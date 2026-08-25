import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSharedBorder,
  resolveSharedBorderWidth,
  resolveSharedBorderColor,
  hasBorderSide,
  isEmptyBorderSide,
} from '../src/components/spreader/core/border-resolve';
import type { BorderSide } from '../src/components/spreader/core/types';

// ============ hasBorderSide / isEmptyBorderSide ============

test('hasBorderSide 判断有效边框', () => {
  assert.equal(hasBorderSide(undefined), false);
  assert.equal(hasBorderSide({}), false);
  assert.equal(hasBorderSide({ width: 0 }), false);
  assert.equal(hasBorderSide({ width: -1 }), false);
  assert.equal(hasBorderSide({ width: 1 }), true);
  assert.equal(hasBorderSide({ width: 2, color: '#000' }), true);
});

test('isEmptyBorderSide 判断空边框', () => {
  assert.equal(isEmptyBorderSide(undefined), true);
  assert.equal(isEmptyBorderSide({}), true);
  assert.equal(isEmptyBorderSide({ width: 0 }), true);
  assert.equal(isEmptyBorderSide({ width: 1 }), false);
});

// ============ resolveSharedBorder 核心规则 ============

test('规则1：两侧都空 → undefined', () => {
  assert.equal(resolveSharedBorder(undefined, undefined), undefined);
  assert.equal(resolveSharedBorder({}, {}), undefined);
  assert.equal(resolveSharedBorder({ width: 0 }, { width: 0 }), undefined);
});

test('规则2：一侧空 → 使用另一侧', () => {
  const side: BorderSide = { width: 1, color: '#f00' };
  assert.deepEqual(resolveSharedBorder(side, undefined), side);
  assert.deepEqual(resolveSharedBorder(undefined, side), side);
  assert.deepEqual(resolveSharedBorder(side, {}), side);
  assert.deepEqual(resolveSharedBorder({}, side), side);
});

test('规则3a：两侧都有 → width 更大者优先', () => {
  const thin: BorderSide = { width: 1, color: '#f00' };
  const thick: BorderSide = { width: 2, color: '#0f0' };
  assert.deepEqual(resolveSharedBorder(thin, thick), thick);
  assert.deepEqual(resolveSharedBorder(thick, thin), thick);
});

test('规则3b：width 相同 → first 优先（稳定 tie-break）', () => {
  const first: BorderSide = { width: 1, color: '#f00' };
  const second: BorderSide = { width: 1, color: '#0f0' };
  assert.deepEqual(resolveSharedBorder(first, second), first);
  // 交换顺序，仍然 first 参数优先
  assert.deepEqual(resolveSharedBorder(second, first), second);
});

test('merge 不无条件覆盖 cell（同宽时 first 优先，无论 source）', () => {
  const cellBorder: BorderSide = { width: 1, color: '#f00' };
  const mergeBorder: BorderSide = { width: 1, color: '#0f0' };
  // cell 为 first → cell 优先
  assert.deepEqual(resolveSharedBorder(cellBorder, mergeBorder, 'cell', 'merge'), cellBorder);
  // merge 为 first → merge 优先（first 侧优先，不是 merge 无条件覆盖）
  assert.deepEqual(resolveSharedBorder(mergeBorder, cellBorder, 'merge', 'cell'), mergeBorder);
  // 但宽度不同时，宽度优先，不受 source 影响
  const thickMerge: BorderSide = { width: 2, color: '#0f0' };
  assert.deepEqual(resolveSharedBorder(cellBorder, thickMerge, 'cell', 'merge'), thickMerge);
  assert.deepEqual(resolveSharedBorder(thickMerge, cellBorder, 'merge', 'cell'), thickMerge);
});

// ============ 便捷函数 ============

test('resolveSharedBorderWidth 返回宽度', () => {
  assert.equal(resolveSharedBorderWidth(undefined, undefined), 0);
  assert.equal(resolveSharedBorderWidth({ width: 2 }, { width: 1 }), 2);
  assert.equal(resolveSharedBorderWidth({ width: 1 }, { width: 3 }), 3);
});

test('resolveSharedBorderColor 返回颜色', () => {
  assert.equal(resolveSharedBorderColor(undefined, undefined), undefined);
  assert.equal(resolveSharedBorderColor({ width: 2, color: '#f00' }, { width: 1, color: '#0f0' }), '#f00');
});
