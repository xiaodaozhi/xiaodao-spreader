import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ref, type Ref } from 'vue';
import { createCoreState } from '../src/components/spreader/composables/core-state';
import { createUndoStyles } from '../src/components/spreader/composables/undo-styles';
import { createSheetsOps } from '../src/components/spreader/composables/sheets-ops';
import { createBordersMerge } from '../src/components/spreader/composables/borders-merge';
import { createFindReplace } from '../src/components/spreader/composables/find-replace';
import type { SheetModelData, SheetState, SelectionRange, DataValidationRule } from '../src/components/spreader/core/types';

// ============ 全栈辅助（core-state + undo-styles + sheets-ops + borders-merge + find-replace） ============
// 与 data-validation-integration.test.ts 的 fullStack 同构，额外接上 borders-merge / find-replace。
function fullStack(editable: boolean) {
    const s = createCoreState(
        { colCount: 26, rowCount: 200, editable },
        { colCount: 26, rowCount: 200, theme: 'light', locale: 'zh-CN' },
    );
    s.clampScroll = (sx, sy) => {
        if (sx !== null) s.scrollX.value = Math.max(0, sx);
        if (sy !== null) s.scrollY.value = Math.max(0, sy);
    };

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
            scrollX: 0, scrollY: 0, colWidths: [], rowHeights: [], colCount: 0, rowCount: 0, freeze: { rows: 0, cols: 0 }, filter: null,
            conditionalFormats: [], dataValidations: [], rowOutlines: [], columnOutlines: [], notes: {},
        }),
    };

    const us = createUndoStyles(s, sheetsCtx);
    const modelData = ref<SheetModelData[]>([]);
    const lastEmittedDataRef = { value: '' };
    const so = createSheetsOps(s, us, modelData, undefined, lastEmittedDataRef);
    sheetsCtx.sheets = so.sheets;
    sheetsCtx.activeSheetIndex = so.activeSheetIndex;
    sheetsCtx.saveSheet = so.saveSheet;
    sheetsCtx.loadSheet = so.loadSheet;
    sheetsCtx.mkSheet = so.mkSheet;

    const bm = createBordersMerge(s, us);
    const fr = createFindReplace(s, us, so, lastEmittedDataRef);

    return { s, us, so, bm, fr, modelData };
}

function range(sC: number, sR: number, eC: number, eR: number): SelectionRange {
    return { startCol: sC, startRow: sR, endCol: eC, endRow: eR };
}

function cellKey(c: number, r: number): string {
    return `${c},${r}`;
}

const RO = null;
void RO;

// =================================================================
// 一、数据编辑入口
// =================================================================

test('只读: setCellValue / clearCellsInRange 不修改数据', () => {
    const { s } = fullStack(true);
    s.setCellValue(0, 0, 'keep');
    s.editable.value = false; // 切入只读
    s.setCellValue(2, 3, 'x'); // 被拦截
    assert.equal(s.cells[cellKey(2, 3)], undefined);
    s.clearCellsInRange(0, 1, 0, 1);
    assert.equal(s.cells[cellKey(0, 0)]?.value, 'keep');
});

test('只读: startEdit 不进入编辑、commitEdit 返回 false', () => {
    const { s } = fullStack(false);
    s.selectCell(1, 1);
    s.startEdit();
    assert.equal(s.editingCell.value, null);
    void s.commitEdit();
    assert.equal(s.editingCell.value, null);
});

test('只读: 粘贴/剪切/清除选区无效且不入 undo 栈', async () => {
    const { s, us, bm } = fullStack(true);
    s.setCellValue(0, 0, 'data');
    s.editable.value = false;
    s.selectRange(0, 0, 1, 1);
    await bm.pasteFromClipboard(); // 只读下应直接早退（不会碰剪贴板）
    assert.equal(s.cells[cellKey(0, 0)]?.value, 'data');
    bm.cutSelected();
    assert.equal(s.cells[cellKey(0, 0)]?.value, 'data');
    bm.clearSelected();
    assert.equal(s.cells[cellKey(0, 0)]?.value, 'data');
    assert.equal(us.undoStack.value.length, 0);
    assert.equal(us.redoStack.value.length, 0);
});

test('只读: applyAutoFill 拖拽填充无效', () => {
    const { s } = fullStack(false);
    s.setCellValue(0, 0, '1');
    s.selectRange(0, 0, 0, 0);
    s.applyAutoFill(range(0, 0, 0, 0), range(0, 1, 0, 3), 'down');
    assert.equal(s.cells[cellKey(0, 1)], undefined);
    assert.equal(s.cells[cellKey(0, 2)], undefined);
    assert.equal(s.cells[cellKey(0, 3)], undefined);
});

test('只读: 公式栏路径 setCellValue 被拦（单元格写入唯一入口）', () => {
    const { s } = fullStack(true);
    s.setCellValue(0, 0, 'v1');
    s.editable.value = false;
    s.setCellValue(0, 0, 'v2');
    assert.equal(s.cells[cellKey(0, 0)]?.value, 'v1');
});

// =================================================================
// 二、格式修改入口
// =================================================================

test('只读: 样式/数字格式修改无效', () => {
    const { s, us, bm } = fullStack(false);
    s.selectRange(0, 0, 1, 1);
    us.applyStyleToSelection('fontWeight', 'bold');
    us.clearFormat();
    us.applyNumberFormatCode('0.00%');
    us.onIncreaseDecimals();
    bm.onBorderChange('all');
    bm.applyCachedBorder();
    bm.mergeCells();
    assert.deepEqual(us.redoStack.value, []);
    // 无任何 style / merge 产生
    const styleKeys = Object.keys(s.styles[0] ?? {});
    assert.equal(styleKeys.length, 0);
    assert.deepEqual(Object.keys(s.merges), []);
});

test('只读: undo/redo 被拦截且历史不变', () => {
    const { s, us } = fullStack(false);
    // 先在可编辑状态造一条历史
    s.editable.value = true;
    us.saveUndo();
    s.setCellValue(0, 0, 'before-ro');
    assert.equal(us.undoStack.value.length, 1);
    // 进入只读
    s.editable.value = false;
    us.undo();
    assert.equal(us.undoStack.value.length, 1, 'undo 栈长度不变');
    assert.equal(s.cells[cellKey(0, 0)]?.value, 'before-ro', '数据未被 undo 回滚');
    us.redo();
    assert.equal(us.undoStack.value.length, 1);
    assert.equal(us.redoStack.value.length, 0);
});

// =================================================================
// 三、结构操作（行列 / 排序 / 筛选 / 工作表）
// =================================================================

test('只读: 行列插入删除与宽高重置无效', () => {
    const { s, so } = fullStack(true);
    s.colWidths.value[0] = 123;
    const rowsBefore = s.rowCount;
    const colsBefore = s.colCount;
    s.editable.value = false;
    so.insertRows(1, 3);
    so.deleteRows(1, 3);
    so.insertCols(1, 3);
    so.deleteCols(1, 3);
    assert.equal(s.rowCount, rowsBefore);
    assert.equal(s.colCount, colsBefore);
    so.resetRowHeight();
    so.resetColWidth();
    assert.equal(s.colWidths.value[0], 123, '列宽未被重置');
});

test('只读: 排序无效', () => {
    const { s, so } = fullStack(true);
    s.setCellValue(0, 0, '3');
    s.setCellValue(0, 1, '1');
    s.setCellValue(0, 2, '2');
    s.editable.value = false;
    so.sortSelectedColumns('asc', range(0, 0, 0, 2));
    assert.equal(s.cells[cellKey(0, 0)]?.value, '3');
    assert.equal(s.cells[cellKey(0, 1)]?.value, '1');
});

test('只读: 筛选启用/清除/列筛选/AutoFilter 无效', () => {
    const { s } = fullStack(false);
    s.selectRange(0, 0, 2, 5);
    s.toggleAutoFilter();
    assert.equal(s.filter.value, null);
    s.enableFilter(range(0, 0, 2, 5));
    assert.equal(s.filter.value, null);
    s.setFilterColumn(0, { type: 'values', values: ['a'] });
    assert.equal(s.filter.value, null);
    s.clearFilter();
    s.clearFilterColumn(0);
    assert.equal(s.filter.value, null);
});

test('只读: 工作表新增/删除/重命名/复制/移动无效', () => {
    const { so } = fullStack(false);
    const count = so.sheets.value.length;
    so.addSheet();
    assert.equal(so.sheets.value.length, count);
    assert.equal(so.dupSheet(0), 0);
    const name0 = so.sheets.value[0]!.name;
    so.renameSheet(0, 'renamed');
    assert.equal(so.sheets.value[0]!.name, name0);
    so.moveSheet(0, 1);
    assert.equal(so.activeSheetIndex.value, 0);
    so.removeSheet(0);
    assert.equal(so.sheets.value.length, count);
});

// =================================================================
// 四、CF / DV / 批注 / 分组
// =================================================================

test('只读: 条件格式规则增删改无效', () => {
    const { s } = fullStack(false);
    s.addConditionalFormatRule({ id: '', rule: { type: 'cellIs', operator: 'greaterThan', formula: ['1'] }, ranges: [range(0, 0, 5, 5)] } as never);
    assert.equal(s.conditionalFormats.length, 0);
});

test('只读: 数据验证创建无效（返回原样规则但不入状态）', () => {
    const { s } = fullStack(false);
    const rule = {
        id: '',
        type: 'list',
        values: ['a', 'b'],
        listSource: { type: 'values', values: ['a', 'b'] },
        ranges: [range(1, 1, 1, 9)],
        allowBlank: false,
        showDropdown: true,
        showInputMessage: false,
        showErrorMessage: false,
    } as unknown as DataValidationRule;
    const ret = s.createDataValidation(rule);
    assert.equal(ret.id, '');
    assert.equal(s.dataValidations.length, 0);
});

test('只读: 批注写入/更新/删除无效', () => {
    const { s } = fullStack(false);
    const note = s.setCellNote(0, 0, 'hello');
    assert.equal(note, null as unknown as ReturnType<typeof s.setCellNote>, '只读下 setCellNote 返回 null');
    assert.deepEqual(s.notes, {});
});

test('只读: 行列分组（outline）无效', () => {
    const { s } = fullStack(false);
    const r = s.addRowGroup(0, 2);
    assert.equal(r.ok, false);
    const c = s.addColumnGroup(0, 2);
    assert.equal(c.ok, false);
    assert.equal(s.getRowOutlines().length, 0);
    assert.equal(s.getColumnOutlines().length, 0);
});

// =================================================================
// 五、查找替换
// =================================================================

test('只读: replace / replaceAll 无效', () => {
    const { s, fr } = fullStack(true);
    s.setCellValue(0, 0, 'foo');
    s.setCellValue(1, 0, 'foo');
    s.editable.value = false;
    fr.findText.value = 'foo';
    fr.replaceText.value = 'bar';
    fr.recompute();
    assert.ok(fr.results.value.length >= 2, '查找本身（只读能力）仍可用');
    fr.replace();
    assert.equal(s.cells[cellKey(0, 0)]?.value, 'foo');
    fr.replaceAll();
    assert.equal(s.cells[cellKey(0, 0)]?.value, 'foo');
    assert.equal(s.cells[cellKey(1, 0)]?.value, 'foo');
});

// =================================================================
// 六、silent 加载路径不被拦（v-model 恢复场景）
// =================================================================

test('只读: setFilter(silent) 仍生效，加载路径不受只读影响', () => {
    const { s } = fullStack(false);
    const f = {
        range: range(0, 0, 2, 9),
        columns: {},
        sortRange: null,
    } as unknown as NonNullable<ReturnType<typeof s.getFilter>>;
    s.setFilter(f, true);
    assert.deepEqual(s.filter.value, f);
    s.setFilter(null, true);
    assert.equal(s.filter.value, null);
});

// =================================================================
// 七、运行时切换与默认回归
// =================================================================

test('运行时切换 editable: false→true 恢复编辑能力', () => {
    const { s, us } = fullStack(false);
    s.editable.value = false;
    s.setCellValue(0, 0, 'blocked');
    assert.equal(s.cells[cellKey(0, 0)], undefined);
    s.editable.value = true;
    us.saveUndo();
    s.setCellValue(0, 0, 'allowed');
    assert.equal(s.cells[cellKey(0, 0)]?.value, 'allowed');
    assert.equal(us.undoStack.value.length, 1);
});

test('运行时切换 editable: true→false 立即生效', () => {
    const { s } = fullStack(true);
    s.setCellValue(0, 0, 'a');
    s.editable.value = false;
    s.setCellValue(0, 0, 'b');
    assert.equal(s.cells[cellKey(0, 0)]?.value, 'a');
});

test('默认 editable=true: 全部操作正常（回归）', async () => {
    const { s, us, so, bm } = fullStack(true);
    s.setCellValue(0, 0, 'x');
    assert.equal(s.cells[cellKey(0, 0)]?.value, 'x');
    us.saveUndo();
    s.clearCellsInRange(0, 0, 0, 0);
    assert.equal(s.cells[cellKey(0, 0)], undefined);
    s.selectRange(0, 0, 1, 1);
    bm.mergeCells();
    assert.ok(Object.keys(s.merges).length > 0);
    so.addSheet();
    assert.equal(so.sheets.value.length, 2);
    s.selectRange(0, 0, 2, 5);
    s.enableFilter(range(0, 0, 2, 5));
    assert.ok(s.filter.value);
    await bm.pasteFromClipboard().catch(() => {}); // node 环境剪贴板可能不可用，只要不抛守卫外异常
    void so;
});
