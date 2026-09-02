import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILTER_BLANK,
  matchColumn,
  isRowVisible,
  getColumnCandidates,
  isColumnFiltered,
  type FilterCellAccessor,
  type FilterCandidates,
} from '../src/components/spreader/core/filter-core';
import type { SheetFilter, FilterColumn } from '../src/components/spreader/core/types';

const LOCALE = 'zh-CN';

/** 用 { "col,row": "value" } 网格构造一个最简单的访问器（无数字格式） */
function grid(gridData: Record<string, string>): FilterCellAccessor {
  return {
    getValue: (c, r) => gridData[`${c},${r}`] ?? '',
    getFormat: () => '',
  };
}

function filterWith(columns: Record<number, FilterColumn>, range?: { startCol: number; startRow: number; endCol: number; endRow: number }): SheetFilter {
  return {
    range: range ?? { startCol: 0, startRow: 0, endCol: 1, endRow: 3 },
    columns: Object.fromEntries(Object.entries(columns).map(([k, v]) => [Number(k), v])),
  };
}

// ============ matchColumn：值列表模式 ============

test('值列表：未选任何值视为不过滤（全部可见）', () => {
  const acc = grid({ '0,1': '苹果', '0,2': '香蕉' });
  const fc: FilterColumn = { type: 'values', values: [] };
  assert.equal(matchColumn(fc, '苹果', '', LOCALE), true);
  assert.equal(matchColumn(fc, '香蕉', '', LOCALE), true);
  assert.equal(matchColumn(fc, '', '', LOCALE), true);
});

test('值列表：选中项命中（原始值匹配）', () => {
  const acc = grid({ '0,1': '苹果' });
  const fc: FilterColumn = { type: 'values', values: ['苹果', '香蕉'] };
  assert.equal(matchColumn(fc, '苹果', '', LOCALE), true);
  assert.equal(matchColumn(fc, '橙子', '', LOCALE), false);
});

test('值列表：空白单元格仅在选中空白哨兵时可见', () => {
  const empty: FilterColumn = { type: 'values', values: [] };
  const withBlank: FilterColumn = { type: 'values', values: [FILTER_BLANK] };
  const noBlank: FilterColumn = { type: 'values', values: ['苹果'] };
  // 空值 + 无筛选
  assert.equal(matchColumn(empty, '', '', LOCALE), true);
  // 空值 + 仅选空白 → 可见
  assert.equal(matchColumn(withBlank, '', '', LOCALE), true);
  // 空值 + 仅选苹果 → 不可见
  assert.equal(matchColumn(noBlank, '', '', LOCALE), false);
});

test('值列表：同时支持原始值与展示值（数字格式下展示串也可命中）', () => {
  const fc: FilterColumn = { type: 'values', values: ['100'] };
  // 原始值 '100' 直接命中
  assert.equal(matchColumn(fc, '100', '#,##0', LOCALE), true);
  // 数字格式展示串 '100' 同样命中（值列表按展示串判定）
  assert.equal(matchColumn(fc, '100', '#,##0.00', LOCALE), true);
});

// ============ matchColumn：文本条件模式 ============

test('文本条件：equals / notEquals（大小写不敏感）', () => {
  const eq: FilterColumn = { type: 'text', condition: { operator: 'equals', value: 'Apple' } };
  assert.equal(matchColumn(eq, 'apple', '', LOCALE), true);
  assert.equal(matchColumn(eq, 'Apple', '', LOCALE), true);
  assert.equal(matchColumn(eq, 'APPLE', '', LOCALE), true);
  assert.equal(matchColumn(eq, 'banana', '', LOCALE), false);

  const ne: FilterColumn = { type: 'text', condition: { operator: 'notEquals', value: 'apple' } };
  assert.equal(matchColumn(ne, 'apple', '', LOCALE), false);
  assert.equal(matchColumn(ne, 'banana', '', LOCALE), true);
});

test('文本条件：contains / notContains / startsWith / endsWith', () => {
  const contains: FilterColumn = { type: 'text', condition: { operator: 'contains', value: 'an' } };
  assert.equal(matchColumn(contains, 'banana', '', LOCALE), true);
  assert.equal(matchColumn(contains, 'apple', '', LOCALE), false);

  const notContains: FilterColumn = { type: 'text', condition: { operator: 'notContains', value: 'an' } };
  assert.equal(matchColumn(notContains, 'banana', '', LOCALE), false);
  assert.equal(matchColumn(notContains, 'apple', '', LOCALE), true);

  const starts: FilterColumn = { type: 'text', condition: { operator: 'startsWith', value: 'ba' } };
  assert.equal(matchColumn(starts, 'banana', '', LOCALE), true);
  assert.equal(matchColumn(starts, 'apple', '', LOCALE), false);

  const ends: FilterColumn = { type: 'text', condition: { operator: 'endsWith', value: 'na' } };
  assert.equal(matchColumn(ends, 'banana', '', LOCALE), true);
  assert.equal(matchColumn(ends, 'apple', '', LOCALE), false);
});

test('文本条件：空白 / 非空白', () => {
  const blank: FilterColumn = { type: 'text', condition: { operator: 'blank' } };
  assert.equal(matchColumn(blank, '', '', LOCALE), true);
  assert.equal(matchColumn(blank, '   ', '', LOCALE), true);
  assert.equal(matchColumn(blank, 'x', '', LOCALE), false);

  const nonBlank: FilterColumn = { type: 'text', condition: { operator: 'notBlank' } };
  assert.equal(matchColumn(nonBlank, '', '', LOCALE), false);
  assert.equal(matchColumn(nonBlank, 'x', '', LOCALE), true);
});

// ============ matchColumn：数字条件模式 ============

test('数字条件：gt / gte / lt / lte（按数值而非字典序）', () => {
  const gt: FilterColumn = { type: 'number', condition: { operator: 'gt', value: '2' } };
  assert.equal(matchColumn(gt, '3', '', LOCALE), true);
  assert.equal(matchColumn(gt, '10', '', LOCALE), true);
  assert.equal(matchColumn(gt, '2', '', LOCALE), false);

  const gte: FilterColumn = { type: 'number', condition: { operator: 'gte', value: '2' } };
  assert.equal(matchColumn(gte, '2', '', LOCALE), true);
  assert.equal(matchColumn(gte, '1', '', LOCALE), false);

  const lt: FilterColumn = { type: 'number', condition: { operator: 'lt', value: '10' } };
  assert.equal(matchColumn(lt, '2', '', LOCALE), true);
  assert.equal(matchColumn(lt, '10', '', LOCALE), false);

  const lte: FilterColumn = { type: 'number', condition: { operator: 'lte', value: '10' } };
  assert.equal(matchColumn(lte, '10', '', LOCALE), true);
  assert.equal(matchColumn(lte, '11', '', LOCALE), false);
});

test('数字条件：between（含边界，自动排序上下限）', () => {
  const between: FilterColumn = { type: 'number', condition: { operator: 'between', value: '2', value2: '5' } };
  assert.equal(matchColumn(between, '2', '', LOCALE), true);
  assert.equal(matchColumn(between, '5', '', LOCALE), true);
  assert.equal(matchColumn(between, '3', '', LOCALE), true);
  assert.equal(matchColumn(between, '1', '', LOCALE), false);
  assert.equal(matchColumn(between, '6', '', LOCALE), false);
  // 上下限逆序也能正确判定
  const rev: FilterColumn = { type: 'number', condition: { operator: 'between', value: '5', value2: '2' } };
  assert.equal(matchColumn(rev, '3', '', LOCALE), true);
});

test('数字条件：非数字单元格不满足任何数值比较', () => {
  const gt: FilterColumn = { type: 'number', condition: { operator: 'gt', value: '2' } };
  assert.equal(matchColumn(gt, 'abc', '', LOCALE), false);
  assert.equal(matchColumn(gt, '', '', LOCALE), false);
});

test('数字条件：equals 按数值相等判定', () => {
  const eq: FilterColumn = { type: 'number', condition: { operator: 'equals', value: '2' } };
  assert.equal(matchColumn(eq, '2', '', LOCALE), true);
  assert.equal(matchColumn(eq, '2.0', '', LOCALE), true);
  assert.equal(matchColumn(eq, '3', '', LOCALE), false);
});

// ============ isRowVisible：多列 AND ============

test('多列 AND：一行须同时满足所有列筛选才可见', () => {
  const acc = grid({
    '0,1': 'A', '1,1': 'x',
    '0,2': 'A', '1,2': 'y',
    '0,3': 'B', '1,3': 'x',
  });
  const filter = filterWith({
    0: { type: 'values', values: ['A'] },
    1: { type: 'values', values: ['x'] },
  });
  assert.equal(isRowVisible(filter, 1, acc, LOCALE), true);  // A & x
  assert.equal(isRowVisible(filter, 2, acc, LOCALE), false); // A & y → 列1 不过
  assert.equal(isRowVisible(filter, 3, acc, LOCALE), false); // B & x → 列0 不过
});

test('isRowVisible：无筛选时全部可见', () => {
  const acc = grid({ '0,1': 'A', '0,2': 'B' });
  assert.equal(isRowVisible(null, 1, acc, LOCALE), true);
  assert.equal(isRowVisible(null, 2, acc, LOCALE), true);
});

test('isRowVisible：超出 range 的列不参与判定', () => {
  const acc = grid({ '0,1': 'B', '1,1': 'x' });
  const filter = filterWith({ 0: { type: 'values', values: ['A'] } }); // range 列 0..1
  // 列0 在范围外（实际 startCol=0，仍在内）；改为构造范围排除列0
  const filter2: SheetFilter = { range: { startCol: 1, startRow: 0, endCol: 1, endRow: 3 }, columns: { 0: { type: 'values', values: ['A'] } } };
  // 列0 不在 [1,1] 范围内 → 不参与 → 行可见
  assert.equal(isRowVisible(filter2, 1, acc, LOCALE), true);
});

// ============ getColumnCandidates：级联 + 去重 + 稳定排序 ============

test('候选值：纯文本列去重并按 locale 文本（numeric）升序', () => {
  const acc = grid({
    '0,1': '香蕉', '0,2': '苹果', '0,3': '苹果', '0,4': '橙子',
  });
  const filter = filterWith({ 0: { type: 'values', values: [] } }, { startCol: 0, startRow: 0, endCol: 0, endRow: 4 });
  const c: FilterCandidates = getColumnCandidates(filter, 0, acc, LOCALE);
  // zh-CN 按拼音：橙子 < 苹果 < 香蕉，且「苹果」重复仅保留一次
  assert.deepEqual(c.values, ['橙子', '苹果', '香蕉']);
  assert.equal(c.hasBlank, false);
});

test('候选值：纯数字列按数值升序（非字典序）', () => {
  const acc = grid({ '0,1': '10', '0,2': '2', '0,3': '1' });
  const filter = filterWith({ 0: { type: 'values', values: [] } }, { startCol: 0, startRow: 0, endCol: 0, endRow: 3 });
  const c = getColumnCandidates(filter, 0, acc, LOCALE);
  assert.deepEqual(c.values, ['1', '2', '10']);
});

test('候选值：检测空白并置 hasBlank=true，空白项不进入 values', () => {
  const acc = grid({ '0,1': 'a', '0,2': '', '0,3': 'b' });
  const filter = filterWith({ 0: { type: 'values', values: [] } }, { startCol: 0, startRow: 0, endCol: 0, endRow: 3 });
  const c = getColumnCandidates(filter, 0, acc, LOCALE);
  assert.deepEqual(c.values, ['a', 'b']);
  assert.equal(c.hasBlank, true);
});

test('候选值：级联，仅统计「其它列已筛选」后可见的行', () => {
  const acc = grid({
    '0,1': 'A', '1,1': 'x',
    '0,2': 'A', '1,2': 'y',
    '0,3': 'B', '1,3': 'z',
  });
  // 列0 已筛选为仅 'A'（行 1,2 可见），列1 候选应只来自行 1,2
  const filter = filterWith({ 0: { type: 'values', values: ['A'] } }, { startCol: 0, startRow: 0, endCol: 1, endRow: 3 });
  const c = getColumnCandidates(filter, 1, acc, LOCALE);
  assert.deepEqual(c.values, ['x', 'y']);
  assert.equal(c.hasBlank, false);

  // 若列0 无筛选，列1 候选应来自全部数据行
  const filterAll = filterWith({ 0: { type: 'values', values: [] } }, { startCol: 0, startRow: 0, endCol: 1, endRow: 3 });
  const cAll = getColumnCandidates(filterAll, 1, acc, LOCALE);
  assert.deepEqual(cAll.values, ['x', 'y', 'z']);
});

// ============ isColumnFiltered：图标高亮判定 ============

test('isColumnFiltered：各状态正确识别', () => {
  assert.equal(isColumnFiltered(undefined), false);
  assert.equal(isColumnFiltered({ type: 'values', values: [] }), false);
  assert.equal(isColumnFiltered({ type: 'values', values: ['a'] }), true);
  assert.equal(isColumnFiltered({ type: 'text', condition: { operator: 'contains', value: 'x' } }), true);
  assert.equal(isColumnFiltered({ type: 'number' }), false); // 无 condition
  assert.equal(isColumnFiltered({ type: 'number', condition: { operator: 'gt', value: '1' } }), true);
});
