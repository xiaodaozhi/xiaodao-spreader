// ============ 数据验证引擎（纯 TypeScript，不依赖 Vue） ============
// 设计要点：
// - 规则属于 Sheet，作用于 Range（支持多区域）；下拉列表只是 list 类型的一种 UI 表现。
// - 数值/日期/时间比较全部复用项目既有的 number-format 解析器，不另建第二套规则。
// - 自定义公式复用既有 Formula Engine，引用基准 = 规则范围左上角（与条件格式一致，支持 $ 绝对/相对引用）。
// - 单条规则求值出错只影响当前验证，不抛出、不影响其它规则。
// - Rule / Condition / UI Behavior 解耦：本文件只回答「值是否合法」，UI 行为由调用方决定。

import type {
  CellData,
  SelectionRange,
  DataValidationRule,
  DataValidationResult,
  DataValidationOperator,
  DataValidationSeverity,
  DataValidationListSource,
} from './types';
import {
  isNumericValue,
  parseDateTimeInput,
  parseNumericText,
} from './number-format';
import { clearEvalCache, evalFormulaCondition, evalFormulaText, shiftFormulaRefs } from './formula';
import { colToLabel } from './utils';
import { t } from './constants';

// ============ 上下文 ============

/** 数据验证求值上下文（由 core-state 注入，引擎本身保持纯净） */
export interface DataValidationContext {
  /** 当前工作表原始单元格数据（供公式引擎引用） */
  cells: Record<string, CellData>;
  colCount: number;
  rowCount: number;
  locale: string;
  /** 取单元格计算后的值（公式已求值） */
  getCellValue: (col: number, row: number) => string;
  /** 按 id 或名称取其它工作表的 cells；用于 list 类型跨表引用。取不到返回 null */
  getSheetCells?: (sheetId: string) => Record<string, CellData> | null;
}

// ============ 基础工具 ============

/** 生成稳定唯一 ID（供新建规则使用，禁止依赖数组 index） */
export function genDataValidationId(): string {
  return 'dv_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 单元格是否落在任一应用范围之内（含边界） */
export function dvCellInRanges(ranges: SelectionRange[], col: number, row: number): boolean {
  for (const r of ranges) {
    if (col >= r.startCol && col <= r.endCol && row >= r.startRow && row <= r.endRow) return true;
  }
  return false;
}

/** 规则范围左上角（所有 ranges 的最小 startCol/startRow），作为相对引用的基准 */
export function dvRuleAnchor(rule: DataValidationRule): { col: number; row: number } {
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

/**
 * 空值判定：null / undefined / '' / 纯空白 均视为空。
 * 与「不存在的单元格」在业务上等价（本项目单元格缺省即空字符串）。
 */
export function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return false;
  const s = typeof value === 'string' ? value : String(value);
  return s.trim() === '';
}

/** 文本长度：按 Unicode 码点统计（中文 / Emoji 不会像 UTF-16 那样被算成 2） */
export function dvTextLength(value: string): number {
  if (!value) return 0;
  return Array.from(value).length;
}

// ============ 数值 / 日期 / 时间解析 ============

/** 严格数值正则：整数、小数、正负号、科学计数法（不允许 0x / Infinity 等） */
const STRICT_NUM_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * 将「操作数」（单元格输入值或规则条件值）解析为数值。
 * - 前导 '=' 视为公式，求值后取数值结果（如 =TODAY()）；公式错误返回 null；
 * - 复用项目 parseNumericText 处理千分位 / 百分比 / 货币符号；
 * - 其余走严格数值正则，避免 Number('0x10') 之类的误判。
 */
export function parseNumericOperand(raw: string, ctx: DataValidationContext): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (s.startsWith('=')) {
    const v = evalFormulaSafe(s.slice(1), ctx);
    return typeof v === 'number' && Number.isFinite(v) ? v : (v === null ? null : Number(v));
  }
  const nt = parseNumericText(s, ctx.locale);
  if (nt && Number.isFinite(nt.num)) return nt.num;
  if (STRICT_NUM_RE.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 求值一段公式（不含前导 '='），出错返回 null */
function evalFormulaSafe(expr: string, ctx: DataValidationContext): string | number | null {
  try {
    clearEvalCache();
    return evalFormulaText(expr, ctx.cells, ctx.colCount, ctx.rowCount);
  } catch {
    return null;
  }
}

/**
 * 将操作数解析为「日期序列号」。
 * - 纯数值 → 直接作为序列号（Excel 日期序列）；
 * - 日期/日期时间字符串 → 复用项目 parseDateTimeInput（与单元格输入识别同源）；
 * - 纯时间字符串（如 12:30）不属于日期 → null。
 */
export function parseDateOperand(raw: string, ctx: DataValidationContext): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (s.startsWith('=')) {
    const v = evalFormulaSafe(s.slice(1), ctx);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') return parseDateOperand(v, ctx);
    return null;
  }
  if (isNumericValue(s) || STRICT_NUM_RE.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const dt = parseDateTimeInput(s, ctx.locale);
  // parseDateTimeInput 对纯时间返回 'h:mm:ss' 格式，日期校验不应接受纯时间
  if (dt && dt.format !== 'h:mm:ss') return dt.serial;
  return null;
}

/**
 * 将操作数解析为「时间」（一天的分数，0 <= x < 1）。
 * - 纯时间字符串 → 复用 parseDateTimeInput；
 * - 日期时间字符串 → 取小数部分；
 * - 数值 → 取小数部分（Excel 时间即序列的小数部分）。
 */
export function parseTimeOperand(raw: string, ctx: DataValidationContext): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (s.startsWith('=')) {
    const v = evalFormulaSafe(s.slice(1), ctx);
    if (typeof v === 'number' && Number.isFinite(v)) return fracOfDay(v);
    if (typeof v === 'string') return parseTimeOperand(v, ctx);
    return null;
  }
  const dt = parseDateTimeInput(s, ctx.locale);
  if (dt) {
    // 纯时间：serial 本身即一天的分数；日期时间：取小数部分
    return dt.format === 'h:mm:ss' ? dt.serial : fracOfDay(dt.serial);
  }
  if (isNumericValue(s)) return fracOfDay(Number(s));
  return null;
}

/** 取一天中的时间分量（0 <= x < 1） */
function fracOfDay(serial: number): number {
  if (!Number.isFinite(serial)) return 0;
  const f = Math.abs(serial) % 1;
  return f;
}

// ============ 运算符 ============

/** 通用比较：op 作用于 (value, v1[, v2])；操作数解析失败或比较数缺失一律视为不通过（返回 false） */
export function compareWithOperator(
  op: DataValidationOperator,
  value: number,
  v1: number | null,
  v2: number | null,
): boolean {
  switch (op) {
    case 'between':
      if (v1 === null || v2 === null) return false;
      return value >= Math.min(v1, v2) && value <= Math.max(v1, v2);
    case 'notBetween':
      if (v1 === null || v2 === null) return false;
      return value < Math.min(v1, v2) || value > Math.max(v1, v2);
    case 'equal':
      return v1 !== null && value === v1;
    case 'notEqual':
      return v1 !== null && value !== v1;
    case 'greaterThan':
      return v1 !== null && value > v1;
    case 'greaterThanOrEqual':
      return v1 !== null && value >= v1;
    case 'lessThan':
      return v1 !== null && value < v1;
    case 'lessThanOrEqual':
      return v1 !== null && value <= v1;
    default:
      return false;
  }
}

// ============ 下拉列表数据源 ============

/** 列表项归一化：去空白后比较；保留原始文本用于回写单元格 */
function normalizeListItem(v: string): string {
  return String(v ?? '').trim().toLowerCase();
}

/**
 * 解析 list 规则的候选项（去重、保序）。
 * - values：直接使用常量列表；
 * - range：读取目标区域（默认当前表，可通过 sheetId 跨表），空单元格按 allowBlank 决定是否保留。
 * 本函数不做缓存（缓存与失效由调用方 core-state 负责）。
 */
export function resolveListItems(
  rule: DataValidationRule,
  ctx: DataValidationContext,
): string[] {
  const src: DataValidationListSource | undefined =
    rule.listSource
    ?? (rule.values ? { type: 'values', values: rule.values } : undefined);
  if (!src) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    const key = normalizeListItem(v);
    if (!key) {
      // 空项：仅在「允许空值」时作为可选项出现（Excel 语义：能选到空 = 允许空）
      if (rule.allowBlank === false) return;
      if (seen.has('\u0000blank')) return;
      seen.add('\u0000blank');
      out.push('');
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  if (src.type === 'values') {
    for (const v of src.values ?? []) push(v);
    return out;
  }

  // range：按行优先读取（与 Excel 一致）
  const { range, sheetId } = src;
  const foreign = sheetId ? ctx.getSheetCells?.(sheetId) ?? null : null;
  const cells = foreign ?? ctx.cells;
  for (let r = range.startRow; r <= range.endRow; r++) {
    for (let c = range.startCol; c <= range.endCol; c++) {
      const key = `${c},${r}`;
      const cell = cells[key];
      // 区分「真正不存在的 Cell」与「存在但为空的 Cell」：前者直接跳过，后者按 allowBlank 处理
      if (!cell) continue;
      if (foreign) {
        const raw = cell.value;
        push(raw.startsWith('=') ? resolveForeignFormula(raw, foreign, ctx) : raw);
      } else {
        push(ctx.getCellValue(c, r));
      }
    }
  }
  return out;
}

/** 跨表引用中的公式单元格：用目标表的 cells 求值一次（错误则回退空字符串） */
function resolveForeignFormula(
  raw: string,
  foreignCells: Record<string, CellData>,
  ctx: DataValidationContext,
): string {
  try {
    clearEvalCache();
    const v = evalFormulaText(raw.slice(1), foreignCells, ctx.colCount, ctx.rowCount);
    return v === null ? '' : String(v);
  } catch {
    return '';
  }
}

/** list 规则是否显示单元格内下拉箭头 */
export function hasDropdownIndicator(rule: DataValidationRule | null | undefined): boolean {
  return !!rule && rule.type === 'list' && rule.showDropdown !== false && rule.enabled !== false;
}

// ============ 单规则求值 ============

/**
 * 创建「带候选值覆盖」的 cells 视图：自定义公式可能引用目标单元格自身（如 =AND(B2>=0,B2<=100)），
 * 校验发生在写入之前，必须让公式看到「候选值」而不是旧值。使用 Proxy 避免 O(n) 拷贝。
 */
function withCandidateValue(
  base: Record<string, CellData>,
  key: string,
  value: string,
): Record<string, CellData> {
  const override: CellData = { value };
  return new Proxy(base, {
    get(target, prop) {
      if (prop === key) return override;
      return target[prop as string];
    },
    has(target, prop) {
      if (prop === key) return true;
      return prop in target;
    },
  });
}

/** 单条规则求值：value 为待写入的原始文本（不含隐式类型转换），col/row 为目标单元格坐标 */
export function evaluateDataValidationRule(
  rule: DataValidationRule,
  value: string | null | undefined,
  col: number,
  row: number,
  ctx: DataValidationContext,
): boolean {
  if (rule.enabled === false) return true;
  const raw = value == null ? '' : String(value);

  // allowBlank 优先：空值直接放行（Excel「忽略空值」默认勾选）
  if (isBlankValue(raw)) return rule.allowBlank !== false;

  try {
    switch (rule.type) {
      case 'any':
        return true; // 「任何值」：不做任何限制
      case 'list': {
        const items = resolveListItems(rule, ctx);
        const target = normalizeListItem(raw);
        return items.some((it) => normalizeListItem(it) === target);
      }
      case 'wholeNumber': {
        const n = parseNumericOperand(raw, ctx);
        if (n === null || !Number.isFinite(n)) return false;
        if (!Number.isInteger(n)) return false;
        return applyOperator(rule, n, ctx, parseNumericOperand);
      }
      case 'decimal': {
        const n = parseNumericOperand(raw, ctx);
        if (n === null || !Number.isFinite(n)) return false;
        return applyOperator(rule, n, ctx, parseNumericOperand);
      }
      case 'date': {
        const n = parseDateOperand(raw, ctx);
        if (n === null) return false;
        return applyOperator(rule, n, ctx, parseDateOperand);
      }
      case 'time': {
        const n = parseTimeOperand(raw, ctx);
        if (n === null) return false;
        return applyOperator(rule, n, ctx, parseTimeOperand);
      }
      case 'textLength': {
        const n = dvTextLength(raw);
        return applyOperator(rule, n, ctx, parseNumericOperand);
      }
      case 'custom': {
        const expr = (rule.formula1 ?? '').trim().replace(/^=/, '');
        if (!expr) return true; // 未配置公式不做限制
        return evaluateCustomFormula(expr, value, col, row, rule, ctx);
      }
      default:
        return true;
    }
  } catch {
    // 单条规则求值出错：仅该规则视为不通过，不抛出、不影响其它规则
    return false;
  }
}

/** 按 operator 将候选值 n 与 formula1/formula2 比较；未配置 operator 时视为通过 */
function applyOperator(
  rule: DataValidationRule,
  n: number,
  ctx: DataValidationContext,
  parse: (raw: string, ctx: DataValidationContext) => number | null,
): boolean {
  const op = rule.operator;
  if (!op) return true;
  const v1 = rule.formula1 !== undefined && rule.formula1 !== '' ? parse(rule.formula1, ctx) : null;
  const v2 = rule.formula2 !== undefined && rule.formula2 !== '' ? parse(rule.formula2, ctx) : null;
  return compareWithOperator(op, n, v1, v2);
}

/**
 * 自定义公式求值：
 *  1. 公式中的相对引用以「规则范围左上角」为基准，按目标单元格偏移（与 Excel 相对引用语义一致）；
 *  2. 用候选值覆盖目标单元格，使 =AND(B2>=0,B2<=100) 这类自引用公式按待写入值判断；
 *  3. 公式本身出错（#REF!/#VALUE! 等）→ 视为不通过，但不抛异常。
 */
function evaluateCustomFormula(
  expr: string,
  value: string | null | undefined,
  col: number,
  row: number,
  rule: DataValidationRule,
  ctx: DataValidationContext,
): boolean {
  try {
    const anchor = dvRuleAnchor(rule);
    const shifted = shiftFormulaRefs(
      expr,
      col - anchor.col,
      row - anchor.row,
      ctx.colCount,
      ctx.rowCount,
      colToLabel,
    );
    const cellsView = withCandidateValue(ctx.cells, `${col},${row}`, value == null ? '' : String(value));
    clearEvalCache();
    return evalFormulaCondition(shifted, cellsView, ctx.colCount, ctx.rowCount);
  } catch {
    return false;
  }
}

// ============ 结果聚合 ============

const SEVERITY_RANK: Record<DataValidationSeverity, number> = {
  stop: 3,
  warning: 2,
  information: 1,
};

/** errorStyle → severity（未配置默认 stop） */
export function dvSeverityOf(rule: DataValidationRule): DataValidationSeverity {
  return rule.errorStyle === 'warning' || rule.errorStyle === 'information'
    ? rule.errorStyle
    : 'stop';
}

/**
 * 校验某个单元格的候选值。
 * 规则：命中范围内的**所有**规则必须全部通过（rules.every）；
 * 失败时取严重级别最高（stop > warning > information）的那条规则生成提示。
 */
export function validateCellValue(
  value: string | null | undefined,
  col: number,
  row: number,
  rules: DataValidationRule[],
  ctx: DataValidationContext,
): DataValidationResult {
  if (!rules || rules.length === 0) return { valid: true };
  let worst: DataValidationRule | null = null;
  let worstRank = 0;
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (!dvCellInRanges(rule.ranges, col, row)) continue;
    let ok = false;
    try {
      ok = evaluateDataValidationRule(rule, value, col, row, ctx);
    } catch {
      ok = false;
    }
    if (ok) continue;
    // showErrorMessage=false 时仍需阻止/提示，但用默认文案
    const rank = SEVERITY_RANK[dvSeverityOf(rule)];
    if (rank > worstRank) {
      worstRank = rank;
      worst = rule;
    }
  }
  if (!worst) return { valid: true };
  const severity = dvSeverityOf(worst);
  const showError = worst.showErrorMessage !== false;
  const texts = defaultDataValidationText(worst, ctx.locale);
  return {
    valid: false,
    rule: worst,
    severity,
    title: (showError && worst.errorTitle) ? worst.errorTitle : texts.title,
    message: (showError && worst.errorMessage) ? worst.errorMessage : texts.message,
  };
}

/**
 * 生成默认错误提示文案（用户未自定义 title/message 时使用）。
 * 文案按类型描述约束条件，便于用户理解「为什么非法」。
 */
export function defaultDataValidationText(
  rule: DataValidationRule,
  locale: string,
): { title: string; message: string } {
  const title = t(locale, 'dvErrorTitleDefault');
  const opLabel = rule.operator ? t(locale, `dv${cap(rule.operator)}`) : '';
  switch (rule.type) {
    case 'list': {
      const items = rule.listSource?.type === 'values'
        ? (rule.listSource.values ?? rule.values ?? [])
        : (rule.values ?? []);
      const brief = items.filter(Boolean).slice(0, 6).join(', ');
      return {
        title,
        message: t(locale, brief ? 'dvMsgList' : 'dvMsgListEmpty').replace('{values}', brief),
      };
    }
    case 'wholeNumber':
      return { title, message: buildRangeMessage(locale, t(locale, 'dvTypeWholeNumber'), opLabel, rule) };
    case 'decimal':
      return { title, message: buildRangeMessage(locale, t(locale, 'dvTypeDecimal'), opLabel, rule) };
    case 'date':
      return { title, message: buildRangeMessage(locale, t(locale, 'dvTypeDate'), opLabel, rule) };
    case 'time':
      return { title, message: buildRangeMessage(locale, t(locale, 'dvTypeTime'), opLabel, rule) };
    case 'textLength':
      return { title, message: buildRangeMessage(locale, t(locale, 'dvTypeTextLength'), opLabel, rule) };
    case 'custom':
      return { title, message: t(locale, 'dvMsgCustom').replace('{formula}', rule.formula1 ?? '') };
    default:
      return { title, message: t(locale, 'dvMsgInvalid') };
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildRangeMessage(
  locale: string,
  typeLabel: string,
  opLabel: string,
  rule: DataValidationRule,
): string {
  if (!opLabel) return t(locale, 'dvMsgInvalid');
  if (rule.operator === 'between' || rule.operator === 'notBetween') {
    return t(locale, rule.operator === 'between' ? 'dvMsgBetween' : 'dvMsgNotBetween')
      .replace('{type}', typeLabel)
      .replace('{min}', rule.formula1 ?? '')
      .replace('{max}', rule.formula2 ?? '');
  }
  return t(locale, 'dvMsgCompare')
    .replace('{type}', typeLabel)
    .replace('{op}', opLabel)
    .replace('{value}', rule.formula1 ?? '');
}

// ============ 规则范围索引 ============
// 目标：避免「编辑一个 Cell → 遍历整表 / 全部规则」。
// 以行分带（band）建立倒排：每行带只保存与之相交的 (rule, rangeIndex)，
// 查询时只需检查该行带的候选，再做精确矩形判定。

const DV_BAND_SIZE = 64;

interface DvIndexEntry {
  rule: DataValidationRule;
  range: SelectionRange;
}

/**
 * 数据验证规则空间索引。
 * - rebuild(rules)：重建（随规则变化调用，成本 O(区域总数)）；
 * - getRules(col,row)：返回命中该单元格且启用的规则列表。
 */
export class DataValidationIndex {
  private bands = new Map<number, DvIndexEntry[]>();
  private dirty = true;
  private source: DataValidationRule[] = [];

  constructor(rules: DataValidationRule[] = []) {
    this.source = rules;
  }

  /** 规则集合发生变化（增/删/改/切表/撤销恢复）后调用 */
  invalidate(): void {
    this.dirty = true;
  }

  private ensure(rules?: DataValidationRule[]): void {
    if (rules && rules !== this.source) {
      this.source = rules;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.bands.clear();
    for (const rule of this.source) {
      if (!rule || rule.enabled === false) continue;
      for (const range of rule.ranges ?? []) {
        const b0 = Math.floor(range.startRow / DV_BAND_SIZE);
        const b1 = Math.floor(range.endRow / DV_BAND_SIZE);
        for (let b = b0; b <= b1; b++) {
          let list = this.bands.get(b);
          if (!list) {
            list = [];
            this.bands.set(b, list);
          }
          list.push({ rule, range });
        }
      }
    }
    this.dirty = false;
  }

  /** 命中该单元格的规则（保持源数组顺序） */
  getRules(col: number, row: number, rules?: DataValidationRule[]): DataValidationRule[] {
    this.ensure(rules);
    const list = this.bands.get(Math.floor(row / DV_BAND_SIZE));
    if (!list || list.length === 0) return [];
    const out: DataValidationRule[] = [];
    for (const e of list) {
      if (col < e.range.startCol || col > e.range.endCol) continue;
      if (row < e.range.startRow || row > e.range.endRow) continue;
      if (!out.includes(e.rule)) out.push(e.rule);
    }
    return out;
  }

  /** 该单元格是否存在任何数据验证 */
  has(col: number, row: number, rules?: DataValidationRule[]): boolean {
    const list = this.bandsOf(col, row, rules);
    for (const e of list) {
      if (col < e.range.startCol || col > e.range.endCol) continue;
      if (row < e.range.startRow || row > e.range.endRow) continue;
      return true;
    }
    return false;
  }

  /**
   * 命中该单元格且满足 predicate 的首条规则。
   * 渲染热路径（每格判定是否画下拉箭头）专用：不分配数组，零垃圾。
   */
  findRule(
    col: number,
    row: number,
    predicate: (rule: DataValidationRule) => boolean,
    rules?: DataValidationRule[],
  ): DataValidationRule | null {
    for (const e of this.bandsOf(col, row, rules)) {
      if (col < e.range.startCol || col > e.range.endCol) continue;
      if (row < e.range.startRow || row > e.range.endRow) continue;
      if (predicate(e.rule)) return e.rule;
    }
    return null;
  }

  /** 取某坐标所在行带的候选条目（必要时先重建索引） */
  private bandsOf(col: number, row: number, rules?: DataValidationRule[]): DvIndexEntry[] {
    this.ensure(rules);
    return this.bands.get(Math.floor(row / DV_BAND_SIZE)) ?? EMPTY_ENTRIES;
  }
}

const EMPTY_ENTRIES: DvIndexEntry[] = [];

// ============ 规则范围变换（插入/删除行列） ============

/** 删除带（axis='row' 删行 / 'col' 删列）后收缩单个 Range；整段落在删除带内返回 null */
export function adjustDvRangeForDelete(
  r: SelectionRange,
  axis: 'row' | 'col',
  idx: number,
  count: number,
): SelectionRange | null {
  if (axis === 'row') {
    const s = r.startRow;
    const e = r.endRow;
    let ns: number;
    let ne: number;
    if (e < idx) {
      ns = s;
      ne = e;
    } else if (s > idx + count - 1) {
      ns = s - count;
      ne = e - count;
    } else {
      ns = s < idx ? s : idx;
      ne = e > idx + count - 1 ? e - count : idx - 1;
      if (ne < ns) return null;
    }
    return { ...r, startRow: ns, endRow: ne };
  }
  const s = r.startCol;
  const e = r.endCol;
  let ns: number;
  let ne: number;
  if (e < idx) {
    ns = s;
    ne = e;
  } else if (s > idx + count - 1) {
    ns = s - count;
    ne = e - count;
  } else {
    ns = s < idx ? s : idx;
    ne = e > idx + count - 1 ? e - count : idx - 1;
    if (ne < ns) return null;
  }
  return { ...r, startCol: ns, endCol: ne };
}

/** 插入带（axis='row' 插行 / 'col' 插列）后放大单个 Range */
export function adjustDvRangeForInsert(
  r: SelectionRange,
  axis: 'row' | 'col',
  idx: number,
  count: number,
): SelectionRange {
  if (axis === 'row') {
    const s = r.startRow;
    const e = r.endRow;
    if (s >= idx) return { ...r, startRow: s + count, endRow: e + count };
    if (e < idx) return r;
    return { ...r, endRow: e + count };
  }
  const s = r.startCol;
  const e = r.endCol;
  if (s >= idx) return { ...r, startCol: s + count, endCol: e + count };
  if (e < idx) return r;
  return { ...r, endCol: e + count };
}

/** 规则区域是否与给定矩形相交 */
export function dvRangeIntersects(a: SelectionRange, b: SelectionRange): boolean {
  return !(a.endCol < b.startCol || a.startCol > b.endCol
    || a.endRow < b.startRow || a.startRow > b.endRow);
}

/**
 * 从规则中扣除给定矩形（用于「清除所选区域的验证」）：
 * 支持矩形差集拆分，剩余为空时返回空数组。
 */
export function subtractDvRange(
  range: SelectionRange,
  cut: SelectionRange,
): SelectionRange[] {
  if (!dvRangeIntersects(range, cut)) return [{ ...range }];
  // 上 / 下 / 左 / 右 四个残余条带
  const out: SelectionRange[] = [];
  if (range.startRow < cut.startRow) {
    out.push({
      startCol: range.startCol, endCol: range.endCol,
      startRow: range.startRow, endRow: cut.startRow - 1,
    });
  }
  if (range.endRow > cut.endRow) {
    out.push({
      startCol: range.startCol, endCol: range.endCol,
      startRow: cut.endRow + 1, endRow: range.endRow,
    });
  }
  const midTop = Math.max(range.startRow, cut.startRow);
  const midBottom = Math.min(range.endRow, cut.endRow);
  if (midTop <= midBottom) {
    if (range.startCol < cut.startCol) {
      out.push({
        startCol: range.startCol, endCol: cut.startCol - 1,
        startRow: midTop, endRow: midBottom,
      });
    }
    if (range.endCol > cut.endCol) {
      out.push({
        startCol: cut.endCol + 1, endCol: range.endCol,
        startRow: midTop, endRow: midBottom,
      });
    }
  }
  return out;
}

/** 平移规则的某个区域（复制粘贴携带规则时使用） */
export function translateDvRange(
  r: SelectionRange,
  dCol: number,
  dRow: number,
): SelectionRange {
  return {
    startCol: r.startCol + dCol,
    endCol: r.endCol + dCol,
    startRow: r.startRow + dRow,
    endRow: r.endRow + dRow,
  };
}

/** 求两个矩形的交集；不相交返回 null */
export function intersectDvRange(a: SelectionRange, b: SelectionRange): SelectionRange | null {
  if (!dvRangeIntersects(a, b)) return null;
  return {
    startCol: Math.max(a.startCol, b.startCol),
    endCol: Math.min(a.endCol, b.endCol),
    startRow: Math.max(a.startRow, b.startRow),
    endRow: Math.min(a.endRow, b.endRow),
  };
}

