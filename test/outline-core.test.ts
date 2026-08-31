import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGroup,
  addOutline,
  setOutlineCollapsed,
  removeOutline,
  clearOutlines,
  addOutlineForInsert,
  addOutlineForDelete,
  recomputeOutlineLevels,
  buildOutlineIndex,
  outlineLevelAt,
  isOutlineCollapsedAt,
  genOutlineId,
} from '../src/components/spreader/core/outline-core';
import type { DimensionOutline } from '../src/components/spreader/core/types';

function row(id: string, start: number, end: number, collapsed = false): DimensionOutline {
  return { id, axis: 'row', start, end, level: 1, collapsed };
}

// ============ 校验与层级 ============

test('分组：至少连续 2 个维度', () => {
  const v = validateGroup([], 3, 3);
  assert.equal(v.ok, false);
  assert.equal(v.code, 'outlineMinSize');
});

test('分组：start>end 非法', () => {
  const v = validateGroup([], 5, 2);
  assert.equal(v.ok, false);
  assert.equal(v.code, 'outlineInvalid');
});

test('分组：禁止部分交叉（2~10 与 5~15）', () => {
  const ex = [row('A', 2, 10)];
  const v = validateGroup(ex, 5, 15);
  assert.equal(v.ok, false);
  assert.equal(v.code, 'outlineCrossing');
});

test('分组：不相交 OK', () => {
  const ex = [row('A', 2, 10), row('B', 12, 16)];
  const v = validateGroup(ex, 20, 24);
  assert.equal(v.ok, true);
});

test('分组：仅一层——完全包含被拒绝（2~20 内再建 5~10 → outlineTooDeep）', () => {
  const ex = [row('A', 2, 20, false)];
  const v = validateGroup(ex, 5, 10);
  assert.equal(v.ok, false);
  assert.equal(v.code, 'outlineTooDeep');
});

test('分组：仅一层——嵌套被拒绝（A 2~20、B 5~10 → B 的创建即 outlineTooDeep）', () => {
  const a = addOutline([], 'row', 2, 20, 'A').outlines;
  // A 已存在，B 完全位于 A 内部 → 嵌套，应被拒绝
  const v = validateGroup(a, 5, 10);
  assert.equal(v.ok, false);
  assert.equal(v.code, 'outlineTooDeep');
});

test('分组：recomputeOutlineLevels 仅一层时所有组 level 均为 1', () => {
  let o = [row('A', 2, 20)];
  o = recomputeOutlineLevels(o);
  o = recomputeOutlineLevels(addOutline(o, 'row', 22, 26, 'B').outlines);
  const a = o.find((x) => x.id === 'A')!;
  const b = o.find((x) => x.id === 'B')!;
  assert.equal(a.level, 1);
  assert.equal(b.level, 1);
});

// ============ 折叠可见性 / 层级查询 ============

test('outlineLevelAt：不相交分组各自 level=1（Row3→1，Row15→1，Row23→1，Row27→0）', () => {
  let o = addOutline([], 'row', 2, 20, 'A').outlines;
  o = addOutline(o, 'row', 22, 26, 'B').outlines;
  assert.equal(outlineLevelAt(o, 3), 1);
  assert.equal(outlineLevelAt(o, 15), 1);
  assert.equal(outlineLevelAt(o, 23), 1);
  assert.equal(outlineLevelAt(o, 27), 0);
});

test('折叠后：isOutlineCollapsedAt 隐藏组内维度，组外不受影响', () => {
  let o = addOutline([], 'row', 2, 5, 'A').outlines;
  o = setOutlineCollapsed(o, 'A', true);
  assert.equal(isOutlineCollapsedAt(o, 2), true);
  assert.equal(isOutlineCollapsedAt(o, 5), true);
  assert.equal(isOutlineCollapsedAt(o, 0), false);
  assert.equal(isOutlineCollapsedAt(o, 6), false);
  // Counterpoint: 展开后恢复
  o = setOutlineCollapsed(o, 'A', false);
  assert.equal(isOutlineCollapsedAt(o, 3), false);
});

test('buildOutlineIndex：collapsed 组标记 hidden、仅一层 maxLevel=1', () => {
  let o = [row('A', 2, 20, true)];
  o = recomputeOutlineLevels(addOutline(o, 'row', 22, 26, 'B').outlines);
  const idx = buildOutlineIndex(o, 25);
  assert.equal(idx.maxLevel, 1);
  assert.equal(idx.levels[0], 0);
  assert.equal(idx.levels[3], 1);
  assert.equal(idx.levels[23], 1);
  assert.equal(idx.hidden[3], true); // A collapsed → 命中
  assert.equal(idx.hidden[23], false); // B 展开
  assert.equal(idx.hidden[0], false);
  assert.equal(idx.hidden[21], false);
});

// ============ 插入 / 删除 ============

test('插入行：Group 5~10，第 8 行插入 → 5~11', () => {
  let o = addOutline([], 'row', 5, 10, 'A').outlines;
  o = addOutlineForInsert(o, 8, 1);
  assert.deepEqual({ s: o[0]!.start, e: o[0]!.end }, { s: 5, e: 11 });
});

test('插入行：Group 前插入 → 平移；Group 后插入 → 不变', () => {
  let a = addOutline([], 'row', 5, 10, 'A').outlines;
  assert.deepEqual({ s: addOutlineForInsert(a, 2, 3)[0]!.start, e: addOutlineForInsert(a, 2, 3)[0]!.end }, { s: 8, e: 13 });
  assert.deepEqual({ s: addOutlineForInsert(a, 12, 3)[0]!.start, e: addOutlineForInsert(a, 12, 3)[0]!.end }, { s: 5, e: 10 });
});

test('删除行：Group 5~10，删除 8 → 5~9', () => {
  let o = addOutline([], 'row', 5, 10, 'A').outlines;
  o = addOutlineForDelete(o, 8, 1);
  assert.deepEqual({ s: o[0]!.start, e: o[0]!.end }, { s: 5, e: 9 });
});

test('删除行：整个 Group 被删除 → 自动移除', () => {
  let o = addOutline([], 'row', 5, 10, 'A').outlines;
  o = addOutlineForDelete(o, 5, 6);
  assert.equal(o.length, 0);
});

test('删除行：某个 Group 整段被删除后，其余 Group 保留', () => {
  let o = addOutline([], 'row', 2, 10, 'A').outlines;
  o = addOutline(o, 'row', 14, 20, 'B').outlines;
  o = addOutlineForDelete(o, 2, 9); // 删除 A 整段（2~10）
  assert.equal(o.some((x) => x.id === 'A'), false);
  const b = o.find((x) => x.id === 'B')!;
  assert.ok(b);
  assert.equal(b.start, 5); // 14 - 9
  assert.equal(b.end, 11);  // 20 - 9
});

// ============ 列分组对称 ============

test('列分组：B~E（1~4）collapsed → 组内不可见、组外可见', () => {
  let o = addOutline([], 'column', 1, 4, 'C').outlines;
  o = setOutlineCollapsed(o, 'C', true);
  assert.equal(isOutlineCollapsedAt(o, 1), true);
  assert.equal(isOutlineCollapsedAt(o, 4), true);
  assert.equal(isOutlineCollapsedAt(o, 0), false);
  assert.equal(isOutlineCollapsedAt(o, 5), false);
});

// ============ ID 稳定性 / 清除 ============

test('genOutlineId：稳定唯一，避免与既有冲突', () => {
  const ex = [row('row-outline-1', 0, 1)];
  assert.equal(genOutlineId(ex, 'row'), 'row-outline-2');
  assert.equal(genOutlineId([], 'column'), 'col-outline-1');
});

test('clearOutlines：清空集合（不触碰行列数据）', () => {
  const o = [row('A', 0, 3), row('B', 5, 8)];
  assert.equal(clearOutlines().length, 0);
  assert.equal(o.length, 2); // 原集合不受影响
});

test('removeOutline / setOutlineCollapsed 为不可变更新', () => {
  const o = [row('A', 0, 3, false)];
  const expanded = setOutlineCollapsed(o, 'A', false); // no-op 返回原引用
  assert.equal(expanded, o);
  const collapsed = setOutlineCollapsed(o, 'A', true);
  assert.notEqual(collapsed, o);
  assert.equal(collapsed[0]!.collapsed, true);
  assert.equal(o[0]!.collapsed, false); // 原集合不变
  const removed = removeOutline(o, 'A');
  assert.equal(removed.length, 0);
  assert.equal(o.length, 1);
});