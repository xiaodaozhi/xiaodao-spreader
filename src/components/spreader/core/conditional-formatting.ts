// ============ 条件格式引擎（纯 TypeScript，不依赖 Vue） ============
// 设计要点：
// - 规则属于 Sheet，作用于 Range；渲染层临时合成 Base Style + Conditional Format，不写回 cell.style。
// - 数值比较为真正的数值比较；重复/唯一以规则 Range 为计算范围（不含空白）。
// - 公式规则复用现有公式引擎，引用基准 = 规则范围左上角（支持 $ 绝对/相对引用）。

import type {
  ConditionalFormattingRule,
  ConditionalFormattingCondition,
  ConditionalFormattingFormat,
  SelectionRange,
  CellData,
} from './types';
import { colToLabel, labelToCol } from './utils';
import { evalFormulaCondition, shiftFormulaRefs } from './formula';

/** 条件格式求值上下文（由 core-state 注入，引擎本身保持纯净） */
export interface CFContext {
  /** 原始单元格数据（供公式引擎引用） */
  cells: Record<string, CellData>;
  colCount: number;
  rowCount: number;
  locale?: string;
  /** 取单元格计算后的显示值（公式已求值）；用于数值/文本/重复值比较 */
  getCellValue: (col: number, row: number) => string;
}

/** 规则范围左上角（所有 ranges 的最小 startCol/startRow） */
export function ruleAnchor(rule: ConditionalFormattingRule): { col: number; row: number } {
  let col = Infinity;
  let row = Infinity;
  for (const r of rule.ranges) {
    if (r.startCol < col) col = r.startCol;
    if (r.startRow < row) row = r.startRow;
  }
  if (!isFinite(col)) col = 0;
  if (!isFinite(row)) row = 0;
  return { col, row };
}

/** 单元格是否落在任一应用范围之内（含边界） */
export function cellInRanges(ranges: SelectionRange[], col: number, row: number): boolean {
  for (const r of ranges) {
    if (col >= r.startCol && col <= r.endCol && row >= r.startRow && row <= r.endRow) return true;
  }
  return false;
}

/** 解析为数值；无法解析返回 null（让数值比较降级为字符串比较或视为不匹配） */
function parseNumeric(s: string): number | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === '') return null;
  // 兼容千分位、百分比符号等常见用户输入
  const cleaned = t.replace(/[, ]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 计算规则 Range 内各单元格显示值的出现次数（空白不计入重复统计，与 Excel 一致） */
export function computeRuleValueStats(
  rule: ConditionalFormattingRule,
  ctx: CFContext,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const range of rule.ranges) {
    for (let r = range.startRow; r <= range.endRow; r++) {
      for (let c = range.startCol; c <= range.endCol; c++) {
        const v = ctx.getCellValue(c, r);
        if (v === '') continue; // 空白不计入重复判定
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
  }
  return counts;
}

interface RuleStatsCache {
  get(ruleId: string): Map<string, number> | undefined;
  set(ruleId: string, stats: Map<string, number>): void;
  invalidate(ruleId?: string): void;
}

/** 轻量统计缓存：cell / 规则变化时失效，避免每个 repaint 重算重复值统计 */
export class CfValueCache implements RuleStatsCache {
  private map = new Map<string, Map<string, number>>();
  get(ruleId: string): Map<string, number> | undefined {
    return this.map.get(ruleId);
  }
  set(ruleId: string, stats: Map<string, number>): void {
    this.map.set(ruleId, stats);
  }
  invalidate(ruleId?: string): void {
    if (ruleId) this.map.delete(ruleId);
    else this.map.clear();
  }
}

/** 单条件评估：返回 true 表示该单元格命中该规则 */
export function evaluateCondition(
  cond: ConditionalFormattingCondition,
  col: number,
  row: number,
  ctx: CFContext,
  anchor: { col: number; row: number },
  stats?: Map<string, number>,
): boolean {
  switch (cond.type) {
    case 'cellIs': {
      const cellVal = ctx.getCellValue(col, row);
      const cellNum = parseNumeric(cellVal);
      switch (cond.operator) {
        case 'equal': {
          const cv = parseNumeric(cond.value);
          if (cellNum !== null && cv !== null) return cellNum === cv;
          return cellVal === cond.value;
        }
        case 'notEqual': {
          const cv = parseNumeric(cond.value);
          if (cellNum !== null && cv !== null) return cellNum !== cv;
          return cellVal !== cond.value;
        }
        case 'greaterThan': {
          const cv = parseNumeric(cond.value);
          if (cellNum === null || cv === null) return false;
          return cellNum > cv;
        }
        case 'greaterThanOrEqual': {
          const cv = parseNumeric(cond.value);
          if (cellNum === null || cv === null) return false;
          return cellNum >= cv;
        }
        case 'lessThan': {
          const cv = parseNumeric(cond.value);
          if (cellNum === null || cv === null) return false;
          return cellNum < cv;
        }
        case 'lessThanOrEqual': {
          const cv = parseNumeric(cond.value);
          if (cellNum === null || cv === null) return false;
          return cellNum <= cv;
        }
        case 'between': {
          const lo = parseNumeric(cond.value);
          const hi = parseNumeric(cond.value2 ?? '');
          if (cellNum === null || lo === null || hi === null) return false;
          return cellNum >= Math.min(lo, hi) && cellNum <= Math.max(lo, hi);
        }
        case 'notBetween': {
          const lo = parseNumeric(cond.value);
          const hi = parseNumeric(cond.value2 ?? '');
          if (cellNum === null || lo === null || hi === null) return false;
          return cellNum < Math.min(lo, hi) || cellNum > Math.max(lo, hi);
        }
      }
      return false;
    }
    case 'textContains': {
      const v = ctx.getCellValue(col, row).toLowerCase();
      return v.includes(cond.value.toLowerCase());
    }
    case 'textNotContains': {
      const v = ctx.getCellValue(col, row).toLowerCase();
      return !v.includes(cond.value.toLowerCase());
    }
    case 'blank': {
      return ctx.getCellValue(col, row) === '';
    }
    case 'notBlank': {
      return ctx.getCellValue(col, row) !== '';
    }
    case 'duplicate': {
      if (!stats) return false;
      const v = ctx.getCellValue(col, row);
      if (v === '') return false;
      return (stats.get(v) ?? 0) > 1;
    }
    case 'unique': {
      if (!stats) return false;
      const v = ctx.getCellValue(col, row);
      if (v === '') return false;
      return (stats.get(v) ?? 0) === 1;
    }
    case 'formula': {
      try {
        const dCol = col - anchor.col;
        const dRow = row - anchor.row;
        // 剥离前导 '='（Excel 习惯 "=A1>100"），再按基准偏移相对引用
        const expr = cond.formula.trim().replace(/^=/, '');
        const shifted = shiftFormulaRefsSafe(expr, dCol, dRow, ctx.colCount, ctx.rowCount);
        return evalFormulaCondition(shifted, ctx.cells, ctx.colCount, ctx.rowCount);
      } catch {
        // 公式求值出错：该单元格视为「不匹配」，不抛出、不影响其它规则
        return false;
      }
    }
    // 第二阶段占位类型：暂不匹配（保证枚举完整、数据结构稳定）
    case 'colorScale':
    case 'dataBar':
    case 'iconSet':
    case 'topBottom':
    case 'aboveBelowAverage':
      return false;
  }
  return false;
}

/** 安全包装：避免直接复用 formula.ts 的导出名；内部调用 shiftFormulaRefs */
function shiftFormulaRefsSafe(
  formula: string,
  dCol: number,
  dRow: number,
  colCount: number,
  rowCount: number,
): string {
  // 复用既有 shiftFormulaRefs（通过 utils 间接导出更稳妥，此处直接调用）
  return shiftFormulaRefs(formula, dCol, dRow, colCount, rowCount, colToLabel);
}

/**
 * 按优先级合并命中规则，返回最终合成格式；无命中返回 null。
 * priority 越小优先级越高；命中 stopIfTrue 后停止后续规则。
 */
export function resolveConditionalFormatting(
  col: number,
  row: number,
  rules: ConditionalFormattingRule[],
  ctx: CFContext,
  cache?: RuleStatsCache,
): ConditionalFormattingFormat | null {
  if (!rules || rules.length === 0) return null;
  // 仅保留作用于本单元格且启用的规则，按 priority 升序排列（priority 越小优先级越高，先应用）
  const candidates = rules
    .filter((r) => r.enabled && cellInRanges(r.ranges, col, row))
    .sort((a, b) => a.priority - b.priority);
  if (candidates.length === 0) return null;

  let merged: ConditionalFormattingFormat = {};
  let matched = false;
  for (const rule of candidates) {
    const anchor = ruleAnchor(rule);
    let stats: Map<string, number> | undefined;
    if (rule.condition.type === 'duplicate' || rule.condition.type === 'unique') {
      stats = cache?.get(rule.id);
      if (!stats) {
        stats = computeRuleValueStats(rule, ctx);
        cache?.set(rule.id, stats);
      }
    }
    let ok = false;
    try {
      ok = evaluateCondition(rule.condition, col, row, ctx, anchor, stats);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    matched = true;
    // 与 Excel 一致：属性冲突时高优先级（先应用）规则获胜，
    // 低优先级规则仅填充尚未设置（undefined）的属性；显式空串 ''（如清除加粗）视为已设置。
    const f = rule.format;
    if (f.backgroundColor !== undefined && merged.backgroundColor === undefined) merged.backgroundColor = f.backgroundColor;
    if (f.color !== undefined && merged.color === undefined) merged.color = f.color;
    if (f.fontWeight !== undefined && merged.fontWeight === undefined) merged.fontWeight = f.fontWeight;
    if (f.fontStyle !== undefined && merged.fontStyle === undefined) merged.fontStyle = f.fontStyle;
    if (f.underline !== undefined && merged.underline === undefined) merged.underline = f.underline;
    if (f.strikethrough !== undefined && merged.strikethrough === undefined) merged.strikethrough = f.strikethrough;
    if (rule.stopIfTrue) break;
  }
  return matched ? merged : null;
}

/** 将条件格式合成到基础样式上，返回用于渲染的样式片段（仅包含会被覆盖的属性） */
export function applyCfFormat(
  base: { backgroundColor?: string; color?: string; fontWeight?: string; fontStyle?: string; underline?: string; strikethrough?: string },
  cf: ConditionalFormattingFormat | null,
): { backgroundColor?: string; color?: string; fontWeight?: string; fontStyle?: string; underline?: string; strikethrough?: string } {
  const out: { backgroundColor?: string; color?: string; fontWeight?: string; fontStyle?: string; underline?: string; strikethrough?: string } = {
    backgroundColor: base.backgroundColor,
    color: base.color,
    fontWeight: base.fontWeight,
    fontStyle: base.fontStyle,
    underline: base.underline,
    strikethrough: base.strikethrough,
  };
  if (!cf) return out;
  if (cf.backgroundColor !== undefined) out.backgroundColor = cf.backgroundColor;
  if (cf.color !== undefined) out.color = cf.color;
  if (cf.fontWeight !== undefined) out.fontWeight = cf.fontWeight || '';
  if (cf.fontStyle !== undefined) out.fontStyle = cf.fontStyle || '';
  if (cf.underline !== undefined) out.underline = cf.underline || '';
  if (cf.strikethrough !== undefined) out.strikethrough = cf.strikethrough || '';
  return out;
}

/** 生成稳定唯一 ID（供新建规则使用，禁止依赖数组 index） */
export function genRuleId(): string {
  return 'cf_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
