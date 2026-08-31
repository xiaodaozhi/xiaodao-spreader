import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ref, nextTick, type Ref } from 'vue';
import { createCoreState, type CoreState } from '../src/components/spreader/composables/core-state';
import { createUndoStyles } from '../src/components/spreader/composables/undo-styles';
import { createSheetsOps } from '../src/components/spreader/composables/sheets-ops';
import { translateDvRange } from '../src/components/spreader/core/data-validation';
import type {
  SheetModelData,
  SheetState,
  DataValidationRule,
  SelectionRange,
} from '../src/components/spreader/core/types';

// ============ 全栈辅助（core-state + undo-styles + sheets-ops + borders-merge） ============
function fullStack(colCount = 26, rowCount = 200) {
  const s = createCoreState(
    { colCount, rowCount },
    { colCount, rowCount, theme: 'light', locale: 'zh-CN' },
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
      scrollX: 0, scrollY: 0, colWidths: [], rowHeights: [],
      colCount: 0, rowCount: 0, freeze: { rows: 0, cols: 0 }, filter: null,
      conditionalFormats: [], dataValidations: [], rowOutlines: [], columnOutlines: [],
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

  return { s, us, so, modelData };
}

function range(sC: number, sR: number, eC: number, eR: number): SelectionRange {
  return { startCol: sC, startRow: sR, endCol: eC, endRow: eR };
}

const LIST_RULE: Omit<DataValidationRule, 'id'> = {
  type: 'list',
  values: ['男', '女'],
  listSource: { type: 'values', values: ['男', '女'] },
  ranges: [range(1, 1, 1, 99)], // B2:B100
  allowBlank: false,
  showDropdown: true,
  showInputMessage: true,
  inputTitle: '性别',
  inputMessage: '请选择性别',
  showErrorMessage: true,
  errorStyle: 'stop',
  errorTitle: '输入错误',
  errorMessage: '只能选择男或女',
};

// =================================================================
// 一、CRUD 与查询
// =================================================================

test('createDataValidation / getDataValidationRules / hasDataValidation', () => {
  const { s } = fullStack();
  const r = s.createDataValidation({ ...LIST_RULE, id: '' });
  assert.ok(r.id);
  assert.equal(s.dataValidations.length, 1);
  // 注意：本组 API 为 (row, col) 顺序
  assert.equal(s.hasDataValidation(1, 1), true);   // B2
  assert.equal(s.hasDataValidation(50, 1), true);  // B51
  assert.equal(s.hasDataValidation(1, 2), false);  // C2 不在范围内
  assert.equal(s.getDataValidationRules(1, 1).length, 1);
});

test('getListValidation / getValidationDropdown：list 且显示下拉', () => {
  const { s } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '' });
  assert.ok(s.getListValidation(1, 1));
  assert.deepEqual(s.getValidationDropdown(1, 1)?.items, ['男', '女']);
  // showDropdown=false → 不显示箭头（但规则仍生效）
  s.updateDataValidation(s.dataValidations[0]!.id, { showDropdown: false });
  assert.equal(s.getListValidation(1, 1), null);
  assert.equal(s.hasDataValidation(1, 1), true);
});

test('getValidationInputMessage：showInputMessage 打开时才返回', () => {
  const { s } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '' });
  assert.deepEqual(s.getValidationInputMessage(1, 1), { title: '性别', message: '请选择性别' });
  s.updateDataValidation(s.dataValidations[0]!.id, { showInputMessage: false });
  assert.equal(s.getValidationInputMessage(1, 1), null);
});

test('updateDataValidation / removeDataValidation', () => {
  const { s } = fullStack();
  const r = s.createDataValidation({ ...LIST_RULE, id: '' });
  s.updateDataValidation(r.id, { errorMessage: '新文案' });
  assert.equal(s.dataValidations[0]!.errorMessage, '新文案');
  s.removeDataValidation(r.id);
  assert.equal(s.dataValidations.length, 0);
});

test('clearDataValidation：只清除选中区域，Range 被拆分/缩小', () => {
  const { s } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '', ranges: [range(0, 0, 0, 9)] }); // A1:A10
  // 清除 A5:A6（index 4..5）→ 拆成 A1:A4 与 A7:A10
  s.clearDataValidation(range(0, 4, 0, 5));
  assert.equal(s.dataValidations.length, 1);
  assert.deepEqual(s.dataValidations[0]!.ranges, [range(0, 0, 0, 3), range(0, 6, 0, 9)]);
  // 清除整段 → 规则删除
  s.clearDataValidation(range(0, 0, 0, 99));
  assert.equal(s.dataValidations.length, 0);
});

// =================================================================
// 二、validateCell / 编辑提交链路
// =================================================================

test('validateCell：合法 / 非法 / allowBlank', () => {
  const { s } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '' });
  assert.equal(s.validateCell(1, 1, '男').valid, true);
  assert.equal(s.validateCell(1, 1, '未知').valid, false);
  assert.equal(s.validateCell(1, 1, '未知').severity, 'stop');
  assert.equal(s.validateCell(1, 1, '未知').message, '只能选择男或女');
  // allowBlank=false → 空值非法
  assert.equal(s.validateCell(1, 1, '').valid, false);
});

test('commitEdit：非法（stop）不写入单元格，且保持编辑态', async () => {
  const { s } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '' });
  s.selectCell(1, 1);
  s.startEdit('未知');
  const ok = await s.commitEdit();
  assert.equal(ok, false);
  assert.equal(s.getCellRaw(1, 1), '');       // 未写入
  assert.ok(s.editingCell.value);             // 仍处于编辑态
});

test('commitEdit：warning 用户确认继续后可写入', async () => {
  const { s } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '', errorStyle: 'warning' });
  s.showValidationAlert = async () => 'continue';
  s.selectCell(1, 1);
  s.startEdit('未知');
  const ok = await s.commitEdit();
  assert.equal(ok, true);
  assert.equal(s.getCellRaw(1, 1), '未知');
  assert.equal(s.editingCell.value, null);
});

test('commitEdit：warning 用户取消 → 不写入', async () => {
  const { s } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '', errorStyle: 'warning' });
  s.showValidationAlert = async () => 'cancel';
  s.selectCell(1, 1);
  s.startEdit('未知');
  assert.equal(await s.commitEdit(), false);
  assert.equal(s.getCellRaw(1, 1), '');
});

test('commitEdit：合法值正常写入并产生 Undo', async () => {
  const { s, us } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '' });
  s.selectCell(1, 1);
  s.startEdit('女');
  assert.equal(await s.commitEdit(), true);
  assert.equal(s.getCellRaw(1, 1), '女');
  assert.ok(us.canUndo.value);
});

// =================================================================
// 三、Undo / Redo（规则级）
// =================================================================

test('创建 / 修改 / 删除验证均为一个完整 Undo 步骤', () => {
  const { s, us } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '' });
  const id = s.dataValidations[0]!.id;
  us.undo();
  assert.equal(s.dataValidations.length, 0, '撤销创建');
  us.redo();
  assert.equal(s.dataValidations.length, 1, '重做创建');

  s.updateDataValidation(id, { errorMessage: 'X' });
  us.undo();
  assert.notEqual(s.dataValidations[0]?.errorMessage, 'X', '撤销修改');

  s.removeDataValidation(id);
  us.undo();
  assert.equal(s.dataValidations.length, 1, '撤销删除');
});

test('清除验证也可撤销', () => {
  const { s, us } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '' });
  s.clearDataValidation(range(1, 1, 1, 99));
  assert.equal(s.dataValidations.length, 0);
  us.undo();
  assert.equal(s.dataValidations.length, 1);
});

// =================================================================
// 四、持久化（serialize → reload）
// =================================================================

test('持久化：dataValidations 随 modelData 输出并可从外部数据恢复', () => {
  const { s, so, modelData } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '' });
  so.emitModelData();
  const out = modelData.value;
  assert.ok(out[0]!.dataValidations);
  assert.equal(out[0]!.dataValidations!.length, 1);
  assert.equal(out[0]!.dataValidations![0]!.type, 'list');
  assert.deepEqual(out[0]!.dataValidations![0]!.values, ['男', '女']);

  // 模拟外部数据重新灌入（与 spreader.vue 的 watch(modelData) 同款路径）
  so.sheets.value = out.map((smd) => {
    const sh = so.mkSheet(smd.name);
    Object.assign(sh.cells, smd.cells ?? {});
    sh.dataValidations = [...(smd.dataValidations ?? [])];
    return sh;
  });
  so.loadSheet(0);
  assert.equal(s.dataValidations.length, 1);
  assert.deepEqual(s.getValidationDropdown(1, 1)?.items, ['男', '女']);
  assert.deepEqual(s.getValidationInputMessage(1, 1), { title: '性别', message: '请选择性别' });
  assert.equal(s.validateCell(1, 1, '未知').valid, false);
});

test('旧数据没有 dataValidations 字段时视为无验证', () => {
  const { so, s } = fullStack();
  so.sheets.value = [so.mkSheet('Sheet1')];
  (so.sheets.value[0] as unknown as { dataValidations?: unknown }).dataValidations = undefined;
  so.loadSheet(0);
  assert.equal(s.dataValidations.length, 0);
  assert.equal(s.hasDataValidation(0, 0), false);
});

test('多 Sheet：验证规则随工作表隔离', () => {
  const { s, so } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '' });
  so.saveSheet();
  so.addSheet('Sheet2');
  assert.equal(s.dataValidations.length, 0, '新工作表无验证');
  so.switchSheet(0);
  assert.equal(s.dataValidations.length, 1, '切回后恢复');
});

// =================================================================
// 五、插入 / 删除行列的 Range 跟随
// =================================================================

test('插入行：验证范围 A2:A100 在范围内插入后扩展', () => {
  const { s, us, so } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '', ranges: [range(0, 1, 0, 99)] }); // A2:A100
  us.saveUndo();
  so.insertRows(49, 49); // 在第 50 行插入
  assert.deepEqual(s.dataValidations[0]!.ranges, [range(0, 1, 0, 100)]);
});

test('删除行：验证范围收缩；整段删除则移除规则', () => {
  const { s, us, so } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '', ranges: [range(0, 10, 0, 20)] });
  us.saveUndo();
  so.deleteRows(0, 4);
  assert.deepEqual(s.dataValidations[0]!.ranges, [range(0, 5, 0, 15)]);
  us.saveUndo();
  so.deleteRows(0, 99);
  assert.equal(s.dataValidations.length, 0);
});

test('插入 / 删除列：验证范围跟随', () => {
  const { s, us, so } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '', ranges: [range(2, 0, 5, 9)] }); // C1:F10
  us.saveUndo();
  so.insertCols(3, 3);
  assert.deepEqual(s.dataValidations[0]!.ranges, [range(2, 0, 6, 9)]);
  us.saveUndo();
  so.deleteCols(2, 6);
  assert.equal(s.dataValidations.length, 0);
});

// =================================================================
// 六、批量校验（粘贴 / AutoFill 原子性）
// =================================================================

test('validateCells：存在非法项时返回最严重结果', () => {
  const { s } = fullStack();
  s.createDataValidation({
    id: '', type: 'wholeNumber', operator: 'between',
    formula1: '1', formula2: '100', errorStyle: 'stop', ranges: [range(0, 0, 0, 2)],
  });
  const res = s.validateCells([
    { col: 0, row: 0, value: '10' },
    { col: 0, row: 1, value: '200' },
  ]);
  assert.equal(res.valid, false);
  assert.equal(res.severity, 'stop');
});

test('AutoFill：存在 Stop 级非法结果时整次取消，不写入任何单元格', () => {
  const { s } = fullStack();
  // 校验规则：<= 10
  s.createDataValidation({
    id: '', type: 'wholeNumber', operator: 'lessThanOrEqual',
    formula1: '10', errorStyle: 'stop', ranges: [range(0, 0, 0, 19)],
  });
  s.setCellValue(0, 0, '1');
  s.setCellValue(0, 1, '2');
  s.applyAutoFill(range(0, 0, 0, 1), range(0, 2, 0, 19), 'down');
  // 生成 3..20 → 11..20 非法 → 整次取消
  for (let r = 2; r <= 19; r++) assert.equal(s.getCellRaw(0, r), '', `row ${r} 不应被写入`);
});

test('AutoFill：全部合法时正常填充', () => {
  const { s } = fullStack();
  s.createDataValidation({
    id: '', type: 'wholeNumber', operator: 'lessThanOrEqual',
    formula1: '10', errorStyle: 'stop', ranges: [range(0, 0, 0, 9)],
  });
  s.setCellValue(0, 0, '1');
  s.setCellValue(0, 1, '2');
  s.applyAutoFill(range(0, 0, 0, 1), range(0, 2, 0, 4), 'down');
  assert.equal(s.getCellRaw(0, 2), '3');
  assert.equal(s.getCellRaw(0, 4), '5');
});

test('AutoFill：warning 用户取消 → 不写入；确认继续 → 写入', async () => {
  const { s } = fullStack();
  s.createDataValidation({
    id: '', type: 'wholeNumber', operator: 'lessThanOrEqual',
    formula1: '10', errorStyle: 'warning', ranges: [range(0, 0, 0, 19)],
  });
  s.setCellValue(0, 0, '1');
  s.setCellValue(0, 1, '2');
  s.showValidationAlert = async () => 'cancel';
  s.applyAutoFill(range(0, 0, 0, 1), range(0, 2, 0, 19), 'down');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.getCellRaw(0, 5), '', '用户取消 → 不写入');

  s.showValidationAlert = async () => 'continue';
  s.applyAutoFill(range(0, 0, 0, 1), range(0, 2, 0, 19), 'down');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.getCellRaw(0, 5), '6', '用户确认 → 写入');
});

// =================================================================
// 七、合并单元格 / 动态扩展
// =================================================================

test('合并单元格：下拉与校验统一按左上角判定', () => {
  const { s } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '', ranges: [range(1, 1, 2, 9)] }); // B2:C10
  s.merges['1,1'] = range(1, 1, 2, 2); // B2:C3 合并
  assert.ok(s.getListValidation(1, 2));   // 合并区内非锚点也归属锚点
  assert.ok(s.getListValidation(2, 2));
  assert.equal(s.validateCell(2, 2, '未知').valid, false);
  assert.equal(s.validateCell(2, 2, '男').valid, true);
});

test('动态扩展：新增行列不会自动扩大验证范围（与 Insert Row 语义区分）', () => {
  const { s } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '', ranges: [range(0, 1, 0, 99)] }); // A2:A100
  s.ensureCapacity(0, 150);
  assert.equal(s.hasDataValidation(100, 0), false, 'A101 不应自动继承');
  assert.equal(s.hasDataValidation(99, 0), true);
});

// =================================================================
// 八、list 源区域跟随数据变化
// =================================================================

test('list 引用区域：修改源区域后下拉项立即更新（缓存失效）', () => {
  const { s } = fullStack();
  s.createDataValidation({
    id: '', type: 'list', showDropdown: true,
    listSource: { type: 'range', range: range(4, 0, 4, 2) }, // E1:E3
    ranges: [range(0, 0, 0, 9)],
  });
  s.setCellValue(4, 0, '北京');
  s.setCellValue(4, 1, '上海');
  s.setCellValue(4, 2, '广州');
  assert.deepEqual(s.getValidationDropdown(0, 0)?.items, ['北京', '上海', '广州']);
  s.setCellValue(4, 1, '深圳');
  assert.deepEqual(s.getValidationDropdown(0, 0)?.items, ['北京', '深圳', '广州']);
  assert.equal(s.validateCell(0, 0, '深圳').valid, true);
  assert.equal(s.validateCell(0, 0, '上海').valid, false);
});

test('大规模验证范围：1 条规则覆盖 A1:A100000，不为每个 Cell 创建规则对象', () => {
  const { s } = fullStack(26, 1000);
  s.createDataValidation({
    id: '', type: 'wholeNumber', operator: 'between',
    formula1: '1', formula2: '100', ranges: [range(0, 0, 0, 999)],
  });
  assert.equal(s.dataValidations.length, 1);
  assert.equal(s.hasDataValidation(500, 0), true);
  assert.equal(s.validateCell(500, 0, '101').valid, false);
});

// =================================================================
// 九、复制粘贴携带验证规则
// =================================================================

test('复制粘贴：完整单元格粘贴会携带验证规则到目标区域', () => {
  const { s } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '', ranges: [range(0, 0, 0, 4)] }); // A1:A5
  s.selectRange(0, 0, 0, 4);
  s.activeCell.value = { col: 2, row: 0 }; // 粘贴到 C1
  // 无 DOM 环境下剪贴板不可用，直接验证「复制捕获源区域规则 → 平移 → 应用到目标」的规则链路
  const captured = s.getDataValidationsInRange(range(0, 0, 0, 4));
  assert.equal(captured.length, 1);
  const moved = captured.map((c) => ({
    ...c.rule,
    ranges: [translateDvRange(c.range, 2, 0)], // A1:A5 → C1:C5
  }));
  s.applyDataValidationsToRange(moved, range(2, 0, 2, 4)); // C1:C5
  assert.equal(s.hasDataValidation(0, 2), true);
  // 覆盖式粘贴：目标区域原有规则被替换
  assert.equal(s.getDataValidationsInRange(range(2, 0, 2, 4)).length, 1);
});

test('validateCells 与 validateCell 在未命中范围时均返回 valid', async () => {
  const { s } = fullStack();
  s.createDataValidation({ ...LIST_RULE, id: '' });
  assert.equal(s.validateCell(9, 9, '任意').valid, true);
  assert.equal(s.validateCells([{ col: 9, row: 9, value: '任意' }]).valid, true);
  await nextTick();
});
