import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateTimeInput } from '../src/components/spreader/core/number-format';

// 期望序列号按 Excel 定义独立推导（1970-01-01 = 25569，适用于 1900-03-01 之后的日期）
function expectSerial(y: number, m: number, d: number): number {
  return 25569 + (Date.UTC(y, m - 1, d) - Date.UTC(1970, 0, 1)) / 86400000;
}

const NOW = new Date(Date.UTC(2026, 7, 1)); // 固定“当前时间”：2026-08-01

// ============ 纯日期 ============

test('日期：yyyy-m-d / yyyy/m/d 识别，格式跟随 locale', () => {
  const zh = parseDateTimeInput('2026-08-25', 'zh-CN', NOW);
  assert.ok(zh);
  assert.equal(zh.serial, expectSerial(2026, 8, 25));
  assert.equal(zh.format, 'yyyy"年"m"月"d"日"');

  const en = parseDateTimeInput('2026/8/5', 'en-US', NOW);
  assert.ok(en);
  assert.equal(en.serial, expectSerial(2026, 8, 5));
  assert.equal(en.format, 'm/d/yyyy');
});

test('日期：中文形式 yyyy年m月d日', () => {
  const r = parseDateTimeInput('2026年8月25日', 'zh-CN', NOW);
  assert.ok(r);
  assert.equal(r.serial, expectSerial(2026, 8, 25));
  assert.equal(r.format, 'yyyy"年"m"月"d"日"');
});

test('日期：m-d / m/d 补当前年', () => {
  const r = parseDateTimeInput('8-25', 'zh-CN', NOW);
  assert.ok(r);
  assert.equal(r.serial, expectSerial(2026, 8, 25));
  const r2 = parseDateTimeInput('12/31', 'en-US', NOW);
  assert.ok(r2);
  assert.equal(r2.serial, expectSerial(2026, 12, 31));
});

test('日期：美式 月/日/年（m/d/yyyy）解析，格式跟随 locale', () => {
  const en = parseDateTimeInput('8/25/2026', 'en-US', NOW);
  assert.ok(en);
  assert.equal(en.serial, expectSerial(2026, 8, 25));
  assert.equal(en.format, 'm/d/yyyy');
  // 与 YYYY/MM/DD 不冲突：2026/8/25 仍按 年/月/日 解析
  const iso = parseDateTimeInput('2026/8/25', 'en-US', NOW);
  assert.ok(iso);
  assert.equal(iso.serial, expectSerial(2026, 8, 25));
  // 带时间：月/日/年 时:分
  const dt = parseDateTimeInput('8/25/2026 12:30', 'en-US', NOW);
  assert.ok(dt);
  assert.equal(dt.serial, expectSerial(2026, 8, 25) + (12 * 3600 + 30 * 60) / 86400);
});

test('日期：美式解析各 locale 均可识别（不依赖 en-US）', () => {
  const zh = parseDateTimeInput('8/25/2026', 'zh-CN', NOW);
  assert.ok(zh);
  assert.equal(zh.serial, expectSerial(2026, 8, 25));
  // 美式 12/31/2026 不会被误读为 年/月/日（否则会越界或错配）
  const r = parseDateTimeInput('12/31/2026', 'zh-CN', NOW);
  assert.ok(r);
  assert.equal(r.serial, expectSerial(2026, 12, 31));
});

test('日期：美式非法（月越界/缺年）仍拒绝', () => {
  assert.equal(parseDateTimeInput('13/25/2026', 'en-US', NOW), null);
  assert.equal(parseDateTimeInput('8/25', 'en-US', NOW)?.serial, expectSerial(2026, 8, 25));
});

test('日期：闰年与非法日期', () => {
  assert.ok(parseDateTimeInput('2024-2-29', 'zh-CN', NOW));
  assert.equal(parseDateTimeInput('2023-2-29', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('2026-13-1', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('2026-0-1', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('2026-8-32', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('1899-12-31', 'zh-CN', NOW), null);
});

test('日期：1900 虚构闰年修正（1900-01-01 = 1，1900-03-01 = 61）', () => {
  assert.equal(parseDateTimeInput('1900-1-1', 'zh-CN', NOW)?.serial, 1);
  assert.equal(parseDateTimeInput('1900-2-28', 'zh-CN', NOW)?.serial, 59);
  assert.equal(parseDateTimeInput('1900-3-1', 'zh-CN', NOW)?.serial, 61);
  assert.equal(parseDateTimeInput('1970-1-1', 'zh-CN', NOW)?.serial, 25569);
});

// ============ 纯时间 ============

test('时间：h:mm / h:mm:ss，格式为 h:mm:ss', () => {
  const t1 = parseDateTimeInput('12:00', 'zh-CN', NOW);
  assert.ok(t1);
  assert.equal(t1.serial, 0.5);
  assert.equal(t1.format, 'h:mm:ss');

  const t2 = parseDateTimeInput('13:30:30', 'zh-CN', NOW);
  assert.ok(t2);
  assert.equal(t2.serial, (13 * 3600 + 30 * 60 + 30) / 86400);

  assert.equal(parseDateTimeInput('0:00', 'zh-CN', NOW)?.serial, 0);
  assert.equal(parseDateTimeInput('23:59:59', 'zh-CN', NOW)?.serial, 86399 / 86400);
});

test('时间：越界不识别', () => {
  assert.equal(parseDateTimeInput('24:00', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('12:60', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('12:30:60', 'zh-CN', NOW), null);
});

// ============ 日期 + 时间 ============

test('日期时间：空格或 T 分隔，格式为日期时间预设', () => {
  const base = expectSerial(2026, 8, 25);
  const r1 = parseDateTimeInput('2026-08-25 12:00', 'zh-CN', NOW);
  assert.ok(r1);
  assert.equal(r1.serial, base + 0.5);
  assert.equal(r1.format, 'yyyy"年"m"月"d"日" h:mm:ss');

  const r2 = parseDateTimeInput('2026/8/25T13:30:15', 'en-US', NOW);
  assert.ok(r2);
  assert.equal(r2.serial, base + (13 * 3600 + 30 * 60 + 15) / 86400);
  assert.equal(r2.format, 'm/d/yyyy h:mm:ss');

  const r3 = parseDateTimeInput('2026年8月25日 8:5', 'zh-CN', NOW);
  assert.ok(r3);
  assert.equal(r3.serial, base + (8 * 3600 + 5 * 60) / 86400);
});

// ============ 不识别的输入 ============

test('纯数字/公式/普通文本/空串不识别', () => {
  assert.equal(parseDateTimeInput('123', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('-1.5', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('=A1', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('abc', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('   ', 'zh-CN', NOW), null);
  assert.equal(parseDateTimeInput('2026-08-25 25:00', 'zh-CN', NOW), null);
});

test('首尾空白可识别（输入容错）', () => {
  const r = parseDateTimeInput('  2026-08-25  ', 'zh-CN', NOW);
  assert.ok(r);
  assert.equal(r.serial, expectSerial(2026, 8, 25));
});
