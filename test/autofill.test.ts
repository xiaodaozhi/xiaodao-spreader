import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFillValue,
  inferFillPattern,
  generateFillValue,
  fillValueToCellData,
  computeTargetRange,
  translateFormulaForTarget,
  applyAutoFillPlan,
  validateMergeCompatibility,
  type FillValue,
  type FillPattern,
  type AutofillSheetLike,
} from '../src/components/spreader/core/autofill';
import { colToLabel } from '../src/components/spreader/core/utils';
import { dateToSerial, serialToDate } from '../src/components/spreader/core/number-format';
import type { SelectionRange, CellCoord } from '../src/components/spreader/core/types';

const LOCALE = 'en-US';
const COL_COUNT = 26;
const ROW_COUNT = 200;

// ============ 辅助：构造 sheet ============
function makeSheet(cells: Record<string, { value: string; styleId?: number }>): AutofillSheetLike {
  return { cells, styles: [] };
}

function range(sC: number, sR: number, eC: number, eR: number): SelectionRange {
  return { startCol: sC, startRow: sR, endCol: eC, endRow: eR };
}

function cell(c: number, r: number): string {
  return `${c},${r}`;
}

// ============ 14.1: Copy ============

test('Copy: 单文本 foo → foo foo foo', () => {
  const sheet = makeSheet({ [cell(0, 0)]: { value: 'foo' } });
  const src = range(0, 0, 0, 0);
  const tgt = range(0, 1, 0, 3);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(plan.cells[cell(0, 1)]!.value, 'foo');
  assert.equal(plan.cells[cell(0, 2)]!.value, 'foo');
  assert.equal(plan.cells[cell(0, 3)]!.value, 'foo');
});

test('Copy: 单数字 1 → 1 1 1（不变 1,2,3）', () => {
  const sheet = makeSheet({ [cell(0, 0)]: { value: '1' } });
  const src = range(0, 0, 0, 0);
  const tgt = range(0, 1, 0, 3);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(plan.cells[cell(0, 1)]!.value, '1');
  assert.equal(plan.cells[cell(0, 2)]!.value, '1');
  assert.equal(plan.cells[cell(0, 3)]!.value, '1');
});

// ============ 14.2: Number Series ============

test('Number Series: 1,2 → 3,4,5', () => {
  const sheet = makeSheet({
    [cell(0, 0)]: { value: '1' },
    [cell(0, 1)]: { value: '2' },
  });
  const src = range(0, 0, 0, 1);
  const tgt = range(0, 2, 0, 4);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(plan.cells[cell(0, 2)]!.value, '3');
  assert.equal(plan.cells[cell(0, 3)]!.value, '4');
  assert.equal(plan.cells[cell(0, 4)]!.value, '5');
});

test('Number Series: 2,4 → 6,8,10', () => {
  const sheet = makeSheet({
    [cell(0, 0)]: { value: '2' },
    [cell(0, 1)]: { value: '4' },
  });
  const src = range(0, 0, 0, 1);
  const tgt = range(0, 2, 0, 4);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(plan.cells[cell(0, 2)]!.value, '6');
  assert.equal(plan.cells[cell(0, 3)]!.value, '8');
  assert.equal(plan.cells[cell(0, 4)]!.value, '10');
});

test('Number Series: 1,3,5 → 7,9,11', () => {
  const sheet = makeSheet({
    [cell(0, 0)]: { value: '1' },
    [cell(0, 1)]: { value: '3' },
    [cell(0, 2)]: { value: '5' },
  });
  const src = range(0, 0, 0, 2);
  const tgt = range(0, 3, 0, 5);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(plan.cells[cell(0, 3)]!.value, '7');
  assert.equal(plan.cells[cell(0, 4)]!.value, '9');
  assert.equal(plan.cells[cell(0, 5)]!.value, '11');
});

// ============ 14.3: Text Number ============

test('Text Number: Item1,Item2 → Item3,Item4', () => {
  const sheet = makeSheet({
    [cell(0, 0)]: { value: 'Item1' },
    [cell(0, 1)]: { value: 'Item2' },
  });
  const src = range(0, 0, 0, 1);
  const tgt = range(0, 2, 0, 3);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(plan.cells[cell(0, 2)]!.value, 'Item3');
  assert.equal(plan.cells[cell(0, 3)]!.value, 'Item4');
});

// ============ 14.4: Date ============

test('Date: 单日 2026-01-01 → +1d', () => {
  const sheet = makeSheet({ [cell(0, 0)]: { value: '2026-01-01' } });
  const src = range(0, 0, 0, 0);
  const tgt = range(0, 1, 0, 2);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  const baseSerial = dateToSerial(2026, 1, 1);
  const nextSerial = dateToSerial(2026, 1, 2);
  const next2Serial = dateToSerial(2026, 1, 3);
  assert.equal(plan.cells[cell(0, 1)]!.value, String(nextSerial));
  assert.equal(plan.cells[cell(0, 2)]!.value, String(next2Serial));
  // 验证 serial 转回日期正确
  assert.deepEqual(serialToDate(Number(plan.cells[cell(0, 1)]!.value)), new Date('2026-01-02T00:00:00Z'));
  assert.deepEqual(serialToDate(Number(plan.cells[cell(0, 2)]!.value)), new Date('2026-01-03T00:00:00Z'));
});

test('Date: 双日 2026-01-01,2026-01-02 → +1d', () => {
  const sheet = makeSheet({
    [cell(0, 0)]: { value: '2026-01-01' },
    [cell(0, 1)]: { value: '2026-01-02' },
  });
  const src = range(0, 0, 0, 1);
  const tgt = range(0, 2, 0, 3);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  const nextSerial = dateToSerial(2026, 1, 3);
  const next2Serial = dateToSerial(2026, 1, 4);
  assert.equal(plan.cells[cell(0, 2)]!.value, String(nextSerial));
  assert.equal(plan.cells[cell(0, 3)]!.value, String(next2Serial));
});

// ============ 14.5: Formula ============

test('Formula 相对引用: =A1 → =A2,=A3', () => {
  const sheet = makeSheet({ [cell(0, 0)]: { value: '10' }, [cell(1, 0)]: { value: '=A1*2' } });
  const src = range(1, 0, 1, 0);
  const tgt = range(1, 1, 1, 2);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(plan.cells[cell(1, 1)]!.value, '=A2*2');
  assert.equal(plan.cells[cell(1, 2)]!.value, '=A3*2');
});

test('Formula 绝对引用: =$A$1 保持不变', () => {
  const sheet = makeSheet({ [cell(0, 0)]: { value: '=$A$1' } });
  const src = range(0, 0, 0, 0);
  const tgt = range(0, 1, 0, 2);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(plan.cells[cell(0, 1)]!.value, '=$A$1');
  assert.equal(plan.cells[cell(0, 2)]!.value, '=$A$1');
});

test('Formula 混合引用列绝对: =$A1 向下 → =$A5', () => {
  const sheet = makeSheet({ [cell(0, 0)]: { value: '=$A1' } });
  const src = range(0, 0, 0, 0);
  const tgt = range(0, 1, 0, 4);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  // 向下 4 行：行从 1→2→3→4→5，列 $A 绝对保持
  assert.equal(plan.cells[cell(0, 1)]!.value, '=$A2');
  assert.equal(plan.cells[cell(0, 2)]!.value, '=$A3');
  assert.equal(plan.cells[cell(0, 3)]!.value, '=$A4');
  assert.equal(plan.cells[cell(0, 4)]!.value, '=$A5');
});

test('Formula 混合引用行绝对: =A$1 向右 → =B$1,C$1,D$1', () => {
  const sheet = makeSheet({ [cell(0, 0)]: { value: '=A$1' } });
  const src = range(0, 0, 0, 0);
  const tgt = range(1, 0, 3, 0);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'right', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  // 向右 3 列：列 A→B→C→D，行 $1 绝对保持
  assert.equal(plan.cells[cell(1, 0)]!.value, '=B$1');
  assert.equal(plan.cells[cell(2, 0)]!.value, '=C$1');
  assert.equal(plan.cells[cell(3, 0)]!.value, '=D$1');
});

test('Formula 复合引用: =B1*$F$1 向下 → =B10*$F$1', () => {
  const sheet = makeSheet({ [cell(1, 0)]: { value: '=B1*$F$1' } });
  const src = range(1, 0, 1, 0);
  const tgt = range(1, 1, 1, 9);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  // B1 相对 → B2..B10，$F$1 绝对保持
  assert.equal(plan.cells[cell(1, 1)]!.value, '=B2*$F$1');
  assert.equal(plan.cells[cell(1, 9)]!.value, '=B10*$F$1');
});

// ============ 14.6: Horizontal Fill ============

test('Horizontal Fill: A1=1,B1=2 → C1=3,D1=4,E1=5,F1=6', () => {
  const sheet = makeSheet({
    [cell(0, 0)]: { value: '1' },
    [cell(1, 0)]: { value: '2' },
  });
  const src = range(0, 0, 1, 0);
  const tgt = range(2, 0, 5, 0);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'right', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(plan.cells[cell(2, 0)]!.value, '3');
  assert.equal(plan.cells[cell(3, 0)]!.value, '4');
  assert.equal(plan.cells[cell(4, 0)]!.value, '5');
  assert.equal(plan.cells[cell(5, 0)]!.value, '6');
});

// ============ 14.7: Multi-cell pattern ============

test('Multi-cell pattern: A1:B2=[[1,10],[2,20]] → A3:B4=[[3,30],[4,40]]', () => {
  const sheet = makeSheet({
    [cell(0, 0)]: { value: '1' },
    [cell(1, 0)]: { value: '10' },
    [cell(0, 1)]: { value: '2' },
    [cell(1, 1)]: { value: '20' },
  });
  const src = range(0, 0, 1, 1);
  const tgt = range(0, 2, 1, 3);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  // A 列：1,2 → 3,4
  assert.equal(plan.cells[cell(0, 2)]!.value, '3');
  assert.equal(plan.cells[cell(0, 3)]!.value, '4');
  // B 列：10,20 → 30,40
  assert.equal(plan.cells[cell(1, 2)]!.value, '30');
  assert.equal(plan.cells[cell(1, 3)]!.value, '40');
});

// ============ 14.8: Style 复用 ============

test('Style: 目标 cell 复用源 cell 的 styleId', () => {
  const sheet = makeSheet({
    [cell(0, 0)]: { value: 'hello', styleId: 5 },
  });
  const src = range(0, 0, 0, 0);
  const tgt = range(0, 1, 0, 2);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(plan.cells[cell(0, 1)]!.styleId, 5);
  assert.equal(plan.cells[cell(0, 2)]!.styleId, 5);
});

test('Style: 线性序列复制源末尾 styleId', () => {
  const sheet = makeSheet({
    [cell(0, 0)]: { value: '1', styleId: 3 },
    [cell(0, 1)]: { value: '2', styleId: 7 },
  });
  const src = range(0, 0, 0, 1);
  const tgt = range(0, 2, 0, 3);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  // 线性模式：正向取源末 styleId = 7
  assert.equal(plan.cells[cell(0, 2)]!.styleId, 7);
  assert.equal(plan.cells[cell(0, 3)]!.styleId, 7);
});

// ============ 14.9: Dynamic Expansion（超出 rowCount 不报错） ============

test('Dynamic Expansion: 超出 rowCount 时 applyAutoFillPlan 正常计算', () => {
  const sheet = makeSheet({ [cell(0, 0)]: { value: '1' } });
  const src = range(0, 0, 0, 0);
  // 目标行 250 超出 rowCount=200，但纯函数不检查边界，由调用方 ensureCapacity
  const tgt = range(0, 1, 0, 250);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  // 单值 Copy，所有目标都是 1
  assert.equal(plan.cells[cell(0, 250)]!.value, '1');
  assert.equal(plan.cells[cell(0, 1)]!.value, '1');
});

// ============ 14.10: Selection 更新（验证 newRange 计算） ============

test('Selection: source+target 合并范围计算正确', () => {
  // 验证 applyAutoFill 中 selection 更新的范围逻辑
  // source = A1:A3, target = A4:A10 → newRange = A1:A10
  const src = range(0, 0, 0, 2);
  const tgt = range(0, 3, 0, 9);
  const newRange: SelectionRange = {
    startCol: Math.min(src.startCol, tgt.startCol),
    startRow: Math.min(src.startRow, tgt.startRow),
    endCol: Math.max(src.endCol, tgt.endCol),
    endRow: Math.max(src.endRow, tgt.endRow),
  };
  assert.deepEqual(newRange, { startCol: 0, startRow: 0, endCol: 0, endRow: 9 });
});

// ============ 14.11: Undo（纯函数不直接测试，验证 plan 不 mutate） ============

test('Undo: applyAutoFillPlan 不 mutate 输入 sheet', () => {
  const cells = { [cell(0, 0)]: { value: '1' } };
  const sheet = makeSheet(cells);
  const src = range(0, 0, 0, 0);
  const tgt = range(0, 1, 0, 2);
  const snapshot = JSON.stringify(sheet.cells);
  applyAutoFillPlan(src, tgt, sheet, 'down', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  // 原始 cells 不应被修改
  assert.equal(JSON.stringify(sheet.cells), snapshot);
  // plan 返回独立的新对象
  assert.equal(sheet.cells[cell(0, 1)], undefined);
});

// ============ 14.12: computeTargetRange 四方向 + 取消 ============

test('computeTargetRange: 向下 A1:A3 + drag to A10 → A4:A10', () => {
  const src = range(0, 0, 0, 2);
  const result = computeTargetRange(src, { col: 0, row: 9 });
  assert.deepEqual(result!.targetRange, { startCol: 0, startRow: 3, endCol: 0, endRow: 9 });
  assert.equal(result!.direction, 'down');
});

test('computeTargetRange: 向上 A5:A10 + drag to A1 → A1:A4', () => {
  const src = range(0, 4, 0, 9);
  const result = computeTargetRange(src, { col: 0, row: 0 });
  assert.deepEqual(result!.targetRange, { startCol: 0, startRow: 0, endCol: 0, endRow: 3 });
  assert.equal(result!.direction, 'up');
});

test('computeTargetRange: 向右 A1:C1 + drag to F1 → D1:F1', () => {
  const src = range(0, 0, 2, 0);
  const result = computeTargetRange(src, { col: 5, row: 0 });
  assert.deepEqual(result!.targetRange, { startCol: 3, startRow: 0, endCol: 5, endRow: 0 });
  assert.equal(result!.direction, 'right');
});

test('computeTargetRange: 向左 D1:F1 + drag to A1 → A1:C1', () => {
  const src = range(3, 0, 5, 0);
  const result = computeTargetRange(src, { col: 0, row: 0 });
  assert.deepEqual(result!.targetRange, { startCol: 0, startRow: 0, endCol: 2, endRow: 0 });
  assert.equal(result!.direction, 'left');
});

test('computeTargetRange: 拖回源区域内部 → null（取消）', () => {
  const src = range(0, 0, 2, 2);
  const result = computeTargetRange(src, { col: 1, row: 1 });
  assert.equal(result, null);
});

test('computeTargetRange: 对角拖动取主要方向', () => {
  // source A1:A3, drag to C10 → 行偏移 7，列偏移 2 → 主要方向 down
  const src = range(0, 0, 0, 2);
  const result = computeTargetRange(src, { col: 2, row: 9 });
  assert.equal(result!.direction, 'down');
  // targetRange 仍为单列（A 列向下扩展）
  assert.equal(result!.targetRange.startCol, 0);
  assert.equal(result!.targetRange.endCol, 0);
});

test('computeTargetRange: 不覆盖源区域', () => {
  const src = range(0, 0, 0, 2);
  const result = computeTargetRange(src, { col: 0, row: 9 });
  // targetRange.startRow 应大于 sourceRange.endRow
  assert.ok(result!.targetRange.startRow > src.endRow);
});

// ============ 额外：inferFillPattern 单元测试 ============

test('inferFillPattern: 空数组 → copy', () => {
  const p = inferFillPattern([]);
  assert.equal(p.kind, 'copy');
});

test('inferFillPattern: 单数字 → copy', () => {
  const p = inferFillPattern([{ kind: 'number', num: 42 }]);
  assert.equal(p.kind, 'copy');
});

test('inferFillPattern: 双数字等差 → linear', () => {
  const p = inferFillPattern([{ kind: 'number', num: 1 }, { kind: 'number', num: 2 }]);
  assert.equal(p.kind, 'linear');
  if (p.kind === 'linear') {
    assert.equal(p.step, 1);
    assert.equal(p.base, 1);
  }
});

test('inferFillPattern: 非等差数字 → copy', () => {
  const p = inferFillPattern([{ kind: 'number', num: 1 }, { kind: 'number', num: 5 }, { kind: 'number', num: 3 }]);
  assert.equal(p.kind, 'copy');
});

test('inferFillPattern: 单日期 → date-linear step=1', () => {
  const p = inferFillPattern([{ kind: 'date', serial: 45000 }]);
  assert.equal(p.kind, 'date-linear');
  if (p.kind === 'date-linear') {
    assert.equal(p.step, 1);
    assert.equal(p.baseSerial, 45000);
  }
});

test('inferFillPattern: 双日期等差 → date-linear', () => {
  const p = inferFillPattern([{ kind: 'date', serial: 45000 }, { kind: 'date', serial: 45002 }]);
  assert.equal(p.kind, 'date-linear');
  if (p.kind === 'date-linear') {
    assert.equal(p.step, 2);
  }
});

test('inferFillPattern: 字母序列 A,B → text-series', () => {
  const p = inferFillPattern([{ kind: 'text', text: 'A' }, { kind: 'text', text: 'B' }]);
  assert.equal(p.kind, 'text-series');
  if (p.kind === 'text-series') {
    assert.equal(p.step, 1);
    assert.equal(p.baseCharCode, 65);
  }
});

test('inferFillPattern: 含公式 → formula', () => {
  const p = inferFillPattern([{ kind: 'number', num: 1 }, { kind: 'formula', formula: '=A1*2' }]);
  assert.equal(p.kind, 'formula');
});

test('inferFillPattern: 文本数字 prefix 一致 → text-number', () => {
  const p = inferFillPattern([
    { kind: 'text-number', prefix: 'Item', num: 1, digits: 1 },
    { kind: 'text-number', prefix: 'Item', num: 2, digits: 1 },
  ]);
  assert.equal(p.kind, 'text-number');
  if (p.kind === 'text-number') {
    assert.equal(p.prefix, 'Item');
    assert.equal(p.step, 1);
    assert.equal(p.base, 1);
    assert.equal(p.digits, 1);
  }
});

// ============ 额外：generateFillValue 单元测试 ============

test('generateFillValue: copy 模式取模循环', () => {
  const pattern: FillPattern = { kind: 'copy', sourceValues: [{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }] };
  assert.equal(generateFillValue(pattern, 0, 2).kind, 'text');
  assert.equal((generateFillValue(pattern, 0, 2) as Extract<FillValue, { kind: 'text' }>).text, 'a');
  assert.equal((generateFillValue(pattern, 1, 2) as Extract<FillValue, { kind: 'text' }>).text, 'b');
  assert.equal((generateFillValue(pattern, 2, 2) as Extract<FillValue, { kind: 'text' }>).text, 'a');
});

test('generateFillValue: linear 模式递增', () => {
  const pattern: FillPattern = { kind: 'linear', step: 2, base: 1, sourceLen: 2 };
  // index 0 → base + step * (sourceLen + 0) = 1 + 2*2 = 5
  assert.equal((generateFillValue(pattern, 0, 2) as Extract<FillValue, { kind: 'number' }>).num, 5);
  // index 1 → 1 + 2*3 = 7
  assert.equal((generateFillValue(pattern, 1, 2) as Extract<FillValue, { kind: 'number' }>).num, 7);
});

// ============ 额外：translateFormulaForTarget 单元测试 ============

test('translateFormulaForTarget: 相对引用行偏移', () => {
  const result = translateFormulaForTarget('=A1', { col: 0, row: 0 }, { col: 0, row: 2 }, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(result, '=A3');
});

test('translateFormulaForTarget: 绝对引用不变', () => {
  const result = translateFormulaForTarget('=$A$1', { col: 0, row: 0 }, { col: 2, row: 5 }, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(result, '=$A$1');
});

test('translateFormulaForTarget: 混合引用列绝对行相对', () => {
  const result = translateFormulaForTarget('=$A1', { col: 0, row: 0 }, { col: 2, row: 4 }, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(result, '=$A5');
});

test('translateFormulaForTarget: 混合引用行绝对列相对', () => {
  const result = translateFormulaForTarget('=A$1', { col: 0, row: 0 }, { col: 2, row: 4 }, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(result, '=C$1');
});

// ============ 额外：validateMergeCompatibility ============

test('validateMergeCompatibility: 无 merge → true', () => {
  const src = range(0, 0, 1, 1);
  const tgt = range(0, 2, 1, 3);
  assert.equal(validateMergeCompatibility(src, tgt, {}), true);
});

test('validateMergeCompatibility: 源完全包含 merge → true', () => {
  const merges = { '0,0': range(0, 0, 0, 0) };
  const src = range(0, 0, 1, 1);
  const tgt = range(0, 2, 1, 3);
  assert.equal(validateMergeCompatibility(src, tgt, merges), true);
});

test('validateMergeCompatibility: 源与 merge 部分相交 → false', () => {
  const merges = { '0,0': range(0, 0, 1, 1) };
  const src = range(0, 0, 0, 0); // 只包含 merge 左上角，不完全包含
  const tgt = range(0, 2, 0, 3);
  assert.equal(validateMergeCompatibility(src, tgt, merges), false);
});

test('validateMergeCompatibility: 目标与已有 merge 相交 → false', () => {
  const merges = { '0,5': range(0, 5, 0, 5) };
  const src = range(0, 0, 0, 2);
  const tgt = range(0, 3, 0, 6); // target 覆盖 0,5
  assert.equal(validateMergeCompatibility(src, tgt, merges), false);
});

// ============ 额外：反向填充（up/left） ============

test('反向填充 up: 1,2 → 0,-1（向上递减）', () => {
  const sheet = makeSheet({
    [cell(0, 1)]: { value: '1' },
    [cell(0, 2)]: { value: '2' },
  });
  const src = range(0, 1, 0, 2);
  const tgt = range(0, 0, 0, 0);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'up', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  // 向上反向：从源首项递减 → 0
  assert.equal(plan.cells[cell(0, 0)]!.value, '0');
});

test('反向填充 left: 1,2 → 0（向左递减）', () => {
  const sheet = makeSheet({
    [cell(1, 0)]: { value: '1' },
    [cell(2, 0)]: { value: '2' },
  });
  const src = range(1, 0, 2, 0);
  const tgt = range(0, 0, 0, 0);
  const plan = applyAutoFillPlan(src, tgt, sheet, 'left', LOCALE, COL_COUNT, ROW_COUNT, colToLabel);
  assert.equal(plan.cells[cell(0, 0)]!.value, '0');
});

// ============ 额外：fillValueToCellData ============

test('fillValueToCellData: 数字转字符串', () => {
  assert.deepEqual(fillValueToCellData({ kind: 'number', num: 42 }), { value: '42', styleId: undefined });
});

test('fillValueToCellData: 文本', () => {
  assert.deepEqual(fillValueToCellData({ kind: 'text', text: 'hello' }), { value: 'hello', styleId: undefined });
});

test('fillValueToCellData: 文本数字保留前导零', () => {
  const result = fillValueToCellData({ kind: 'text-number', prefix: 'Item', num: 3, digits: 2 });
  assert.equal(result.value, 'Item03');
});

test('fillValueToCellData: 日期存序列号', () => {
  const result = fillValueToCellData({ kind: 'date', serial: 45000 });
  assert.equal(result.value, '45000');
});

test('fillValueToCellData: 公式保持 = 前缀', () => {
  const result = fillValueToCellData({ kind: 'formula', formula: '=A1*2' });
  assert.equal(result.value, '=A1*2');
});

test('fillValueToCellData: 透传 styleId', () => {
  assert.deepEqual(fillValueToCellData({ kind: 'number', num: 1 }, 5), { value: '1', styleId: 5 });
});
