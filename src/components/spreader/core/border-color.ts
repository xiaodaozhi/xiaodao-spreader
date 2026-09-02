/**
 * Border Color - 边框颜色的纯逻辑层（与 Vue / Canvas 完全解耦，可直接单测）。
 *
 * 设计要点：
 *  - 颜色是「每条独立边」的属性（BorderSide.color），与线型（width / style）彼此解耦：
 *      · 改颜色  → 只改 color，保留 width / style，且不创建原本不存在的边框；
 *      · 改线型  → 只改 width，保留已有 color；边原本不存在时才用当前色板的颜色。
 *  - 颜色统一以标准 HEX 字符串存储（'#RRGGBB'）；'' / undefined 表示「自动」，
 *    渲染时回退到 DEFAULT_BORDER_COLOR，从而不破坏既有无颜色数据的历史边框。
 *  - 本模块只做「计划（plan）」，不触碰真实数据；读写由调用方（borders-merge）注入，
 *    因此合并单元格的「锚点存储」等既有机制可以原样复用。
 */

import type { BorderSide, BorderStyle, SelectionRange } from './types';
import type { BorderType } from './border-icon';

/** 默认边框颜色：BorderSide.color 缺失（自动）时的回退色 */
export const DEFAULT_BORDER_COLOR = '#444';

/** 四条边的键名 */
export type BorderSideKey = 'top' | 'right' | 'bottom' | 'left';

export const BORDER_SIDE_KEYS: BorderSideKey[] = ['top', 'right', 'bottom', 'left'];

/** 一条「实际边」：某个 grid 坐标上的某条边（调用方负责把它映射到 merge 锚点） */
export interface BorderTarget {
  col: number;
  row: number;
  side: BorderSideKey;
}

/** 一次改色 / 改线型的写入指令 */
export interface BorderWrite extends BorderTarget {
  next: BorderSide;
}

// ============ 颜色基础 ============

/**
 * 归一化颜色：'' / 非字符串 / 纯空白 → undefined（自动色）。
 * 不做大小写改写，保留用户/调用方写入的原始形态。
 */
export function normalizeBorderColor(color: string | undefined | null): string | undefined {
  if (typeof color !== 'string') return undefined;
  const t = color.trim();
  return t === '' ? undefined : t;
}

/** 颜色比较：大小写不敏感；'' 与 undefined 视为同一个「自动」值 */
export function sameBorderColor(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeBorderColor(a);
  const nb = normalizeBorderColor(b);
  if (na === undefined || nb === undefined) return na === nb;
  return na.toLowerCase() === nb.toLowerCase();
}

/** 解析实际绘制颜色（自动 → 默认色） */
export function resolveBorderColor(color: string | undefined): string {
  return normalizeBorderColor(color) ?? DEFAULT_BORDER_COLOR;
}

// ============ 单边派生 ============

/** 该边是否有实际线宽（用于判断「边框是否存在」） */
export function hasBorderLine(side: BorderSide | undefined): boolean {
  return !!side && typeof side.width === 'number' && side.width > 0;
}

/**
 * 仅替换颜色，保留 width / style。
 * color 为 ''（自动）时删除 color 字段，回到默认色渲染，不残留空串。
 */
export function withBorderColor(side: BorderSide, color: string): BorderSide {
  const next: BorderSide = { ...side };
  const c = normalizeBorderColor(color);
  if (c === undefined) delete next.color;
  else next.color = c;
  return next;
}

/**
 * 仅替换线宽，保留已有 color / style。
 * 边原本不存在、或原本没有颜色时，才使用 fallbackColor（当前色板颜色 / 默认色）。
 * 用于「边框颜色选择器」：只改色不动线型，且只为原本没有颜色的边补上笔刷色。
 */
export function withBorderWidth(
  side: BorderSide | undefined,
  width: number,
  fallbackColor?: string,
): BorderSide {
  const next: BorderSide = side ? { ...side } : {};
  next.width = width;
  if (normalizeBorderColor(next.color) === undefined) {
    const fb = normalizeBorderColor(fallbackColor);
    if (fb === undefined) delete next.color;
    else next.color = fb;
  }
  return next;
}

/**
 * 强制设置线宽与颜色（用于「点击边框类型按钮」场景）：
 * 无论该边是否已存在，都把 width 与 color 设为给定值，color 为自动时删除 color 字段。
 * 与 withBorderWidth 的区别：withBorderWidth 在边已存在且有颜色时保留旧颜色；
 * 这里按 Excel 行为，用当前笔刷色覆盖该边（点「上边框」即把上边设为当前色）。
 * 仅线型样式（style 虚线等）保留，不强制改。
 */
export function forceBorderSide(
  side: BorderSide | undefined,
  width: number,
  color?: string,
): BorderSide {
  const next: BorderSide = side ? { ...side } : {};
  next.width = width;
  const c = normalizeBorderColor(color);
  if (c === undefined) delete next.color;
  else next.color = c;
  return next;
}

// ============ 作用边枚举 ============

/**
 * 枚举某个边框类型在某个选区上要作用的「实际边」。
 *
 * - 'none'      → 无（清除是整格操作，由调用方单独处理）
 * - 'all'       → 选区内每个单元格的四条边（跳过合并区非锚点格）
 * - 'outer' / 'thickOuter' → 选区真正的外轮廓四边
 * - 单边类型    → 该方向上位于选区边界的每一条边
 *
 * 合并单元格不在此处展开：返回的仍是 grid 坐标，由调用方的 getSide / setSide
 * 统一重定向到 merge 锚点，与既有「合并区域锚点存储」机制保持一致。
 */
export function forEachBorderTarget(
  bt: BorderType,
  range: SelectionRange,
  cb: (t: BorderTarget) => void,
): void {
  const sC = Math.min(range.startCol, range.endCol);
  const eC = Math.max(range.startCol, range.endCol);
  const sR = Math.min(range.startRow, range.endRow);
  const eR = Math.max(range.startRow, range.endRow);
  if (eC < sC || eR < sR) return;

  if (bt === 'none') return;

  if (bt === 'all') {
    for (let c = sC; c <= eC; c++) {
      for (let r = sR; r <= eR; r++) {
        for (const side of BORDER_SIDE_KEYS) cb({ col: c, row: r, side });
      }
    }
    return;
  }

  if (bt === 'outer' || bt === 'thickOuter') {
    // 单行 / 单列选区时四边都会命中同一批格子，四条边各自独立处理即可（互不覆盖）
    for (let c = sC; c <= eC; c++) {
      cb({ col: c, row: sR, side: 'top' });
      cb({ col: c, row: eR, side: 'bottom' });
    }
    for (let r = sR; r <= eR; r++) {
      cb({ col: sC, row: r, side: 'left' });
      cb({ col: eC, row: r, side: 'right' });
    }
    return;
  }

  // 单边类型：bottom / top / left / right
  const sideMap: Partial<Record<BorderType, { side: BorderSideKey; isEdge: (c: number, r: number) => boolean }>> = {
    bottom: { side: 'bottom', isEdge: (_c, r) => r === eR },
    top: { side: 'top', isEdge: (_c, r) => r === sR },
    left: { side: 'left', isEdge: (c, _r) => c === sC },
    right: { side: 'right', isEdge: (c, _r) => c === eC },
  };
  const info = sideMap[bt];
  if (!info) return;
  for (let c = sC; c <= eC; c++) {
    for (let r = sR; r <= eR; r++) {
      if (info.isEdge(c, r)) cb({ col: c, row: r, side: info.side });
    }
  }
}

/**
 * 计算「改颜色」的写入计划。
 *
 * 约束（对应需求）：
 *  - 只命中已经存在的边框（width > 0），绝不因此创建出新的边框；
 *  - 颜色无变化（含大小写差异）的边不产生写入；
 *  - 每条实际边独立成条，相邻单元格的共享边各自记录自己那一份，
 *    不做任何跨单元格同步 - 谁被选到才改谁，避免一侧改色把另一侧覆盖掉。
 */
export function planBorderColorChanges(
  bt: BorderType,
  range: SelectionRange,
  color: string,
  getSide: (col: number, row: number, side: BorderSideKey) => BorderSide | undefined,
): BorderWrite[] {
  const out: BorderWrite[] = [];
  forEachBorderTarget(bt, range, ({ col, row, side }) => {
    const cur = getSide(col, row, side);
    if (!hasBorderLine(cur)) return; // 不存在的边框不创建
    const next = withBorderColor(cur!, color);
    if (sameBorderColor(cur?.color, next.color)) return; // 无实际变化
    out.push({ col, row, side, next });
  });
  return out;
}

/**
 * 计算「改线型」的逐边写入计划（'all' / 'none' 之外的类型）。
 * 已存在的边保留自己的颜色，只更新 width；新建的边使用 fallbackColor。
 */
export function planBorderTypeWrites(
  bt: BorderType,
  range: SelectionRange,
  width: number,
  fallbackColor: string | undefined,
  getSide: (col: number, row: number, side: BorderSideKey) => BorderSide | undefined,
): BorderWrite[] {
  const out: BorderWrite[] = [];
  forEachBorderTarget(bt, range, ({ col, row, side }) => {
    const cur = getSide(col, row, side);
    out.push({ col, row, side, next: withBorderWidth(cur, width, fallbackColor) });
  });
  return out;
}

/**
 * 为 'all' 生成整格边框（四边一次性替换），逐边保留已有颜色。
 * 供 applyBorderToCell 这类「整格覆盖」入口使用。
 */
export function buildAllSidesBorder(
  col: number,
  row: number,
  width: number,
  fallbackColor: string | undefined,
  getSide: (col: number, row: number, side: BorderSideKey) => BorderSide | undefined,
): BorderStyle {
  const border: BorderStyle = {};
  for (const side of BORDER_SIDE_KEYS) {
    border[side] = withBorderWidth(getSide(col, row, side), width, fallbackColor);
  }
  return border;
}

/**
 * 为 'all' 生成整格边框（四边一次性替换），逐边强制设为给定线宽与颜色（覆盖原有颜色）。
 * 用于「点击『所有框线』按钮」：统一用当前笔刷色覆盖四条边框。
 */
export function forceAllSidesBorder(
  col: number,
  row: number,
  width: number,
  color: string | undefined,
  getSide: (col: number, row: number, side: BorderSideKey) => BorderSide | undefined,
): BorderStyle {
  const border: BorderStyle = {};
  for (const side of BORDER_SIDE_KEYS) {
    border[side] = forceBorderSide(getSide(col, row, side), width, color);
  }
  return border;
}

/**
 * 读取选区在「当前边框类型作用域」内的统一边框颜色：
 *  - 所有被命中的边颜色一致 → 返回该色；
 *  - 存在不同颜色，或命中的边为空 → 返回 undefined（自动 / 混合，UI 按未选中处理）。
 *
 * 只统计真实存在的边框，未被画线的边不参与，避免「部分单元格没边框」把结果拉成混合。
 */
export function resolveSelectionBorderColor(
  bt: BorderType,
  range: SelectionRange,
  getSide: (col: number, row: number, side: BorderSideKey) => BorderSide | undefined,
): string | undefined {
  let first: string | undefined;
  let seen = false;
  let mixed = false;
  forEachBorderTarget(bt, range, ({ col, row, side }) => {
    if (mixed) return;
    const cur = getSide(col, row, side);
    if (!hasBorderLine(cur)) return; // 不存在的边不参与
    const v = normalizeBorderColor(cur!.color);
    if (!seen) {
      first = v;
      seen = true;
      return;
    }
    if (!sameBorderColor(first, v)) mixed = true;
  });
  if (mixed || !seen) return undefined;
  return first;
}
