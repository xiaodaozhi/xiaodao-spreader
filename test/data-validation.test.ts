import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DataValidationIndex,
  adjustDvRangeForDelete,
  adjustDvRangeForInsert,
  dvCellInRanges,
  dvRuleAnchor,
  dvTextLength,
  evaluateDataValidationRule,
  genDataValidationId,
  hasDropdownIndicator,
  intersectDvRange,
  isBlankValue,
  resolveListItems,
  subtractDvRange,
  translateDvRange,
  validateCellValue,
  type DataValidationContext,
} from '../src/components/spreader/core/data-validation';
import { dateToSerial } from '../src/components/spreader/core/number-format';
import type {
  CellData,
  DataValidationRule,
  DataValidationType,
  SelectionRange,
} from '../src/components/spreader/core/types';

const LOCALE = 'zh-CN';
const COL_COUNT = 26;
const ROW_COUNT = 200;

// ============ 辅助 ============
function range(sC: number, sR: number, eC: number, eR: number): SelectionRange {
  return { startCol: sC, startRow: sR, endCol: eC, endRow: eR };
}

function makeCells(entries: Record<string, string>): Record<string, CellData> {
  const out: Record<string, CellData> = {};
  for (const [k, v] of Object.entries(entries)) out[k] = { value: v };
  return out;
}

function makeCtx(cells: Record<string, CellData>, foreign?: Record<string, Record<string, CellData>>): DataValidationContext {
  return {
    cells,
    colCount: COL_COUNT,
    rowCount: ROW_COUNT,
    locale: LOCALE,
    getCellValue: (c, r) => {
      const cell = cells[`${c},${r}`];
      if (!cell) return '';
      return cell.value.startsWith('=') ? '' : cell.value;
    },
    getSheetCells: (id) => (foreign && foreign[id]) ?? null,
  };
}

function rule(partial: Partial<DataValidationRule> & { type: DataValidationType }): DataValidationRule {
  return { id: genDataValidationId(), ranges: [range(0, 0, 0, 0)], ...partial };
}

function evalRule(
  r: DataValidationRule,
  value: string | null,
  col: number,
  row: number,
  cells: Record<string, CellData> = {},
  foreign?: Record<string, Record<string, CellData>>,
): boolean {
  return evaluateDataValidationRule(r, value, col, row, makeCtx(cells, foreign));
}

// ============ 1. List（常量列表） ============

test('List: 北京,上海,广州 —— 上海 valid / 深圳 invalid', () => {
  const r = rule({ type: 'list', values: ['北京', '上海', '广州'] });
  assert.equal(evalRule(r, '上海', 0, 0), true);
  assert.equal(evalRule(r, '深圳', 0, 0), false);
});

test('List: 大小写不敏感 + 忽略首尾空白', () => {
  const r = rule({ type: 'list', values: ['Yes', 'No'] });
  assert.equal(evalRule(r, 'yes', 0, 0), true);
  assert.equal(evalRule(r, ' No ', 0, 0), true);
});

test('List: listSource.values 与 values 字段等价', () => {
  const r = rule({ type: 'list', listSource: { type: 'values', values: ['男', '女'] } });
  assert.equal(evalRule(r, '男', 0, 0), true);
  assert.equal(evalRule(r, '未知', 0, 0), false);
});

// ============ 2. List（引用区域） ============

test('List Range: 读取 Sheet2!A1:A3，修改源数据后下拉项同步更新', () => {
  const r = rule({
    type: 'list',
    listSource: { type: 'range', range: range(0, 0, 0, 2), sheetId: 'Sheet2' },
  });
  const before = { Sheet2: makeCells({ '0,0': '北京', '0,1': '上海', '0,2': '广州' }) };
  assert.deepEqual(resolveListItems(r, makeCtx({}, before)), ['北京', '上海', '广州']);

  const after = { Sheet2: makeCells({ '0,0': '北京', '0,1': '深圳', '0,2': '广州' }) };
  const ctx2 = makeCtx({}, after);
  assert.deepEqual(resolveListItems(r, ctx2), ['北京', '深圳', '广州']);
  assert.equal(evalRule(r, '深圳', 0, 0, {}, after), true);
  assert.equal(evalRule(r, '上海', 0, 0, {}, after), false);
});

test('List Range: 去重 + 跳过不存在的 Cell + 空值按 allowBlank 处理', () => {
  const r = rule({
    type: 'list',
    allowBlank: false,
    listSource: { type: 'range', range: range(0, 0, 0, 3) },
  });
  // A1=北京, A2=(空字符串但 cell 存在), A3=上海, A4 不存在
  const cells = makeCells({ '0,0': '北京', '0,1': '', '0,2': '上海', '0,3': '北京' });
  // allowBlank=false → 空项不出现在候选中
  assert.deepEqual(resolveListItems(r, makeCtx(cells)), ['北京', '上海']);

  const r2 = rule({
    type: 'list',
    allowBlank: true,
    listSource: { type: 'range', range: range(0, 0, 0, 3) },
  });
  assert.deepEqual(resolveListItems(r2, makeCtx(cells)), ['北京', '', '上海']);
});

// ============ 3. Whole Number ============

test('Whole Number 1~100: 1/50/100 valid，0/101/1.5 invalid', () => {
  const r = rule({
    type: 'wholeNumber',
    operator: 'between',
    formula1: '1',
    formula2: '100',
  });
  for (const v of ['1', '50', '100']) assert.equal(evalRule(r, v, 0, 0), true, `${v} 应有效`);
  for (const v of ['0', '101', '1.5', 'abc']) assert.equal(evalRule(r, v, 0, 0), false, `${v} 应无效`);
});

test('Whole Number 支持千分位 / 科学计数法 / 负号', () => {
  const r = rule({ type: 'wholeNumber', operator: 'greaterThanOrEqual', formula1: '1000' });
  assert.equal(evalRule(r, '1,000', 0, 0), true);
  assert.equal(evalRule(r, '1e4', 0, 0), true);
  assert.equal(evalRule(r, '-5', 0, 0), false);
});

// ============ 4. Decimal ============

test('Decimal: 1.5 / 3.14 / 2 valid', () => {
  const r = rule({ type: 'decimal', operator: 'between', formula1: '0', formula2: '10' });
  assert.equal(evalRule(r, '1.5', 0, 0), true);
  assert.equal(evalRule(r, '3.14', 0, 0), true);
  assert.equal(evalRule(r, '2', 0, 0), true);
  assert.equal(evalRule(r, '10.1', 0, 0), false);
  assert.equal(evalRule(r, 'abc', 0, 0), false);
});

// ============ 5. Date ============

test('Date 2026-01-01 ~ 2026-12-31', () => {
  const r = rule({
    type: 'date',
    operator: 'between',
    formula1: '2026-01-01',
    formula2: '2026-12-31',
  });
  assert.equal(evalRule(r, '2026-01-01', 0, 0), true);
  assert.equal(evalRule(r, '2026-06-15', 0, 0), true);
  assert.equal(evalRule(r, '2026-12-31', 0, 0), true);
  assert.equal(evalRule(r, '2025-12-31', 0, 0), false);
  assert.equal(evalRule(r, '2027-01-01', 0, 0), false);
  // 纯时间不是日期
  assert.equal(evalRule(r, '12:30', 0, 0), false);
});

test('Date 支持序列号直接比较（复用项目 dateToSerial）', () => {
  const serial = String(dateToSerial(2026, 6, 1));
  const r = rule({ type: 'date', operator: 'greaterThan', formula1: '2026-01-01' });
  assert.equal(evalRule(r, serial, 0, 0), true);
});

// ============ 6. Time ============

test('Time 09:00 ~ 18:00：按时间比较而非字符串比较', () => {
  const r = rule({ type: 'time', operator: 'between', formula1: '09:00', formula2: '18:00' });
  assert.equal(evalRule(r, '09:30', 0, 0), true);
  assert.equal(evalRule(r, '17:59', 0, 0), true);
  assert.equal(evalRule(r, '18:01', 0, 0), false);
  assert.equal(evalRule(r, '08:59', 0, 0), false);
});

// ============ 7. Text Length ============

test('Text Length <= 10：中文 / Emoji 按码点统计', () => {
  const r = rule({ type: 'textLength', operator: 'lessThanOrEqual', formula1: '10' });
  assert.equal(evalRule(r, 'abc', 0, 0), true);
  assert.equal(evalRule(r, '12345678901', 0, 0), false);
  assert.equal(evalRule(r, '中文中文中文中文中文中', 0, 0), false); // 11 个码点
  assert.equal(dvTextLength('abc'), 3);
  assert.equal(dvTextLength('中文'), 2);
  assert.equal(dvTextLength('😀😀'), 2); // UTF-16 length 为 4，码点为 2
});

// ============ 8. Custom Formula ============

test('Custom: =AND(B2>=0,B2<=100) —— 50 valid / 101 invalid', () => {
  // 应用范围 B2:B100（col=1, row=1..99）
  const r = rule({
    type: 'custom',
    formula1: '=AND(B2>=0,B2<=100)',
    ranges: [range(1, 1, 1, 99)],
  });
  assert.equal(evalRule(r, '50', 1, 1), true);
  assert.equal(evalRule(r, '101', 1, 1), false);
  // 同一规则作用于 B3 时，公式相对引用自动偏移为 B3
  assert.equal(evalRule(r, '50', 1, 2), true);
  assert.equal(evalRule(r, '101', 1, 2), false);
});

test('Custom: 相对引用基准 = 规则范围左上角（$A2 列绝对行相对）', () => {
  // 应用范围 B2:D100，公式 =$A2="完成"
  const r = rule({
    type: 'custom',
    formula1: '=$A2="完成"',
    ranges: [range(1, 1, 3, 99)],
  });
  const done = makeCells({ '0,1': '完成', '0,2': '未完成', '0,49': '完成' });
  assert.equal(evalRule(r, '任意', 1, 1, done), true);  // B2 → $A2 = 完成
  assert.equal(evalRule(r, '任意', 1, 2, done), false); // B3 → $A3 = 未完成
  assert.equal(evalRule(r, '任意', 3, 49, done), true); // D50 → $A50 = 完成
});

test('Custom: 公式求值出错（#REF!/#VALUE!）视为 invalid 且不抛异常', () => {
  const r = rule({ type: 'custom', formula1: '=1/0' });
  assert.doesNotThrow(() => evalRule(r, 'x', 0, 0));
  assert.equal(evalRule(r, 'x', 0, 0), false);
});

test('Custom: 未配置公式时不做限制', () => {
  const r = rule({ type: 'custom' });
  assert.equal(evalRule(r, '任意内容', 0, 0), true);
});

// ============ 9. allowBlank ============

test('allowBlank=true：空值放行；allowBlank=false：空值非法', () => {
  const rAllow = rule({ type: 'wholeNumber', operator: 'greaterThan', formula1: '10', allowBlank: true });
  const rDeny = rule({ type: 'wholeNumber', operator: 'greaterThan', formula1: '10', allowBlank: false });
  for (const empty of ['', '   ', null]) {
    assert.equal(evalRule(rAllow, empty, 0, 0), true, `allowBlank 应放行 ${JSON.stringify(empty)}`);
    assert.equal(evalRule(rDeny, empty, 0, 0), false, `allowBlank=false 应拦截 ${JSON.stringify(empty)}`);
  }
});

test('isBlankValue 区分 null / undefined / 空串 / 空白 / 非空', () => {
  assert.equal(isBlankValue(null), true);
  assert.equal(isBlankValue(undefined), true);
  assert.equal(isBlankValue(''), true);
  assert.equal(isBlankValue('   '), true);
  assert.equal(isBlankValue('0'), false);
  assert.equal(isBlankValue(0), false);
});

// ============ 10. 运算符 ============

test('运算符：equal / notEqual / notBetween / lessThan 等', () => {
  const mk = (operator: DataValidationRule['operator'], f1: string, f2?: string) =>
    rule({ type: 'wholeNumber', operator, formula1: f1, formula2: f2 });
  assert.equal(evalRule(mk('equal', '5'), '5', 0, 0), true);
  assert.equal(evalRule(mk('equal', '5'), '6', 0, 0), false);
  assert.equal(evalRule(mk('notEqual', '5'), '6', 0, 0), true);
  assert.equal(evalRule(mk('notBetween', '1', '10'), '20', 0, 0), true);
  assert.equal(evalRule(mk('notBetween', '1', '10'), '5', 0, 0), false);
  assert.equal(evalRule(mk('lessThan', '10'), '9', 0, 0), true);
  assert.equal(evalRule(mk('greaterThan', '10'), '11', 0, 0), true);
  // between 的上下界顺序无关
  assert.equal(evalRule(mk('between', '100', '1'), '50', 0, 0), true);
});

// ============ 11. 多规则：必须全部通过 ============

test('多规则：整数 + 1~100 → 50 valid，50.5 / 101 invalid', () => {
  const rules: DataValidationRule[] = [
    rule({ id: 'r1', type: 'wholeNumber', ranges: [range(0, 0, 0, 9)] }),
    rule({ id: 'r2', type: 'wholeNumber', operator: 'between', formula1: '1', formula2: '100', ranges: [range(0, 0, 0, 9)] }),
  ];
  const ctx = makeCtx({});
  assert.equal(validateCellValue('50', 0, 0, rules, ctx).valid, true);
  assert.equal(validateCellValue('50.5', 0, 0, rules, ctx).valid, false);
  assert.equal(validateCellValue('101', 0, 0, rules, ctx).valid, false);
  assert.equal(validateCellValue('0', 0, 0, rules, ctx).valid, false);
});

test('无规则 / 未命中范围：一律 valid', () => {
  const ctx = makeCtx({});
  assert.equal(validateCellValue('任意', 0, 0, [], ctx).valid, true);
  const r = rule({ type: 'list', values: ['x'], ranges: [range(5, 5, 6, 6)] });
  assert.equal(validateCellValue('任意', 0, 0, [r], ctx).valid, true);
});

test('失败结果取最严重的 severity，并携带提示文案', () => {
  const rules: DataValidationRule[] = [
    rule({ id: 'warn', type: 'list', values: ['a'], errorStyle: 'warning', errorMessage: '警告文案' }),
    rule({ id: 'stop', type: 'wholeNumber', errorStyle: 'stop', errorMessage: '停止文案' }),
  ];
  const res = validateCellValue('zzz', 0, 0, rules, makeCtx({}));
  assert.equal(res.valid, false);
  assert.equal(res.severity, 'stop');
  assert.equal(res.rule?.id, 'stop');
  assert.equal(res.message, '停止文案');
  assert.equal(res.title, '输入无效');
});

test('showErrorMessage=false 时使用默认文案', () => {
  const rules = [rule({ type: 'list', values: ['a'], showErrorMessage: false })];
  const res = validateCellValue('zzz', 0, 0, rules, makeCtx({}));
  assert.equal(res.valid, false);
  assert.ok(res.message && res.message.length > 0);
});

test('enabled=false 的规则被忽略', () => {
  const rules = [rule({ type: 'list', values: ['a'], enabled: false })];
  assert.equal(validateCellValue('zzz', 0, 0, rules, makeCtx({})).valid, true);
});

// ============ 12. 空间索引 ============

test('DataValidationIndex：命中查询 / 跨行带 / 失效重建', () => {
  const r1 = rule({ id: 'r1', type: 'list', values: ['a'], ranges: [range(0, 0, 2, 2)] });
  const r2 = rule({ id: 'r2', type: 'list', values: ['b'], ranges: [range(0, 100, 2, 199)] }); // 跨多个行带
  const rules = [r1, r2];
  const idx = new DataValidationIndex(rules);
  assert.ok(idx.has(0, 0));
  assert.equal(idx.getRules(1, 1).length, 1);
  assert.equal(idx.has(5, 5), false);
  assert.ok(idx.has(0, 150));
  assert.equal(idx.getRules(1, 150)[0]!.id, 'r2');
  // 规则集合替换后失效重建
  const idx2 = new DataValidationIndex();
  idx2.invalidate();
  assert.equal(idx2.has(0, 0, rules), true);
  idx2.invalidate();
  assert.equal(idx2.has(0, 0, []), false);
});

test('DataValidationIndex：多区域同一规则只返回一次', () => {
  const r = rule({ id: 'r1', type: 'list', values: ['a'], ranges: [range(0, 0, 2, 2), range(0, 0, 5, 5)] });
  const idx = new DataValidationIndex([r]);
  assert.equal(idx.getRules(1, 1).length, 1);
});

// ============ 13. 范围变换（插入 / 删除 / 清除 / 平移） ============

test('插入行：范围 A2:A100 在第 50 行插入后扩展为 A2:A101', () => {
  // A2:A100 → (col 0, row 1..99)；在第 50 行（index 49）插入 1 行
  const before = range(0, 1, 0, 99);
  const after = adjustDvRangeForInsert(before, 'row', 49, 1);
  assert.deepEqual(after, range(0, 1, 0, 100));
});

test('删除行：范围整体平移 / 部分裁剪 / 整段命中返回 null', () => {
  // 完全在删除带之下 → 平移
  assert.deepEqual(adjustDvRangeForDelete(range(0, 10, 0, 20), 'row', 0, 5), range(0, 5, 0, 15));
  // 与删除带部分相交 → 删除带内部分被裁掉，剩余部分上移
  // （删除 rows 0..9 后，原 rows 10..20 落到 0..10）
  assert.deepEqual(adjustDvRangeForDelete(range(0, 5, 0, 20), 'row', 0, 10), range(0, 0, 0, 10));
  // 整段落在删除带内 → null
  assert.equal(adjustDvRangeForDelete(range(0, 5, 0, 8), 'row', 0, 10), null);
  // 完全在删除带之上 → 不动
  assert.deepEqual(adjustDvRangeForDelete(range(0, 0, 0, 3), 'row', 10, 5), range(0, 0, 0, 3));
});

test('插入 / 删除列的范围变换', () => {
  assert.deepEqual(adjustDvRangeForInsert(range(0, 0, 4, 4), 'col', 2, 2), range(0, 0, 6, 4));
  assert.deepEqual(adjustDvRangeForDelete(range(5, 0, 9, 4), 'col', 0, 3), range(2, 0, 6, 4));
  assert.equal(adjustDvRangeForDelete(range(1, 0, 2, 4), 'col', 0, 5), null);
});

test('subtractDvRange：矩形差集拆分（清除所选区域验证）', () => {
  const r = range(0, 0, 9, 9);
  // 中间挖洞 → 上下左右四段
  const parts = subtractDvRange(r, range(3, 3, 5, 5));
  assert.equal(parts.length, 4);
  // 整块挖掉 → 空
  assert.equal(subtractDvRange(r, range(0, 0, 9, 9)).length, 0);
  // 不相交 → 原样
  assert.deepEqual(subtractDvRange(r, range(20, 20, 25, 25)), [r]);
  // 切掉顶部一条 → 剩一段
  assert.deepEqual(subtractDvRange(r, range(0, 0, 9, 4)), [range(0, 5, 9, 9)]);
});

test('translateDvRange / intersectDvRange / dvCellInRanges / dvRuleAnchor', () => {
  assert.deepEqual(translateDvRange(range(1, 1, 2, 2), 3, 4), range(4, 5, 5, 6));
  assert.deepEqual(intersectDvRange(range(0, 0, 5, 5), range(3, 3, 9, 9)), range(3, 3, 5, 5));
  assert.equal(intersectDvRange(range(0, 0, 1, 1), range(5, 5, 6, 6)), null);
  assert.equal(dvCellInRanges([range(0, 0, 2, 2), range(5, 5, 6, 6)], 5, 5), true);
  assert.equal(dvCellInRanges([range(0, 0, 2, 2)], 3, 3), false);
  assert.deepEqual(
    dvRuleAnchor(rule({ type: 'list', ranges: [range(4, 6, 8, 9), range(1, 2, 3, 4)] })),
    { col: 1, row: 2 },
  );
});

// ============ 14. 下拉箭头显示条件 ============

test('hasDropdownIndicator：仅 list + showDropdown !== false + enabled', () => {
  assert.equal(hasDropdownIndicator(rule({ type: 'list' })), true);
  assert.equal(hasDropdownIndicator(rule({ type: 'list', showDropdown: false })), false);
  assert.equal(hasDropdownIndicator(rule({ type: 'list', enabled: false })), false);
  assert.equal(hasDropdownIndicator(rule({ type: 'wholeNumber' })), false);
  assert.equal(hasDropdownIndicator(null), false);
});

// ============ 15. ID 唯一性 ============

test('genDataValidationId 生成唯一 ID', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 500; i++) ids.add(genDataValidationId());
  assert.equal(ids.size, 500);
});

// ============ 16. 「任何值」(any) 类型 ============

test('evaluateDataValidationRule：any 类型对一切值放行', () => {
  const r = rule({ type: 'any' });
  // 数字、文本、空值、日期字符串均视为合法（无限制）
  assert.equal(evaluateDataValidationRule(r, '123', 0, 0, makeCtx(makeCells({ '0,0': '123' }))), true);
  assert.equal(evaluateDataValidationRule(r, 'hello', 0, 0, makeCtx(makeCells({ '0,0': 'hello' }))), true);
  assert.equal(evaluateDataValidationRule(r, '', 0, 0, makeCtx({})), true);
  assert.equal(evaluateDataValidationRule(r, '2026-08-31', 0, 0, makeCtx(makeCells({ '0,0': '2026-08-31' }))), true);
});

test('validateCellValue：any 类型整组规则始终 valid', () => {
  const r = rule({ type: 'any' });
  const res = validateCellValue('任意内容', 0, 0, [r], makeCtx(makeCells({ '0,0': '任意内容' })));
  assert.equal(res.valid, true);
});

test('evaluateDataValidationRule：any 类型不受 enabled=false 之外的空值逻辑影响', () => {
  // enabled=false 也应放行（与 list/custom 一致）
  assert.equal(evaluateDataValidationRule(rule({ type: 'any', enabled: false }), 'x', 0, 0, makeCtx(makeCells({ '0,0': 'x' }))), true);
});
