<script setup lang="ts">
import { ref, reactive, computed, nextTick, type Ref, type UnwrapRef } from 'vue';
import { SB_SIZE, t } from '../core/constants';
import Toolbar from './toolbar.vue';
import Tabbar from './tabbar.vue';
import FindReplaceBar from './find-replace-bar.vue';
import NumberFormatDialog from './pickers/number-format-dialog.vue';
import SortConfirmDialog from './pickers/sort-confirm-dialog.vue';
import InsertFunctionDialog from './pickers/insert-function-dialog.vue';
import FilterPopup from './pickers/filter-popup.vue';
import ConditionalFormatManager from './pickers/conditional-format-manager.vue';
import ConditionalFormatRuleEditor from './pickers/conditional-format-rule-editor.vue';
import DataValidationDialog from './pickers/data-validation-dialog.vue';
import DataValidationDropdown from './pickers/data-validation-dropdown.vue';
import DataValidationAlert from './pickers/data-validation-alert.vue';
import DataValidationInputMessage from './data-validation-input-message.vue';
import type {
  SheetModelData,
  SheetState,
  ConditionalFormattingRule,
  ConditionalFormattingCondition,
  CellIsOperator,
  DataValidationRule,
  DataValidationSeverity,
} from '../core/types';
import { createCoreState, type DataValidationAlertAction, type CoreState } from '../composables/core-state';
import { colToLabel } from '../core/utils';

import { createUndoStyles, bindMenuRefs, type UndoStylesState } from '../composables/undo-styles';
import { createBordersMerge, type BordersMergeState } from '../composables/borders-merge';
import { createSheetsOps, type SheetsOpsState } from '../composables/sheets-ops';
import { createInteractions, type InteractionsState } from '../composables/interactions';
import { createFindReplace, type FindReplaceState } from '../composables/find-replace';
import { NF_MIXED, NF_CUSTOM } from '../core/number-format';

// ============ Props ============
const props = withDefaults(defineProps<{
  rowCount?: number;
  colCount?: number;
  width?: number | string;
  height?: number | string;
  theme?: 'light' | 'dark';
  locale?: string;
}>(), {
  rowCount: 200,
  colCount: 26,
  theme: 'light',
  locale: 'zh-CN',
});

// ============ v-model:data ============
const modelData = defineModel<SheetModelData[]>('data', { default: () => [] });
const lastEmittedDataRef = { value: '' };

// ============ 创建各模块实例 ============
const coreStateRaw = createCoreState(
  props,
  { rowCount: props.rowCount, colCount: props.colCount, theme: props.theme, locale: props.locale },
);

// 先创建带正确类型的 sheetsCtx 占位
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
    id: '',
    name,
    cells: {},
    merges: {},
    styles: [{}],
    borders: [{}],
    selection: null,
    activeCell: { col: 0, row: 0 },
    scrollX: 0,
    scrollY: 0,
    colWidths: [],
    rowHeights: [],
    colCount: 0,
    rowCount: 0,
    freeze: { rows: 0, cols: 0 },
    filter: null,
    conditionalFormats: [],
    dataValidations: [],
    rowOutlines: [],
    columnOutlines: [],
  }),
};

const undoStylesRaw = createUndoStyles(coreStateRaw, sheetsCtx);
const bordersMergeRaw = createBordersMerge(coreStateRaw, undoStylesRaw);

// 绑定边框/合并菜单引用到 undo-styles（用于互斥开关）
bindMenuRefs(undoStylesRaw, {
  borderMenuOpen: bordersMergeRaw.borderMenuOpen,
  mergeMenuOpen: bordersMergeRaw.mergeMenuOpen,
});

const sheetsOpsRaw = createSheetsOps(
  coreStateRaw,
  undoStylesRaw,
  modelData,
  undefined,
  lastEmittedDataRef,
);

// 将 sheetsCtx 的实际引用替换为 sheetsOps 的
sheetsCtx.sheets = sheetsOpsRaw.sheets;
sheetsCtx.activeSheetIndex = sheetsOpsRaw.activeSheetIndex;
sheetsCtx.saveSheet = sheetsOpsRaw.saveSheet;
sheetsCtx.loadSheet = sheetsOpsRaw.loadSheet;
sheetsCtx.mkSheet = sheetsOpsRaw.mkSheet;

const interactionsRaw = createInteractions(
  coreStateRaw,
  undoStylesRaw,
  bordersMergeRaw,
  sheetsOpsRaw,
  lastEmittedDataRef,
);

// 生命周期 / watch 装配
interactionsRaw.setupLifecycle();

// ============ 查找和替换 ============
const findReplaceRaw = createFindReplace(
  coreStateRaw,
  undoStylesRaw,
  sheetsOpsRaw,
  lastEmittedDataRef,
);
findReplaceRaw.setupLifecycle();

// ============ reactive 包装：模板自动解包 ref/computed ============
const coreState = reactive(coreStateRaw) as unknown as UnwrapRef<CoreState>;
const undoStyles = reactive(undoStylesRaw) as unknown as UnwrapRef<UndoStylesState>;
const bordersMerge = reactive(bordersMergeRaw) as unknown as UnwrapRef<BordersMergeState>;
const sheetsOps = reactive(sheetsOpsRaw) as unknown as UnwrapRef<SheetsOpsState>;
// 直接用 sheetsOpsRaw 的顶层 ref 暴露给模板，避免 reactive 嵌套属性在 prop 传递时丢失响应式追踪
const sheets = sheetsOpsRaw.sheets;
const activeSheetIndex = sheetsOpsRaw.activeSheetIndex;
const sortMenuOpen = sheetsOpsRaw.sortMenuOpen;
const cachedSortOrder = sheetsOpsRaw.cachedSortOrder;
const outlineMenuOpen = ref(false);
const interactions = reactive(interactionsRaw) as unknown as UnwrapRef<InteractionsState>;
const findReplace = reactive(findReplaceRaw) as unknown as UnwrapRef<FindReplaceState>;

// 当前选区是否为单个单元格（计算下拉框的求和/平均值在单格时禁用，与右键菜单一致）
const isSingleCell = computed(() => {
  const sel = coreState.selection;
  return !!sel && sel.startCol === sel.endCol && sel.startRow === sel.endRow;
});

// 排序可用条件：与列右键菜单「排序」子项一致（合并单元格/公式阻断、需有可排数据）
const canSort = computed(() => {
  const sel = coreState.selection;
  if (!sel) return false;
  return sheetsOpsRaw.canSortColumns(sel.startCol, sel.endCol);
});

// 筛选可用条件：已存在筛选态（按钮选中态）时始终可用（点击即清除整个筛选）；
// 否则若选区命中任何跨多格合并单元格则禁用——合并单元格会破坏表头/数据探测，不应进入筛选态。
const canFilter = computed(() => {
  if (coreState.getFilter() !== null) return true;
  const sel = coreState.selection;
  if (!sel) return true;
  const sc = Math.min(sel.startCol, sel.endCol);
  const ec = Math.max(sel.startCol, sel.endCol);
  const sr = Math.min(sel.startRow, sel.endRow);
  const er = Math.max(sel.startRow, sel.endRow);
  for (const key in coreState.merges) {
    const m = coreState.merges[key]!;
    if (m.startCol === m.endCol && m.startRow === m.endRow) continue; // 单格不算合并
    if (sc <= m.endCol && ec >= m.startCol && sr <= m.endRow && er >= m.startRow) return false;
  }
  return true;
});

// 数字格式对话框初始格式：选区一致时用该格式；混合或自定义标记（NF_CUSTOM）时回退到活动单元格的真实格式代码，再不行则常规
const nfDialogCurrentFormat = computed(() => {
  const sel = undoStyles.selNumberFormat;
  if (sel !== NF_MIXED && sel !== NF_CUSTOM) return sel;
  const ac = coreState.activeCell;
  const st = coreStateRaw.resolveStyle(coreState.cells[coreState.cellKey(ac.col, ac.row)]);
  return typeof st?.numberFormat === 'string' ? st.numberFormat : '';
});

function setNfDialogOpen(v: boolean) {
  undoStylesRaw.nfDialogOpen.value = v;
}

// ============ 插入函数对话框 ============
const insertFuncOpen = ref(false);
function openInsertFunctionDialog() {
  insertFuncOpen.value = true;
}
function setInsertFuncOpen(v: boolean) {
  insertFuncOpen.value = v;
}
function onInsertFunction(text: string) {
  interactionsRaw.insertFunctionIntoCell(text);
}

// ============ 筛选开关（工具栏「筛选」按钮 / Ctrl+Shift+L） ============
// 切换整个 Sheet 的 AutoFilter：未启用时自动检测筛选范围（选区优先 → active cell 当前区域）→ 创建；
// 已启用时整体移除（恢复隐藏行、清除所有条件、移除表头箭头）。
function onToggleFilter() {
  coreState.toggleAutoFilter();
  interactions.scheduleRender();
}

// 当前筛选列 Header 单元格显示值（用于弹窗标题）；空则回退列字母
function filterHeaderLabel(col: number): string {
  const f = coreState.getFilter();
  if (!f) return '';
  return coreState.getCellValue(col, f.range.startRow);
}

// ============ 冻结窗格工具栏事件 ============
// 冻结点是否位于 A1（选区左上角或活动单元格为 (0,0) 时无上方/左侧可冻结）
const freezePanesDisabled = computed(() => {
  const sel = coreState.selection;
  const r = sel ? sel.startRow : coreState.activeCell.row;
  const c = sel ? sel.startCol : coreState.activeCell.col;
  return r === 0 && c === 0;
});

function onFreezeChange(v: string) {
  const cur = coreState.freeze;
  if (v === 'panes') {
    // 以选区/活动单元格的左上角作为冻结点（0-based：D5 -> { rows: 4, cols: 3 }）
    const sel = coreState.selection;
    const r = sel ? sel.startRow : coreState.activeCell.row;
    const c = sel ? sel.startCol : coreState.activeCell.col;
    coreState.setFreeze(r, c);
  } else if (v === 'firstRow') {
    coreState.setFreeze(1, cur.cols);
  } else if (v === 'firstCol') {
    coreState.setFreeze(cur.rows, 1);
  } else if (v === 'unfreeze') {
    coreState.clearFreeze();
  }
  interactions.scheduleRender();
}

// ============ 条件格式（Conditional Formatting）============
const toolbarRef = ref<InstanceType<typeof Toolbar> | null>(null);
const cfManagerOpen = ref(false);
const cfEditorOpen = ref(false);
const cfEditorRule = ref<ConditionalFormattingRule | null>(null);
const cfEditorMode = ref<'create' | 'edit'>('create');

// 新建规则的默认「应用于」范围：优先选区，否则活动单元格
const cfDefaultRangeText = computed(() => {
  const sel = coreState.selection;
  if (sel) {
    const a = colToLabel(sel.startCol) + (sel.startRow + 1);
    const b = colToLabel(sel.endCol) + (sel.endRow + 1);
    if (sel.startCol === sel.endCol && sel.startRow === sel.endRow) return a;
    return `${a}:${b}`;
  }
  const ac = coreState.activeCell;
  return colToLabel(ac.col) + (ac.row + 1);
});

function onCfPreset(type: string) {
  let condition: ConditionalFormattingCondition;
  const cellOps = ['equal', 'notEqual', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual', 'between', 'notBetween'];
  if (cellOps.includes(type)) {
    condition = { type: 'cellIs', operator: type as CellIsOperator, value: '' };
  } else if (type === 'textContains') {
    condition = { type: 'textContains', value: '' };
  } else if (type === 'textNotContains') {
    condition = { type: 'textNotContains', value: '' };
  } else if (type === 'blank') {
    condition = { type: 'blank' };
  } else if (type === 'notBlank') {
    condition = { type: 'notBlank' };
  } else if (type === 'duplicate') {
    condition = { type: 'duplicate' };
  } else if (type === 'unique') {
    condition = { type: 'unique' };
  } else {
    condition = { type: 'cellIs', operator: 'greaterThan', value: '' };
  }
  cfEditorRule.value = {
    id: '',
    condition,
    format: { backgroundColor: '#DEEBF7', color: '#17375E' },
    ranges: [],
    priority: 0,
    stopIfTrue: false,
    enabled: true,
  };
  cfEditorMode.value = 'create';
  toolbarRef.value?.closeOverflow();
  cfEditorOpen.value = true;
}

function onCfNew() {
  cfEditorRule.value = {
    id: '',
    condition: { type: 'cellIs', operator: 'greaterThan', value: '' },
    format: { backgroundColor: '#DEEBF7', color: '#17375E' },
    ranges: [],
    priority: 0,
    stopIfTrue: false,
    enabled: true,
  };
  cfEditorMode.value = 'create';
  toolbarRef.value?.closeOverflow();
  cfEditorOpen.value = true;
}

function onCfManage() {
  toolbarRef.value?.closeOverflow();
  cfManagerOpen.value = true;
}

function onCfClear(scope: 'selection' | 'sheet') {
  coreState.clearConditionalFormats(scope);
  interactions.scheduleRender();
}

function onCfSave(rule: ConditionalFormattingRule) {
  if (rule.id) {
    coreState.updateConditionalFormatRule(rule.id, rule);
  } else {
    coreState.addConditionalFormatRule(rule);
  }
  cfEditorOpen.value = false;
}

function onCfEdit(rule: ConditionalFormattingRule) {
  cfEditorRule.value = rule;
  cfEditorMode.value = 'edit';
  toolbarRef.value?.closeOverflow();
  cfEditorOpen.value = true;
}

function onCfDelete(id: string) {
  coreState.removeConditionalFormatRule(id);
}

function onCfMove(id: string, dir: 'up' | 'down') {
  coreState.moveConditionalFormatRule(id, dir);
}

function onCfToggle(id: string, enabled: boolean) {
  coreState.updateConditionalFormatRule(id, { enabled });
}

// ============ 数据验证（Data Validation）============
const dvDialogOpen = ref(false);
const dvDialogRule = ref<DataValidationRule | null>(null);
const dvDialogMode = ref<'create' | 'edit'>('create');

/** 打开对话框时的默认「应用于」：优先选区，否则活动单元格 */
const dvDefaultRangeText = computed(() => {
  const sel = coreState.selection;
  if (sel) {
    const a = colToLabel(sel.startCol) + (sel.startRow + 1);
    const b = colToLabel(sel.endCol) + (sel.endRow + 1);
    if (sel.startCol === sel.endCol && sel.startRow === sel.endRow) return a;
    return `${a}:${b}`;
  }
  const ac = coreState.activeCell;
  return colToLabel(ac.col) + (ac.row + 1);
});

/** 出错警告弹窗：Promise 化，便于 core-state 的输入链路 await 用户决策 */
const dvAlert = ref<{
  severity: DataValidationSeverity;
  title: string;
  message: string;
  col: number;
  row: number;
} | null>(null);
let dvAlertResolve: ((v: DataValidationAlertAction) => void) | null = null;

/** 由 core-state 注入：弹出出错警告并等待用户决策 */
function showValidationAlert(payload: {
  severity: DataValidationSeverity;
  title: string;
  message: string;
  col: number;
  row: number;
}): Promise<DataValidationAlertAction> {
  return new Promise((resolve) => {
    dvAlertResolve = resolve;
    dvAlert.value = { ...payload };
  });
}
coreStateRaw.showValidationAlert = showValidationAlert;

/** 分组校验提示（应用内对话框，与数据验证警告同一套视觉组件，替代 window.alert） */
const outlineAlert = ref<string | null>(null);
function showOutlineAlert(message: string) {
  outlineAlert.value = message;
}
function onOutlineAlertResolve() {
  outlineAlert.value = null;
}
interactionsRaw.showOutlineAlert = showOutlineAlert;

/** list 跨表引用：按 id 或名称定位工作表的 cells（当前表直接返回运行时 cells，保证读到最新值） */
coreStateRaw.getSheetCellsById = (sheetId: string) => {
  const idx = sheetsOpsRaw.sheets.value.findIndex((x) => x.id === sheetId || x.name === sheetId);
  if (idx < 0) return null;
  if (idx === sheetsOpsRaw.activeSheetIndex.value) return coreStateRaw.cells;
  return sheetsOpsRaw.sheets.value[idx]!.cells;
};

/** 右键菜单 / 工具栏入口：打开数据验证对话框 */
coreStateRaw.requestDataValidationDialog = () => openDataValidationDialog();

function openDataValidationDialog() {
  // 已有规则：按活动单元格命中加载，用户修改后更新原 Rule（不重复创建）
  const ac = coreState.activeCell;
  const existing = coreStateRaw.getDataValidationRule(ac.row, ac.col);
  dvDialogRule.value = existing ? JSON.parse(JSON.stringify(existing)) as DataValidationRule : null;
  dvDialogMode.value = existing ? 'edit' : 'create';
  toolbarRef.value?.closeOverflow();
  dvDialogOpen.value = true;
}

function onDvSave(rule: DataValidationRule) {
  // 「任何值」：按对话框中填写的范围清除数据验证（与 Excel 一致），不创建/更新规则
  if (rule.type === 'any') {
    rule.ranges.forEach((r) => coreStateRaw.clearDataValidation(r));
    dvDialogOpen.value = false;
    interactionsRaw.scheduleRender();
    return;
  }
  if (rule.id) {
    coreStateRaw.updateDataValidation(rule.id, rule);
  } else {
    coreStateRaw.createDataValidation(rule);
  }
  dvDialogOpen.value = false;
  interactionsRaw.scheduleRender();
}

function onDvClear() {
  const sel = coreState.selection;
  if (sel) coreStateRaw.clearDataValidation(sel);
  dvDialogOpen.value = false;
  interactionsRaw.scheduleRender();
}

function onDvAlertResolve(action: DataValidationAlertAction) {
  dvAlert.value = null;
  const resolve = dvAlertResolve;
  dvAlertResolve = null;
  // 编辑态被拦截：把焦点与选区交还给被编辑的单元格，便于用户直接修正
  nextTick(() => {
    const ec = coreState.editingCell;
    if (ec) {
      coreStateRaw.selectCell(ec.col, ec.row);
      coreStateRaw.ensureVisible(ec.col, ec.row);
      interactionsRaw.scheduleRender();
      sheetsOpsRaw.focusEditInput();
    }
  });
  resolve?.(action);
}

/** 输入信息提示：位置随活动单元格 / 滚动实时重算（复用 cellToScreenRect，兼容冻结与合并） */
const dvInputTip = computed(() => {
  const ac = coreState.activeCell;
  const msg = coreStateRaw.getValidationInputMessage(ac.row, ac.col);
  if (!msg) return null;
  const rect = coreStateRaw.cellToScreenRect(ac.row, ac.col);
  const wrapper = sheetsOpsRaw.wrapperRef.value;
  const offset = wrapper ? wrapper.getBoundingClientRect() : { left: 0, top: 0 };
  return {
    title: msg.title,
    message: msg.message,
    x: offset.left + rect.x,
    y: offset.top + rect.y,
    width: rect.width,
    height: rect.height,
  };
});

// ============ 模板赋值辅助函数（用于 @update:xxx 事件）============
function setFontSizeMenuOpen(v: boolean) {
  undoStylesRaw.fontSizeMenuOpen.value = v;
}
function setTextColorMenuOpen(v: boolean) {
  undoStylesRaw.textColorMenuOpen.value = v;
}
function setFillColorMenuOpen(v: boolean) {
  undoStylesRaw.fillColorMenuOpen.value = v;
}
/** 工具栏「分组」菜单动作 → 交互层 分组/取消分组/展开折叠/清除 */
function onOutlineAction(action: string) {
  switch (action) {
    case 'group-rows':
      interactionsRaw.outlineGroupRows();
      break;
    case 'group-cols':
      interactionsRaw.outlineGroupCols();
      break;
    case 'ungroup-rows':
      interactionsRaw.outlineUngroupRows();
      break;
    case 'ungroup-cols':
      interactionsRaw.outlineUngroupCols();
      break;
    case 'expand-all':
      interactionsRaw.outlineExpandRows();
      interactionsRaw.outlineExpandCols();
      break;
    case 'collapse-all':
      interactionsRaw.outlineCollapseRows();
      interactionsRaw.outlineCollapseCols();
      break;
    case 'clear':
      coreStateRaw.clearAllOutlines();
      break;
  }
}
function setRenTabVal(v: string) {
  interactionsRaw.renTabVal.value = v;
}
function setCtxMenuNull() {
  interactionsRaw.ctxMenu.value = null;
}

// 函数 ref 绑定（用于嵌套在 reactive 对象中的 ref）
const setFormulaBarRef = (el: unknown) => {
  sheetsOpsRaw.formulaBarRef.value = el as HTMLTextAreaElement | null;
};
function toggleFormulaBarExpanded() {
  interactionsRaw.formulaBarExpanded.value = !interactionsRaw.formulaBarExpanded.value;
}
/** 表格容器元素（响应式副本）：传给 Toolbar 作为弹出菜单的边界基准，
 *  使其嵌入宿主 Vue 页面时菜单不会越界盖住宿主内容。 */
const wrapperEl = ref<HTMLDivElement | null>(null);
const setWrapperRef = (el: unknown) => {
  sheetsOpsRaw.wrapperRef.value = el as HTMLDivElement | null;
  wrapperEl.value = el as HTMLDivElement | null;
};
const setCanvasRef = (el: unknown) => {
  sheetsOpsRaw.canvasRef.value = el as HTMLCanvasElement | null;
};
const setFreezeCanvasRef = (el: unknown) => {
  sheetsOpsRaw.freezeCanvasRef.value = el as HTMLCanvasElement | null;
};
const setEditInputRef = (el: unknown) => {
  sheetsOpsRaw.editInputRef.value = el as HTMLTextAreaElement | null;
};
const setDimInputRef = (el: unknown) => {
  interactionsRaw.dimInputRef.value = el as HTMLInputElement | null;
};
</script>

<template>
  <div
    class="spreadsheet-outer"
    :style="sheetsOps.outerStyle"
  >
    <!-- 工具栏 -->
    <Toolbar
      ref="toolbarRef"
      :locale="coreState.locale"
      :can-undo="undoStyles.canUndo"
      :can-redo="undoStyles.canRedo"
      :paint-fmt-active="undoStyles.paintFmt !== null"
      :has-selection="undoStyles.hasSelection"
      :font-family-options="undoStyles.fontFamilyOptions"
      :font-size-options="undoStyles.fontSizeOptions"
      :sel-font-family="undoStyles.selFontFamily"
      :sel-font-size="undoStyles.selFontSize"
      :font-size-input="undoStyles.fontSizeInput"
      :font-size-menu-open="undoStyles.fontSizeMenuOpen"
      :sel-font-weight="undoStyles.selFontWeight"
      :sel-font-style="undoStyles.selFontStyle"
      :sel-underline="undoStyles.selUnderline"
      :sel-strikethrough="undoStyles.selStrikethrough"
      :sel-text-color="undoStyles.selTextColor"
      :text-color-menu-open="undoStyles.textColorMenuOpen"
      :sel-fill-color="undoStyles.selFillColor"
      :fill-color-menu-open="undoStyles.fillColorMenuOpen"
      :cached-text-color="undoStyles.cachedTextColor"
      :cached-fill-color="undoStyles.cachedFillColor"
      :border-menu-open="bordersMerge.borderMenuOpen"
      :cached-border="bordersMerge.cachedBorder"
      :sort-menu-open="sortMenuOpen"
      :cached-sort-order="cachedSortOrder"
      :can-sort="canSort"
      :outline-menu-open="outlineMenuOpen"
      :can-filter="canFilter"
      :filter-active="coreState.getFilter() !== null"
      :h-align-options="undoStyles.hAlignOptions"
      :v-align-options="undoStyles.vAlignOptions"
      :sel-h-align="undoStyles.selHAlign"
      :sel-v-align="undoStyles.selVAlign"
      :sel-wrap="undoStyles.selWrap"
      :merge-menu-open="bordersMerge.mergeMenuOpen"
      :calc-menu-open="bordersMerge.calcMenuOpen"
      :is-single-cell="isSingleCell"
      :has-freeze="coreState.freeze.rows > 0 || coreState.freeze.cols > 0"
      :freeze-panes-disabled="freezePanesDisabled"
      :sel-number-format="undoStyles.selNumberFormatDisplay"
      :nf-options="undoStyles.nfOptions"
      :can-increase-decimals="undoStyles.canIncreaseDecimals"
      :can-decrease-decimals="undoStyles.canDecreaseDecimals"
      :boundary-el="wrapperEl"
      :theme-vars="sheetsOps.toolbarThemeVars"
      @undo="undoStyles.undo()"
      @redo="undoStyles.redo()"
      @paint-format="undoStyles.onPaintFormat"
      @clear-format="undoStyles.clearFormat()"
      @number-format-change="undoStyles.onNumberFormatChange($event)"
      @increase-decimals="undoStyles.onIncreaseDecimals"
      @decrease-decimals="undoStyles.onDecreaseDecimals"
      @font-family-change="undoStyles.onFontFamilyChange($event)"
      @font-size-input="undoStyles.onFontSizeInput($event)"
      @font-size-blur="undoStyles.onFontSizeBlur"
      @font-size-keydown="undoStyles.onFontSizeKeydown($event)"
      @font-size-change="undoStyles.onFontSizeChange($event)"
      @update:font-size-menu-open="setFontSizeMenuOpen($event)"
      @font-size-toggle="undoStyles.toggleFontSizeMenu()"
      @font-size-step-up="undoStyles.onFontSizeStepUp"
      @font-size-step-down="undoStyles.onFontSizeStepDown"
      @bold-toggle="undoStyles.toggleFontWeight"
      @italic-toggle="undoStyles.toggleFontStyle"
      @underline-toggle="undoStyles.toggleUnderline"
      @strikethrough-toggle="undoStyles.toggleStrikethrough"
      @text-color-change="undoStyles.onTextColorChange($event)"
      @update:text-color-menu-open="setTextColorMenuOpen($event)"
      @fill-color-change="undoStyles.onFillColorChange($event)"
      @update:fill-color-menu-open="setFillColorMenuOpen($event)"
      @apply-text-color="undoStyles.applyCachedTextColor"
      @apply-fill-color="undoStyles.applyCachedFillColor"
      @update:border-menu-open="undoStyles.onBorderMenuToggle($event)"
      @border-change="bordersMerge.onBorderChange($event)"
      @apply-border="bordersMerge.applyCachedBorder"
      @update:sort-menu-open="sheetsOps.onSortMenuToggle($event)"
      @sort-change="sheetsOps.onSortChange($event)"
      @apply-sort="sheetsOps.applyCachedSort"
      @update:outline-menu-open="outlineMenuOpen = $event"
      @outline-action="onOutlineAction($event)"
      @toggle-filter="onToggleFilter"
      @freeze-change="onFreezeChange($event)"
      @h-align-change="undoStyles.onHAlignChange($event)"
      @v-align-change="undoStyles.onVAlignChange($event)"
      @wrap-toggle="undoStyles.onWrapToggle"
      @update:merge-menu-open="bordersMerge.onMergeMenuToggle($event)"
      @merge-change="bordersMerge.onMergeChange($event)"
      @apply-merge="bordersMerge.onApplyMerge"
      @update:calc-menu-open="bordersMerge.onCalcMenuToggle($event)"
      @calc-sum="bordersMerge.onCalcSum"
      @calc-avg="bordersMerge.onCalcAvg"
      @calc-count="bordersMerge.onCalcCount"
      @find="findReplaceRaw.openFind()"
      @cf-preset="onCfPreset($event)"
      @cf-new-rule="onCfNew"
      @cf-manage="onCfManage"
      @cf-clear="onCfClear($event)"
      @open-data-validation="openDataValidationDialog"
    />

    <!-- 查找和替换栏 -->
    <FindReplaceBar
      :open="findReplace.open"
      :find-text="findReplace.findText"
      :replace-text="findReplace.replaceText"
      :scope="findReplace.scope"
      :match-case="findReplace.matchCase"
      :match-entire-cell="findReplace.matchEntireCell"
      :current-index="findReplace.currentIndex"
      :total="findReplace.results.length"
      :message="findReplace.message"
      :focus-token="findReplace.focusToken"
      :locale="coreState.locale"
      :theme-vars="sheetsOps.toolbarThemeVars"
      @update:find-text="findReplaceRaw.findText.value = $event"
      @update:replace-text="findReplaceRaw.replaceText.value = $event"
      @update:scope="findReplaceRaw.scope.value = $event"
      @update:match-case="findReplaceRaw.matchCase.value = $event"
      @update:match-entire-cell="findReplaceRaw.matchEntireCell.value = $event"
      @prev="findReplaceRaw.findPrev()"
      @next="findReplaceRaw.findNext()"
      @replace="findReplaceRaw.replace()"
      @replace-all="findReplaceRaw.replaceAll()"
      @close="findReplaceRaw.close()"
    />

    <!-- 数字格式配置对话框 -->
    <NumberFormatDialog
      :model-open="undoStyles.nfDialogOpen"
      :locale="coreState.locale"
      :current-format="nfDialogCurrentFormat"
      :is-custom="undoStyles.selNumberFormat === NF_CUSTOM"
      @update:model-open="setNfDialogOpen($event)"
      @apply="undoStyles.applyNumberFormatCode($event)"
    />

    <!-- 排序提醒对话框 -->
    <SortConfirmDialog
      :model-open="sheetsOps.sortConfirmOpen"
      :locale="coreState.locale"
      @update:model-open="sheetsOps.sortConfirmOpen = $event"
      @confirm="sheetsOps.confirmSort($event)"
      @cancel="sheetsOps.cancelSortConfirmation()"
    />

    <!-- 插入函数对话框 -->
    <InsertFunctionDialog
      :model-open="insertFuncOpen"
      :locale="coreState.locale"
      @update:model-open="setInsertFuncOpen($event)"
      @insert="onInsertFunction($event)"
    />

    <!-- 编辑栏 -->
    <div
      class="formula-bar"
      :class="{ 'formula-bar--expanded': interactions.formulaBarExpanded }"
    >
      <div class="formula-bar__cell-label">
        {{ interactions.activeCellLabel }}
      </div>
      <div class="formula-bar__buttons">
        <button
          type="button"
          class="formula-bar__btn formula-bar__btn--cancel"
          title="取消（Esc）"
          aria-label="取消"
          @mousedown.prevent
          @click.stop="interactions.cancelFormulaBarEdit"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden="true"
          >
            <path
              d="M3 3l8 8M11 3l-8 8"
              fill="none"
              stroke="#e53935"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="formula-bar__btn formula-bar__btn--accept"
          title="接受（Enter）"
          aria-label="接受"
          @mousedown.prevent
          @click.stop="interactions.acceptFormulaBarEdit"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden="true"
          >
            <path
              d="M2.5 7.5l3.5 3.5L12 3.5"
              fill="none"
              stroke="#2e7d32"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="formula-bar__btn formula-bar__btn--fx"
          :title="t(coreState.locale, 'insertFunctionTitle')"
          :aria-label="t(coreState.locale, 'insertFunctionTitle')"
          @mousedown.prevent
          @click.stop="openInsertFunctionDialog"
        >
          <span class="formula-bar__fx-label">fx</span>
        </button>
      </div>
      <textarea
        :ref="setFormulaBarRef"
        class="formula-bar__input"
        :class="{ 'formula-bar__input--expanded': interactions.formulaBarExpanded }"
        :rows="interactions.formulaBarExpanded ? 3 : 1"
        :value="interactions.formulaBarDisplay"
        spellcheck="false"
        @focus="interactions.onFormulaBarFocus"
        @input="interactions.onFormulaBarInput"
        @keydown="interactions.onFormulaBarKeydown"
        @blur="interactions.onFormulaBarBlur"
      />
      <button
        type="button"
        class="formula-bar__toggle"
        :title="interactions.formulaBarExpanded ? '折叠为1行' : '展开为3行'"
        @mousedown.prevent
        @click.stop="toggleFormulaBarExpanded"
      >
        <svg
          v-if="!interactions.formulaBarExpanded"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        ><path
          d="M2 4l4 4 4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg>
        <svg
          v-else
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        ><path
          d="M2 8l4-4 4 4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg>
      </button>
    </div>

    <div
      :ref="setWrapperRef"
      class="spreadsheet-wrapper"
    >
      <canvas
        :ref="setCanvasRef"
        class="grid-canvas"
        tabindex="0"
        @mousedown="interactions.onMouseDown"
        @mousemove="interactions.onMouseMove"
        @mouseup="interactions.onMouseUp"
        @mouseleave="interactions.onMouseLeave"
        @dblclick="interactions.onDblClick"
        @wheel.prevent="interactions.onWheel"
        @focus="sheetsOps.onCanvasFocus"
        @keydown="interactions.onKeydown"
        @contextmenu="interactions.onCanvasCtx"
        @touchstart.prevent="interactions.onTouchStart"
        @touchmove.prevent="interactions.onTouchMove"
        @touchend="interactions.onTouchEnd"
      />
      <canvas
        :ref="setFreezeCanvasRef"
        class="grid-canvas grid-canvas--freeze"
        aria-hidden="true"
      />
      <textarea
        :ref="setEditInputRef"
        class="cell-editor"
        :value="coreState.editValue"
        :style="interactions.editInputStyle"
        @input="interactions.onEditInput"
        @keydown="interactions.onEditKd"
        @compositionstart="interactions.onEditCompositionStart"
        @compositionend="interactions.onEditCompositionEnd"
        @blur="interactions.onEditBlur"
        @paste="interactions.onEditPaste"
      />
      <!-- 垂直滚动条 -->
      <div
        v-if="sheetsOps.maxScrollY > 0"
        class="v-scrollbar"
        :style="{ top: interactions.vScrollbarTop + 'px', height: `calc(100% - ${interactions.vScrollbarTop + SB_SIZE}px)` }"
      >
        <button
          class="sb-btn sb-btn--up"
          title=""
          @mousedown.prevent="sheetsOps.clampScroll(null, coreState.scrollY - 50); interactions.scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--up" />
        </button>
        <div
          class="sb-track sb-track--v"
          @mousedown="interactions.onVTrk"
        >
          <div
            class="sb-thumb sb-thumb--v"
            :style="{ top: interactions.vThumbT + 'px', height: interactions.vThumbH + 'px' }"
            @mousedown="interactions.onVStart"
          />
        </div>
        <button
          class="sb-btn sb-btn--down"
          @mousedown.prevent="sheetsOps.clampScroll(null, coreState.scrollY + 50); interactions.scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--down" />
        </button>
      </div>
      <!-- 水平滚动条 -->
      <div
        v-if="sheetsOps.maxScrollX > 0"
        class="h-scrollbar"
        :style="{ left: interactions.hScrollbarLeft + 'px', width: `calc(100% - ${interactions.hScrollbarLeft + SB_SIZE}px)` }"
      >
        <button
          class="sb-btn sb-btn--left"
          @mousedown.prevent="sheetsOps.clampScroll(coreState.scrollX - 50, null); interactions.scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--left" />
        </button>
        <div
          class="sb-track sb-track--h"
          @mousedown="interactions.onHTrk"
        >
          <div
            class="sb-thumb sb-thumb--h"
            :style="{ left: interactions.hThumbL + 'px', width: interactions.hThumbW + 'px' }"
            @mousedown="interactions.onHStart"
          />
        </div>
        <button
          class="sb-btn sb-btn--right"
          @mousedown.prevent="sheetsOps.clampScroll(coreState.scrollX + 50, null); interactions.scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--right" />
        </button>
      </div>
      <div
        v-if="sheetsOps.maxScrollX > 0 && sheetsOps.maxScrollY > 0"
        class="sb-corner"
      />
    </div>

    <!-- Sheet 标签栏 -->
    <Tabbar
      :locale="coreState.locale"
      :sheets="sheets"
      :active-sheet-index="activeSheetIndex"
      :ren-tab="interactions.renTab"
      :ren-tab-val="interactions.renTabVal"
      @tab-click="interactions.onTabClick($event)"
      @tab-dblclick="interactions.onTabDblClick($event)"
      @tab-contextmenu="interactions.onTabCtxMenu($event.ev, $event.i)"
      @tab-rename-input="setRenTabVal($event)"
      @tab-rename-keydown="interactions.onTabRenameKd($event)"
      @tab-rename-commit="interactions.commitTabRename"
      @tabbar-contextmenu="interactions.onTabBarCtx($event)"
      @delete-sheet="
        sheetsOps.removeSheet($event);
        interactions.scheduleRender();
      "
      @add-sheet="
        sheetsOps.addSheet();
        interactions.scheduleRender();
      "
    />

    <!-- 右键菜单 -->
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="interactions.ctxMenu"
          class="context-menu"
          :style="{ left: interactions.ctxMenu.x + 'px', top: interactions.ctxMenu.y + 'px' }"
          @click.stop
        >
          <template
            v-for="(item, i) in interactions.ctxMenu.items"
            :key="i"
          >
            <div
              class="context-menu__item"
              :class="{ 'context-menu__item--disabled': item.disabled }"
              @click="!item.disabled && item.action && (item.action(), setCtxMenuNull())"
              @mouseenter="interactions.onCtxItemEnter($event, item)"
            >
              <span class="context-menu__label">{{ item.label }}</span>
              <svg
                v-if="item.children"
                class="context-menu__arrow"
                viewBox="0 0 1024 1024"
                version="1.1"
                xmlns="http://www.w3.org/2000/svg"
                p-id="22869"
              >
                <path
                  d="M361.386667 180.053333a32 32 0 0 0 0 45.226667L648.106667 512l-286.72 286.72a32 32 0 1 0 45.226666 45.226667l309.333334-309.333334a32 32 0 0 0 0-45.226666L406.613333 180.053333a32 32 0 0 0-45.226666 0z"
                  p-id="22870"
                />
              </svg>
              <div
                v-if="item.children"
                class="context-submenu"
                :class="{ 'context-submenu--left': interactions.ctxSubmenuLeft }"
              >
                <div
                  v-for="(child, j) in item.children"
                  :key="j"
                  class="context-menu__item"
                  :class="{ 'context-menu__item--disabled': child.disabled }"
                  @click.stop="!child.disabled && child.action && (child.action(), setCtxMenuNull())"
                >
                  {{ child.label }}
                </div>
              </div>
            </div>
          </template>
        </div>
      </Transition>
    </Teleport>

    <!-- 筛选弹窗 -->
    <FilterPopup
      v-if="interactions.filterPopup"
      :key="interactions.filterPopup.col"
      :col="interactions.filterPopup.col"
      :header-label="filterHeaderLabel(interactions.filterPopup.col)"
      :anchor="{ x: interactions.filterPopup.x, y: interactions.filterPopup.y }"
      :locale="coreState.locale"
      :get-filter="coreState.getFilter"
      :set-filter="coreState.setFilter"
      :set-filter-column="coreState.setFilterColumn"
      :clear-filter-column="coreState.clearFilterColumn"
      :get-column-candidates="coreState.getColumnCandidates"
      :close="interactions.closeFilterPopup"
    />

    <!-- 条件格式管理器 -->
    <Teleport to="body">
      <div
        v-if="cfManagerOpen"
        class="cf-modal-mask"
        @click.self="cfManagerOpen = false"
      >
        <ConditionalFormatManager
          :locale="coreState.locale"
          :rules="coreState.conditionalFormats"
          :theme-vars="sheetsOps.toolbarThemeVars"
          @new="onCfNew"
          @edit="onCfEdit"
          @delete="onCfDelete"
          @move="onCfMove"
          @toggle="onCfToggle"
          @close="cfManagerOpen = false"
        />
      </div>
    </Teleport>

    <!-- 条件格式规则编辑器 -->
    <Teleport to="body">
      <div
        v-if="cfEditorOpen"
        class="cf-modal-mask"
        @click.self="cfEditorOpen = false"
      >
        <ConditionalFormatRuleEditor
          :locale="coreState.locale"
          :mode="cfEditorMode"
          :rule="cfEditorRule"
          :default-range-text="cfDefaultRangeText"
          :theme-vars="sheetsOps.toolbarThemeVars"
          @save="onCfSave"
          @cancel="cfEditorOpen = false"
        />
      </div>
    </Teleport>

    <!-- 数据验证下拉列表（List Validation） -->
    <DataValidationDropdown
      v-if="interactions.validationDropdown"
      :key="`${interactions.validationDropdown.col},${interactions.validationDropdown.row}`"
      :items="interactions.validationDropdown.items"
      :current="interactions.validationDropdown.current"
      :locale="coreState.locale"
      :x="interactions.validationDropdown.x"
      :y="interactions.validationDropdown.y"
      :width="interactions.validationDropdown.width"
      :height="interactions.validationDropdown.height"
      @select="interactionsRaw.onValidationDropdownSelect($event)"
      @close="interactionsRaw.closeValidationDropdown()"
    />

    <!-- 数据验证输入信息提示 -->
    <DataValidationInputMessage
      v-if="dvInputTip"
      :title="dvInputTip.title"
      :message="dvInputTip.message"
      :x="dvInputTip.x"
      :y="dvInputTip.y"
      :width="dvInputTip.width"
      :height="dvInputTip.height"
    />

    <!-- 数据验证对话框 -->
    <Teleport to="body">
      <div
        v-if="dvDialogOpen"
        class="cf-modal-mask"
        @click.self="dvDialogOpen = false"
      >
        <DataValidationDialog
          :locale="coreState.locale"
          :mode="dvDialogMode"
          :rule="dvDialogRule"
          :default-range-text="dvDefaultRangeText"
          :theme-vars="sheetsOps.toolbarThemeVars"
          @save="onDvSave"
          @clear="onDvClear"
          @cancel="dvDialogOpen = false"
        />
      </div>
    </Teleport>

    <!-- 数据验证出错警告 -->
    <Teleport to="body">
      <div
        v-if="dvAlert"
        class="cf-modal-mask"
      >
        <DataValidationAlert
          :locale="coreState.locale"
          :severity="dvAlert.severity"
          :title="dvAlert.title"
          :message="dvAlert.message"
          :theme-vars="sheetsOps.toolbarThemeVars"
          @resolve="onDvAlertResolve"
        />
      </div>
    </Teleport>

    <!-- 分组校验提示（应用内对话框，替代 window.alert） -->
    <Teleport to="body">
      <div
        v-if="outlineAlert"
        class="cf-modal-mask"
      >
        <DataValidationAlert
          :locale="coreState.locale"
          severity="information"
          :title="t(coreState.locale, 'outlineAlertTitle')"
          :message="outlineAlert"
          :theme-vars="sheetsOps.toolbarThemeVars"
          @resolve="onOutlineAlertResolve"
        />
      </div>
    </Teleport>

    <!-- 行高/列宽浮动设置栏 -->
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="interactions.dimPanel"
          class="dim-panel"
          :style="{ left: interactions.dimPanel.x + 'px', top: interactions.dimPanel.y + 'px' }"
          @mousedown.stop
          @touchstart.stop
          @click.stop
        >
          <div class="dim-panel__title">
            {{ interactions.dimPanel.type === 'row' ? '行高' : '列宽' }}
          </div>
          <div class="dim-panel__body">
            <input
              :ref="setDimInputRef"
              class="dim-panel__input"
              :class="{ 'dim-panel__input--error': interactions.dimPanel.error }"
              type="number"
              step="1"
              min="1"
              inputmode="numeric"
              :value="interactions.dimPanel.value"
              @input="interactions.onDimInput"
              @keydown="interactions.onDimKeydown"
              @blur="interactions.onDimBlur"
            >
          </div>
          <div
            v-if="interactions.dimPanel.error"
            class="dim-panel__error"
          >
            {{ interactions.dimPanel.error }}
          </div>
          <div class="dim-panel__footer">
            <button
              class="dim-panel__btn dim-panel__btn--primary"
              @click="interactions.applyDimPanel"
            >
              确定
            </button>
            <button
              class="dim-panel__btn"
              @click="interactions.closeDimPanel"
            >
              取消
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.spreadsheet-outer { flex: 1; display: flex; flex-direction: column; overflow: hidden; height: 100%; min-height: 400px; width: 100%; }
.formula-bar { display: flex; align-items: flex-start; min-height: 36px; padding: 0; gap: 0; }
.formula-bar--expanded { min-height: 72px; }
.formula-bar__cell-label { width: 48px; min-width: 48px; height: 28px; line-height: 28px; margin-top: 4px; text-align: center; font-size: 12px; font-weight: 600; color: var(--sp-formula-bar-label-color); background: var(--sp-formula-bar-label-bg); border: 1px solid var(--sp-formula-bar-label-border); border-radius: 2px; user-select: none; }
.formula-bar__buttons { display: inline-flex; align-items: stretch; margin-top: 4px; margin-left: 6px; height: 28px; border: 1px solid var(--sp-formula-bar-input-border); border-radius: 2px; overflow: hidden; background: var(--sp-formula-bar-input-bg); }
.formula-bar__btn { width: 22px; height: 28px; border: none; border-radius: 0; background: transparent; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; user-select: none; color: inherit; }
.formula-bar__btn + .formula-bar__btn { border-left: 1px solid var(--sp-formula-bar-input-border); }
.formula-bar__btn:hover { background: var(--sp-scroll-btn-hover-bg, #f0f0f0); }
.formula-bar__btn--cancel:hover { color: #e53935; background: #fdecea; }
.formula-bar__btn--accept:hover { color: #2e7d32; background: #e8f5e9; }
.formula-bar__fx-label {
  font-family: Georgia, "Times New Roman", serif;
  font-style: italic;
  font-weight: 600;
  font-size: 13px;
  line-height: 1;
  user-select: none;
}
.formula-bar__btn--fx:hover { background: var(--sp-scroll-btn-hover-bg, #f0f0f0); }
.formula-bar__input { flex: 1; min-height: 28px; height: 28px; line-height: 20px; margin-top: 4px; border: 1px solid var(--sp-formula-bar-input-border); border-radius: 2px; outline: none; padding: 3px 6px; margin-left: 4px; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; color: var(--sp-formula-bar-input-color); background: var(--sp-formula-bar-input-bg); resize: none; overflow: hidden; box-sizing: border-box; }
.formula-bar__input--expanded { height: 68px; overflow: auto; }
.formula-bar__input:focus { border-color: var(--sp-formula-bar-input-focus-border); box-shadow: 0 0 0 1px var(--sp-formula-bar-input-focus-shadow); }
.formula-bar__toggle { width: 22px; min-width: 22px; height: 28px; margin-top: 4px; margin-left: 2px; margin-right: 2px; border: 1px solid var(--sp-formula-bar-input-border); border-radius: 2px; background: var(--sp-formula-bar-input-bg); color: var(--sp-formula-bar-input-color); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; user-select: none; }
.formula-bar__toggle:hover { background: var(--sp-scroll-btn-hover-bg, #e8e8e8); }
.spreadsheet-wrapper { flex: 1; position: relative; overflow: hidden; background: var(--sp-wrapper-bg); }
.grid-canvas { position: absolute; top: 0; left: 0; display: block; outline: none; cursor: cell; }
.grid-canvas--freeze { pointer-events: none; z-index: 1; }
.grid-canvas:not(.grid-canvas--freeze) { z-index: 0; }
.grid-canvas:focus { outline: none; }
.v-scrollbar { position: absolute; right: 0; top: 0; width: 11px; height: calc(100% - 11px); display: flex; flex-direction: column; background: var(--sp-wrapper-bg); }
.h-scrollbar { position: absolute; left: 0; bottom: 0; height: 11px; width: calc(100% - 11px); display: flex; background: var(--sp-wrapper-bg); }
.sb-corner { position: absolute; right: 0; bottom: 0; width: 11px; height: 11px; background: var(--sp-wrapper-bg); }
.sb-btn { width: 11px; height: 11px; min-width: 11px; min-height: 11px; border: none; background: var(--sp-scroll-btn-bg, #e8e8e8); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; user-select: none; }
.sb-btn:hover { background: var(--sp-scroll-btn-hover-bg, #d0d0d0); }
.sb-btn:active { background: var(--sp-scroll-btn-active-bg, #c0c0c0); }
.sb-arrow { display: block; width: 0; height: 0; }
.sb-arrow--up { border-left: 3px solid transparent; border-right: 3px solid transparent; border-bottom: 4px solid var(--sp-scroll-btn-color, #666); }
.sb-arrow--down { border-left: 3px solid transparent; border-right: 3px solid transparent; border-top: 4px solid var(--sp-scroll-btn-color, #666); }
.sb-arrow--left { border-top: 3px solid transparent; border-bottom: 3px solid transparent; border-right: 4px solid var(--sp-scroll-btn-color, #666); }
.sb-arrow--right { border-top: 3px solid transparent; border-bottom: 3px solid transparent; border-left: 4px solid var(--sp-scroll-btn-color, #666); }
.sb-track { flex: 1; position: relative; background: var(--sp-scroll-track-bg, rgba(0,0,0,0.06)); }
.sb-track--v { width: 11px; }
.sb-track--h { height: 11px; }
.sb-thumb { position: absolute; border-radius: 3px; background: var(--sp-scroll-thumb); cursor: default; }
.sb-thumb:hover { background: var(--sp-scroll-thumb-hover); }
.sb-thumb--v { left: 1px; right: 1px; min-height: 16px; }
.sb-thumb--h { top: 1px; bottom: 1px; min-width: 16px; }
.cell-editor { position: absolute; border: 2px solid var(--sp-cell-editor-border); outline: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; color: var(--sp-cell-editor-color); background: var(--sp-cell-editor-bg); box-shadow: 0 0 0 1px var(--sp-cell-editor-shadow); z-index: 10; box-sizing: border-box; min-width: 0; overflow: hidden; padding: 0; margin: 0; -webkit-appearance: none; appearance: none; resize: none; white-space: pre-wrap; word-break: break-all; }
</style>

<style>
.context-menu { position: fixed; z-index: 10000; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 4px 0; min-width: 120px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; transform-origin: top left; }
.context-menu__item { padding: 6px 12px; cursor: pointer; color: #333; white-space: nowrap; position: relative; display: flex; align-items: center; justify-content: space-between; }
.context-menu__item:hover { background: #e8f0fe; }
.context-menu__item--disabled { color: #bbb; cursor: default; }
.context-menu__item--disabled:hover { background: transparent; }
.context-menu__arrow { margin-left: 8px; margin-right: -2px; width: 12px; height: 12px; fill: #888; flex: none; }
/* top:-5px = 向下弹出时相对父项上移 1px 后的对齐值；向上弹出时由 interactions.ts 的
   predictCtxSubmenuDir() inline 写 bottom:-5px（等距下移）。两处需保持同步。 */
.context-submenu { display: none; position: absolute; left: 100%; top: -5px; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 4px 0; min-width: 100px; z-index: 10001; }
.context-submenu--left { left: auto; right: 100%; }
.context-menu__item:not(.context-menu__item--disabled):hover > .context-submenu { display: block; }
.context-submenu .context-menu__item { justify-content: flex-start; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }

/* 行高/列宽浮动设置栏 */
.dim-panel { position: fixed; z-index: 10002; width: 220px; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 10px 12px; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; user-select: none; transform-origin: top left; }
.dim-panel__title { font-size: 13px; font-weight: 600; color: #333; margin-bottom: 8px; }
.dim-panel__body { display: flex; align-items: center; gap: 6px; }
.dim-panel__input { flex: 1; height: 26px; border: 1px solid #c0c0c0; border-radius: 3px; outline: none; padding: 0 6px; font-size: 13px; color: #1a1a1a; background: #fff; box-sizing: border-box; }
.dim-panel__input:focus { border-color: #0078d7; box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3); }
.dim-panel__input--error { border-color: #d93025; box-shadow: 0 0 0 1px rgba(217, 48, 37, 0.3); }
.dim-panel__error { margin-top: 6px; font-size: 12px; color: #d93025; line-height: 1.4; }
.dim-panel__footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.dim-panel__btn { height: 26px; padding: 0 14px; border: 1px solid #ccc; border-radius: 3px; background: #fff; color: #333; font-size: 13px; cursor: pointer; }
.dim-panel__btn:hover { background: #f0f0f0; }
.dim-panel__btn--primary { border-color: #0078d7; background: #0078d7; color: #fff; }
.dim-panel__btn--primary:hover { background: #0069c0; }

/* 条件格式对话框遮罩（Teleport 到 body，scoped 无法穿透） */
.cf-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10003;
}
</style>
