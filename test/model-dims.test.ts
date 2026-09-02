import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ref, type Ref } from 'vue';
import { createCoreState } from '../src/components/spreader/composables/core-state';
import { createUndoStyles } from '../src/components/spreader/composables/undo-styles';
import { createSheetsOps } from '../src/components/spreader/composables/sheets-ops';
import { deriveModelDims } from '../src/components/spreader/core/model-dims';
import type { SheetModelData, SheetState } from '../src/components/spreader/core/types';

// ============ 全栈辅助（与 conditional-formatting.test.ts 同款模式）============
function fullStack(colCount = 26, rowCount = 200) {
  const s = createCoreState(
    { colCount, rowCount },
    { colCount, rowCount, theme: 'light', locale: 'zh-CN' },
  );
  const sheetsCtx: {
    sheets: Ref<SheetState[]>;
    activeSheetIndex: Ref<number>;
    saveSheet: () => void;
    loadSheet: (i: number) => void;
    mkSheet: (name: string, dims?: { colCount?: number; rowCount?: number }) => SheetState;
  } = {
    sheets: ref<SheetState[]>([]),
    activeSheetIndex: ref(0),
    saveSheet: () => {},
    loadSheet: (_i: number) => {},
    mkSheet: (name: string) => ({
      id: '', name, cells: {}, merges: {}, styles: [{}], borders: [{}],
      selection: null, activeCell: { col: 0, row: 0 },
      scrollX: 0, scrollY: 0, colWidths: [], rowHeights: [],
      colCount: 0, rowCount: 0, freeze: { rows: 0, cols: 0 }, filter: null,
      conditionalFormats: [], dataValidations: [], rowOutlines: [], columnOutlines: [], notes: {},
    }),
  };
  const us = createUndoStyles(s, sheetsCtx);
  const modelData = ref<SheetModelData[]>([]);
  const lastEmittedDataRef = { value: '' };
  const sheetsOps = createSheetsOps(s, us, modelData, undefined, lastEmittedDataRef);
  sheetsCtx.sheets = sheetsOps.sheets;
  sheetsCtx.activeSheetIndex = sheetsOps.activeSheetIndex;
  sheetsCtx.saveSheet = sheetsOps.saveSheet;
  sheetsCtx.loadSheet = sheetsOps.loadSheet;
  sheetsCtx.mkSheet = sheetsOps.mkSheet;
  return { s, us, sheetsOps, modelData };
}

// ============ deriveModelDims：纯函数 ============

test('deriveModelDims：空内容返回保底尺寸', () => {
  const d = deriveModelDims({ name: 'S', cells: {} }, { colCount: 26, rowCount: 200 });
  assert.equal(d.colCount, 26);
  assert.equal(d.rowCount, 200);
});

test('deriveModelDims：cells 超出默认 26×200 时推导出更大尺寸', () => {
  const d = deriveModelDims(
    { name: 'S', cells: { '0,0': { value: 'a' }, '30,250': { value: 'far' } } },
    { colCount: 26, rowCount: 200 },
  );
  assert.equal(d.colCount, 31); // maxCol=30 → exclusive 31
  assert.equal(d.rowCount, 251);
});

test('deriveModelDims：merges / filter / CF / DV / 分组范围参与推导', () => {
  const base = { colCount: 1, rowCount: 1 };
  const byMerges = deriveModelDims(
    { name: 'S', cells: {}, merges: { m: { startCol: 0, startRow: 0, endCol: 60, endRow: 60 } } },
    base,
  );
  assert.equal(byMerges.colCount, 61);
  assert.equal(byMerges.rowCount, 61);

  const byFilter = deriveModelDims(
    { name: 'S', cells: {}, filter: { range: { startCol: 0, startRow: 0, endCol: 90, endRow: 300 }, columns: {} } },
    base,
  );
  assert.equal(byFilter.colCount, 91);
  assert.equal(byFilter.rowCount, 301);

  const byCf = deriveModelDims(
    {
      name: 'S', cells: {},
      conditionalFormats: [{ id: 'r', ranges: [{ startCol: 0, startRow: 0, endCol: 45, endRow: 10 }] }],
    } as unknown as SheetModelData,
    base,
  );
  assert.equal(byCf.colCount, 46);

  const byDv = deriveModelDims(
    {
      name: 'S', cells: {},
      dataValidations: [{ id: 'd', ranges: [{ startCol: 0, startRow: 0, endCol: 12, endRow: 400 }] }],
    } as unknown as SheetModelData,
    base,
  );
  assert.equal(byDv.rowCount, 401);

  const byOutlines = deriveModelDims(
    {
      name: 'S', cells: {},
      rowOutlines: [{ id: 'o', axis: 'row', start: 0, end: 260, level: 1, collapsed: false }],
      columnOutlines: [{ id: 'c', axis: 'column', start: 0, end: 33, level: 1, collapsed: false }],
    } as unknown as SheetModelData,
    base,
  );
  assert.equal(byOutlines.colCount, 34);
  assert.equal(byOutlines.rowCount, 261);
});

test('deriveModelDims：自定义列宽/行高参与推导，未达阈值的忽略', () => {
  const base = { colCount: 1, rowCount: 1 };
  const d = deriveModelDims(
    { name: 'S', cells: {}, colWidths: { 40: 120, 41: 10 }, rowHeights: { 300: 40, 301: 5 } },
    base,
  );
  // 40→41（宽 120 达标）；41 宽 10 低于 MIN_COL_WIDTH 忽略；行同理
  assert.equal(d.colCount, 41);
  assert.equal(d.rowCount, 301);
});

test('deriveModelDims：畸形 key / 负数 / 非整数安全忽略', () => {
  const base = { colCount: 26, rowCount: 200 };
  const d = deriveModelDims(
    { name: 'S', cells: { 'abc': { value: 'x' }, '1': { value: 'x' }, '-5,10': { value: 'x' } } },
    base,
  );
  assert.equal(d.colCount, 26);
  assert.equal(d.rowCount, 200);
});

// ============ 序列化往返 ============

test('emitModelData 不再输出 colCount/rowCount（即使已动态扩展）', () => {
  const { s, modelData } = fullStack();
  s.setCellValue(30, 250, 'far-cell');
  s.emitModelData!();
  const smd = modelData.value[0]!;
  assert.equal(smd.cells['30,250']!.value, 'far-cell');
  assert.equal('colCount' in smd, false, 'SheetModelData 不应包含 colCount');
  assert.equal('rowCount' in smd, false, 'SheetModelData 不应包含 rowCount');
});

test('旧数据（无 colCount/rowCount）按内容推导加载，超范围数据仍可访问', () => {
  const { s, sheetsOps } = fullStack();
  const smd: SheetModelData = { name: 'S', cells: { '0,0': { value: 'a' }, '30,250': { value: 'far' } } };
  const dims = deriveModelDims(smd, { colCount: s.props.colCount, rowCount: s.props.rowCount });
  const sh = sheetsOps.mkSheet(smd.name, dims);
  Object.assign(sh.cells, smd.cells);
  sheetsOps.sheets.value = [sh];
  sheetsOps.loadSheet(0);
  assert.ok(s.colCount >= 31, `colCount 应 >= 31，实际 ${s.colCount}`);
  assert.ok(s.rowCount >= 251, `rowCount 应 >= 251，实际 ${s.rowCount}`);
  assert.equal(s.getCellRaw(30, 250), 'far');
});

test('内容在默认范围内时不放大网格（无残留空网格）', () => {
  const { s, sheetsOps } = fullStack();
  const smd: SheetModelData = { name: 'S', cells: { '3,7': { value: 'x' } } };
  const dims = deriveModelDims(smd, { colCount: s.props.colCount, rowCount: s.props.rowCount });
  assert.equal(dims.colCount, s.props.colCount);
  assert.equal(dims.rowCount, s.props.rowCount);
  const sh = sheetsOps.mkSheet(smd.name, dims);
  sheetsOps.sheets.value = [sh];
  sheetsOps.loadSheet(0);
  assert.equal(s.colCount, 26);
  assert.equal(s.rowCount, 200);
});
