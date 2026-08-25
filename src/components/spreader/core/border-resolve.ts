/**
 * Border Resolve — 公共边统一解析。
 *
 * 核心函数 resolveSharedBorder 负责处理相邻两个 BorderSide 的冲突，
 * 产生唯一的最终视觉边框结果。
 *
 * 冲突规则（按优先级）：
 * 1. 两侧都 undefined/空 → 不绘制
 * 2. 一侧存在、另一侧不存在 → 使用存在的一侧
 * 3. 两侧都存在：
 *    a. width 更大者优先
 *    b. width 相同时：first 侧优先（稳定 tie-break）
 * 4. merge 不无条件覆盖 cell（firstSource/secondSource 预留但当前不影响优先级）
 */

import type { BorderSide, BorderSource } from './types';

/**
 * 判断 BorderSide 是否有效（有实际宽度）。
 */
export function hasBorderSide(border: BorderSide | undefined): boolean {
  return !!border && border.width !== undefined && border.width > 0;
}

/**
 * 判断 BorderSide 是否为空。
 */
export function isEmptyBorderSide(border: BorderSide | undefined): boolean {
  return !border || border.width === undefined || border.width <= 0;
}

/**
 * 统一解析两个相邻 BorderSide 的冲突，返回最终要绘制的 BorderSide。
 *
 * @param first - 第一个候选边框（对于水平公共边：上方 cell 的 bottom；对于垂直公共边：左方 cell 的 right）
 * @param second - 第二个候选边框（对于水平公共边：下方 cell 的 top；对于垂直公共边：右方 cell 的 left）
 * @param firstSource - 第一个候选的来源（'cell' 或 'merge'），预留参数
 * @param secondSource - 第二个候选的来源（'cell' 或 'merge'），预留参数
 * @returns 最终要绘制的 BorderSide，或 undefined（不绘制）
 *
 * 规则：
 * 1. 两侧都空 → undefined
 * 2. 一侧空 → 另一侧
 * 3. 两侧都有：
 *    a. width 更大者优先
 *    b. width 相同 → first 优先（稳定 tie-break）
 */
export function resolveSharedBorder(
  first: BorderSide | undefined,
  second: BorderSide | undefined,
  firstSource?: BorderSource,
  secondSource?: BorderSource,
): BorderSide | undefined {
  const firstValid = hasBorderSide(first);
  const secondValid = hasBorderSide(second);

  // 规则 1：两侧都空 → 不绘制
  if (!firstValid && !secondValid) return undefined;

  // 规则 2：一侧空 → 另一侧
  if (firstValid && !secondValid) return first;
  if (!firstValid && secondValid) return second;

  // 规则 3：两侧都有
  const firstWidth = first!.width ?? 0;
  const secondWidth = second!.width ?? 0;

  // 3a. width 更大者优先
  if (firstWidth > secondWidth) return first;
  if (secondWidth > firstWidth) return second;

  // 3b. width 相同 → first 优先（稳定 tie-break）
  // 注意：merge 不无条件覆盖 cell
  // firstSource/secondSource 参数预留，当前不影响优先级
  return first;
}

/**
 * 获取公共边的宽度（便捷函数）。
 */
export function resolveSharedBorderWidth(
  first: BorderSide | undefined,
  second: BorderSide | undefined,
  firstSource?: BorderSource,
  secondSource?: BorderSource,
): number {
  const resolved = resolveSharedBorder(first, second, firstSource, secondSource);
  return resolved?.width ?? 0;
}

/**
 * 获取公共边的颜色（便捷函数）。
 */
export function resolveSharedBorderColor(
  first: BorderSide | undefined,
  second: BorderSide | undefined,
  firstSource?: BorderSource,
  secondSource?: BorderSource,
): string | undefined {
  const resolved = resolveSharedBorder(first, second, firstSource, secondSource);
  return resolved?.color;
}
