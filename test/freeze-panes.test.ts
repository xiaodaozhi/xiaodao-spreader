import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ref, type Ref } from 'vue';
import { createCoreState, type CoreState } from '../src/components/spreader/composables/core-state';
import { createUndoStyles } from '../src/components/spreader/composables/undo-styles';
import { createSheetsOps } from '../src/components/spreader/composables/sheets-ops';
import { HEADER_WIDTH, HEADER_HEIGHT, SB_SIZE, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '../src/components/spreader/core/constants';
import type { SheetModelData, SheetState } from '../src/components/spreader/core/types';

// ============ 纯 core-state 测试辅助 ============
function freshState(colCount = 26, rowCount = 200): CoreState {
  const s = createCoreState(
    { colCount, rowCount },
    { colCount, rowCount, theme: 'light', locale: 'zh-CN' },
  );
  // 注入一个简单的 clampScroll：直接更新 scrollX/scrollY（无动态扩展）
  s.clampScroll = (sx, sy) => {
    if (sx !== null) s.scrollX.value = Math.max(0, sx);
    if (sy !== null) s.scrollY.value = Math.max(0, sy);
  };
  return s;
}

// ============ 全栈测试辅助（core-state + undo-styles + sheets-ops） ============
function fullStack(colCount = 26, rowCount = 200) {
  const s = createCoreState(
    { colCount, rowCount },
    { colCount, rowCount, theme: 'light', locale: 'zh-CN' },
  );

  // 占位 sheetsCtx（spreader.vue 同款模式）
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
      conditionalFormats: [], dataValidations: [], rowOutlines: [], columnOutlines: [],
    }),
  };

  const us = createUndoStyles(s, sheetsCtx);

  const modelData = ref<SheetModelData[]>([]);
  const lastEmittedDataRef = { value: '' };
  const sheetsOps = createSheetsOps(s, us, modelData, undefined, lastEmittedDataRef);

  // 替换占位为真实引用
  sheetsCtx.sheets = sheetsOps.sheets;
  sheetsCtx.activeSheetIndex = sheetsOps.activeSheetIndex;
  sheetsCtx.saveSheet = sheetsOps.saveSheet;
  sheetsCtx.loadSheet = sheetsOps.loadSheet;
  sheetsCtx.mkSheet = sheetsOps.mkSheet;

  return { s, us, sheetsOps, modelData };
}

// =================================================================
// 一、数据模型与默认值
// =================================================================

test('freeze 默认为 { rows: 0, cols: 0 }', () => {
  const s = freshState();
  assert.deepEqual(s.getFreeze(), { rows: 0, cols: 0 });
  assert.equal(s.freeze.rows, 0);
  assert.equal(s.freeze.cols, 0);
});

test('SheetState.freeze 为必填字段（类型层面由 ts 保证，这里验证运行时默认）', () => {
  const s = freshState();
  assert.ok(s.freeze && typeof s.freeze.rows === 'number' && typeof s.freeze.cols === 'number');
});

// =================================================================
// 二、setFreeze / clearFreeze / getFreeze 基础行为与 clamp
// =================================================================

test('setFreeze 设置 rows/cols', () => {
  const s = freshState();
  s.setFreeze(3, 2);
  assert.deepEqual(s.getFreeze(), { rows: 3, cols: 2 });
});

test('setFreeze rows 超过 rowCount 时 clamp 到 rowCount', () => {
  const s = freshState(26, 200);
  s.setFreeze(9999, 2);
  assert.equal(s.freeze.rows, 200, 'rows 应 clamp 到 rowCount');
  assert.equal(s.freeze.cols, 2);
});

test('setFreeze cols 超过 colCount 时 clamp 到 colCount', () => {
  const s = freshState(26, 200);
  s.setFreeze(2, 9999);
  assert.equal(s.freeze.rows, 2);
  assert.equal(s.freeze.cols, 26, 'cols 应 clamp 到 colCount');
});

test('setFreeze 负数 clamp 到 0', () => {
  const s = freshState();
  s.setFreeze(-5, -3);
  assert.deepEqual(s.getFreeze(), { rows: 0, cols: 0 });
});

test('setFreeze 浮点数向下取整 (floor)', () => {
  const s = freshState();
  s.setFreeze(3.9, 2.1);
  assert.equal(s.freeze.rows, 3);
  assert.equal(s.freeze.cols, 2);
});

test('setFreeze(0,0) 等价于未冻结', () => {
  const s = freshState();
  s.setFreeze(2, 2);
  s.setFreeze(0, 0);
  assert.deepEqual(s.getFreeze(), { rows: 0, cols: 0 });
});

test('clearFreeze 重置为 {0,0}', () => {
  const s = freshState();
  s.setFreeze(4, 5);
  s.clearFreeze();
  assert.deepEqual(s.getFreeze(), { rows: 0, cols: 0 });
});

test('getFreeze 返回快照而非内部引用（修改返回值不影响内部状态）', () => {
  const s = freshState();
  s.setFreeze(2, 3);
  const snap = s.getFreeze();
  snap.rows = 999;
  assert.equal(s.freeze.rows, 2, '内部状态不应被外部修改');
});

// =================================================================
// 三、getFrozenMetrics 基于真实行高/列宽
// =================================================================

test('getFrozenMetrics 未冻结时返回 {0,0}', () => {
  const s = freshState();
  const m = s.getFrozenMetrics();
  assert.equal(m.frozenRowsHeight, 0);
  assert.equal(m.frozenColumnsWidth, 0);
});

test('getFrozenMetrics 基于默认列宽累加', () => {
  const s = freshState();
  s.setFreeze(0, 3);
  const m = s.getFrozenMetrics();
  assert.equal(m.frozenColumnsWidth, DEFAULT_COL_WIDTH * 3, '3 列默认宽度 = 300');
  assert.equal(m.frozenRowsHeight, 0);
});

test('getFrozenMetrics 基于默认行高累加', () => {
  const s = freshState();
  s.setFreeze(3, 0);
  const m = s.getFrozenMetrics();
  assert.equal(m.frozenRowsHeight, DEFAULT_ROW_HEIGHT * 3, '3 行默认高度 = 72');
  assert.equal(m.frozenColumnsWidth, 0);
});

test('getFrozenMetrics 反映自定义列宽变化', () => {
  const s = freshState();
  // 修改前 3 列宽度为 100, 80, 120
  s.colWidths.value[0] = 100;
  s.colWidths.value[1] = 80;
  s.colWidths.value[2] = 120;
  s.setFreeze(0, 3);
  const m = s.getFrozenMetrics();
  assert.equal(m.frozenColumnsWidth, 300, '100+80+120 = 300');
});

test('getFrozenMetrics 反映自定义行高变化', () => {
  const s = freshState();
  s.rowHeights.value[0] = 40;
  s.rowHeights.value[1] = 50;
  s.setFreeze(2, 0);
  const m = s.getFrozenMetrics();
  assert.equal(m.frozenRowsHeight, 90, '40+50 = 90');
});

test('getFrozenMetrics 同时冻结行和列', () => {
  const s = freshState();
  s.colWidths.value[0] = 120;
  s.rowHeights.value[0] = 30;
  s.setFreeze(2, 2);
  const m = s.getFrozenMetrics();
  assert.equal(m.frozenColumnsWidth, 120 + DEFAULT_COL_WIDTH);
  assert.equal(m.frozenRowsHeight, 30 + DEFAULT_ROW_HEIGHT);
});

// =================================================================
// 四、getViewportRegions 四区域
// =================================================================

test('未冻结时仅有 body 区域', () => {
  const s = freshState();
  const regions = s.getViewportRegions();
  assert.equal(regions.length, 1);
  assert.equal(regions[0]!.kind, 'body');
});

test('仅冻结行时返回 rows + body', () => {
  const s = freshState();
  s.setFreeze(2, 0);
  const regions = s.getViewportRegions();
  const kinds = regions.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['body', 'rows']);
});

test('仅冻结列时返回 columns + body', () => {
  const s = freshState();
  s.setFreeze(0, 2);
  const regions = s.getViewportRegions();
  const kinds = regions.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['body', 'columns']);
});

test('同时冻结行列时返回 corner + rows + columns + body', () => {
  const s = freshState();
  s.setFreeze(2, 3);
  const regions = s.getViewportRegions();
  const kinds = regions.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['body', 'columns', 'corner', 'rows']);
});

test('corner 区域位置与尺寸正确', () => {
  const s = freshState();
  s.setFreeze(2, 3);
  const regions = s.getViewportRegions();
  const corner = regions.find((r) => r.kind === 'corner')!;
  assert.ok(corner, '应存在 corner');
  assert.equal(corner.x, HEADER_WIDTH);
  assert.equal(corner.y, HEADER_HEIGHT);
  assert.equal(corner.width, DEFAULT_COL_WIDTH * 3);
  assert.equal(corner.height, DEFAULT_ROW_HEIGHT * 2);
  assert.equal(corner.scrollLeft, 0);
  assert.equal(corner.scrollTop, 0);
});

test('body 区域起点扣除冻结尺寸', () => {
  const s = freshState();
  s.setFreeze(2, 3);
  const regions = s.getViewportRegions();
  const body = regions.find((r) => r.kind === 'body')!;
  const frozenW = DEFAULT_COL_WIDTH * 3;
  const frozenH = DEFAULT_ROW_HEIGHT * 2;
  assert.equal(body.x, HEADER_WIDTH + frozenW);
  assert.equal(body.y, HEADER_HEIGHT + frozenH);
  assert.equal(body.width, 800 - HEADER_WIDTH - SB_SIZE - frozenW);
  assert.equal(body.height, 600 - HEADER_HEIGHT - SB_SIZE - frozenH);
});

test('rows 区域随横向滚动，columns 区域随纵向滚动', () => {
  const s = freshState();
  s.setFreeze(1, 1);
  s.scrollX.value = 100;
  s.scrollY.value = 80;
  const regions = s.getViewportRegions();
  const rows = regions.find((r) => r.kind === 'rows')!;
  const cols = regions.find((r) => r.kind === 'columns')!;
  assert.equal(rows.scrollLeft, 100, 'rows 区域 scrollLeft 跟随横向滚动');
  assert.equal(rows.scrollTop, 0, 'rows 区域不随纵向滚动');
  assert.equal(cols.scrollTop, 80, 'columns 区域 scrollTop 跟随纵向滚动');
  assert.equal(cols.scrollLeft, 0, 'columns 区域不随横向滚动');
});

test('corner 区域 scrollLeft/scrollTop 始终为 0', () => {
  const s = freshState();
  s.setFreeze(1, 1);
  s.scrollX.value = 200;
  s.scrollY.value = 200;
  const regions = s.getViewportRegions();
  const corner = regions.find((r) => r.kind === 'corner')!;
  assert.equal(corner.scrollLeft, 0);
  assert.equal(corner.scrollTop, 0);
});

// =================================================================
// 五、cellToScreenRect 四种归属
// =================================================================

test('cellToScreenRect 未冻结时 body 单元格受双向滚动影响', () => {
  const s = freshState();
  s.scrollX.value = 100;
  s.scrollY.value = 80;
  // col 5 的逻辑 X = 5 * DEFAULT_COL_WIDTH = 500；row 4 的逻辑 Y = 4 * DEFAULT_ROW_HEIGHT = 96
  const rect = s.cellToScreenRect(4, 5);
  assert.equal(rect.x, HEADER_WIDTH + 500 - 100);
  assert.equal(rect.y, HEADER_HEIGHT + 96 - 80);
  assert.equal(rect.width, DEFAULT_COL_WIDTH);
  assert.equal(rect.height, DEFAULT_ROW_HEIGHT);
});

test('cellToScreenRect corner 单元格不受滚动影响', () => {
  const s = freshState();
  s.setFreeze(2, 2);
  s.scrollX.value = 500;
  s.scrollY.value = 500;
  // row 1 col 1 落在 corner（< freeze.rows=2 且 < freeze.cols=2）
  const rect = s.cellToScreenRect(1, 1);
  assert.equal(rect.x, HEADER_WIDTH + DEFAULT_COL_WIDTH * 1, 'corner X 不受 scrollX 影响');
  assert.equal(rect.y, HEADER_HEIGHT + DEFAULT_ROW_HEIGHT * 1, 'corner Y 不受 scrollY 影响');
});

test('cellToScreenRect 冻结行单元格：Y 不受滚动，X 受横向滚动', () => {
  const s = freshState();
  s.setFreeze(2, 0);
  s.scrollX.value = 200;
  s.scrollY.value = 200;
  // row 0 冻结（< 2），col 5 不冻结
  const rect = s.cellToScreenRect(0, 5);
  assert.equal(rect.y, HEADER_HEIGHT + 0, '冻结行 Y 不受 scrollY 影响');
  assert.equal(rect.x, HEADER_WIDTH + 500 - 200, '冻结行的非冻结列 X 受 scrollX 影响');
});

test('cellToScreenRect 冻结列单元格：X 不受滚动，Y 受纵向滚动', () => {
  const s = freshState();
  s.setFreeze(0, 2);
  s.scrollX.value = 200;
  s.scrollY.value = 200;
  // col 0 冻结（< 2），row 5 不冻结
  const rect = s.cellToScreenRect(5, 0);
  assert.equal(rect.x, HEADER_WIDTH + 0, '冻结列 X 不受 scrollX 影响');
  assert.equal(rect.y, HEADER_HEIGHT + 5 * DEFAULT_ROW_HEIGHT - 200, '冻结列的非冻结行 Y 受 scrollY 影响');
});

// =================================================================
// 六、screenToCell 四区域命中
// =================================================================

test('screenToCell 命中 header 区域返回 null', () => {
  const s = freshState();
  s.setFreeze(2, 2);
  assert.equal(s.screenToCell(HEADER_WIDTH - 1, HEADER_HEIGHT + 50), null);
  assert.equal(s.screenToCell(HEADER_WIDTH + 50, HEADER_HEIGHT - 1), null);
});

test('screenToCell 命中 corner 区域（不叠加 scroll）', () => {
  const s = freshState();
  s.setFreeze(2, 2);
  s.scrollX.value = 999;
  s.scrollY.value = 999;
  // corner 内点击 col 1 row 1：屏幕 x = HEADER_WIDTH + 100, y = HEADER_HEIGHT + 24
  const hit = s.screenToCell(HEADER_WIDTH + 100, HEADER_HEIGHT + 24);
  assert.ok(hit);
  assert.equal(hit!.col, 1);
  assert.equal(hit!.row, 1);
});

test('screenToCell 命中 body 区域（叠加 scroll）', () => {
  const s = freshState();
  s.scrollX.value = 100;
  s.scrollY.value = 80;
  // 屏幕 x = HEADER_WIDTH + 400 → logicalX = 400 + 100 = 500 → col 5
  // 屏幕 y = HEADER_HEIGHT + 16  → logicalY = 16 + 80 = 96 → row 4
  const hit = s.screenToCell(HEADER_WIDTH + 400, HEADER_HEIGHT + 16);
  assert.ok(hit);
  assert.equal(hit!.col, 5);
  assert.equal(hit!.row, 4);
});

test('screenToCell 横向滚动后点击冻结列仍命中冻结列', () => {
  const s = freshState();
  s.setFreeze(0, 2);
  s.scrollX.value = 500;
  // 点击屏幕 x = HEADER_WIDTH + 50（落在冻结列 0 区域内）
  const hit = s.screenToCell(HEADER_WIDTH + 50, HEADER_HEIGHT + 10);
  assert.ok(hit);
  assert.equal(hit!.col, 0, '横向滚动后冻结列仍命中 col 0');
});

test('screenToCell 纵向滚动后点击冻结行仍命中冻结行', () => {
  const s = freshState();
  s.setFreeze(2, 0);
  s.scrollY.value = 500;
  // 点击屏幕 y = HEADER_HEIGHT + 10（落在冻结行 0 区域内）
  const hit = s.screenToCell(HEADER_WIDTH + 50, HEADER_HEIGHT + 10);
  assert.ok(hit);
  assert.equal(hit!.row, 0, '纵向滚动后冻结行仍命中 row 0');
});

// =================================================================
// 七、isCellFrozen
// =================================================================

test('isCellFrozen 判定', () => {
  const s = freshState();
  s.setFreeze(2, 3);
  // corner
  assert.equal(s.isCellFrozen(0, 0), true);
  assert.equal(s.isCellFrozen(1, 2), true);
  // 冻结行 + 非冻结列
  assert.equal(s.isCellFrozen(1, 5), true, 'row < freeze.rows 视为冻结');
  // 非冻结行 + 冻结列
  assert.equal(s.isCellFrozen(5, 2), true, 'col < freeze.cols 视为冻结');
  // body
  assert.equal(s.isCellFrozen(2, 3), false, '恰好等于 freeze 边界不算冻结');
  assert.equal(s.isCellFrozen(5, 5), false);
});

test('isCellFrozen 未冻结时全部返回 false', () => {
  const s = freshState();
  assert.equal(s.isCellFrozen(0, 0), false);
  assert.equal(s.isCellFrozen(10, 10), false);
});

// =================================================================
// 八、scrollCellIntoView
// =================================================================

test('scrollCellIntoView 冻结单元格不触发滚动', () => {
  const s = freshState();
  s.setFreeze(2, 2);
  s.scrollX.value = 100;
  s.scrollY.value = 100;
  s.scrollCellIntoView(0, 0);
  assert.equal(s.scrollX.value, 100, '冻结单元格不应改变 scrollX');
  assert.equal(s.scrollY.value, 100, '冻结单元格不应改变 scrollY');
});

test('scrollCellIntoView Body 单元格在可视左侧之外时向左滚动', () => {
  const s = freshState();
  s.setFreeze(1, 1);
  s.scrollX.value = 500;
  s.scrollY.value = 500;
  // col 1 冻结？不，freeze.cols=1，col 1 不冻结，属于 body
  // body-relative: cx = colPositions[1] - frozenW = 100 - 100 = 0 < scrollX(500)
  s.scrollCellIntoView(1, 1);
  assert.equal(s.scrollX.value, 0, '应向左滚到使 col 1 可见');
  assert.equal(s.scrollY.value, 0, '应向上滚到使 row 1 可见');
});

test('scrollCellIntoView Body 单元格在可视右侧之外时向右滚动', () => {
  const s = freshState();
  s.setFreeze(0, 0);
  // viewSize 800x600，body 可视宽 = 800 - HEADER_WIDTH - SB_SIZE = 737
  // 让 col 10 (logicalX=1000) 滚入：cx+cw=1100 > sx+737
  s.scrollX.value = 0;
  s.scrollCellIntoView(0, 10);
  // 期望 scrollX = cx + cw - gw = 1000 + 100 - 737 = 363
  assert.equal(s.scrollX.value, 1000 + DEFAULT_COL_WIDTH - (800 - HEADER_WIDTH - SB_SIZE));
});

test('scrollCellIntoView Body 单元格已在可视区时不滚动', () => {
  const s = freshState();
  s.setFreeze(1, 1);
  s.scrollX.value = 0;
  s.scrollY.value = 0;
  // col 2 row 2 在 body 可视区内
  s.scrollCellIntoView(2, 2);
  assert.equal(s.scrollX.value, 0);
  assert.equal(s.scrollY.value, 0);
});

// =================================================================
// 九、ensureCapacity 不修改 freeze
// =================================================================

test('ensureCapacity 扩展范围时不改变 freeze', () => {
  const s = freshState();
  s.setFreeze(3, 2);
  s.ensureCapacity(100, 500);
  assert.equal(s.rowCount >= 501, true, 'rowCount 应已扩展');
  assert.equal(s.colCount >= 101, true, 'colCount 应已扩展');
  assert.deepEqual(s.getFreeze(), { rows: 3, cols: 2 }, 'freeze 应保持不变');
});

test('ensureCapacity 扩展后冻结语义仍是前 N 行/列', () => {
  const s = freshState();
  s.setFreeze(3, 2);
  const beforeRowCount = s.rowCount;
  s.ensureCapacity(s.colCount - 1, s.rowCount + 100);
  assert.ok(s.rowCount > beforeRowCount);
  // 仍是前 3 行 / 前 2 列冻结
  assert.equal(s.isCellFrozen(2, 1), true);
  assert.equal(s.isCellFrozen(3, 2), false);
});

// =================================================================
// 十、insert / delete 后 freeze clamp（全栈）
// =================================================================

test('deleteRows 后 freeze.rows 仍保持有效（动态范围只增不减，防御性 clamp 维持不变式）', () => {
  const { sheetsOps, s } = fullStack(10, 20);
  s.setFreeze(5, 0);
  assert.equal(s.freeze.rows, 5);
  const rowsBefore = s.rowCount;
  // 删除 0-2 行（删 3 行）
  sheetsOps.deleteRows(0, 2);
  // 动态范围只增不减：rowCount 不收缩
  assert.equal(s.rowCount, rowsBefore, 'rowCount 不随删除收缩');
  // freeze.rows 仍满足 0 <= rows <= rowCount 不变式
  assert.ok(s.freeze.rows >= 0 && s.freeze.rows <= s.rowCount, 'freeze.rows 维持有效区间');
});

test('deleteCols 后 freeze.cols 仍保持有效（动态范围只增不减，防御性 clamp 维持不变式）', () => {
  const { sheetsOps, s } = fullStack(10, 20);
  s.setFreeze(0, 4);
  assert.equal(s.freeze.cols, 4);
  const colsBefore = s.colCount;
  sheetsOps.deleteCols(0, 2);
  assert.equal(s.colCount, colsBefore, 'colCount 不随删除收缩');
  assert.ok(s.freeze.cols >= 0 && s.freeze.cols <= s.colCount, 'freeze.cols 维持有效区间');
});

test('insertRows 在冻结区域内插入行后 freeze.rows 语义不变（保持前 N 行）', () => {
  const { sheetsOps, s } = fullStack(10, 20);
  s.setFreeze(3, 0);
  sheetsOps.insertRows(0, 1); // 在顶部插入 2 行
  assert.equal(s.freeze.rows, 3, 'freeze.rows 保持 3（前 3 行冻结语义不变）');
});

test('insertCols 在冻结区域内插入列后 freeze.cols 语义不变', () => {
  const { sheetsOps, s } = fullStack(10, 20);
  s.setFreeze(0, 3);
  sheetsOps.insertCols(0, 1); // 在左侧插入 2 列
  assert.equal(s.freeze.cols, 3, 'freeze.cols 保持 3（前 3 列冻结语义不变）');
});

// =================================================================
// 十一、多 Sheet 各自 freeze 隔离
// =================================================================

test('多 Sheet 切换后各自 freeze 正确恢复', () => {
  const { sheetsOps, s } = fullStack(26, 200);
  // Sheet1（index 0）：冻结 2 行 1 列
  s.setFreeze(2, 1);
  sheetsOps.saveSheet();
  assert.deepEqual(sheetsOps.sheets.value[0]!.freeze, { rows: 2, cols: 1 });

  // 新增 Sheet2
  sheetsOps.sheets.value.push(sheetsOps.mkSheet('Sheet2'));
  sheetsOps.loadSheet(1);
  assert.deepEqual(s.getFreeze(), { rows: 0, cols: 0 }, '新 Sheet 应未冻结');
  s.setFreeze(5, 3);
  sheetsOps.saveSheet();
  assert.deepEqual(sheetsOps.sheets.value[1]!.freeze, { rows: 5, cols: 3 });

  // 切回 Sheet1
  sheetsOps.loadSheet(0);
  assert.deepEqual(s.getFreeze(), { rows: 2, cols: 1 }, 'Sheet1 freeze 应恢复');

  // 切回 Sheet2
  sheetsOps.loadSheet(1);
  assert.deepEqual(s.getFreeze(), { rows: 5, cols: 3 }, 'Sheet2 freeze 应恢复');
});

test('switchSheet 保存并恢复 freeze', () => {
  const { sheetsOps, s } = fullStack(26, 200);
  s.setFreeze(1, 1);
  // 新增 Sheet2
  sheetsOps.addSheet();
  assert.deepEqual(s.getFreeze(), { rows: 0, cols: 0 }, '新增 Sheet 后当前未冻结');
  s.setFreeze(4, 2);
  // 切回 Sheet1（index 0）
  sheetsOps.switchSheet(0);
  assert.deepEqual(s.getFreeze(), { rows: 1, cols: 1 }, '切回 Sheet1 freeze 恢复');
  // 切到 Sheet2（index 1）
  sheetsOps.switchSheet(1);
  assert.deepEqual(s.getFreeze(), { rows: 4, cols: 2 }, '切到 Sheet2 freeze 恢复');
});

// =================================================================
// 十二、持久化（emitModelData）序列化 freeze
// =================================================================

test('emitModelData 未冻结时省略 freeze 字段', () => {
  const { sheetsOps, modelData } = fullStack(26, 200);
  sheetsOps.emitModelData();
  assert.equal(modelData.value[0]!.freeze, undefined, '未冻结时不应输出 freeze');
});

test('emitModelData 冻结时输出 freeze 字段', () => {
  const { sheetsOps, s, modelData } = fullStack(26, 200);
  s.setFreeze(2, 3);
  sheetsOps.emitModelData();
  assert.deepEqual(modelData.value[0]!.freeze, { rows: 2, cols: 3 });
});

test('v-model 整体替换后 freeze 同步（缺省视为未冻结）', () => {
  const { sheetsOps, s, modelData } = fullStack(26, 200);
  // 模拟父组件替换整个数据：旧数据无 freeze 字段
  modelData.value = [{ name: 'Sheet1', cells: {} }];
  // saveSheet + loadSheet 重新加载
  sheetsOps.loadSheet(0);
  assert.deepEqual(s.getFreeze(), { rows: 0, cols: 0 }, '缺省 freeze 视为未冻结');
});

test('v-model 整体替换后 freeze 同步（带 freeze 字段）', () => {
  const { sheetsOps, s, modelData } = fullStack(26, 200);
  modelData.value = [{ name: 'Sheet1', cells: {}, freeze: { rows: 4, cols: 2 } }];
  // 把 modelData 的 sheet 写入 sheets 数组再加载
  // 直接构造 SheetState：通过 mkSheet 然后覆盖 freeze
  const sh = sheetsOps.mkSheet('Sheet1');
  sh.freeze = { rows: 4, cols: 2 };
  sheetsOps.sheets.value = [sh];
  sheetsOps.loadSheet(0);
  assert.deepEqual(s.getFreeze(), { rows: 4, cols: 2 });
});

// =================================================================
// 十三、边界情况
// =================================================================

test('冻结全部行：getFrozenMetrics 与 viewport 不产生负尺寸', () => {
  const s = freshState(5, 5);
  s.setFreeze(5, 0); // 冻结全部 5 行
  const m = s.getFrozenMetrics();
  assert.equal(m.frozenRowsHeight, DEFAULT_ROW_HEIGHT * 5);
  const regions = s.getViewportRegions();
  const body = regions.find((r) => r.kind === 'body')!;
  assert.ok(body.height >= 0, 'body height 不应为负');
  assert.ok(!Number.isNaN(body.height));
});

test('冻结全部列：getFrozenMetrics 与 viewport 不产生负尺寸', () => {
  const s = freshState(5, 5);
  s.setFreeze(0, 5); // 冻结全部 5 列
  const m = s.getFrozenMetrics();
  assert.equal(m.frozenColumnsWidth, DEFAULT_COL_WIDTH * 5);
  const regions = s.getViewportRegions();
  const body = regions.find((r) => r.kind === 'body')!;
  assert.ok(body.width >= 0, 'body width 不应为负');
  assert.ok(!Number.isNaN(body.width));
});

test('冻结全部行列：不产生负尺寸/NaN', () => {
  const s = freshState(3, 3);
  s.setFreeze(3, 3);
  const regions = s.getViewportRegions();
  for (const r of regions) {
    assert.ok(r.width >= 0, `${r.kind} width >= 0`);
    assert.ok(r.height >= 0, `${r.kind} height >= 0`);
    assert.ok(!Number.isNaN(r.width), `${r.kind} width 非 NaN`);
    assert.ok(!Number.isNaN(r.height), `${r.kind} height 非 NaN`);
  }
});

test('空 Sheet（极小范围）冻结首行首列', () => {
  const s = freshState(1, 1);
  s.setFreeze(1, 1);
  assert.deepEqual(s.getFreeze(), { rows: 1, cols: 1 });
  const m = s.getFrozenMetrics();
  assert.equal(m.frozenColumnsWidth, DEFAULT_COL_WIDTH);
  assert.equal(m.frozenRowsHeight, DEFAULT_ROW_HEIGHT);
});

test('极端列宽下 getFrozenMetrics 正确累加', () => {
  const s = freshState(5, 5);
  s.colWidths.value[0] = 1;
  s.colWidths.value[1] = 10000;
  s.setFreeze(0, 2);
  const m = s.getFrozenMetrics();
  assert.equal(m.frozenColumnsWidth, 10001);
});

// =================================================================
// 十四、合并单元格跨冻结线几何
// =================================================================

test('合并单元格跨冻结列 + 隐藏列：cellToScreenRect 几何正确', () => {
  const s = freshState();
  // 模拟截图：A 冻结，B-E 隐藏，F-K 可见
  s.colWidths.value[1] = 0;
  s.colWidths.value[2] = 0;
  s.colWidths.value[3] = 0;
  s.colWidths.value[4] = 0;
  s.setFreeze(0, 1);
  // 合并 A1:K1（col 0..10, row 0）
  s.merges[s.cellKey(0, 0)] = { startCol: 0, startRow: 0, endCol: 10, endRow: 0 };
  s.cells[s.cellKey(0, 0)] = { value: '落霞峰 弟子名录' };
  s.scrollX.value = 0;

  const rA = s.cellToScreenRect(0, 0);
  const rF = s.cellToScreenRect(0, 5);

  // A 列宽（隐藏列宽为 0）
  const aW = DEFAULT_COL_WIDTH;

  // anchor A1：x = HEADER_WIDTH，width = cP[11] - cP[0] = 7 倍列宽（隐藏列宽为 0）
  // （11 列：col 0(A, 100) + col 1-4(B-E, 0) + col 5-10(F-K, 100×6) = 700）
  assert.equal(rA.x, HEADER_WIDTH);
  assert.equal(rA.width, 7 * aW);
  assert.equal(rA.y, HEADER_HEIGHT);

  // F1（非 anchor、body 列、合并内）：cellToScreenRect 返回「子矩形」——
  // x = HW + A 宽度（隐藏列宽为 0，F 紧贴在冻结分隔线右）；width = cP[11]-cP[5]
  assert.equal(rF.x, HEADER_WIDTH + aW);
  assert.equal(rF.width, 6 * aW);
});

// 验证关键修复点：合并内 body 列的 cellToScreenRect 正确叠加 scrollX，
// 由 drawMergedCells 通过 (eRect.x + eRect.width) - aRect.x 算出真实合并宽。
test('冻结首列 + scrollX>0：合并内 body 列的 cellToScreenRect 正确叠加 scrollX', () => {
  const s = freshState(11, 5);
  // 隐藏 B-E
  for (let c = 1; c <= 4; c++) s.colWidths.value[c] = 0;
  // 冻结首列（rows=0, cols=1）
  s.setFreeze(0, 1);
  // 合并 A1:K1
  s.merges[s.cellKey(0, 0)] = { startCol: 0, startRow: 0, endCol: 10, endRow: 0 };

  const rA0 = s.cellToScreenRect(0, 0);
  const rF0 = s.cellToScreenRect(0, 5);
  // 滚动到 sx = 2*A 宽
  const sx = 2 * DEFAULT_COL_WIDTH;
  s.scrollX.value = sx;
  const rA = s.cellToScreenRect(0, 0);
  const rF = s.cellToScreenRect(0, 5);

  // anchor A1：冻结列，scrollX 不影响
  assert.equal(rA.x, rA0.x, 'A1.x 不应随 scrollX 改变');
  assert.equal(rA.width, rA0.width, 'A1.width 不应随 scrollX 改变');

  // F1（非 anchor，body 列，合并内）：screenX 随 scrollX 同步减少
  assert.equal(rF0.x - rF.x, sx, 'F1.x 应减少 = scrollX');
  assert.equal(rF.width, rF0.width, 'F1.width 不应改变（子矩形宽 = cP[end+1]-cP[F]）');

  // 关键：drawMergedCells 用 (rH.x + rH.width) - rA.x 算出合并宽度，
  // 必须正确处理 endCell 在 body 区叠加 scrollX 而 anchor 在冻结区不叠加的情况。
  const rK = s.cellToScreenRect(0, 10); // K1（endCol），非 anchor，body 列
  const mergedWidth = (rK.x + rK.width) - rA.x;
  assert.equal(mergedWidth, 7 * DEFAULT_COL_WIDTH - sx, '合并宽度 = K1 右边界 - A1 左边界（body 部分已减 sx）');
});

// 本次修复核心：跨冻结线合并的「逻辑宽」cP[endCol+1]-cP[startCol] 不随 scrollX 变化——
// drawMergedCells 用它做文本布局（换行/溢出/对齐）与冻结段背景，保证 A1 冻结段
// 位置+宽度恒定完整，不会随滚动缩小或变空。
test('跨冻结线合并：逻辑宽与冻结段位置不随 scrollX 变化', () => {
  const s = freshState(11, 5);
  // 隐藏 B-E（与截图场景一致：冻结首列 + 合并跨到 body 列）
  for (let c = 1; c <= 4; c++) s.colWidths.value[c] = 0;
  s.setFreeze(0, 1);
  s.merges[s.cellKey(0, 0)] = { startCol: 0, startRow: 0, endCol: 10, endRow: 0 };

  const frozenW = s.colPositions.value[1]! - s.colPositions.value[0]!; // A 列宽
  const bodyLeft = HEADER_WIDTH + frozenW; // 冻结分隔线屏幕 x（固定）

  // scrollX = 0 基准
  const rA0 = s.cellToScreenRect(0, 0);
  const logicW0 = s.colPositions.value[11]! - s.colPositions.value[0]!;
  assert.equal(logicW0, 7 * frozenW, '逻辑宽 = 可见列总宽（隐藏列不计）');
  assert.equal(rA0.x + rA0.width, HEADER_WIDTH + 7 * frozenW, '未滚动时合并右边界 = HW + 逻辑宽');

  // 滚动后：逻辑宽不变；anchor（冻结段）位置与宽度不变
  s.scrollX.value = 2 * frozenW;
  const rA = s.cellToScreenRect(0, 0);
  const logicW = s.colPositions.value[11]! - s.colPositions.value[0]!;
  assert.equal(logicW, logicW0, '逻辑宽不随 scrollX 变化（文本布局/冻结段背景的依据）');
  assert.equal(rA.x, rA0.x, 'A1 冻结段左边界不随 scrollX 变化');
  assert.equal(rA.width, rA0.width, 'A1 冻结段宽度不随 scrollX 变化');
  // 冻结段渲染右边界固定为 bodyLeft：跨线合并整体右边界必越过冻结线，
  // 保证 freeze pane 中背景/网格右边界 = bodyLeft（A1 永远占满整列，不缩小不变空）
  assert.ok(HEADER_WIDTH + 7 * frozenW >= bodyLeft, '跨线合并整体矩形覆盖冻结段');
  assert.equal(bodyLeft, HEADER_WIDTH + frozenW, '冻结分隔线固定');
});
