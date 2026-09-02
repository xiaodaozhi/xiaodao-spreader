/**
 * Border Icon - 边框图标的单一数据源。
 *
 * toolbar 主按钮与 border-picker 下拉项渲染的是同一套「田字型」边框图标，
 * 此前两处各维护一份 BORDER_SEGS / SOLID_SEGS / THICK_SEGS / segRole，
 * 靠注释「与 border-picker.vue 保持一致」约束，实际极易改一处漏一处。
 * 现统一收敛到此模块，两处都从这里取，杜绝不同步。
 */

export type BorderType = 'none' | 'bottom' | 'top' | 'left' | 'right' | 'all' | 'outer' | 'thickOuter';

/** 田字型边框图标：4 个外边 + 1 条竖中线 + 1 条横中线（viewBox 0 0 30 30） */
export interface BorderSeg { name: string; x1: number; y1: number; x2: number; y2: number }

export const BORDER_SEGS: BorderSeg[] = [
  { name: 'top', x1: 4, y1: 4, x2: 26, y2: 4 },
  { name: 'bottom', x1: 4, y1: 26, x2: 26, y2: 26 },
  { name: 'left', x1: 4, y1: 4, x2: 4, y2: 26 },
  { name: 'right', x1: 26, y1: 4, x2: 26, y2: 26 },
  { name: 'vMid', x1: 15, y1: 4, x2: 15, y2: 26 },
  { name: 'hMid', x1: 4, y1: 15, x2: 26, y2: 15 },
];

/** 各边框类型对应的实线段；粗外框线对应粗实线段；未列出者为虚线 */
export const SOLID_SEGS: Record<BorderType, string[]> = {
  bottom: ['bottom'],
  top: ['top'],
  left: ['left'],
  right: ['right'],
  none: [],
  all: ['top', 'bottom', 'left', 'right', 'vMid', 'hMid'],
  outer: ['top', 'bottom', 'left', 'right'],
  thickOuter: ['top', 'bottom', 'left', 'right'],
};

export const THICK_SEGS: Record<BorderType, string[]> = {
  bottom: [],
  top: [],
  left: [],
  right: [],
  none: [],
  all: [],
  outer: [],
  thickOuter: ['top', 'bottom', 'left', 'right'],
};

export function segRole(bt: BorderType, name: string): 'solid' | 'dashed' | 'thick' {
  if (THICK_SEGS[bt].includes(name)) return 'thick';
  if (SOLID_SEGS[bt].includes(name)) return 'solid';
  return 'dashed';
}

/**
 * 右下角是否需要补点。
 *
 * 外边线段长 22（4 → 26），虚线用 dasharray "0 4" + round cap 画圆点，
 * 22 / 4 = 5.5 不整除，于是最后一点落在 (24,26) / (26,24)，
 * 角点 (26,26) 恰好是两条虚线的空白位，露出缺口。
 * 仅当 right 与 bottom 同时为虚线时才可见（top / left / none 三种）。
 */
export function needsCornerDot(bt: BorderType): boolean {
  return segRole(bt, 'right') === 'dashed' && segRole(bt, 'bottom') === 'dashed';
}

/** 补充圆点半径：与 stroke-width 1.5 的 round cap 圆点直径一致 */
export const CORNER_DOT_R = 0.75;
/** 补充圆点位置：右下角交点 */
export const CORNER_DOT_CX = 26;
export const CORNER_DOT_CY = 26;

/** 下拉菜单选项顺序 */
export const BORDER_OPTIONS: { key: BorderType; i18nKey: string }[] = [
  { key: 'bottom', i18nKey: 'borderBottom' },
  { key: 'top', i18nKey: 'borderTop' },
  { key: 'left', i18nKey: 'borderLeft' },
  { key: 'right', i18nKey: 'borderRight' },
  { key: 'none', i18nKey: 'borderNone' },
  { key: 'all', i18nKey: 'borderAll' },
  { key: 'outer', i18nKey: 'borderOuter' },
  { key: 'thickOuter', i18nKey: 'borderThickOuter' },
];

/** 各边框类型对应的 i18n 文案 key（toolbar 主按钮标签用） */
export const BORDER_LABEL_KEY: Record<BorderType, string> = {
  none: 'borderNone',
  bottom: 'borderBottom',
  top: 'borderTop',
  left: 'borderLeft',
  right: 'borderRight',
  all: 'borderAll',
  outer: 'borderOuter',
  thickOuter: 'borderThickOuter',
};
