import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumericText } from '../src/components/spreader/core/number-format';

const LOCALE = 'zh-CN';

// ============ 千分位逗号 ============

test('千分位：1,234 → 数值 1234，格式 #,##0', () => {
  const r = parseNumericText('1,234', LOCALE);
  assert.ok(r);
  assert.equal(r.num, 1234);
  assert.equal(r.format, '#,##0');
});

test('千分位：1,234.56 → 数值 1234.56，格式 #,##0.00', () => {
  const r = parseNumericText('1,234.56', LOCALE);
  assert.ok(r);
  assert.equal(r.num, 1234.56);
  assert.equal(r.format, '#,##0.00');
});

test('千分位：多组逗号 1,234,567 → 数值 1234567', () => {
  const r = parseNumericText('1,234,567', LOCALE);
  assert.ok(r);
  assert.equal(r.num, 1234567);
  assert.equal(r.format, '#,##0');
});

// ============ 百分比 ============

test('百分比：100% → 数值 1（÷100），格式 0%', () => {
  const r = parseNumericText('100%', LOCALE);
  assert.ok(r);
  assert.equal(r.num, 1);
  assert.equal(r.format, '0%');
});

test('百分比：3.14% → 数值 0.0314，格式 0.00%', () => {
  const r = parseNumericText('3.14%', LOCALE);
  assert.ok(r);
  assert.equal(r.num, 0.0314);
  assert.equal(r.format, '0.00%');
});

test('百分比：1,234.5% → 数值 12.345，格式 #,##0.0%', () => {
  const r = parseNumericText('1,234.5%', LOCALE);
  assert.ok(r);
  assert.equal(r.num, 12.345);
  assert.equal(r.format, '#,##0.0%');
});

test('百分比：负数 -50% → 数值 -0.5，格式 0%', () => {
  const r = parseNumericText('-50%', LOCALE);
  assert.ok(r);
  assert.equal(r.num, -0.5);
  assert.equal(r.format, '0%');
});

// ============ 货币符号 ============

test('货币：$1,234.56 → 1234.56，格式 $#,##0.00', () => {
  const r = parseNumericText('$1,234.56', LOCALE);
  assert.ok(r);
  assert.equal(r.num, 1234.56);
  assert.equal(r.format, '$#,##0.00');
});

test('货币：¥1234（无逗号）→ 1234，格式 ¥0', () => {
  const r = parseNumericText('¥1234', LOCALE);
  assert.ok(r);
  assert.equal(r.num, 1234);
  assert.equal(r.format, '¥0');
});

test('货币：¥1,234.56 → 1234.56，格式 ¥#,##0.00', () => {
  const r = parseNumericText('¥1,234.56', LOCALE);
  assert.ok(r);
  assert.equal(r.num, 1234.56);
  assert.equal(r.format, '¥#,##0.00');
});

// ============ 不识别的输入 ============

test('纯数字/小数（无特殊符号）不识别，保持常规', () => {
  assert.equal(parseNumericText('3.14', LOCALE), null);
  assert.equal(parseNumericText('123', LOCALE), null);
  assert.equal(parseNumericText('-1.5', LOCALE), null);
});

test('公式/普通文本/空串不识别', () => {
  assert.equal(parseNumericText('=A1', LOCALE), null);
  assert.equal(parseNumericText('abc', LOCALE), null);
  assert.equal(parseNumericText('', LOCALE), null);
});

test('非法千分位/混入文本不识别', () => {
  assert.equal(parseNumericText('1,2,3', LOCALE), null); // 分组长度不对
  assert.equal(parseNumericText('12,34', LOCALE), null);
  assert.equal(parseNumericText('10,000 people', LOCALE), null); // 含非数字后缀
  assert.equal(parseNumericText('1,234,5678', LOCALE), null); // 末组非 3 位
});

test('日期文本优先于数字文本识别', () => {
  // 形如 "1,2" 之类若被日期逻辑捕获则不应误判为数字；此处验证不会把日期式返回数字结果
  assert.equal(parseNumericText('2026-08-25', LOCALE), null);
});

test('首尾空白容错', () => {
  const r = parseNumericText('  1,234.56  ', LOCALE);
  assert.ok(r);
  assert.equal(r.num, 1234.56);
  assert.equal(r.format, '#,##0.00');
});
