/**
 * Border Resolve - 公共边统一解析。
 *
 * 核心函数 resolveSharedBorder 负责处理相邻两个 BorderSide 的冲突，
 * 产生唯一的最终视觉边框结果。
 *
 * 冲突规则（按优先级）：
 * 1. 两侧都 undefined/空 → 不绘制
 * 2. 一侧存在、另一侧不存在 → 使用存在的一侧
 * 3. 两侧都存在：
 *    a. 仅一侧带 owner（由边框操作显式写入的「选区边界边」）→ 该侧优先
 *       （修复：选区外框/上边框/左边框被相邻单元格旧 border 覆盖的问题；
 *        该标记持久化在数据里，取消选区/重绘/重新加载后结果仍一致，无需同步相邻单元格）
 *    b. 两侧都带 owner 或都不带 → width 更大者优先
 *    c. width 相同时：first 侧优先（稳定 tie-break）
 * 4. merge 不无条件覆盖 cell（firstSource/secondSource 预留但当前不影响优先级）
 *
 * 说明：req 要求「选区内部公共边」与「选区外普通公共边」继续沿用既有冲突规则。
 * owner 仅由边框操作写入选区边界边时设置，因此：
 *  - 选区内部公共边（两侧都带 owner，或都无 owner）→ 走 3b/3c 既有规则；
 *  - 选区外普通公共边（两侧都无 owner）→ 走 3b/3c 既有规则，行为不变；
 *  - 仅当「本次操作写入的边界边」对面是「未带 owner 的相邻边」时，才优先本次操作边。
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
 * @param _firstSource - 第一个候选的来源（'cell' 或 'merge'），预留参数，当前不影响优先级
 * @param _secondSource - 第二个候选的来源（'cell' 或 'merge'），预留参数，当前不影响优先级
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
  _firstSource?: BorderSource,
  _secondSource?: BorderSource,
): BorderSide | undefined {
  const firstValid = hasBorderSide(first);
  const secondValid = hasBorderSide(second);

  // 规则 1：两侧都空 → 不绘制
  if (!firstValid && !secondValid) return undefined;

  // 规则 2：一侧空 → 另一侧
  if (firstValid && !secondValid) return first;
  if (!firstValid && secondValid) return second;

  // 规则 3：两侧都有
  const firstOwner = !!first!.owner;
  const secondOwner = !!second!.owner;

  // 3a. 仅一侧带 owner（本次边框操作显式写入的选区边界边）→ 该侧优先。
  //     这是修复「选区边框被相邻单元格旧 border 覆盖」的核心：
  //     - 相邻单元格数据不被同步修改（满足「不强制同步两侧」）；
  //     - owner 标记持久化在数据里，取消选区/滚动/重绘/重新加载后结果仍一致。
  if (firstOwner && !secondOwner) return first;
  if (secondOwner && !firstOwner) return second;

  // 3b. 两侧都带 owner 或都不带 → 沿用既有冲突规则：width 更大者优先
  const firstWidth = first!.width ?? 0;
  const secondWidth = second!.width ?? 0;
  if (firstWidth > secondWidth) return first;
  if (secondWidth > firstWidth) return second;

  // 3c. width 相同 → first 优先（稳定 tie-break）
  // 注意：merge 不无条件覆盖 cell
  // _firstSource/_secondSource 参数预留，当前不影响优先级
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
