import { ref, reactive, computed, watch, nextTick, type Ref, type ComputedRef } from 'vue';
import { DEFAULT_COL_WIDTH, lightTheme, darkTheme } from '../core/constants';
import type { ThemeColors, SheetState, SheetModelData  } from '../core/types';
import { resolveSize } from '../core/utils';
import { buildOuterStyle } from '../core/theme';
import type { CoreState } from './core-state';
import type { UndoStylesState } from './undo-styles';

export interface SheetsOpsState {
  // 行列增删
  deleteRows: (rS: number, rE: number) => void;
  insertRows: (rS: number, rE: number) => void;
  insertCols: (cS: number, cE: number) => void;
  deleteCols: (cS: number, cE: number) => void;

  // 多 Sheet 管理
  sheets: Ref<SheetState[]>;
  activeSheetIndex: Ref<number>;
  saveSheet: () => void;
  loadSheet: (i: number) => void;
  switchSheet: (i: number) => void;
  addSheet: (n?: string) => number;
  removeSheet: (i: number) => number;
  renameSheet: (i: number, n: string) => void;
  dupSheet: (i: number) => number;
  moveSheet: (i: number, d: number) => void;
  sheetCount: ComputedRef<number>;
  mkSheet: (name: string) => SheetState;

  // v-model emit
  emitModelData: () => void;
  scheduleOptEmit: () => void;

  // 主题 & CSS
  themeColors: ComputedRef<ThemeColors>;
  outerStyle: ComputedRef<Record<string, string>>;
  toolbarThemeVars: ComputedRef<Record<string, string>>;

  // 模板 refs & 滚动控制
  wrapperRef: Ref<HTMLDivElement | null>;
  canvasRef: Ref<HTMLCanvasElement | null>;
  editInputRef: Ref<HTMLTextAreaElement | null>;
  formulaBarRef: Ref<HTMLInputElement | null>;
  viewSize: { w: number; h: number };
  maxScrollX: ComputedRef<number>;
  maxScrollY: ComputedRef<number>;
  clampScroll: (sx: number | null, sy: number | null) => void;
  canFocusHiddenEditor: () => boolean;
  focusEditInput: (selectAllText?: boolean) => void;
  onCanvasFocus: () => void;

  // 行高/列宽重置
  resetRowHeight: () => void;
  resetColWidth: () => void;

  // 外部 modelData
  modelData: Ref<SheetModelData[]>;
}

export function createSheetsOps(
  s: CoreState,
  us: UndoStylesState,
  rawModelData: Ref<SheetModelData[]>,
  _applySizeCallback?: () => void,
  lastEmittedDataRef?: { value: string },
): SheetsOpsState {
  // ============ 行/列插入/删除 ============
  function deleteRows(rS: number, rE: number) {
    const dr = rE - rS + 1;
    for (let r = rS; r <= rE; r++) {
      for (let c = 0; c < s.colCount; c++) s.delCell(s.cellKey(c, r));
    }
    for (let r = rS; r < s.rowCount - dr; r++) {
      for (let c = 0; c < s.colCount; c++) {
        const sk = s.cellKey(c, r + dr), dk = s.cellKey(c, r);
        if (s.cells[sk]) {
          s.cells[dk] = s.cells[sk]!;
          s.delCell(sk);
        } else {
          s.delCell(dk);
        }
      }
      s.rowHeights.value[r] = s.rowHeights.value[r + dr];
    }
    for (let r = s.rowCount - dr; r < s.rowCount; r++) {
      for (let c = 0; c < s.colCount; c++) s.delCell(s.cellKey(c, r));
      s.rowHeights.value[r] = undefined;
    }
    if (rS > 0) {
      for (let c = 0; c < s.colCount; c++) {
        s.syncCellBorders?.(c, rS - 1);
        s.syncCellBorders?.(c, rS);
      }
    }
  }

  function insertRows(rS: number, rE: number) {
    const n = rE - rS + 1;
    if (rE >= s.rowCount - 1) return;
    for (let r = s.rowCount - 1; r > rE; r--) {
      for (let c = 0; c < s.colCount; c++) {
        const sk = s.cellKey(c, r - n), dk = s.cellKey(c, r);
        if (s.cells[sk]) s.cells[dk] = s.cells[sk]!;
        else s.delCell(dk);
      }
      s.rowHeights.value[r] = s.rowHeights.value[r - n];
    }
    for (let r = rE + 1; r <= rE + n; r++) {
      for (let c = 0; c < s.colCount; c++) s.delCell(s.cellKey(c, r));
      s.rowHeights.value[r] = undefined;
    }
  }

  function insertCols(cS: number, cE: number) {
    const n = cE - cS + 1;
    if (cE >= s.colCount - 1) return;
    for (let c = s.colCount - 1; c > cE; c--) {
      for (let r = 0; r < s.rowCount; r++) {
        const sk = s.cellKey(c - n, r), dk = s.cellKey(c, r);
        if (s.cells[sk]) s.cells[dk] = s.cells[sk]!;
        else s.delCell(dk);
      }
      s.colWidths.value[c] = s.colWidths.value[c - n]!;
    }
    for (let c = cE + 1; c <= cE + n; c++) {
      for (let r = 0; r < s.rowCount; r++) s.delCell(s.cellKey(c, r));
      s.colWidths.value[c] = DEFAULT_COL_WIDTH;
    }
  }

  function deleteCols(cS: number, cE: number) {
    const dc = cE - cS + 1;
    for (let c = cS; c <= cE; c++) {
      for (let r = 0; r < s.rowCount; r++) s.delCell(s.cellKey(c, r));
    }
    for (let c = cS; c < s.colCount - dc; c++) {
      for (let r = 0; r < s.rowCount; r++) {
        const sk = s.cellKey(c + dc, r), dk = s.cellKey(c, r);
        if (s.cells[sk]) {
          s.cells[dk] = s.cells[sk]!;
          s.delCell(sk);
        } else {
          s.delCell(dk);
        }
      }
      s.colWidths.value[c] = s.colWidths.value[c + dc]!;
    }
    for (let c = s.colCount - dc; c < s.colCount; c++) {
      for (let r = 0; r < s.rowCount; r++) s.delCell(s.cellKey(c, r));
      s.colWidths.value[c] = DEFAULT_COL_WIDTH;
    }
    if (cS > 0) {
      for (let r = 0; r < s.rowCount; r++) {
        s.syncCellBorders?.(cS - 1, r);
        s.syncCellBorders?.(cS, r);
      }
    }
  }

  // ============ 多 Sheet 管理 ============
  let sidN = 0;
  function nid() {
    sidN++;
    return `s_${sidN}`;
  }
  function mkSheet(name: string): SheetState {
    return {
      id: nid(), name, cells: {}, merges: {},
      selection: { startCol: 0, startRow: 0, endCol: 0, endRow: 0 },
      activeCell: { col: 0, row: 0 },
      scrollX: 0, scrollY: 0,
      colWidths: new Array(s.colCount).fill(DEFAULT_COL_WIDTH),
      rowHeights: new Array(s.rowCount).fill(undefined),
    };
  }
  const sheets = ref<SheetState[]>([mkSheet('Sheet1')]);
  const activeSheetIndex = ref(0);

  function saveSheet() {
    const sh = sheets.value[activeSheetIndex.value];
    if (!sh) return;
    sh.cells = { ...s.cells };
    sh.merges = { ...s.merges };
    sh.selection = s.selection.value ? { ...s.selection.value } : null;
    sh.activeCell = { ...s.activeCell.value };
    sh.scrollX = s.scrollX.value;
    sh.scrollY = s.scrollY.value;
    sh.colWidths = [...s.colWidths.value];
    sh.rowHeights = [...s.rowHeights.value];
  }

  function loadSheet(i: number) {
    const sh = sheets.value[i];
    if (!sh) return;
    Object.keys(s.cells).forEach((k) => s.delCell(k));
    Object.assign(s.cells, sh.cells);
    Object.keys(s.merges).forEach((k) => Reflect.deleteProperty(s.merges, k));
    if (sh.merges) Object.assign(s.merges, sh.merges);
    s.selection.value = sh.selection ? { ...sh.selection } : null;
    s.activeCell.value = { ...sh.activeCell };
    s.scrollX.value = sh.scrollX;
    s.scrollY.value = sh.scrollY;
    s.colWidths.value = [...sh.colWidths];
    s.rowHeights.value = [...sh.rowHeights];
    activeSheetIndex.value = i;
  }

  function switchSheet(i: number) {
    if (i === activeSheetIndex.value || i < 0 || i >= sheets.value.length) return;
    s.cancelEdit();
    saveSheet();
    loadSheet(i);
  }

  function addSheet(n?: string): number {
    us.saveUndo();
    s.cancelEdit();
    saveSheet();
    sheets.value.push(mkSheet(n ?? `Sheet${sheets.value.length + 1}`));
    loadSheet(sheets.value.length - 1);
    return sheets.value.length - 1;
  }

  function removeSheet(i: number): number {
    if (sheets.value.length <= 1) return activeSheetIndex.value;
    us.saveUndo();
    s.cancelEdit();
    sheets.value.splice(i, 1);
    loadSheet(Math.min(i, sheets.value.length - 1));
    return activeSheetIndex.value;
  }

  function renameSheet(i: number, n: string) {
    if (sheets.value[i] && n.trim()) {
      us.saveUndo();
      sheets.value[i]!.name = n.trim();
    }
  }

  function dupSheet(i: number): number {
    us.saveUndo();
    s.cancelEdit();
    saveSheet();
    const src = sheets.value[i];
    if (!src) return i;
    let bn = src.name;
    const m = bn.match(/^(.*?)\s*\((\d+)\)$/);
    let n = m ? parseInt(m[2]!, 10) + 1 : 2;
    if (m) bn = m[1]!;
    let nn = `${bn} (${n})`;
    const names = new Set(sheets.value.map((x) => x.name));
    while (names.has(nn)) {
      n++;
      nn = `${bn} (${n})`;
    }
    const cp: SheetState = {
      id: nid(), name: nn, cells: { ...src.cells },
      merges: src.merges ? { ...src.merges } : {},
      selection: src.selection ? { ...src.selection } : null,
      activeCell: src.activeCell ? { ...src.activeCell } : { col: 0, row: 0 },
      scrollX: src.scrollX, scrollY: src.scrollY,
      colWidths: [...src.colWidths], rowHeights: [...src.rowHeights],
    };
    sheets.value.splice(i + 1, 0, cp);
    loadSheet(i + 1);
    return i + 1;
  }

  function moveSheet(i: number, d: number) {
    const ni = i + d;
    if (ni < 0 || ni >= sheets.value.length) return;
    us.saveUndo();
    const cur = activeSheetIndex.value;
    const src = sheets.value.splice(i, 1)[0]!;
    sheets.value.splice(ni, 0, src);
    if (cur === i) activeSheetIndex.value = ni;
    else if (i < cur && ni >= cur) activeSheetIndex.value = cur - 1;
    else if (i > cur && ni <= cur) activeSheetIndex.value = cur + 1;
    s.scheduleRender?.();
  }

  const sheetCount = computed(() => sheets.value.length);

  // ============ v-model emit ============
  let lastEmittedData = '';
  const modelData = rawModelData;

  function emitModelData() {
    saveSheet();
    const out: SheetModelData[] = sheets.value.map((sh) => {
      const cs: Record<string, { value: string; style?: Record<string, unknown> }> = {};
      for (const [k, v] of Object.entries(sh.cells)) {
        cs[k] = { value: v.value };
        if (v.style) cs[k]!.style = v.style;
      }
      const smd: SheetModelData = { name: sh.name, cells: cs };
      if (sh.merges && Object.keys(sh.merges).length) {
        smd.merges = { ...sh.merges };
      }
      const cw: Record<number, number> = {};
      for (let i = 0; i < sh.colWidths.length; i++) {
        if (sh.colWidths[i] !== 100) cw[i] = sh.colWidths[i]!;
      }
      if (Object.keys(cw).length) smd.colWidths = cw;
      const rh: Record<number, number> = {};
      for (let i = 0; i < sh.rowHeights.length; i++) {
        const hv = sh.rowHeights[i];
        if (hv !== undefined && hv !== null) rh[i] = hv;
      }
      if (Object.keys(rh).length) smd.rowHeights = rh;
      return smd;
    });
    const js = JSON.stringify(out);
    if (js !== lastEmittedData) {
      lastEmittedData = js;
      modelData.value = out;
      if (lastEmittedDataRef) lastEmittedDataRef.value = js;
    }
  }
  // 反向注入到 core-state
  s.emitModelData = emitModelData;

  let pendingOptEmit = false;
  function scheduleOptEmit() {
    if (!pendingOptEmit) {
      pendingOptEmit = true;
      Promise.resolve().then(() => {
        pendingOptEmit = false;
        emitModelData();
      });
    }
  }

  // ============ 主题 & CSS ============
  const themeColors = computed(() => (s.props.theme === 'dark' ? darkTheme : lightTheme));
  const outerStyle = computed(() => buildOuterStyle(themeColors.value, s.props.width, s.props.height, resolveSize));
  const toolbarThemeVars = computed(() => {
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(outerStyle.value)) {
      if (k.startsWith('--')) vars[k] = v;
    }
    return vars;
  });

  // ============ 模板 refs & 滚动控制 ============
  const wrapperRef = ref<HTMLDivElement | null>(null);
  const canvasRef = ref<HTMLCanvasElement | null>(null);
  const editInputRef = ref<HTMLTextAreaElement | null>(null);
  const formulaBarRef = ref<HTMLInputElement | null>(null);
  const viewSize = reactive({ w: 800, h: 600 });
  // 同时同步到 core-state 的 viewSize（用于 ensureVisible）
  if (s.viewSize) {
    watch(viewSize, (v) => {
      if (s.viewSize) {
        s.viewSize.w = v.w;
        s.viewSize.h = v.h;
      }
    }, { deep: true });
  }

  const HEADER_WIDTH = 48;
  const HEADER_HEIGHT = 28;
  const SB_SIZE = 11;

  const maxScrollX = computed(() => Math.max(0, s.totalWidth.value - Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE)));
  const maxScrollY = computed(() => Math.max(0, s.totalHeight.value - Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE)));

  function clampScroll(sx: number | null, sy: number | null) {
    const gw = Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE);
    const gh = Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE);
    s.scrollX.value = Math.max(0, Math.min(sx ?? s.scrollX.value, Math.max(0, s.totalWidth.value - gw)));
    s.scrollY.value = Math.max(0, Math.min(sy ?? s.scrollY.value, Math.max(0, s.totalHeight.value - gh)));
  }
  // 反向注入到 core-state
  s.clampScroll = clampScroll;

  function canFocusHiddenEditor(): boolean {
    if (typeof window === 'undefined') return false;
    return !window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
  }

  function focusEditInput(selectAllText = false) {
    nextTick(() => {
      const inp = editInputRef.value;
      if (!inp) return;
      if (!s.editingCell.value && !canFocusHiddenEditor()) {
        if (document.activeElement === inp) inp.blur();
        return;
      }
      inp.focus({ preventScroll: true });
      if (selectAllText) inp.select();
    });
  }

  function onCanvasFocus() {
    focusEditInput();
  }

  // ============ 行高/列宽重置 ============
  function resetRowHeight() {
    const sel = s.selection.value;
    if (!sel) return;
    us.saveUndo();
    for (let r = sel.startRow; r <= sel.endRow; r++) s.rowHeights.value[r] = undefined;
    s.scheduleRender?.();
    emitModelData();
  }
  function resetColWidth() {
    const sel = s.selection.value;
    if (!sel) return;
    us.saveUndo();
    for (let c = sel.startCol; c <= sel.endCol; c++) s.colWidths.value[c] = DEFAULT_COL_WIDTH;
    s.scheduleRender?.();
    emitModelData();
  }

  return {
    deleteRows,
    insertRows,
    insertCols,
    deleteCols,

    sheets,
    activeSheetIndex,
    saveSheet,
    loadSheet,
    switchSheet,
    addSheet,
    removeSheet,
    renameSheet,
    dupSheet,
    moveSheet,
    sheetCount,
    mkSheet,

    emitModelData,
    scheduleOptEmit,

    themeColors,
    outerStyle,
    toolbarThemeVars,

    wrapperRef,
    canvasRef,
    editInputRef,
    formulaBarRef,
    viewSize,
    maxScrollX,
    maxScrollY,
    clampScroll,
    canFocusHiddenEditor,
    focusEditInput,
    onCanvasFocus,

    resetRowHeight,
    resetColWidth,

    modelData,
  };
}
