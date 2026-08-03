<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { HEADER_HEIGHT, HEADER_WIDTH, SB_SIZE, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, UNDO_MAX, t, lightTheme, darkTheme  } from './spreader/constants';
import { colToLabel, resolveSize, writeClipboardText, getCanvasXY } from './spreader/utils';
import { FormulaDeps, parseFormulaRefs, clearEvalCache, computeCellValue, shiftFormulaRefs } from './spreader/formula';
import { buildOuterStyle } from './spreader/theme';
import type { CellCoord, CellData, SelectionRange, SheetState, SheetModelData, ContextMenuItem } from './spreader/types';

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

const locale = computed(() => props.locale === 'zh-CN' ? 'zh-CN' : 'en-US');
const colCount = props.colCount;
const rowCount = props.rowCount;

// ============ 模式 ============
const modelData = defineModel<SheetModelData[]>('data', { default: () => [] });
let lastEmittedData = '';

// ============ 核心数据 ============
const cells = reactive<Record<string, CellData>>({});
const formulaDeps = new FormulaDeps();
const selection = ref<SelectionRange | null>(null);
const activeCell = ref<CellCoord>({ col: 0, row: 0 });
const editingCell = ref<CellCoord | null>(null);
const editValue = ref('');
const colWidths = ref<number[]>(new Array(colCount).fill(DEFAULT_COL_WIDTH));
const rowHeights = ref<number[]>(new Array(rowCount).fill(DEFAULT_ROW_HEIGHT));
const scrollX = ref(0);
const scrollY = ref(0);

// ============ 列位置/行位置计算 ============
const colPositions = computed(() => {
  const p = [0];
  for (let i = 0; i < colCount; i++) p.push(p[i]! + colWidths.value[i]!);
  return p;
});
const rowPositions = computed(() => {
  const p = [0];
  for (let i = 0; i < rowCount; i++) p.push(p[i]! + rowHeights.value[i]!);
  return p;
});
const totalWidth = computed(() => colPositions.value[colCount]!);
const totalHeight = computed(() => rowPositions.value[rowCount]!);

// ============ 选区操作 ============
function selectCell(c: number, r: number) {
  activeCell.value = { col: c, row: r };
  selection.value = { startCol: c, startRow: r, endCol: c, endRow: r };
}
function selectRange(sC: number, sR: number, eC: number, eR: number) {
  activeCell.value = { col: sC, row: sR };
  selection.value = {
    startCol: Math.min(sC, eC), startRow: Math.min(sR, eR),
    endCol: Math.max(sC, eC), endRow: Math.max(sR, eR),
  };
}
function selectAll() {
  selectRange(0, 0, colCount - 1, rowCount - 1);
}
function isSelected(c: number, r: number) {
  const s = selection.value;
  return s ? c >= s.startCol && c <= s.endCol && r >= s.startRow && r <= s.endRow : false;
}
function cellKey(c: number, r: number) {
  return `${c},${r}`;
}
function delCell(k: string) {
  Reflect.deleteProperty(cells, k);
}

// ============ 单元格读写 ============
function getCellRaw(c: number, r: number) {
  return cells[cellKey(c, r)]?.value ?? '';
}
function getCellValue(c: number, r: number) {
  clearEvalCache();
  return computeCellValue(c, r, cells, colCount, rowCount);
}
function setCellValue(c: number, r: number, v: string | null | undefined) {
  const k = cellKey(c, r);
  clearEvalCache();
  if (v === '' || v == null) {
    formulaDeps.clear(k);
    delCell(k);
    formulaDeps.markDirty(k);
    return;
  }
  const val = String(v);
  const st = cells[k]?.style ?? null;
  cells[k] = { value: val, style: st };
  if (val.startsWith('=')) {
    formulaDeps.set(k, parseFormulaRefs(val.slice(1), colCount, rowCount));
  } else {
    formulaDeps.clear(k);
  }
  formulaDeps.markDirty(k);
}
function clearCellsInRange(cS: number, cE: number, rS: number, rE: number) {
  for (let c = cS; c <= cE; c++) {
    for (let r = rS; r <= rE; r++) {
      const k = cellKey(c, r);
      formulaDeps.clear(k);
      delCell(k);
      formulaDeps.markDirty(k);
    }
  }
}

// ============ 编辑状态 ============
function startEdit() {
  if (!editingCell.value) {
    editingCell.value = { ...activeCell.value };
    editValue.value = getCellRaw(activeCell.value.col, activeCell.value.row);
  }
}
function commitEdit() {
  if (editingCell.value) {
    setCellValue(editingCell.value.col, editingCell.value.row, editValue.value);
    editingCell.value = null;
    editValue.value = '';
  }
}
function cancelEdit() {
  editingCell.value = null;
  editValue.value = '';
}

// ============ 导航 ============
function moveActive(dC: number, dR: number) {
  selectCell(
    Math.max(0, Math.min(colCount - 1, activeCell.value.col + dC)),
    Math.max(0, Math.min(rowCount - 1, activeCell.value.row + dR)),
  );
}
function ensureVisible(c: number, r: number) {
  const gw = Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE);
  const gh = Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE);
  const cx = colPositions.value[c]!;
  const cy = rowPositions.value[r]!;
  const cw = colWidths.value[c]!;
  const ch = rowHeights.value[r]!;
  let sx = scrollX.value;
  let sy = scrollY.value;
  if (cx < sx) sx = cx;
  else if (cx + cw > sx + gw) sx = cx + cw - gw;
  if (cy < sy) sy = cy;
  else if (cy + ch > sy + gh) sy = cy + ch - gh;
  clampScroll(sx, sy);
}

// ============ 二分命中 ============
function hitCol(x: number) {
  const p = colPositions.value;
  if (x < 0 || x >= p[colCount]!) return -1;
  let lo = 0, hi = colCount - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (p[m]! <= x) lo = m;
    else hi = m - 1;
  }
  return lo;
}
function hitRow(y: number) {
  const p = rowPositions.value;
  if (y < 0 || y >= p[rowCount]!) return -1;
  let lo = 0, hi = rowCount - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (p[m]! <= y) lo = m;
    else hi = m - 1;
  }
  return lo;
}

// ============ 撤销/重做 ============
interface UndoSnap { cells: Record<string, CellData>; colWidths: number[]; rowHeights: number[] }
const undoStack = ref<UndoSnap[]>([]);
const redoStack = ref<UndoSnap[]>([]);
function takeSnap(): UndoSnap {
  const s: Record<string, CellData> = {};
  for (const [k, v] of Object.entries(cells)) {
    s[k] = { value: v.value, style: v.style };
  }
  return { cells: s, colWidths: [...colWidths.value], rowHeights: [...rowHeights.value] };
}
function restoreSnap(s: UndoSnap) {
  Object.keys(cells).forEach((k) => delCell(k));
  Object.assign(cells, s.cells);
  colWidths.value = s.colWidths;
  rowHeights.value = s.rowHeights;
  formulaDeps.rebuild(cells, colCount, rowCount);
}
function saveUndo() {
  const s = takeSnap();
  const last = undoStack.value[undoStack.value.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(s)) return;
  undoStack.value.push(s);
  redoStack.value = [];
  if (undoStack.value.length > UNDO_MAX) undoStack.value.shift();
}
function undo() {
  if (!undoStack.value.length) return;
  redoStack.value.push(takeSnap());
  restoreSnap(undoStack.value.pop()!);
  selection.value = null;
  scheduleRender();
}
function redo() {
  if (!redoStack.value.length) return;
  undoStack.value.push(takeSnap());
  restoreSnap(redoStack.value.pop()!);
  selection.value = null;
  scheduleRender();
}

// ============ 剪贴板 ============
let copySourceRange: SelectionRange | null = null;
function copyToClipboard() {
  const s = selection.value;
  if (!s) return;
  copySourceRange = { ...s };
  const ls: string[] = [];
  for (let r = s.startRow; r <= s.endRow; r++) {
    const row: string[] = [];
    for (let c = s.startCol; c <= s.endCol; c++) row.push(getCellRaw(c, r));
    ls.push(row.join('\t'));
  }
  writeClipboardText(ls.join('\n'));
}
function copyRowCol() {
  const s = selection.value;
  if (!s) return;
  if (s.startCol === 0 && s.endCol === colCount - 1) {
    const ls: string[] = [];
    for (let r = s.startRow; r <= s.endRow; r++) {
      const row: string[] = [];
      for (let c = 0; c < colCount; c++) row.push(getCellRaw(c, r));
      ls.push(row.join('\t'));
    }
    writeClipboardText(ls.join('\n'));
  } else if (s.startRow === 0 && s.endRow === rowCount - 1) {
    const ls: string[] = [];
    for (let r = 0; r < rowCount; r++) {
      const row: string[] = [];
      for (let c = s.startCol; c <= s.endCol; c++) row.push(getCellRaw(c, r));
      ls.push(row.join('\t'));
    }
    writeClipboardText(ls.join('\n'));
  }
}
async function pasteFromClipboard() {
  let txt = '';
  try {
    txt = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (!txt && txt !== '') return;
  const lines = txt.split(/\r?\n/);
  const ac = activeCell.value;
  const src = copySourceRange;
  for (let r = 0; r < lines.length; r++) {
    const cols = lines[r]!.split('\t');
    for (let c = 0; c < cols.length; c++) {
      const tc = ac.col + c;
      const tr = ac.row + r;
      if (tc < colCount && tr < rowCount) {
        let val = cols[c]!;
        if (val.startsWith('=') && src) {
          val = shiftFormulaRefs(
            val,
            tc - (src.startCol + c),
            tr - (src.startRow + r),
            colCount, rowCount, colToLabel,
          );
        }
        setCellValue(tc, tr, val);
      }
    }
  }
}
function cutSelected() {
  copyToClipboard();
  if (selection.value) {
    const s = selection.value;
    clearCellsInRange(s.startCol, s.endCol, s.startRow, s.endRow);
    scheduleRender();
  }
}
function clearSelected() {
  if (selection.value) {
    const s = selection.value;
    clearCellsInRange(s.startCol, s.endCol, s.startRow, s.endRow);
    scheduleRender();
  }
}

// ============ 求和功能 ============
function sumSelected() {
  const s = selection.value;
  if (!s) return;
  saveUndo();
  const sc = s.startCol, sr = s.startRow, ec = s.endCol, er = s.endRow;
  if (sr === er) {
    // 单行选区
    if (ec + 1 < colCount) {
      // 右侧有空位：写入 ec+1，求和范围 sc~ec
      const rangeRef = `${colToLabel(sc)}${sr + 1}:${colToLabel(ec)}${sr + 1}`;
      setCellValue(ec + 1, sr, `=SUM(${rangeRef})`);
    } else {
      // 选中了行末单元格：写入 ec，求和范围 sc~ec-1
      const rangeRef = `${colToLabel(sc)}${sr + 1}:${colToLabel(ec - 1)}${sr + 1}`;
      setCellValue(ec, sr, `=SUM(${rangeRef})`);
    }
  } else {
    // 多行选区 — 每列独立求和
    for (let c = sc; c <= ec; c++) {
      if (er + 1 < rowCount) {
        // 下方有空位：写入 er+1，求和范围 sr~er
        const rangeRef = `${colToLabel(c)}${sr + 1}:${colToLabel(c)}${er + 1}`;
        setCellValue(c, er + 1, `=SUM(${rangeRef})`);
      } else {
        // 选中了列末单元格：写入 er，求和范围 sr~er-1
        const rangeRef = `${colToLabel(c)}${sr + 1}:${colToLabel(c)}${er}`;
        setCellValue(c, er, `=SUM(${rangeRef})`);
      }
    }
  }
  scheduleRender();
  emitModelData();
}

// ============ 行/列插入/删除 ============
function deleteRows(rS: number, rE: number) {
  const dr = rE - rS + 1;
  for (let r = rS; r <= rE; r++) {
    for (let c = 0; c < colCount; c++) delCell(cellKey(c, r));
  }
  for (let r = rS; r < rowCount - dr; r++) {
    for (let c = 0; c < colCount; c++) {
      const sk = cellKey(c, r + dr), dk = cellKey(c, r);
      if (cells[sk]) {
        cells[dk] = cells[sk]!;
        delCell(sk);
      } else {
        delCell(dk);
      }
    }
    rowHeights.value[r] = rowHeights.value[r + dr]!;
  }
  for (let r = rowCount - dr; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) delCell(cellKey(c, r));
    rowHeights.value[r] = DEFAULT_ROW_HEIGHT;
  }
}
function insertRows(rS: number, rE: number) {
  const n = rE - rS + 1;
  if (rE >= rowCount - 1) return;
  for (let r = rowCount - 1; r > rE; r--) {
    for (let c = 0; c < colCount; c++) {
      const sk = cellKey(c, r - n), dk = cellKey(c, r);
      if (cells[sk]) cells[dk] = cells[sk]!;
      else delCell(dk);
    }
    rowHeights.value[r] = rowHeights.value[r - n]!;
  }
  for (let r = rE + 1; r <= rE + n; r++) {
    for (let c = 0; c < colCount; c++) delCell(cellKey(c, r));
    rowHeights.value[r] = DEFAULT_ROW_HEIGHT;
  }
}
function insertCols(cS: number, cE: number) {
  const n = cE - cS + 1;
  if (cE >= colCount - 1) return;
  for (let c = colCount - 1; c > cE; c--) {
    for (let r = 0; r < rowCount; r++) {
      const sk = cellKey(c - n, r), dk = cellKey(c, r);
      if (cells[sk]) cells[dk] = cells[sk]!;
      else delCell(dk);
    }
    colWidths.value[c] = colWidths.value[c - n]!;
  }
  for (let c = cE + 1; c <= cE + n; c++) {
    for (let r = 0; r < rowCount; r++) delCell(cellKey(c, r));
    colWidths.value[c] = DEFAULT_COL_WIDTH;
  }
}
function deleteCols(cS: number, cE: number) {
  const dc = cE - cS + 1;
  for (let c = cS; c <= cE; c++) {
    for (let r = 0; r < rowCount; r++) delCell(cellKey(c, r));
  }
  for (let c = cS; c < colCount - dc; c++) {
    for (let r = 0; r < rowCount; r++) {
      const sk = cellKey(c + dc, r), dk = cellKey(c, r);
      if (cells[sk]) {
  cells[dk] = cells[sk]!;
  delCell(sk);
} else {
  delCell(dk);
}
    }
    colWidths.value[c] = colWidths.value[c + dc]!;
  }
  for (let c = colCount - dc; c < colCount; c++) {
    for (let r = 0; r < rowCount; r++) delCell(cellKey(c, r));
    colWidths.value[c] = DEFAULT_COL_WIDTH;
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
    id: nid(), name, cells: {},
    selection: { startCol: 0, startRow: 0, endCol: 0, endRow: 0 },
    activeCell: { col: 0, row: 0 },
    scrollX: 0, scrollY: 0,
    colWidths: new Array(colCount).fill(DEFAULT_COL_WIDTH),
    rowHeights: new Array(rowCount).fill(DEFAULT_ROW_HEIGHT),
  };
}
const sheets = ref<SheetState[]>([mkSheet('Sheet1')]);
const activeSheetIndex = ref(0);
function saveSheet() {
  const s = sheets.value[activeSheetIndex.value];
  if (!s) return;
  s.cells = { ...cells };
  s.selection = selection.value ? { ...selection.value } : null;
  s.activeCell = { ...activeCell.value };
  s.scrollX = scrollX.value;
  s.scrollY = scrollY.value;
  s.colWidths = [...colWidths.value];
  s.rowHeights = [...rowHeights.value];
}
function loadSheet(i: number) {
  const s = sheets.value[i];
  if (!s) return;
  Object.keys(cells).forEach((k) => delCell(k));
  Object.assign(cells, s.cells);
  selection.value = s.selection ? { ...s.selection } : null;
  activeCell.value = { ...s.activeCell };
  scrollX.value = s.scrollX;
  scrollY.value = s.scrollY;
  colWidths.value = [...s.colWidths];
  rowHeights.value = [...s.rowHeights];
  activeSheetIndex.value = i;
}
function switchSheet(i: number) {
  if (i === activeSheetIndex.value || i < 0 || i >= sheets.value.length) return;
  cancelEdit();
  saveSheet();
  loadSheet(i);
}
function addSheet(n?: string) {
  cancelEdit();
  saveSheet();
  sheets.value.push(mkSheet(n ?? `Sheet${sheets.value.length + 1}`));
  loadSheet(sheets.value.length - 1);
  return sheets.value.length - 1;
}
function removeSheet(i: number) {
  if (sheets.value.length <= 1) return activeSheetIndex.value;
  cancelEdit();
  sheets.value.splice(i, 1);
  loadSheet(Math.min(i, sheets.value.length - 1));
  return activeSheetIndex.value;
}
function renameSheet(i: number, n: string) {
  if (sheets.value[i] && n.trim()) sheets.value[i]!.name = n.trim();
}
function dupSheet(i: number) {
  cancelEdit();
  saveSheet();
  const src = sheets.value[i];
  if (!src) return i;
  let bn = src.name;
  const m = bn.match(/^(.*?)\s*\((\d+)\)$/);
  let n = m ? parseInt(m[2]!, 10) + 1 : 2;
  if (m) bn = m[1]!;
  let nn = `${bn} (${n})`;
  const names = new Set(sheets.value.map((s) => s.name));
  while (names.has(nn)) {
    n++;
    nn = `${bn} (${n})`;
  }
  const cp: SheetState = {
    id: nid(), name: nn, cells: { ...src.cells },
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
  const cur = activeSheetIndex.value;
  const s = sheets.value.splice(i, 1)[0]!;
  sheets.value.splice(ni, 0, s);
  if (cur === i) activeSheetIndex.value = ni;
  else if (i < cur && ni >= cur) activeSheetIndex.value = cur - 1;
  else if (i > cur && ni <= cur) activeSheetIndex.value = cur + 1;
  scheduleRender();
}
const sheetCount = computed(() => sheets.value.length);

// ============ v-model emit ============
function emitModelData() {
  saveSheet();
  const out: SheetModelData[] = sheets.value.map((s) => {
    const cs: Record<string, { value: string; style?: Record<string, unknown> }> = {};
    for (const [k, v] of Object.entries(s.cells)) {
      cs[k] = { value: v.value };
      if (v.style) cs[k]!.style = v.style;
    }
    const sh: SheetModelData = { name: s.name, cells: cs };
    const cw: Record<number, number> = {};
    for (let i = 0; i < s.colWidths.length; i++) {
      if (s.colWidths[i] !== 100) cw[i] = s.colWidths[i]!;
    }
    if (Object.keys(cw).length) sh.colWidths = cw;
    const rh: Record<number, number> = {};
    for (let i = 0; i < s.rowHeights.length; i++) {
      if (s.rowHeights[i] !== 24) rh[i] = s.rowHeights[i]!;
    }
    if (Object.keys(rh).length) sh.rowHeights = rh;
    return sh;
  });
  const js = JSON.stringify(out);
  if (js !== lastEmittedData) {
      lastEmittedData = js;
      modelData.value = out;
    }
}
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
const themeColors = computed(() => props.theme === 'dark' ? darkTheme : lightTheme);
const outerStyle = computed(() => buildOuterStyle(themeColors.value, props.width, props.height, resolveSize));

// ============ 模板 refs & 滚动控制 ============
const wrapperRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const editInputRef = ref<HTMLInputElement | null>(null);
const formulaBarRef = ref<HTMLInputElement | null>(null);
const viewSize = reactive({ w: 800, h: 600 });
const maxScrollX = computed(() => Math.max(0, totalWidth.value - Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE)));
const maxScrollY = computed(() => Math.max(0, totalHeight.value - Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE)));
function clampScroll(sx: number | null, sy: number | null) {
  const gw = Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE);
  const gh = Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE);
  scrollX.value = Math.max(0, Math.min(sx ?? scrollX.value, Math.max(0, totalWidth.value - gw)));
  scrollY.value = Math.max(0, Math.min(sy ?? scrollY.value, Math.max(0, totalHeight.value - gh)));
}

// ============ 渲染器 ============
let rp = false;
let rCtx: CanvasRenderingContext2D | null = null;
let rDpr = 1;
function scheduleRender() {
  if (!rp) {
    rp = true;
    requestAnimationFrame(() => {
      rp = false;
      render();
    });
  }
}
function render() {
  const cvs = canvasRef.value;
  if (!cvs) return;
  const wrapper = wrapperRef.value;
  if (!wrapper) return;
  rCtx = cvs.getContext('2d');
  if (!rCtx) return;
  rDpr = window.devicePixelRatio || 1;
  const r = wrapper.getBoundingClientRect();
  const W = r.width;
  const H = r.height;
  viewSize.w = W;
  viewSize.h = H;
  cvs.width = W * rDpr;
  cvs.height = H * rDpr;
  cvs.style.width = W + 'px';
  cvs.style.height = H + 'px';
  rCtx.setTransform(rDpr, 0, 0, rDpr, 0, 0);
  const sx = scrollX.value;
  const sy = scrollY.value;
  const HW = HEADER_WIDTH;
  const HH = HEADER_HEIGHT;
  const cs = themeColors.value;
  const cP = colPositions.value;
  const rP = rowPositions.value;
  const cW = colWidths.value;
  const rH = rowHeights.value;

  const sC = Math.max(0, hitCol(sx));
  let eC2 = sC;
  for (let c = sC; c < colCount; c++) {
    if (HW + cP[c]! - sx >= W) break;
    eC2 = c;
  }
  const eC = eC2;
  const sR = Math.max(0, hitRow(sy));
  let eR2 = sR;
  for (let r = sR; r < rowCount; r++) {
    if (HH + rP[r]! - sy >= H) break;
    eR2 = r;
  }
  const eR = eR2;

  // 背景
  rCtx.fillStyle = cs.bg;
  rCtx.fillRect(0, 0, W, H);
  rCtx.fillStyle = cs.gridBg;
  rCtx.fillRect(HW, HH, W - HW, H - HH);

  // 网格单元格
  rCtx.save();
  rCtx.beginPath();
  rCtx.rect(HW + 0.5, HH + 0.5, W - HW - 1, H - HH - 1);
  rCtx.clip();
  const sel = selection.value;
  const ed = editingCell.value;
  for (let row = sR; row <= eR; row++) {
    for (let col = sC; col <= eC; col++) {
      const x = HW + cP[col]! - sx;
        const y = HH + rP[row]! - sy;
        const cw = cW[col]!;
        const rh = rH[row]!;
      if (x + cw < HW || y + rh < HH || x > W || y > H) continue;
      if (isSelected(col, row)) {
        rCtx.fillStyle = cs.selectionBg;
        rCtx.fillRect(x, y, cw, rh);
      }
      if (activeCell.value.col === col && activeCell.value.row === row) {
        rCtx.strokeStyle = cs.activeCellBorder;
        rCtx.lineWidth = 2;
        rCtx.strokeRect(x + 1, y + 1, cw - 2, rh - 2);
      }
      rCtx.strokeStyle = cs.gridLine;
      rCtx.lineWidth = 0.5;
      rCtx.strokeRect(x + 0.25, y + 0.25, cw - 0.5, rh - 0.5);
      if (!(ed && ed.col === col && ed.row === row)) {
        const v = getCellValue(col, row);
        if (v) {
          rCtx.fillStyle = cs.cellText;
          rCtx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif';
          rCtx.textBaseline = 'middle';
          rCtx.save();
          rCtx.beginPath();
          rCtx.rect(x + 5, y + 1, cw - 10, rh - 2);
          rCtx.clip();
          rCtx.fillText(v, x + 5, y + rh / 2 + 0.5);
          rCtx.restore();
        }
      }
    }
  }
  rCtx.restore();

  // 列标题
  rCtx.fillStyle = cs.headerBg;
  rCtx.fillRect(HW, 0, W - HW, HH);
  for (let col = sC; col <= eC; col++) {
    const x = HW + cP[col]! - sx, cw = cW[col]!;
    if (x + cw < HW || x > W) continue;
    if (sel && col >= sel.startCol && col <= sel.endCol) {
      rCtx.fillStyle = cs.selectionBg;
      rCtx.fillRect(x, 0, cw, HH);
    }
    rCtx.strokeStyle = cs.headerBorder;
    rCtx.lineWidth = 0.5;
    rCtx.strokeRect(x + 0.25, 0.25, cw - 0.5, HH - 0.5);
    if (sel && col >= sel.startCol && col <= sel.endCol) {
      rCtx.strokeStyle = cs.activeCellBorder;
      rCtx.lineWidth = 2;
      rCtx.beginPath();
      rCtx.moveTo(x, HH - 1);
      rCtx.lineTo(x + cw, HH - 1);
      rCtx.stroke();
    }
    rCtx.fillStyle = cs.headerText;
    rCtx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    rCtx.textAlign = 'center';
    rCtx.textBaseline = 'middle';
    rCtx.fillText(colToLabel(col), x + cw / 2, HH / 2);
  }
  rCtx.strokeStyle = cs.headerSep;
  rCtx.lineWidth = 1;
  rCtx.beginPath();
  rCtx.moveTo(HW, HH + 0.5);
  rCtx.lineTo(W, HH + 0.5);
  rCtx.stroke();

  // 行标题
  rCtx.fillStyle = cs.headerBg;
  rCtx.fillRect(0, HH, HW, H - HH);
  for (let row = sR; row <= eR; row++) {
    const y = HH + rP[row]! - sy, rh = rH[row]!;
    if (y + rh < HH || y > H) continue;
    if (sel && row >= sel.startRow && row <= sel.endRow) {
      rCtx.fillStyle = cs.selectionBg;
      rCtx.fillRect(0, y, HW, rh);
    }
    rCtx.strokeStyle = cs.headerBorder;
    rCtx.lineWidth = 0.5;
    rCtx.strokeRect(0.25, y + 0.25, HW - 0.5, rh - 0.5);
    if (sel && row >= sel.startRow && row <= sel.endRow) {
      rCtx.strokeStyle = cs.activeCellBorder;
      rCtx.lineWidth = 2;
      rCtx.beginPath();
      rCtx.moveTo(HW - 1, y);
      rCtx.lineTo(HW - 1, y + rh);
      rCtx.stroke();
    }
    rCtx.fillStyle = cs.headerText;
    rCtx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    rCtx.textAlign = 'center';
    rCtx.textBaseline = 'middle';
    rCtx.fillText(String(row + 1), HW / 2, y + rh / 2 + 0.5);
  }
  rCtx.strokeStyle = cs.headerSep;
  rCtx.lineWidth = 1;
  rCtx.beginPath();
  rCtx.moveTo(HW + 0.5, HH);
  rCtx.lineTo(HW + 0.5, H);
  rCtx.stroke();

  // 角格
  rCtx.fillStyle = cs.headerBg;
  rCtx.fillRect(0, 0, HW, HH);
  rCtx.strokeStyle = cs.headerSep;
  rCtx.lineWidth = 1;
  rCtx.strokeRect(0.5, 0.5, HW - 0.5, HH - 0.5);
}

// ============ 编辑栏 ============
const activeCellLabel = computed(() => colToLabel(activeCell.value.col) + String(activeCell.value.row + 1));
const formulaBarDisplay = computed(() => editingCell.value ? editValue.value : getCellRaw(activeCell.value.col, activeCell.value.row));
function onFormulaBarFocus() {
  if (!editingCell.value) {
    ensureVisible(activeCell.value.col, activeCell.value.row);
    editValue.value = getCellRaw(activeCell.value.col, activeCell.value.row);
    startEdit();
    scheduleRender();
  }
}
function onFormulaBarInput(e: Event) {
  editValue.value = (e.target as HTMLInputElement).value;
}
function onFormulaBarKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitEdit();
    moveActive(0, 1);
    ensureVisible(activeCell.value.col, activeCell.value.row);
    formulaBarRef.value?.blur();
    scheduleRender();
    canvasRef.value?.focus();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
    formulaBarRef.value?.blur();
    scheduleRender();
    canvasRef.value?.focus();
  }
}
function onFormulaBarBlur() {
  setTimeout(() => {
    if (editingCell.value) {
      commitEdit();
      scheduleRender();
    }
  }, 0);
}

// ============ Tab 栏 ============
const renTab = ref<number | null>(null);
const renTabVal = ref('');
function onTabClick(i: number) {
  if (renTab.value !== null) return;
  switchSheet(i);
  scheduleRender();
}
function onTabDblClick(i: number) {
  if (i !== activeSheetIndex.value) {
    saveSheet();
    loadSheet(i);
    scheduleRender();
  }
  renTab.value = i;
  renTabVal.value = sheets.value[i]!.name;
  nextTick(() => {
    const inp = document.querySelector('.tab-rename-input') as HTMLInputElement;
    inp?.focus();
    inp?.select();
  });
}
function commitTabRename() {
  if (renTab.value !== null) {
    renameSheet(renTab.value, renTabVal.value);
    nextTick(emitModelData);
  }
  renTab.value = null;
  renTabVal.value = '';
}
function cclTabRename() {
  renTab.value = null;
  renTabVal.value = '';
}
function onTabRenameKd(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitTabRename();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cclTabRename();
  }
}

// ============ 右键菜单 ============
const ctxMenu = ref<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
let cdcHandler: (() => void) | null = null;
function rdl() {
  if (cdcHandler) {
    document.removeEventListener('click', cdcHandler);
    cdcHandler = null;
  }
}
function showCtx(x: number, y: number, items: ContextMenuItem[]) {
  rdl();
  const mw = 140;
  const mh = items.length * 28 + 8;
  const sw = window.innerWidth;
  const sh = window.innerHeight;
  if (x + mw > sw) x -= mw;
  if (y + mh > sh) y -= mh;
  ctxMenu.value = { x, y, items };
  cdcHandler = () => {
    ctxMenu.value = null;
    rdl();
  };
  setTimeout(() => document.addEventListener('click', cdcHandler!, { once: true }), 0);
}
const ctxSubmenuLeft = ref(false);
function onCtxItemEnter(e: MouseEvent, item: ContextMenuItem) {
  if (!item.children) {
    ctxSubmenuLeft.value = false;
    return;
  }
  const el = e.currentTarget as HTMLElement;
  const sub = el.querySelector('.context-submenu') as HTMLElement | null;
  if (!sub) {
    ctxSubmenuLeft.value = false;
    return;
  }
  const subRect = sub.getBoundingClientRect();
  ctxSubmenuLeft.value = subRect.right > window.innerWidth;
}

function onTabCtxMenu(e: MouseEvent, i: number) {
  e.preventDefault();
  e.stopPropagation();
  showCtx(e.clientX, e.clientY, [
    {
      label: t(locale.value, 'insert'),
      action: () => {
        addSheet();
        scheduleRender();
      },
    },
    { label: t(locale.value, 'copy'), action: () => { dupSheet(i); } },
    { label: t(locale.value, 'rename'), action: () => { onTabDblClick(i); } },
    {
      label: t(locale.value, 'delete'),
      action: () => {
        removeSheet(i);
        scheduleRender();
      },
      disabled: sheetCount.value <= 1,
    },
    { label: t(locale.value, 'moveSheetLeft'), action: () => { moveSheet(i, -1); }, disabled: i === 0 },
    { label: t(locale.value, 'moveSheetRight'), action: () => { moveSheet(i, 1); }, disabled: i === sheets.value.length - 1 },
  ]);
}
function onTabBarCtx(e: MouseEvent) {
  e.preventDefault();
  if ((e.target as HTMLElement).closest('.tab-item') || (e.target as HTMLElement).closest('.tab-bar__add-btn')) return;
  showCtx(e.clientX, e.clientY, [
    {
      label: t(locale.value, 'insert'),
      action: () => {
        addSheet();
        scheduleRender();
      },
    },
  ]);
}

function onCornerCtx(e: MouseEvent) {
  e.preventDefault();
  selectAll();
  scheduleRender();
  showCtx(e.clientX, e.clientY, [
    {
      label: t(locale.value, 'cut'),
      action: () => {
        cutSelected();
        emitModelData();
      },
    },
    { label: t(locale.value, 'copy'), action: () => copyToClipboard() },
    {
      label: t(locale.value, 'paste'),
      action: () => {
        saveUndo();
        pasteFromClipboard().then(() => {
          scheduleRender();
          nextTick(emitModelData);
        });
      },
    },
    { label: t(locale.value, 'delete'), action: () => {
      saveUndo();
      clearSelected();
      for (let c = 0; c < colCount; c++) colWidths.value[c] = DEFAULT_COL_WIDTH;
      for (let r = 0; r < rowCount; r++) rowHeights.value[r] = DEFAULT_ROW_HEIGHT;
      scheduleRender();
      emitModelData();
    } },
  ]);
}
function onRowHdrCtx(e: MouseEvent, row: number) {
  e.preventDefault();
  const sel = selection.value;
  if (!(sel && sel.startCol === 0 && sel.endCol === colCount - 1 && row >= sel.startRow && row <= sel.endRow)) {
    selectRange(0, row, colCount - 1, row);
    scheduleRender();
  }
  const s = selection.value!;
  showCtx(e.clientX, e.clientY, [
    {
      label: t(locale.value, 'insert'),
      action: () => {
        saveUndo();
        insertRows(s.startRow, s.endRow);
        scheduleRender();
        emitModelData();
      },
      disabled: s.endRow >= rowCount - 1,
    },
    { label: t(locale.value, 'cut'), action: () => {
      saveUndo();
      copyRowCol();
      for (let r = s.startRow; r <= s.endRow; r++) {
        for (let c = 0; c < colCount; c++) delCell(cellKey(c, r));
      }
      scheduleRender();
      emitModelData();
    } },
    { label: t(locale.value, 'copy'), action: () => copyRowCol() },
    {
      label: t(locale.value, 'paste'),
      action: () => {
        saveUndo();
        pasteFromClipboard().then(() => {
          scheduleRender();
          nextTick(emitModelData);
        });
      },
    },
    {
      label: t(locale.value, 'delete'),
      action: () => {
        saveUndo();
        deleteRows(s.startRow, s.endRow);
        scheduleRender();
        emitModelData();
      },
    },
  ]);
}
function onColHdrCtx(e: MouseEvent, col: number) {
  e.preventDefault();
  const sel = selection.value;
  if (!(sel && sel.startRow === 0 && sel.endRow === rowCount - 1 && col >= sel.startCol && col <= sel.endCol)) {
    selectRange(col, 0, col, rowCount - 1);
    scheduleRender();
  }
  const s = selection.value!;
  showCtx(e.clientX, e.clientY, [
    {
      label: t(locale.value, 'insert'),
      action: () => {
        saveUndo();
        insertCols(s.startCol, s.endCol);
        scheduleRender();
        emitModelData();
      },
      disabled: s.endCol >= colCount - 1,
    },
    { label: t(locale.value, 'cut'), action: () => {
      saveUndo();
      copyRowCol();
      for (let c = s.startCol; c <= s.endCol; c++) {
        for (let r = 0; r < rowCount; r++) delCell(cellKey(c, r));
      }
      scheduleRender();
      emitModelData();
    } },
    { label: t(locale.value, 'copy'), action: () => copyRowCol() },
    {
      label: t(locale.value, 'paste'),
      action: () => {
        saveUndo();
        pasteFromClipboard().then(() => {
          scheduleRender();
          nextTick(emitModelData);
        });
      },
    },
    {
      label: t(locale.value, 'delete'),
      action: () => {
        saveUndo();
        deleteCols(s.startCol, s.endCol);
        scheduleRender();
        emitModelData();
      },
    },
  ]);
}
function onCellCtx(e: MouseEvent, c: number, r: number) {
  e.preventDefault();
  if (!isSelected(c, r)) {
    selectCell(c, r);
    scheduleRender();
  }
  const sel = selection.value;
  const isSingleCell = !!(sel && sel.startCol === sel.endCol && sel.startRow === sel.endRow);
  showCtx(e.clientX, e.clientY, [
    {
      label: t(locale.value, 'cut'),
      action: () => {
        cutSelected();
        emitModelData();
      },
    },
    { label: t(locale.value, 'copy'), action: () => copyToClipboard() },
    {
      label: t(locale.value, 'paste'),
      action: () => {
        saveUndo();
        pasteFromClipboard().then(() => {
          scheduleRender();
          nextTick(emitModelData);
        });
      },
    },
    {
      label: t(locale.value, 'delete'),
      action: () => {
        saveUndo();
        clearSelected();
        scheduleRender();
        emitModelData();
      },
    },
    {
      label: t(locale.value, 'calculate'),
      children: [
        { label: t(locale.value, 'sum'), action: sumSelected, disabled: isSingleCell },
      ],
    },
  ]);
}

// ============ 编辑输入框 CSS ============
const editInputStyle = computed(() => {
  if (!editingCell.value) return { display: 'none' as const };
  const c = editingCell.value.col, r = editingCell.value.row;
  return {
    left: `${HEADER_WIDTH + colPositions.value[c]! - scrollX.value}px`,
    top: `${HEADER_HEIGHT + rowPositions.value[r]! - scrollY.value}px`,
    width: `${colWidths.value[c]!}px`,
    height: `${rowHeights.value[r]!}px`,
  };
});

// ============ 滚动条 ============
const hScrollbarW = computed(() => Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE));
const vScrollbarH = computed(() => Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE));
const hTrackW = computed(() => Math.max(0, hScrollbarW.value - 11 * 2));
const vTrackH = computed(() => Math.max(0, vScrollbarH.value - 11 * 2));
function gridVW() {
  return Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE);
}
function gridVH() {
  return Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE);
}
const hThumbW = computed(() => {
  if (maxScrollX.value <= 0) return hTrackW.value;
  return Math.max(24, (gridVW() / totalWidth.value) * hTrackW.value);
});
const hThumbL = computed(() => {
  if (maxScrollX.value <= 0) return 0;
  return (scrollX.value / maxScrollX.value) * (hTrackW.value - hThumbW.value);
});
const vThumbH = computed(() => {
  if (maxScrollY.value <= 0) return vTrackH.value;
  return Math.max(24, (gridVH() / totalHeight.value) * vTrackH.value);
});
const vThumbT = computed(() => {
  if (maxScrollY.value <= 0) return 0;
  return (scrollY.value / maxScrollY.value) * (vTrackH.value - vThumbH.value);
});
let sbDrg: 'h' | 'v' | null = null;
let sbMs: number = 0;
let sbSc: number = 0;
function onVStart(e: MouseEvent) {
  e.preventDefault();
  sbDrg = 'v';
  sbMs = e.clientY;
  sbSc = scrollY.value;
  document.addEventListener('mousemove', onSbMove);
  document.addEventListener('mouseup', onSbUp);
}
function onHStart(e: MouseEvent) {
  e.preventDefault();
  sbDrg = 'h';
  sbMs = e.clientX;
  sbSc = scrollX.value;
  document.addEventListener('mousemove', onSbMove);
  document.addEventListener('mouseup', onSbUp);
}
function onSbMove(e: MouseEvent) {
  if (sbDrg === 'v') {
    const d = e.clientY - sbMs;
    const r = d / (vTrackH.value - vThumbH.value);
    clampScroll(null, sbSc + r * maxScrollY.value);
    scheduleRender();
  } else if (sbDrg === 'h') {
    const d = e.clientX - sbMs;
    const r = d / (hTrackW.value - hThumbW.value);
    clampScroll(sbSc + r * maxScrollX.value, null);
    scheduleRender();
  }
}
function onSbUp() {
  sbDrg = null;
  document.removeEventListener('mousemove', onSbMove);
  document.removeEventListener('mouseup', onSbUp);
}
function onVTrk(e: MouseEvent) {
  if (sbDrg) return;
  const cr = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const y = e.clientY - cr.top;
  if (y < vThumbT.value) clampScroll(null, scrollY.value - gridVH());
  else if (y > vThumbT.value + vThumbH.value) clampScroll(null, scrollY.value + gridVH());
  scheduleRender();
}
function onHTrk(e: MouseEvent) {
  if (sbDrg) return;
  const cr = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = e.clientX - cr.left;
  if (x < hThumbL.value) clampScroll(scrollX.value - gridVW(), null);
  else if (x > hThumbL.value + hThumbW.value) clampScroll(scrollX.value + gridVW(), null);
  scheduleRender();
}

// ============ 鼠标/触屏 状态 ============
let isDragging = false;
let drgSC = 0;
let drgSR = 0;
let isResizingC = false;
let isResizingR = false;
let rszTC = 0;
let rszTR = 0;
let rszSS = 0;
let rszSG = 0;
let tSX = 0;
let tSY = 0;
let tSSX = 0;
let tSSY = 0;
let isTouch = false;
let tMoved = false;
let tSC = 0;
let tSR = 0;
let ltT = 0;
let ltC = -1;
let ltR = -1;

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  ctxMenu.value = null;
  const p = getCanvasXY(e, canvasRef.value);
  if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
    const gx = p.x - HEADER_WIDTH + scrollX.value;
    const c = hitCol(gx);
    if (c >= 0 && Math.abs(p.x - (HEADER_WIDTH + colPositions.value[c + 1]! - scrollX.value)) <= 4) {
      isResizingC = true;
      rszTC = c;
      rszSS = colWidths.value[c]!;
      rszSG = gx;
      scheduleRender();
      return;
    }
  }
  if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
    const gy = p.y - HEADER_HEIGHT + scrollY.value;
    const r = hitRow(gy);
    if (r >= 0 && Math.abs(p.y - (HEADER_HEIGHT + rowPositions.value[r + 1]! - scrollY.value)) <= 4) {
      isResizingR = true;
      rszTR = r;
      rszSS = rowHeights.value[r]!;
      rszSG = gy;
      scheduleRender();
      return;
    }
  }
  if (p.x < HEADER_WIDTH || p.y < HEADER_HEIGHT) {
    if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
      const c = hitCol(p.x - HEADER_WIDTH + scrollX.value);
      if (c >= 0) {
        selectRange(c, 0, c, rowCount - 1);
        isDragging = true;
        drgSC = c;
        drgSR = 0;
      }
    } else if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
      const r = hitRow(p.y - HEADER_HEIGHT + scrollY.value);
      if (r >= 0) {
        selectRange(0, r, colCount - 1, r);
        isDragging = true;
        drgSC = 0;
        drgSR = r;
      }
    } else if (p.x < HEADER_WIDTH && p.y < HEADER_HEIGHT) {
      selectAll();
    }
    scheduleRender();
    return;
  }
  const c = hitCol(p.x - HEADER_WIDTH + scrollX.value), r = hitRow(p.y - HEADER_HEIGHT + scrollY.value);
  if (c < 0 || r < 0) return;
  commitEdit();
  if (e.shiftKey && selection.value) {
    const s = selection.value;
    selectRange(s.startCol, s.startRow, c, r);
  } else {
    selectCell(c, r);
  }
  isDragging = true;
  drgSC = c;
  drgSR = r;
  canvasRef.value?.focus();
  scheduleRender();
}
function onMouseMove(e: MouseEvent) {
  if (isResizingC) {
    const x = getCanvasXY(e, canvasRef.value).x;
    const d = (x - HEADER_WIDTH + scrollX.value) - rszSG;
    if (rszSS + d >= 30) colWidths.value[rszTC] = rszSS + d;
    scheduleRender();
    return;
  }
  if (isResizingR) {
    const y = getCanvasXY(e, canvasRef.value).y;
    const d = (y - HEADER_HEIGHT + scrollY.value) - rszSG;
    if (rszSS + d >= 24) rowHeights.value[rszTR] = rszSS + d;
    scheduleRender();
    return;
  }
  if (!isDragging) {
    const cvs = canvasRef.value;
    if (!cvs) return;
    const p = getCanvasXY(e, cvs);
    if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
      const c = hitCol(p.x - HEADER_WIDTH + scrollX.value);
      if (c >= 0 && Math.abs(p.x - (HEADER_WIDTH + colPositions.value[c + 1]! - scrollX.value)) <= 4) {
        cvs.style.cursor = 'col-resize';
        return;
      }
    }
    if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
      const r = hitRow(p.y - HEADER_HEIGHT + scrollY.value);
      if (r >= 0 && Math.abs(p.y - (HEADER_HEIGHT + rowPositions.value[r + 1]! - scrollY.value)) <= 4) {
        cvs.style.cursor = 'row-resize';
        return;
      }
    }
    cvs.style.cursor = 'cell';
    return;
  }
  const p = getCanvasXY(e, canvasRef.value);
  if (drgSC < 0 || drgSR < 0) return;
  if (p.x < HEADER_WIDTH || p.y < HEADER_HEIGHT) {
    if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
      const c = hitCol(p.x - HEADER_WIDTH + scrollX.value);
      if (c >= 0) selectRange(Math.min(drgSC, c), 0, Math.max(drgSC, c), rowCount - 1);
    } else if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
      const r = hitRow(p.y - HEADER_HEIGHT + scrollY.value);
      if (r >= 0) selectRange(0, Math.min(drgSR, r), colCount - 1, Math.max(drgSR, r));
    }
    scheduleRender();
    return;
  }
  const c = hitCol(p.x - HEADER_WIDTH + scrollX.value), r = hitRow(p.y - HEADER_HEIGHT + scrollY.value);
  if (c < 0 || r < 0) return;
  if (drgSR === 0 && drgSC >= 0 && selection.value && selection.value.startRow === 0 && selection.value.endRow === rowCount - 1) {
    selectRange(Math.min(drgSC, c), 0, Math.max(drgSC, c), rowCount - 1);
  } else if (drgSC === 0 && drgSR >= 0 && selection.value && selection.value.startCol === 0 && selection.value.endCol === colCount - 1) {
    selectRange(0, Math.min(drgSR, r), colCount - 1, Math.max(drgSR, r));
  } else {
    selectRange(drgSC, drgSR, c, r);
  }
  scheduleRender();
}
function onMouseUp() {
  const w = isResizingC || isResizingR;
  isDragging = false;
  isResizingC = false;
  isResizingR = false;
  if (w) scheduleOptEmit();
}
function onMouseLeave() {
  const w = isResizingC || isResizingR;
  isDragging = false;
  isResizingC = false;
  isResizingR = false;
  if (w) scheduleOptEmit();
}
function onCanvasCtx(e: MouseEvent) {
  e.preventDefault();
  const p = getCanvasXY(e, canvasRef.value);
  if (p.x < HEADER_WIDTH && p.y < HEADER_HEIGHT) {
    onCornerCtx(e);
    return;
  }
  if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
    const c = hitCol(p.x - HEADER_WIDTH + scrollX.value);
    if (c >= 0) onColHdrCtx(e, c);
    return;
  }
  if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
    const r = hitRow(p.y - HEADER_HEIGHT + scrollY.value);
    if (r >= 0) onRowHdrCtx(e, r);
    return;
  }
  if (p.x >= HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
    const c = hitCol(p.x - HEADER_WIDTH + scrollX.value), r = hitRow(p.y - HEADER_HEIGHT + scrollY.value);
    if (c >= 0 && r >= 0) onCellCtx(e, c, r);
  }
}
function onDblClick(e: MouseEvent) {
  const p = getCanvasXY(e, canvasRef.value);
  if (p.x < HEADER_WIDTH || p.y < HEADER_HEIGHT) return;
  const c = hitCol(p.x - HEADER_WIDTH + scrollX.value), r = hitRow(p.y - HEADER_HEIGHT + scrollY.value);
  if (c < 0 || r < 0) return;
  selectCell(c, r);
  ensureVisible(c, r);
  startEdit();
  scheduleRender();
  nextTick(() => editInputRef.value?.focus());
}
function onWheel(e: WheelEvent) {
  clampScroll(scrollX.value + e.deltaX, scrollY.value + e.deltaY);
  scheduleRender();
}

// 触屏
function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) {
    isTouch = false;
    return;
  }
  const t = e.touches[0]!;
  const cvs = canvasRef.value;
  if (!cvs) return;
  const r = cvs.getBoundingClientRect();
  const x = t.clientX - r.left, y = t.clientY - r.top;
  if (x >= HEADER_WIDTH && y >= HEADER_HEIGHT) {
    e.preventDefault();
    isTouch = true;
    tMoved = false;
    tSX = x;
    tSY = y;
    tSSX = scrollX.value;
    tSSY = scrollY.value;
    tSC = hitCol(x - HEADER_WIDTH + scrollX.value);
    tSR = hitRow(y - HEADER_HEIGHT + scrollY.value);
  }
}
function onTouchMove(e: TouchEvent) {
  if (!isTouch || e.touches.length !== 1) return;
  const t = e.touches[0]!;
  const cvs = canvasRef.value;
  if (!cvs) return;
  const r = cvs.getBoundingClientRect();
  const x = t.clientX - r.left, y = t.clientY - r.top;
  if (Math.abs(x - tSX) > 8 || Math.abs(y - tSY) > 8) {
    tMoved = true;
    e.preventDefault();
    clampScroll(tSSX + (tSX - x), tSSY + (tSY - y));
    scheduleRender();
  }
}
function onTouchEnd() {
  if (!isTouch) return;
  isTouch = false;
  if (!tMoved && tSC >= 0 && tSR >= 0) {
    const n = Date.now();
    if (tSC === ltC && tSR === ltR && n - ltT < 300) {
      selectCell(tSC, tSR);
      startEdit();
      scheduleRender();
      nextTick(() => editInputRef.value?.focus());
      ltT = 0;
    } else {
      commitEdit();
      selectCell(tSC, tSR);
      scheduleRender();
      ltT = n;
    }
    ltC = tSC;
    ltR = tSR;
    canvasRef.value?.focus();
  }
}

// 键盘
function onKeydown(e: KeyboardEvent) {
  if (editingCell.value) return;
  const ctl = e.ctrlKey || e.metaKey, sh = e.shiftKey;
  switch (true) {
    case ctl && (e.key === 'c' || e.key === 'C'):
      e.preventDefault();
      copyToClipboard();
      return;
    case ctl && (e.key === 'x' || e.key === 'X'):
      e.preventDefault();
      cutSelected();
      return;
    case ctl && (e.key === 'z' || e.key === 'Z'):
      e.preventDefault();
      undo();
      return;
    case ctl && (e.key === 'y' || e.key === 'Y'):
      e.preventDefault();
      redo();
      return;
    case ctl && (e.key === 'v' || e.key === 'V'):
      e.preventDefault();
      saveUndo();
      pasteFromClipboard().then(() => {
        scheduleRender();
        nextTick(emitModelData);
      });
      return;
    case ctl && (e.key === 'a' || e.key === 'A'):
      e.preventDefault();
      selectAll();
      scheduleRender();
      return;
    case ctl && e.key === 'Home':
      e.preventDefault();
      selectCell(0, 0);
      ensureVisible(0, 0);
      scheduleRender();
      return;
    case ctl && e.key === 'End':
      e.preventDefault();
      selectCell(colCount - 1, rowCount - 1);
      ensureVisible(colCount - 1, rowCount - 1);
      scheduleRender();
      return;
    case e.key === 'Home':
      e.preventDefault();
      selectCell(0, activeCell.value.row);
      ensureVisible(0, activeCell.value.row);
      scheduleRender();
      return;
    case e.key === 'End':
      e.preventDefault();
      selectCell(colCount - 1, activeCell.value.row);
      ensureVisible(colCount - 1, activeCell.value.row);
      scheduleRender();
      return;
    case e.key === 'ArrowUp':
      e.preventDefault();
      moveActive(0, -1);
      ensureVisible(activeCell.value.col, activeCell.value.row);
      scheduleRender();
      return;
    case e.key === 'ArrowDown':
      e.preventDefault();
      moveActive(0, 1);
      ensureVisible(activeCell.value.col, activeCell.value.row);
      scheduleRender();
      return;
    case e.key === 'ArrowLeft':
      e.preventDefault();
      moveActive(-1, 0);
      ensureVisible(activeCell.value.col, activeCell.value.row);
      scheduleRender();
      return;
    case e.key === 'ArrowRight':
      e.preventDefault();
      moveActive(1, 0);
      ensureVisible(activeCell.value.col, activeCell.value.row);
      scheduleRender();
      return;
    case e.key === 'Tab':
      e.preventDefault();
      moveActive(sh ? -1 : 1, 0);
      ensureVisible(activeCell.value.col, activeCell.value.row);
      scheduleRender();
      return;
    case e.key === 'Enter':
      e.preventDefault();
      moveActive(0, sh ? -1 : 1);
      ensureVisible(activeCell.value.col, activeCell.value.row);
      scheduleRender();
      return;
    case e.key === 'F2':
      e.preventDefault();
      ensureVisible(activeCell.value.col, activeCell.value.row);
      startEdit();
      scheduleRender();
      nextTick(() => editInputRef.value?.focus());
      return;
    case e.key === 'Delete':
    case e.key === 'Backspace':
      e.preventDefault();
      saveUndo();
      clearSelected();
      scheduleRender();
      return;
    case e.key === 'Escape':
      e.preventDefault();
      cancelEdit();
      scheduleRender();
      return;
    case e.key.length === 1 && !ctl:
      e.preventDefault();
      ensureVisible(activeCell.value.col, activeCell.value.row);
      startEdit();
      editValue.value = e.key;
      scheduleRender();
      nextTick(() => {
        const inp = editInputRef.value;
        if (inp) {
          inp.focus();
          inp.setSelectionRange(1, 1);
        }
      });
      return;
  }
}

// 编辑框
function onEditInput(e: Event) {
  editValue.value = (e.target as HTMLInputElement).value;
}
function onEditKd(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitEdit();
    moveActive(0, 1);
    ensureVisible(activeCell.value.col, activeCell.value.row);
    scheduleRender();
    canvasRef.value?.focus();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    commitEdit();
    moveActive(e.shiftKey ? -1 : 1, 0);
    ensureVisible(activeCell.value.col, activeCell.value.row);
    scheduleRender();
    canvasRef.value?.focus();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
    scheduleRender();
    canvasRef.value?.focus();
  }
}
function onEditBlur() {
  setTimeout(() => {
    if (editingCell.value) {
      commitEdit();
      scheduleRender();
    }
  }, 0);
}

// 尺寸
function applySize() {
  const wr = wrapperRef.value?.getBoundingClientRect();
  if (wr) {
    const pw = resolveSize(props.width);
    const ph = resolveSize(props.height);
    if (pw != null) viewSize.w = pw;
    else viewSize.w = wr.width;
    if (ph != null) viewSize.h = ph;
    else viewSize.h = wr.height;
  }
  clampScroll(null, null);
  scheduleRender();
}

let resizeObs: ResizeObserver | null = null;
onMounted(() => {
  const pw = resolveSize(props.width), ph = resolveSize(props.height);
  if (pw == null || ph == null) {
    resizeObs = new ResizeObserver(() => applySize());
    if (wrapperRef.value) resizeObs.observe(wrapperRef.value);
  }
  nextTick(() => {
    applySize();
  });
  selectCell(0, 0);
  if (modelData.value && modelData.value.length > 0) {
    lastEmittedData = JSON.stringify(modelData.value);
    sheets.value = modelData.value.map((s) => {
      const sh = mkSheet(s.name);
      for (const [k, v] of Object.entries(s.cells)) {
        sh.cells[k] = { value: v.value, style: v.style ?? null };
      }
      if (s.colWidths) {
        for (const [c, w] of Object.entries(s.colWidths)) {
          const ci = Number(c);
          if (ci >= 0 && ci < colCount && w >= 30) sh.colWidths[ci] = w;
        }
      }
      if (s.rowHeights) {
        for (const [r, h] of Object.entries(s.rowHeights)) {
          const ri = Number(r);
          if (ri >= 0 && ri < rowCount && h >= 24) sh.rowHeights[ri] = h;
        }
      }
      return sh;
    });
    if (sheets.value.length > 0) loadSheet(0);
  }
});
watch(() => [props.width, props.height], () => {
  const pw = resolveSize(props.width), ph = resolveSize(props.height);
  if (pw != null && ph != null) {
    resizeObs?.disconnect();
    resizeObs = null;
  } else if (!resizeObs && wrapperRef.value) {
    resizeObs = new ResizeObserver(() => applySize());
    resizeObs.observe(wrapperRef.value);
  }
  nextTick(() => applySize());
});
watch(() => props.theme, () => scheduleRender());
watch(() => ({ ...cells }), () => nextTick(emitModelData), { deep: false });
watch(activeSheetIndex, () => nextTick(emitModelData));
watch(() => modelData.value, (v) => {
  if (!v || v.length === 0) return;
  const nd = JSON.stringify(v);
  if (nd === lastEmittedData) return;
  lastEmittedData = nd;
  sheets.value = v.map((s) => {
    const sh = mkSheet(s.name);
    for (const [k, it] of Object.entries(s.cells)) {
      sh.cells[k] = { value: it.value, style: it.style ?? null };
    }
    if (s.colWidths) {
      for (const [c, w] of Object.entries(s.colWidths)) {
        const ci = Number(c);
        if (ci >= 0 && ci < colCount && w >= 30) sh.colWidths[ci] = w;
      }
    }
    if (s.rowHeights) {
      for (const [r, h] of Object.entries(s.rowHeights)) {
        const ri = Number(r);
        if (ri >= 0 && ri < rowCount && h >= 24) sh.rowHeights[ri] = h;
      }
    }
    return sh;
  });
  if (sheets.value.length > 0) loadSheet(0);
  scheduleRender();
}, { deep: true });
onBeforeUnmount(() => {
  resizeObs?.disconnect();
});
</script>

<template>
  <div
    class="spreadsheet-outer"
    :style="outerStyle"
  >
    <!-- Sheet 标签栏 -->
    <div
      class="tab-bar"
      @contextmenu="onTabBarCtx"
    >
      <div class="tab-list">
        <template
          v-for="(s, i) in sheets"
          :key="s.id"
        >
          <div
            class="tab-item"
            :class="{ 'tab-item--active': i === activeSheetIndex }"
            @click="onTabClick(i)"
            @dblclick.prevent="onTabDblClick(i)"
            @contextmenu="onTabCtxMenu($event, i)"
          >
            <template v-if="renTab === i">
              <input
                class="tab-rename-input"
                :value="renTabVal"
                @input="renTabVal = ($event.target as HTMLInputElement).value"
                @keydown="onTabRenameKd"
                @blur="commitTabRename"
                @click.stop
              >
            </template>
            <template v-else>
              <span class="tab-item__name">{{ s.name }}</span>
            </template>
          </div>
        </template>
      </div>
      <button
        class="tab-bar__add-btn"
        :title="t(locale, 'addSheet')"
        @click="addSheet(); scheduleRender()"
      >
        +
      </button>
    </div>

    <!-- 编辑栏 -->
    <div class="formula-bar">
      <div class="formula-bar__cell-label">
        {{ activeCellLabel }}
      </div>
      <input
        ref="formulaBarRef"
        class="formula-bar__input"
        :value="formulaBarDisplay"
        @focus="onFormulaBarFocus"
        @input="onFormulaBarInput"
        @keydown="onFormulaBarKeydown"
        @blur="onFormulaBarBlur"
      >
    </div>

    <div
      ref="wrapperRef"
      class="spreadsheet-wrapper"
    >
      <canvas
        ref="canvasRef"
        class="grid-canvas"
        tabindex="0"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseLeave"
        @dblclick="onDblClick"
        @wheel.prevent="onWheel"
        @keydown="onKeydown"
        @contextmenu="onCanvasCtx"
        @touchstart.prevent="onTouchStart"
        @touchmove.prevent="onTouchMove"
        @touchend="onTouchEnd"
      />
      <input
        v-if="editingCell"
        ref="editInputRef"
        class="cell-editor"
        :value="editValue"
        :style="editInputStyle"
        @input="onEditInput"
        @keydown="onEditKd"
        @blur="onEditBlur"
      >
      <!-- 垂直滚动条 -->
      <div
        v-if="maxScrollY > 0"
        class="v-scrollbar"
        :style="{ top: HEADER_HEIGHT + 'px', height: `calc(100% - ${HEADER_HEIGHT + SB_SIZE}px)` }"
      >
        <button
          class="sb-btn sb-btn--up"
          :title="t(locale, 'scrollUp')"
          @mousedown.prevent="clampScroll(null, scrollY - 50); scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--up" />
        </button>
        <div
          class="sb-track sb-track--v"
          @mousedown="onVTrk"
        >
          <div
            class="sb-thumb sb-thumb--v"
            :style="{ top: vThumbT + 'px', height: vThumbH + 'px' }"
            @mousedown="onVStart"
          />
        </div>
        <button
          class="sb-btn sb-btn--down"
          :title="t(locale, 'scrollDown')"
          @mousedown.prevent="clampScroll(null, scrollY + 50); scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--down" />
        </button>
      </div>
      <!-- 水平滚动条 -->
      <div
        v-if="maxScrollX > 0"
        class="h-scrollbar"
        :style="{ left: HEADER_WIDTH + 'px', width: `calc(100% - ${HEADER_WIDTH + SB_SIZE}px)` }"
      >
        <button
          class="sb-btn sb-btn--left"
          :title="t(locale, 'scrollLeft')"
          @mousedown.prevent="clampScroll(scrollX - 50, null); scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--left" />
        </button>
        <div
          class="sb-track sb-track--h"
          @mousedown="onHTrk"
        >
          <div
            class="sb-thumb sb-thumb--h"
            :style="{ left: hThumbL + 'px', width: hThumbW + 'px' }"
            @mousedown="onHStart"
          />
        </div>
        <button
          class="sb-btn sb-btn--right"
          :title="t(locale, 'scrollRight')"
          @mousedown.prevent="clampScroll(scrollX + 50, null); scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--right" />
        </button>
      </div>
      <div
        v-if="maxScrollX > 0 && maxScrollY > 0"
        class="sb-corner"
      />
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="ctxMenu"
        class="context-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <template
          v-for="(item, i) in ctxMenu.items"
          :key="i"
        >
          <div
            class="context-menu__item"
            :class="{ 'context-menu__item--disabled': item.disabled }"
            @click="!item.disabled && item.action && (item.action(), ctxMenu = null)"
            @mouseenter="onCtxItemEnter($event, item)"
          >
            <span class="context-menu__label">{{ item.label }}</span>
            <span
              v-if="item.children"
              class="context-menu__arrow"
            />
            <div
              v-if="item.children"
              class="context-submenu"
              :class="{ 'context-submenu--left': ctxSubmenuLeft }"
            >
              <div
                v-for="(child, j) in item.children"
                :key="j"
                class="context-menu__item"
                :class="{ 'context-menu__item--disabled': child.disabled }"
                @click.stop="!child.disabled && child.action && (child.action(), ctxMenu = null)"
              >
                {{ child.label }}
              </div>
            </div>
          </div>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.spreadsheet-outer { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.formula-bar { display: flex; align-items: start; height: 32px; min-height: 32px; padding: 0; gap: 0; }
.formula-bar__cell-label { width: 48px; min-width: 48px; height: 28px; line-height: 28px; text-align: center; font-size: 12px; font-weight: 600; color: var(--sp-formula-bar-label-color); background: var(--sp-formula-bar-label-bg); border: 1px solid var(--sp-formula-bar-label-border); border-radius: 2px; user-select: none; }
.formula-bar__input { flex: 1; height: 28px; border: 1px solid var(--sp-formula-bar-input-border); border-radius: 2px; outline: none; padding: 0 6px; margin-left: 4px; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; color: var(--sp-formula-bar-input-color); background: var(--sp-formula-bar-input-bg); }
.formula-bar__input:focus { border-color: var(--sp-formula-bar-input-focus-border); box-shadow: 0 0 0 1px var(--sp-formula-bar-input-focus-shadow); }
.tab-bar { display: flex; align-items: stretch; height: 30px; min-height: 30px; background: var(--sp-tab-bar-bg); border-bottom: 1px solid var(--sp-tab-bar-border); user-select: none; margin-bottom: 4px; }
.tab-list { display: flex; align-items: flex-end; flex: 1; overflow: hidden; gap: 1px; padding: 0 1px; }
.tab-item { display: flex; align-items: center; height: 28px; min-width: 0; max-width: 120px; padding: 0 10px; cursor: pointer; border: 1px solid var(--sp-tab-inactive-border); background: var(--sp-tab-inactive-bg); color: var(--sp-tab-inactive-color); font-size: 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; white-space: nowrap; transition: background 0.1s; }
.tab-item:hover { background: var(--sp-tab-hover-bg); }
.tab-item--active { height: 28px; background: var(--sp-tab-active-bg); color: var(--sp-tab-active-color); border-color: var(--sp-tab-bar-border) var(--sp-tab-bar-border) var(--sp-tab-active-bg); border-bottom: 2px solid var(--sp-tab-active-border); font-size: 16px; }
.tab-item--active:hover { background: var(--sp-tab-active-bg); }
.tab-item__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-rename-input { width: 100%; height: 18px; border: none; border-radius: 0; outline: none; padding: 0; font-size: 16px; font-family: inherit; background: var(--sp-tab-active-bg); color: var(--sp-tab-active-color); box-sizing: border-box; }
.tab-bar__add-btn { width: 24px; min-width: 24px; height: 24px; margin: 3px 4px 0 3px; border: none; background: transparent; color: var(--sp-tab-add-btn-color); font-size: 16px; line-height: 22px; text-align: center; cursor: pointer; padding: 0; }
.tab-bar__add-btn:hover { background: var(--sp-tab-add-btn-hover-bg); }
.spreadsheet-wrapper { flex: 1; position: relative; overflow: hidden; background: var(--sp-wrapper-bg); }
.grid-canvas { position: absolute; top: 0; left: 0; display: block; outline: none; cursor: cell; }
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
.cell-editor { position: absolute; border: 2px solid var(--sp-cell-editor-border); outline: none; padding: 0 4px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; color: var(--sp-cell-editor-color); background: var(--sp-cell-editor-bg); box-shadow: 0 0 0 1px var(--sp-cell-editor-shadow); z-index: 10; box-sizing: border-box; min-width: 0; }
</style>

<style>
.context-menu { position: fixed; z-index: 10000; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 4px 0; min-width: 120px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; }
.context-menu__item { padding: 6px 20px; cursor: pointer; color: #333; white-space: nowrap; position: relative; display: flex; align-items: center; justify-content: space-between; }
.context-menu__item:hover { background: #e8f0fe; }
.context-menu__item--disabled { color: #bbb; cursor: default; }
.context-menu__item--disabled:hover { background: transparent; }
.context-menu__arrow { margin-left: 16px; margin-right: -5px; width: 0; height: 0; border-top: 3px solid transparent; border-bottom: 3px solid transparent; border-left: 4px solid #888; }
.context-submenu { display: none; position: absolute; left: 100%; top: -4px; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 4px 0; min-width: 100px; z-index: 10001; }
.context-submenu--left { left: auto; right: 100%; }
.context-menu__item:hover > .context-submenu { display: block; }
.context-submenu .context-menu__item { justify-content: flex-start; }
</style>
