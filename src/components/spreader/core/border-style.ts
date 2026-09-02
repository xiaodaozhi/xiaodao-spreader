/**
 * Border Line Style - 边框线型的纯逻辑层（与 Vue / Canvas 完全解耦，可直接单测）。
 *
 * 线型是「每条独立边」的属性（BorderSide.style），与颜色（color）、线宽（width）彼此解耦：
 *  - 改颜色 → 只动 color，保留 width / style；
 *  - 改线型 → 只动 style，保留 width / color；
 *  - 改线宽 → 只动 width，保留 color / style。
 *
 * 取值：'solid' | 'dashed' | 'dotted'。
 * 旧数据（BorderSide 无 style 字段）一律按 'solid' 处理，从而保持历史数据兼容。
 */

/** 边框线型 */
export type BorderLineStyle = 'solid' | 'dashed' | 'dotted';

/**
 * 归一化线型：非 'dashed' / 'dotted' 一律回退为 'solid'。
 * 用于读取 BorderSide.style 时兜底（旧数据缺省 → solid），并防御非法字符串。
 */
export function normalizeBorderLineStyle(s?: string | null): BorderLineStyle {
  return s === 'dashed' || s === 'dotted' ? s : 'solid';
}

/**
 * 返回 canvas 的 dash 数组（基于线宽保证视觉一致），solid 返回 null（走 fillRect，不画虚线）。
 *  - dashed：dash 长 + gap，dash/gap 随线宽缩放；
 *  - dotted：0 长度 dash + round cap → 画出直径 = 线宽的圆点，gap 随线宽缩放。
 */
export function borderLineDash(style: BorderLineStyle, width: number): number[] | null {
  if (style === 'solid') return null;
  const w = Math.max(1, width);
  if (style === 'dashed') {
    return [Math.max(3, w * 2.5), Math.max(2, w * 1.5)];
  }
  // dotted：0 长度 dash + 由 round cap 撑成的圆点
  return [0.0001, Math.max(2, w * 1.8)];
}
