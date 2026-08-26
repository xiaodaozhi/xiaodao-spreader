import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFormulaStructure } from '../src/components/spreader/core/formula';

test('checkFormulaStructure 合法公式（含大小写/前后空白/嵌套）', () => {
  assert.deepEqual(checkFormulaStructure('=SUM(A1:A10)'), { ok: true, name: 'SUM' });
  assert.deepEqual(checkFormulaStructure('  =sum(a1:a10)  '), { ok: true, name: 'SUM' });
  assert.deepEqual(checkFormulaStructure('=AVERAGE(B1:B5)'), { ok: true, name: 'AVERAGE' });
  assert.deepEqual(checkFormulaStructure('=COUNT(A1:C3)'), { ok: true, name: 'COUNT' });
  assert.deepEqual(checkFormulaStructure('=IF(A1>0, B1, C1)'), { ok: true, name: 'IF' });
  assert.deepEqual(
    checkFormulaStructure('=VLOOKUP(A1, B1:C10, 2, FALSE)'),
    { ok: true, name: 'VLOOKUP' },
  );
  assert.deepEqual(checkFormulaStructure('=VLOOKUP(A1, B1:C10, 2)'), { ok: true, name: 'VLOOKUP' });
  assert.deepEqual(checkFormulaStructure('=CONCATENATE(A1, B1)'), { ok: true, name: 'CONCATENATE' });
  assert.deepEqual(checkFormulaStructure('=CONCATENATE(A1)'), { ok: true, name: 'CONCATENATE' });
  // 嵌套函数作为参数
  assert.deepEqual(
    checkFormulaStructure('=IF(A1>0, SUM(B1:B10), C1)'),
    { ok: true, name: 'IF' },
  );
  // 参数中含引号字符串（引号内括号不参与配平）
  assert.deepEqual(
    checkFormulaStructure('=CONCATENATE("a(b", A1)'),
    { ok: true, name: 'CONCATENATE' },
  );
});

test('checkFormulaStructure 空/无 = 前导/结构破坏', () => {
  assert.equal(checkFormulaStructure('').ok, false);
  assert.equal(checkFormulaStructure('   ').ok, false);
  // 缺少前导 =
  assert.equal(checkFormulaStructure('SUM(A1:A10)').ok, false);
  // 括号不闭合
  assert.equal(checkFormulaStructure('=SUM(A1:A10').ok, false);
  // 多余括号（配平失败）
  assert.equal(checkFormulaStructure('=SUM((A1:A10)').ok, false);
  // 纯文本
  assert.equal(checkFormulaStructure('=abc').ok, false);
});

test('checkFormulaStructure 函数名不在支持列表（返回该名供「改名」检测）', () => {
  const chk = checkFormulaStructure('=AVG(A1:A10)');
  assert.equal(chk.ok, false);
  assert.equal(chk.name, 'AVG');
  assert.equal(checkFormulaStructure('=foo(1, 2, 3)').name, 'FOO');
});

test('checkFormulaStructure 参数数量与空参数校验', () => {
  // SUM 只接受 1 个参数
  assert.equal(checkFormulaStructure('=SUM(A1, B1)').ok, false);
  // 空参数 → 0 个参数
  assert.equal(checkFormulaStructure('=SUM()').ok, false);
  // IF 需要 3 个参数
  assert.equal(checkFormulaStructure('=IF(A1>0, B1)').ok, false);
  assert.equal(checkFormulaStructure('=IF(A1>0, B1, C1, D1)').ok, false);
  // VLOOKUP 需要 3~4 个参数
  assert.equal(checkFormulaStructure('=VLOOKUP(A1, B1:C10)').ok, false);
  assert.equal(checkFormulaStructure('=VLOOKUP(A1, B1:C10, 2, FALSE, 1)').ok, false);
  // 顶层参数留空
  assert.equal(checkFormulaStructure('=IF(A1>0, , C1)').ok, false);
});
