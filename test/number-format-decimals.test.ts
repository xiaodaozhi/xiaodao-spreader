import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NF_MAX_DECIMALS,
  NF_MIN_DECIMALS,
  NF_CUSTOM,
  NF_TEXT,
  isNumericValue,
  isDecimalsAdjustable,
  getEffectiveDecimals,
  adjustNumberFormatDecimals,
  normalizeNumberFormatForDisplay,
} from '../src/components/spreader/core/number-format';
import { computeCellValue } from '../src/components/spreader/core/formula';

// ============ isNumericValue ============

test('isNumericValue 有限数字为 true', () => {
  assert.equal(isNumericValue('123'), true);
  assert.equal(isNumericValue('-1.5'), true);
  assert.equal(isNumericValue('0'), true);
});

test('isNumericValue 非数字/空串/公式为 false', () => {
  assert.equal(isNumericValue(''), false);
  assert.equal(isNumericValue('   '), false);
  assert.equal(isNumericValue('abc'), false);
  assert.equal(isNumericValue('=SUM(A1)'), false);
});

// ============ isDecimalsAdjustable ============

test('数值类格式（数字/百分比/货币/会计/科学计数）恒可调整', () => {
  assert.equal(isDecimalsAdjustable('#,##0.00', ''), true);
  assert.equal(isDecimalsAdjustable('0.00%', 'abc'), true);
  assert.equal(isDecimalsAdjustable('¥#,##0.00', ''), true);
  assert.equal(isDecimalsAdjustable('¥#,##0.00;(¥#,##0.00);¥"-"', ''), true);
  assert.equal(isDecimalsAdjustable('0.00E+00', ''), true);
});

test('常规格式：值为数字时可调整，否则不可', () => {
  assert.equal(isDecimalsAdjustable('', '1.5'), true);
  assert.equal(isDecimalsAdjustable('', 'abc'), false);
  assert.equal(isDecimalsAdjustable(undefined, '42'), true);
  assert.equal(isDecimalsAdjustable('General', '42'), true);
});

// 公式单元格：原始 raw 是 "=..." 串，isNumericValue 判为 false；
// 但小数位按钮需用【计算结果】判定，否则公式数值单元格无法调整小数位
// （cell 显示已识别为数字并右对齐，按钮却误判不可调整）。
test('公式单元格应使用计算结果判定小数位可调整（而非原始公式串）', () => {
  const cells = {
    '0,0': { value: '1' },
    '0,1': { value: '2' },
    '0,2': { value: '3' },
    '1,0': { value: '=SUM(A1:A3)' },
  };
  const raw = cells['1,0']!.value;
  // 原始公式串本身不可识别为数值
  assert.equal(isDecimalsAdjustable('', raw), false);
  // 计算结果可识别为数值 → 按钮应可用
  const result = computeCellValue(1, 0, cells as any, 10, 10);
  assert.equal(result, '6');
  assert.equal(isDecimalsAdjustable('', result), true);
  // 计算结果的小数位（常规 → 0，可增减）
  assert.equal(getEffectiveDecimals('', result), 0);
});

test('文本/日期/时间/持续时间不可调整', () => {
  assert.equal(isDecimalsAdjustable('@', '123'), false);
  assert.equal(isDecimalsAdjustable('yyyy"年"m"月"d"日"', '45000'), false);
  assert.equal(isDecimalsAdjustable('h:mm:ss', '0.5'), false);
  assert.equal(isDecimalsAdjustable('[h]:mm:ss', '1.5'), false);
  // 财务格式的 [Red] 颜色修饰符不应被误判为日期类 → 可调整
  assert.equal(isDecimalsAdjustable('#,##0.00;[Red](#,##0.00)', '1'), true);
});

// ============ getEffectiveDecimals ============

test('getEffectiveDecimals 数值类取首个含占位符区段的小数位', () => {
  assert.equal(getEffectiveDecimals('#,##0.00', ''), 2);
  assert.equal(getEffectiveDecimals('#,##0', ''), 0);
  assert.equal(getEffectiveDecimals('0.00%', ''), 2);
  assert.equal(getEffectiveDecimals('0.000E+00', ''), 3);
});

test('getEffectiveDecimals 常规数值 → 实际小数位；不支持 → -1', () => {
  assert.equal(getEffectiveDecimals('', '1.5'), 1);
  assert.equal(getEffectiveDecimals('', '100'), 0);
  assert.equal(getEffectiveDecimals('', '536.81952291356'), 11);
  // 公式结果（常规格式，长小数）应反映实际小数位，而非恒为 0
  assert.equal(getEffectiveDecimals('', '-536.81952291356'), 11);
  assert.equal(getEffectiveDecimals('', 'abc'), -1);
  assert.equal(getEffectiveDecimals('@', '1'), -1);
  assert.equal(getEffectiveDecimals('h:mm:ss', '0.5'), -1);
});

// ============ adjustNumberFormatDecimals ============

test('基础数值格式增减小数位', () => {
  assert.equal(adjustNumberFormatDecimals('#,##0.00', 3), '#,##0.000');
  assert.equal(adjustNumberFormatDecimals('#,##0.00', 1), '#,##0.0');
  assert.equal(adjustNumberFormatDecimals('#,##0.00', 0), '#,##0');
  assert.equal(adjustNumberFormatDecimals('#,##0', 2), '#,##0.00');
});

test('百分比/货币/科学计数保留后缀与结构', () => {
  assert.equal(adjustNumberFormatDecimals('0.00%', 3), '0.000%');
  assert.equal(adjustNumberFormatDecimals('¥#,##0.00', 1), '¥#,##0.0');
  assert.equal(adjustNumberFormatDecimals('¥#,##0', 2), '¥#,##0.00');
  assert.equal(adjustNumberFormatDecimals('0.00E+00', 3), '0.000E+00');
});

test('多区段格式逐区段调整，纯文本区段保留', () => {
  assert.equal(
    adjustNumberFormatDecimals('¥#,##0.00;(¥#,##0.00);¥"-"', 0),
    '¥#,##0;(¥#,##0);¥"-"',
  );
  assert.equal(
    adjustNumberFormatDecimals('#,##0.00;[Red](#,##0.00)', 1),
    '#,##0.0;[Red](#,##0.0)',
  );
});

test('常规格式生成纯数值格式', () => {
  assert.equal(adjustNumberFormatDecimals('', 1), '0.0');
  assert.equal(adjustNumberFormatDecimals(undefined, 2), '0.00');
  assert.equal(adjustNumberFormatDecimals('General', 0), '0');
});

test('文本/日期/时间/持续时间返回 null', () => {
  assert.equal(adjustNumberFormatDecimals('@', 2), null);
  assert.equal(adjustNumberFormatDecimals('yyyy"年"m"月"d"日"', 2), null);
  assert.equal(adjustNumberFormatDecimals('h:mm:ss', 2), null);
  assert.equal(adjustNumberFormatDecimals('[h]:mm:ss', 2), null);
});

test('目标小数位越界返回 null', () => {
  assert.equal(adjustNumberFormatDecimals('#,##0.00', -1), null);
  assert.equal(adjustNumberFormatDecimals('#,##0.00', NF_MAX_DECIMALS + 1), null);
  assert.equal(NF_MIN_DECIMALS, 0);
  // 颜色修饰符保留，只调整占位符核心；条件修饰符 [>100] 中的数字不参与调整
  assert.equal(
    adjustNumberFormatDecimals('#,##0.00;[Red](#,##0.00)', 1),
    '#,##0.0;[Red](#,##0.0)',
  );
});

test('目标与当前一致时原样返回', () => {
  assert.equal(adjustNumberFormatDecimals('#,##0.00', 2), '#,##0.00');
});

// ============ normalizeNumberFormatForDisplay（下拉回显归类） ============

test('回显：精确命中预设/常规/文本原样返回', () => {
  assert.equal(normalizeNumberFormatForDisplay('#,##0.00', 'zh-CN'), '#,##0.00');
  assert.equal(normalizeNumberFormatForDisplay('0.00%', 'zh-CN'), '0.00%');
  assert.equal(normalizeNumberFormatForDisplay('', 'zh-CN'), '');
  assert.equal(normalizeNumberFormatForDisplay(undefined, 'zh-CN'), '');
  assert.equal(normalizeNumberFormatForDisplay(NF_TEXT, 'zh-CN'), NF_TEXT);
});

test('回显：增减小数位产生的非预设数值代码归为数值预设', () => {
  assert.equal(normalizeNumberFormatForDisplay('#,##0.000', 'zh-CN'), '#,##0.00');
  assert.equal(normalizeNumberFormatForDisplay('#,##0.0', 'zh-CN'), '#,##0.00');
  assert.equal(normalizeNumberFormatForDisplay('0', 'zh-CN'), '#,##0.00');
  assert.equal(normalizeNumberFormatForDisplay('0.0000', 'en'), '#,##0.00');
  assert.equal(normalizeNumberFormatForDisplay('0.000%', 'zh-CN'), '0.00%');
  assert.equal(normalizeNumberFormatForDisplay('0.000E+00', 'zh-CN'), '0.00E+00');
});

test('回显：对话框改货币符号/会计/财务归为对应预设', () => {
  assert.equal(normalizeNumberFormatForDisplay('€#,##0.00', 'zh-CN'), '¥#,##0.00');
  assert.equal(normalizeNumberFormatForDisplay('$#,##0', 'en'), '$#,##0');
  assert.equal(
    normalizeNumberFormatForDisplay('€#,##0.00;(€#,##0.00);€"-"', 'zh-CN'),
    '¥#,##0.00;(¥#,##0.00);¥"-"',
  );
  assert.equal(normalizeNumberFormatForDisplay('0.00;[Red](0.00)', 'zh-CN'), '#,##0.00;[Red](#,##0.00)');
});

test('回显：非默认日期/时间/时长归为对应预设', () => {
  assert.equal(normalizeNumberFormatForDisplay('yyyy-mm-dd', 'zh-CN'), 'yyyy"年"m"月"d"日"');
  assert.equal(normalizeNumberFormatForDisplay('mm/dd/yyyy', 'en'), 'm/d/yyyy');
  assert.equal(normalizeNumberFormatForDisplay('yyyy-mm-dd hh:mm', 'zh-CN'), 'yyyy"年"m"月"d"日" h:mm:ss');
  assert.equal(normalizeNumberFormatForDisplay('hh:mm', 'zh-CN'), 'h:mm:ss');
  assert.equal(normalizeNumberFormatForDisplay('[mm]:ss', 'zh-CN'), '[h]:mm:ss');
});

test('回显：无法识别的自定义代码归为自定义', () => {
  assert.equal(normalizeNumberFormatForDisplay('"abc"', 'zh-CN'), NF_CUSTOM);
  assert.equal(normalizeNumberFormatForDisplay('abc', 'zh-CN'), NF_CUSTOM);
});
