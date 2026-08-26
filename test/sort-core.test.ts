import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSortKey,
  parseSortKeyByDisplay,
  compareSortKeys,
  buildSortedRowOrder,
  looksLikeHeader,
  type SortKey,
} from '../src/components/spreader/core/sort-core';

const LOCALE = 'zh-CN';

const k = (v: string) => parseSortKey(v, LOCALE);

test('parseSortKey 空白识别（空串/纯空白/undefined）', () => {
  assert.equal(parseSortKey('', LOCALE).kind, 'blank');
  assert.equal(parseSortKey('   ', LOCALE).kind, 'blank');
  assert.equal(parseSortKey(null, LOCALE).kind, 'blank');
  assert.equal(parseSortKey(undefined, LOCALE).kind, 'blank');
});

test('parseSortKey 数字识别（含负数/小数/科学计数），不改变原始 string', () => {
  assert.deepEqual(k('10'), { kind: 'number', num: 10 });
  assert.deepEqual(k('-3.5'), { kind: 'number', num: -3.5 });
  assert.deepEqual(k('1e2'), { kind: 'number', num: 100 });
});

test('parseSortKey 日期/时间字符串转序列值', () => {
  const d = k('2024-01-02');
  assert.equal(d.kind, 'number');
  assert.equal(typeof d.num, 'number');
  // 晚于 1900 序列起点，且日期越晚序列值越大
  assert.ok(k('2024-02-01').num! > d.num!);
  // 时间字符串 → 一天内的小数序列
  const tm = k('12:30');
  assert.equal(tm.kind, 'number');
  assert.ok(tm.num! > 0 && tm.num! < 1);
});

test('parseSortKey 无法解析的值归类为文本', () => {
  assert.deepEqual(k('abc'), { kind: 'text', text: 'abc' });
  assert.deepEqual(k('张三'), { kind: 'text', text: '张三' });
});

test('数字按数值比较：升序 "2" < "10"（而非字典序）', () => {
  assert.ok(compareSortKeys(k('2'), k('10'), 'asc', LOCALE) < 0);
  assert.ok(compareSortKeys(k('10'), k('2'), 'asc', LOCALE) > 0);
  assert.ok(compareSortKeys(k('10'), k('2'), 'desc', LOCALE) < 0);
});

test('空值无论升序降序始终置底（Excel 行为）', () => {
  const blank = parseSortKey('', LOCALE);
  assert.ok(compareSortKeys(blank, k('1'), 'asc', LOCALE) > 0);
  assert.ok(compareSortKeys(blank, k('1'), 'desc', LOCALE) > 0);
  assert.ok(compareSortKeys(k('abc'), blank, 'desc', LOCALE) < 0);
  assert.equal(compareSortKeys(blank, parseSortKey('  ', LOCALE), 'asc', LOCALE), 0);
});

test('混合类型：升序 数字/日期 < 文本；降序反转', () => {
  assert.ok(compareSortKeys(k('999'), k('abc'), 'asc', LOCALE) < 0);
  assert.ok(compareSortKeys(k('999'), k('abc'), 'desc', LOCALE) > 0);
});

test('文本比较支持本地化与内嵌数字（a2 < a10）', () => {
  assert.ok(compareSortKeys(k('a2'), k('a10'), 'asc', LOCALE) < 0);
  assert.ok(compareSortKeys(k('a10'), k('a2'), 'desc', LOCALE) < 0);
});

test('buildSortedRowOrder 返回置换数组并应用后整行数据保持对应', () => {
  // 模拟两列数据：A 列（关键列）与 B 列
  const colA = ['10', '2', '1'];
  const colB = ['张三', '李四', '王五'];
  const keys: SortKey[] = colA.map((v) => parseSortKey(v, LOCALE));
  const perm = buildSortedRowOrder(keys, 'asc', LOCALE);
  assert.deepEqual(perm, [2, 1, 0]);
  const sortedA = perm.map((i) => colA[i]);
  const sortedB = perm.map((i) => colB[i]);
  assert.deepEqual(sortedA, ['1', '2', '10']);
  // B 列跟随整行移动，不错位
  assert.deepEqual(sortedB, ['王五', '李四', '张三']);
});

test('混合类型 + 空值综合排序（升序）', () => {
  const values = ['banana', '2', '', 'apple', '10'];
  const keys = values.map((v) => parseSortKey(v, LOCALE));
  const perm = buildSortedRowOrder(keys, 'asc', LOCALE);
  assert.deepEqual(perm.map((i) => values[i]), ['2', '10', 'apple', 'banana', '']);
});

test('混合类型 + 空值综合排序（降序，空值仍置底）', () => {
  const values = ['banana', '2', '', 'apple', '10'];
  const keys = values.map((v) => parseSortKey(v, LOCALE));
  const perm = buildSortedRowOrder(keys, 'desc', LOCALE);
  assert.deepEqual(perm.map((i) => values[i]), ['banana', 'apple', '10', '2', '']);
});

test('日期字符串按时间先后排序', () => {
  const values = ['2024-03-01', '2023-12-31', '2024-01-15'];
  const keys = values.map((v) => parseSortKey(v, LOCALE));
  const perm = buildSortedRowOrder(keys, 'asc', LOCALE);
  assert.deepEqual(perm.map((i) => values[i]), ['2023-12-31', '2024-01-15', '2024-03-01']);
});

test('排序稳定：相同键保持原始行序', () => {
  const values = ['x', 'a', 'x', 'a'];
  const keys = values.map((v) => parseSortKey(v, LOCALE));
  const perm = buildSortedRowOrder(keys, 'asc', LOCALE);
  assert.deepEqual(perm, [1, 3, 0, 2]);
});

test('looksLikeHeader 表头启发式识别', () => {
  // 首行文本 + 其余含数字 → 表头
  assert.equal(looksLikeHeader([k('姓名'), k('1'), k('2')]), true);
  // 首行为数字 → 非表头
  assert.equal(looksLikeHeader([k('2'), k('10')]), false);
  // 全部文本 → 非表头
  assert.equal(looksLikeHeader([k('甲'), k('乙')]), false);
  // 单行 → 非表头
  assert.equal(looksLikeHeader([k('标题')]), false);
});

// ============ parseSortKeyByDisplay（按展示内容排序）============

test('百分比格式单元格：按展示数值（×scale）参与排序，而非存储值', () => {
  // 存储值 1、格式 0% → 展示 "100%"，排序键应为 100
  const key = parseSortKeyByDisplay('1', '0%', LOCALE);
  assert.deepEqual(key, { kind: 'number', num: 100 });
  // 存储值 0.5、格式 0.00% → 展示 "50.00%"，排序键应为 50
  assert.deepEqual(parseSortKeyByDisplay('0.5', '0.00%', LOCALE), { kind: 'number', num: 50 });
});

test('百分比与普通数字混排：按展示数值大小排序', () => {
  // 关键列：A=展示"100%"（存储1,格式0%）、B=展示"50"（存储50,常规）
  const keys = [
    parseSortKeyByDisplay('1', '0%', LOCALE),
    parseSortKeyByDisplay('50', '', LOCALE),
  ];
  const perm = buildSortedRowOrder(keys, 'asc', LOCALE);
  // 50 < 100 → 常规"50"在前
  assert.deepEqual(perm, [1, 0]);
});

test('千分位格式单元格：按数值排序（含缩放/无缩放一致）', () => {
  const k1 = parseSortKeyByDisplay('1234', '#,##0', LOCALE);
  const k2 = parseSortKeyByDisplay('1234', '', LOCALE); // 常规同样值
  assert.deepEqual(k1, { kind: 'number', num: 1234 });
  assert.deepEqual(k1, k2);
});

test('货币/会计负数格式：按数值排序（展示串顺序不等于数值顺序）', () => {
  // 负数会计格式存储 -1234.5、格式 $#,##0.00;($#,##0.00);$"-"
  const neg = parseSortKeyByDisplay('-1234.5', '$#,##0.00;($#,##0.00);$"-"', LOCALE);
  const pos = parseSortKeyByDisplay('999', '$#,##0.00;($#,##0.00);$"-"', LOCALE);
  assert.deepEqual(neg, { kind: 'number', num: -1234.5 });
  assert.deepEqual(pos, { kind: 'number', num: 999 });
  // 数值比较：负数在前
  assert.ok(compareSortKeys(neg, pos, 'asc', LOCALE) < 0);
});

test('文本格式单元格：按展示原文排序（支持内嵌数字自然序）', () => {
  const k1 = parseSortKeyByDisplay('100%', '@', LOCALE); // 文本格式的 "100%"
  const k2 = parseSortKeyByDisplay('50', '@', LOCALE);
  assert.deepEqual(k1, { kind: 'text', text: '100%' });
  // 文本分支走 localeCompare numeric：100% 排在 50 之后
  assert.ok(compareSortKeys(k1, k2, 'asc', LOCALE) > 0);
});

test('常规文本单元格：按展示串（=原文）排序', () => {
  assert.deepEqual(parseSortKeyByDisplay('苹果', '', LOCALE), { kind: 'text', text: '苹果' });
  assert.deepEqual(parseSortKeyByDisplay('香蕉', '', LOCALE), { kind: 'text', text: '香蕉' });
});

test('日期格式单元格：按序列值排序', () => {
  // 存储序列值 45234、格式 yyyy"年"m"月"d"日" → 数值键=45234
  const key = parseSortKeyByDisplay('45234', 'yyyy"年"m"月"d"日"', LOCALE);
  assert.deepEqual(key, { kind: 'number', num: 45234 });
});

test('数值格式下出现非数字内容：回退为展示文本排序（不报错）', () => {
  // 单元格套了数字格式但内容是文本 → 按展示串作为文本键
  const key = parseSortKeyByDisplay('N/A', '#,##0.00', LOCALE);
  assert.equal(key.kind, 'text');
  assert.equal(key.text, 'N/A');
});
