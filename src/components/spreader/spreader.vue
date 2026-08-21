<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { HEADER_HEIGHT, HEADER_WIDTH, SB_SIZE, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, MIN_COL_WIDTH, MIN_ROW_HEIGHT, MAX_COL_WIDTH, MAX_ROW_HEIGHT, UNDO_MAX, t, lightTheme, darkTheme, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, FONT_FAMILIES, FONT_SIZES, H_ALIGN_OPTIONS, V_ALIGN_OPTIONS } from './constants';
import type { MergeType } from './constants';
import Toolbar from './toolbar.vue';
import Tabbar from './tabbar.vue';
import { colToLabel, resolveSize, writeClipboardText, getCanvasXY } from './utils';
import { FormulaDeps, parseFormulaRefs, clearEvalCache, computeCellValue, shiftFormulaRefs } from './formula';
import { buildOuterStyle } from './theme';
import type { CellCoord, CellData, SelectionRange, SheetState, SheetModelData, ContextMenuItem } from './types';
import type { BorderType } from './borderPicker.vue';

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
const merges = reactive<Record<string, SelectionRange>>({});
const formulaDeps = new FormulaDeps();
const selection = ref<SelectionRange | null>(null);
const activeCell = ref<CellCoord>({ col: 0, row: 0 });
const editingCell = ref<CellCoord | null>(null);
const editValue = ref('');
const colWidths = ref<number[]>(new Array(colCount).fill(DEFAULT_COL_WIDTH));
const rowHeights = ref<(number | undefined)[]>(new Array(rowCount).fill(undefined));
const scrollX = ref(0);
const scrollY = ref(0);

// ============ 高 DPI 字号缩放 ============
/** 基准上下内边距（px）——以默认字号10px、默认行高24px为基准，每侧7px */
const BASE_CELL_VPAD = (DEFAULT_ROW_HEIGHT - DEFAULT_FONT_SIZE) / 2;

// ============ 字体度量（Canvas 与 input 共用） ============
const fontMetricsCache = new Map<string, { ascent: number; descent: number }>();
let fontMetricsCanvas: HTMLCanvasElement | null = null;

function measureFontMetrics(family: string, size: number, weight: string, style: string): { ascent: number; descent: number } {
  const key = `${style} ${weight} ${size}px ${family}`;
  const cached = fontMetricsCache.get(key);
  if (cached) return cached;
  if (!fontMetricsCanvas) fontMetricsCanvas = document.createElement('canvas');
  const ctx = fontMetricsCanvas.getContext('2d');
  if (!ctx) return { ascent: size * 0.8, descent: size * 0.2 };
  ctx.font = key;
  const m = ctx.measureText('M');
  const rawAsc = m.actualBoundingBoxAscent;
  const rawDesc = m.actualBoundingBoxDescent;
  const ascent = rawAsc || size * 0.8;
  const descent = rawDesc || size * 0.2;
  const a = Math.max(ascent, size * 0.5);
  const d = Math.max(descent, size * 0.15);
  const result = { ascent: a, descent: d };
  fontMetricsCache.set(key, result);
  return result;
}

function getFontMetricsForCell(c: number, r: number): { ascent: number; descent: number } {
  const st = cells[cellKey(c, r)]?.style;
  const fsz = cellFontSize(c, r);
  const ffa = typeof st?.fontFamily === 'string' && st.fontFamily ? st.fontFamily : DEFAULT_FONT_FAMILY;
  const fw = st?.fontWeight === 'bold' ? 'bold' : 'normal';
  const fs = st?.fontStyle === 'italic' ? 'italic' : 'normal';
  return measureFontMetrics(ffa, fsz, fw, fs);
}

/** 将文本按 \n 分割，并可选地按宽度自动换行 */
function getWrappedLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, wrap: boolean): string[] {
  if (!text) return [''];
  const paragraphs = text.split('\n');
  const result: string[] = [];
  for (const para of paragraphs) {
    if (!wrap || maxWidth <= 0) {
      result.push(para);
    } else {
      let currentLine = '';
      for (let i = 0; i < para.length; i++) {
        const ch = para[i]!;
        const testLine = currentLine + ch;
        const w = ctx.measureText(testLine).width;
        if (w > maxWidth && currentLine) {
          result.push(currentLine);
          currentLine = ch;
        } else {
          currentLine = testLine;
        }
      }
      result.push(currentLine);
    }
  }
  return result;
}
/** 读取单元格的字号属性值 */
function cellFontSize(c: number, r: number): number {
  const st = cells[cellKey(c, r)]?.style;
  return typeof st?.fontSize === 'number' && st.fontSize > 0 ? st.fontSize : DEFAULT_FONT_SIZE;
}

// ============ 列位置/行位置计算 ============
const colPositions = computed(() => {
  const p = [0];
  for (let i = 0; i < colCount; i++) p.push(p[i]! + colWidths.value[i]!);
  return p;
});
/** 计算行的实际高度：显式行高优先，否则按行内最大字号自动撑大（不小于默认行高）
 *  注意：行高使用逻辑字号（非 DPI 缩放），DPI 缩放仅影响 Canvas 渲染清晰度 */
function getRowHeight(r: number): number {
  const h = rowHeights.value[r];
  if (h !== undefined && h !== null && h > 0) return h;
  let maxFs = DEFAULT_FONT_SIZE;
  let maxAsc = maxFs * 0.8;
  let maxDesc = maxFs * 0.2;
  let maxLines = 1;
  const ctx = fontMetricsCanvas ? fontMetricsCanvas.getContext('2d') : null;
  for (let c = 0; c < colCount; c++) {
    const fs = cellFontSize(c, r);
    const st = cells[cellKey(c, r)]?.style;
    const ffa = typeof st?.fontFamily === 'string' && st.fontFamily ? st.fontFamily : DEFAULT_FONT_FAMILY;
    const fw = st?.fontWeight === 'bold' ? 'bold' : 'normal';
    const fstyle = st?.fontStyle === 'italic' ? 'italic' : 'normal';
    const v = getCellValue(c, r);
    if (v && ctx) {
      ctx.font = `${fstyle} ${fw} ${fs}px ${ffa}`;
      const firstLine = v.split('\n')[0] || v;
      const m = ctx.measureText(firstLine);
      const rawAsc = m.actualBoundingBoxAscent;
      const rawDesc = m.actualBoundingBoxDescent;
      const a = rawAsc || fs * 0.8;
      const d = rawDesc || fs * 0.2;
      const cellAsc = Math.max(a, fs * 0.5);
      const cellDesc = Math.max(d, fs * 0.15);
      if (cellAsc > maxAsc) maxAsc = cellAsc;
      if (cellDesc > maxDesc) maxDesc = cellDesc;
      if (fs > maxFs) maxFs = fs;
      const stWrap = st?.wrap === 'wrap';
      let cellLines: number;
      if (stWrap) {
        // 合并单元格使用合并后的总宽度进行换行计算
        const mergeInfo = findMerge(c, r);
        let wrapWidth: number;
        if (mergeInfo && c === mergeInfo.range.startCol && r === mergeInfo.range.startRow) {
          wrapWidth = colPositions.value[mergeInfo.range.endCol + 1]! - colPositions.value[c]!;
        } else {
          wrapWidth = colWidths.value[c]!;
        }
        const lines = getWrappedLines(ctx, v, Math.max(0, wrapWidth - 10), true);
        cellLines = lines.length;
        if (cellLines > maxLines) maxLines = cellLines;
      } else {
        cellLines = v.split('\n').length;
        if (cellLines > maxLines) maxLines = cellLines;
      }
    } else if (fs > maxFs) {
      maxFs = fs;
      const metrics = measureFontMetrics(ffa, fs, fw, fstyle);
      if (metrics.ascent > maxAsc) maxAsc = metrics.ascent;
      if (metrics.descent > maxDesc) maxDesc = metrics.descent;
    }
  }
  const lineH = maxFs;
  const calculated = BASE_CELL_VPAD * 2 + maxLines * lineH;
  const finalHeight = Math.min(MAX_ROW_HEIGHT, Math.max(DEFAULT_ROW_HEIGHT, Math.round(calculated)));
  return finalHeight;
}
/** 判断行是否为自动行高（无显式行高属性） */
function isAutoRow(r: number): boolean {
  return rowHeights.value[r] === undefined;
}
const rowPositions = computed(() => {
  const p = [0];
  for (let i = 0; i < rowCount; i++) p.push(p[i]! + getRowHeight(i));
  return p;
});
const totalWidth = computed(() => colPositions.value[colCount]!);
const totalHeight = computed(() => rowPositions.value[rowCount]!);

// ============ 选区操作 ============
function selectCell(c: number, r: number) {
  // 如果点击合并单元格，选区扩展为整个合并区域，活跃单元格为锚点
  const m = findMerge(c, r);
  if (m) {
    activeCell.value = { col: m.range.startCol, row: m.range.startRow };
    selection.value = { ...m.range };
  } else {
    activeCell.value = { col: c, row: r };
    selection.value = { startCol: c, startRow: r, endCol: c, endRow: r };
  }
}
function selectRange(sC: number, sR: number, eC: number, eR: number) {
  // 活跃单元格 = 起始位置（若在合并区域内则取锚点）
  const m = findMerge(sC, sR);
  activeCell.value = m ? { col: m.range.startCol, row: m.range.startRow } : { col: sC, row: sR };
  // 扩展选区以完全包含重叠的合并单元格
  selection.value = expandSelectionForMerges(sC, sR, eC, eR);
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

// ============ 合并单元格：辅助函数 ============
/** 查找包含指定单元格的合并区域，返回 { range, anchor } 或 null */
function findMerge(c: number, r: number): { range: SelectionRange; anchor: string } | null {
  for (const key in merges) {
    const m = merges[key];
    if (!m) continue;
    if (c >= m.startCol && c <= m.endCol && r >= m.startRow && r <= m.endRow) {
      return { range: m, anchor: key };
    }
  }
  return null;
}
/** 判断单元格是否为合并区域的锚点（左上角） */
function isMergeAnchor(c: number, r: number): boolean {
  return merges[cellKey(c, r)] !== undefined;
}
/** 获取合并单元格的跨距 { w, h }（像素宽度/高度），非合并返回单格尺寸 */
function mergedSpan(c: number, r: number): { w: number; h: number } {
  const m = findMerge(c, r);
  if (m && c === m.range.startCol && r === m.range.startRow) {
    const w = colPositions.value[m.range.endCol + 1]! - colPositions.value[c]!;
    const h = rowPositions.value[m.range.endRow + 1]! - rowPositions.value[r]!;
    return { w, h };
  }
  return { w: colWidths.value[c]!, h: getRowHeight(r) };
}
/**
 * 扩展选区以完全包含所有与当前选区部分重叠的合并单元格。
 * 反复扩展直到稳定（因为扩展可能引入新的重叠合并）。
 */
function expandSelectionForMerges(sC: number, sR: number, eC: number, eR: number): SelectionRange {
  let minC = Math.min(sC, eC);
  let maxC = Math.max(sC, eC);
  let minR = Math.min(sR, eR);
  let maxR = Math.max(sR, eR);
  let changed = true;
  while (changed) {
    changed = false;
    for (const key in merges) {
      const m = merges[key];
      if (!m) continue;
      // 检查是否有部分重叠（一个矩形与另一个矩形相交但非包含）
      const overlap = m.startCol <= maxC && m.endCol >= minC && m.startRow <= maxR && m.endRow >= minR;
      if (overlap) {
        if (m.startCol < minC) { minC = m.startCol; changed = true; }
        if (m.endCol > maxC) { maxC = m.endCol; changed = true; }
        if (m.startRow < minR) { minR = m.startRow; changed = true; }
        if (m.endRow > maxR) { maxR = m.endRow; changed = true; }
      }
    }
  }
  return { startCol: minC, startRow: minR, endCol: maxC, endRow: maxR };
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
      // 同步清除相邻单元格的对应边框
      syncCellBorders(c, r);
    }
  }
}

// ============ 编辑状态 ============
function startEdit(initialValue?: string) {
  if (!editingCell.value) {
    editingCell.value = { ...activeCell.value };
    editValue.value = initialValue ?? getCellRaw(activeCell.value.col, activeCell.value.row);
  }
}
function commitEdit() {
  if (editingCell.value) {
    saveUndo();
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
  const cur = activeCell.value;
  let newC = Math.max(0, Math.min(colCount - 1, cur.col + dC));
  let newR = Math.max(0, Math.min(rowCount - 1, cur.row + dR));

  const curMerge = findMerge(cur.col, cur.row);
  const targetMerge = findMerge(newC, newR);

  // 如果当前在合并区域内，且移动后仍在同一合并区域，则跳过整个合并区域
  if (curMerge && targetMerge && curMerge.anchor === targetMerge.anchor) {
    if (dC > 0) newC = curMerge.range.endCol + 1;
    else if (dC < 0) newC = curMerge.range.startCol - 1;
    if (dR > 0) newR = curMerge.range.endRow + 1;
    else if (dR < 0) newR = curMerge.range.startRow - 1;
    newC = Math.max(0, Math.min(colCount - 1, newC));
    newR = Math.max(0, Math.min(rowCount - 1, newR));
  }

  selectCell(newC, newR);
}
function ensureVisible(c: number, r: number) {
  const gw = Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE);
  const gh = Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE);
  const cx = colPositions.value[c]!;
  const cy = rowPositions.value[r]!;
  const m = findMerge(c, r);
  const cw = m ? colPositions.value[m.range.endCol + 1]! - colPositions.value[c]! : colWidths.value[c]!;
  const ch = m ? rowPositions.value[m.range.endRow + 1]! - rowPositions.value[r]! : getRowHeight(r);
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
interface UndoSnap {
  sheets: SheetState[];
  activeSheetIndex: number;
}
const undoStack = ref<UndoSnap[]>([]);
const redoStack = ref<UndoSnap[]>([]);
function cloneCells(src: Record<string, CellData>): Record<string, CellData> {
  const o: Record<string, CellData> = {};
  for (const [k, v] of Object.entries(src)) o[k] = { value: v.value, style: v.style };
  return o;
}
function takeSnap(): UndoSnap {
  saveSheet();
  return {
    sheets: sheets.value.map((s) => ({
      id: s.id, name: s.name,
      cells: cloneCells(s.cells),
      merges: s.merges ? { ...s.merges } : {},
      selection: s.selection ? { ...s.selection } : null,
      activeCell: s.activeCell ? { ...s.activeCell } : { col: 0, row: 0 },
      scrollX: s.scrollX, scrollY: s.scrollY,
      colWidths: [...s.colWidths], rowHeights: [...s.rowHeights],
    })),
    activeSheetIndex: activeSheetIndex.value,
  };
}
function restoreSnap(s: UndoSnap) {
  sheets.value = s.sheets.map((x) => ({ ...x, cells: cloneCells(x.cells) }));
  loadSheet(Math.max(0, Math.min(s.activeSheetIndex, sheets.value.length - 1)));
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
  scheduleRender();
  nextTick(emitModelData);
}
function redo() {
  if (!redoStack.value.length) return;
  undoStack.value.push(takeSnap());
  restoreSnap(redoStack.value.pop()!);
  scheduleRender();
  nextTick(emitModelData);
}

// ============ 工具栏：格式刷 / 清除格式 ============
const canUndo = computed(() => undoStack.value.length > 0);
const canRedo = computed(() => redoStack.value.length > 0);
const hasSelection = computed(() => !!selection.value);

/** 格式刷：记录源区域各单元格样式（按相对位置） */
const paintFmt = ref<{ styles: Record<string, Record<string, unknown> | null> } | null>(null);
function onPaintFormat() {
  const sel = selection.value;
  if (!sel) return;
  const styles: Record<string, Record<string, unknown> | null> = {};
  for (let c = sel.startCol; c <= sel.endCol; c++) {
    for (let r = sel.startRow; r <= sel.endRow; r++) {
      styles[`${c - sel.startCol},${r - sel.startRow}`] = cells[cellKey(c, r)]?.style ?? null;
    }
  }
  paintFmt.value = { styles };
}
function applyPaintFormat() {
  const pf = paintFmt.value;
  const sel = selection.value;
  if (!pf || !sel) return;
  saveUndo();
  for (let c = sel.startCol; c <= sel.endCol; c++) {
    for (let r = sel.startRow; r <= sel.endRow; r++) {
      // 跳过合并区域的覆盖单元格（非锚点）
      const m = findMerge(c, r);
      if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
      const st = pf.styles[`${c - sel.startCol},${r - sel.startRow}`] ?? null;
      const k = cellKey(c, r);
      const val = cells[k]?.value ?? '';
      if (val === '' && st === null) delCell(k);
      else cells[k] = { value: val, style: st };
      // 同步相邻单元格的对应边框
      syncCellBorders(c, r);
    }
  }
  paintFmt.value = null;
  scheduleRender();
  emitModelData();
}
function clearFormat() {
  const sel = selection.value;
  if (!sel) return;
  saveUndo();
  for (let c = sel.startCol; c <= sel.endCol; c++) {
    for (let r = sel.startRow; r <= sel.endRow; r++) {
      // 跳过合并区域的覆盖单元格（非锚点）
      const m = findMerge(c, r);
      if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
      const k = cellKey(c, r);
      const val = cells[k]?.value ?? '';
      if (val === '') delCell(k);
      else cells[k] = { value: val, style: null };
      // 同步清除相邻单元格的对应边框
      syncCellBorders(c, r);
    }
  }
  scheduleRender();
  emitModelData();
}

// ============ 工具栏：字体 / 字号 ============
const fontFamilyOptions = computed(() =>
  FONT_FAMILIES.map((f) => ({ ...f, label: f.value === '' ? t(locale.value, 'fontDefault') : f.label }))
);
const fontSizeOptions = computed(() =>
  FONT_SIZES.map((f) => ({ ...f, label: String(f.value) }))
);
const FONT_FAMILY_MIXED = '\u0000';
const selFontFamily = computed(() => {
  const sel = selection.value;
  if (!sel) return '';
  let first: string | undefined;
  let mixed = false;
  for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
    for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
      const st = cells[cellKey(c, r)]?.style;
      const ff = typeof st?.fontFamily === 'string' ? st.fontFamily : '';
      if (first === undefined) first = ff;
      else if (ff !== first) mixed = true;
    }
  }
  return mixed ? FONT_FAMILY_MIXED : (first ?? '');
});
const selFontSize = computed(() => {
  const sel = selection.value;
  if (!sel) return DEFAULT_FONT_SIZE;
  let first: number | undefined;
  let mixed = false;
  for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
    for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
      const fsz = cellFontSize(c, r);
      if (first === undefined) first = fsz;
      else if (fsz !== first) mixed = true;
    }
  }
  return mixed ? 0 : (first ?? DEFAULT_FONT_SIZE);
});

function applyStyleToSelection(prop: string, value: unknown) {
  const sel = selection.value;
  if (!sel) return;
  saveUndo();
  for (let c = sel.startCol; c <= sel.endCol; c++) {
    for (let r = sel.startRow; r <= sel.endRow; r++) {
      // 跳过合并区域的覆盖单元格（非锚点），样式只应用到锚点
      const m = findMerge(c, r);
      if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
      const k = cellKey(c, r);
      const val = cells[k]?.value ?? '';
      const st = cells[k]?.style ? { ...cells[k]!.style } : {};
      if (value === '' || value === null || value === undefined || value === 0) delete st[prop];
      else st[prop] = value;
      const style = Object.keys(st).length ? st : null;
      if (val === '' && style === null) delCell(k);
      else cells[k] = { value: val, style };
    }
  }
  scheduleRender();
  emitModelData();
}
function onFontFamilyChange(v: string | number) {
  applyStyleToSelection('fontFamily', v === '' ? '' : v);
}
function onFontSizeChange(v: string | number) {
  applyStyleToSelection('fontSize', v);
  fontSizeMenuOpen.value = false;
}

// ============ 工具栏：对齐 ============
const hAlignOptions = computed(() =>
  H_ALIGN_OPTIONS.map((o) => ({ label: t(locale.value, o.labelKey), value: o.value, icon: o.icon }))
);
const vAlignOptions = computed(() =>
  V_ALIGN_OPTIONS.map((o) => ({ label: t(locale.value, o.labelKey), value: o.value, icon: o.icon }))
);
// 以选区左上角（首单元格）的对齐属性为显示基准；无属性默认左对齐 / 顶端对齐
const selHAlign = computed(() => {
  const sel = selection.value;
  if (!sel) return 'left';
  const st = cells[cellKey(sel.startCol, sel.startRow)]?.style;
  const a = typeof st?.textAlign === 'string' ? st.textAlign : '';
  return a === 'center' || a === 'right' ? a : 'left';
});
const selVAlign = computed(() => {
  const sel = selection.value;
  if (!sel) return 'top';
  const st = cells[cellKey(sel.startCol, sel.startRow)]?.style;
  const a = typeof st?.verticalAlign === 'string' ? st.verticalAlign : '';
  return a === 'middle' || a === 'bottom' ? a : 'top';
});
const selWrap = computed(() => {
  const sel = selection.value;
  if (!sel) return false;
  const st = cells[cellKey(sel.startCol, sel.startRow)]?.style;
  return st?.wrap === 'wrap';
});
function onHAlignChange(v: string | number) {
  applyStyleToSelection('textAlign', v);
}
function onVAlignChange(v: string | number) {
  applyStyleToSelection('verticalAlign', v);
}
function onWrapToggle() {
  const sel = selection.value;
  if (!sel) return;
  const cur = selWrap.value;
  applyStyleToSelection('wrap', cur ? undefined : 'wrap');
}

const fontSizeInput = ref('');
const fontSizeMenuOpen = ref(false);

watch(selFontSize, (v) => {
  fontSizeInput.value = v === 0 ? '' : String(v);
}, { immediate: true });

function onFontSizeInput(raw: string) {
  const filtered = raw.replace(/[^\d]/g, '');
  fontSizeInput.value = filtered;
  // 实时更新选中单元格（范围5-72）
  const num = parseInt(filtered, 10);
  if (!isNaN(num) && num >= 5 && num <= 72) {
    if (num !== selFontSize.value) {
      applyStyleToSelection('fontSize', num);
    }
  }
}

function onFontSizeBlur() {
  const raw = fontSizeInput.value.trim();
  if (!raw) {
    // 空值恢复当前单元格字号
    fontSizeInput.value = selFontSize.value === 0 ? '' : String(selFontSize.value);
    return;
  }
  let v = parseInt(raw, 10);
  if (isNaN(v)) {
    v = selFontSize.value === 0 ? DEFAULT_FONT_SIZE : selFontSize.value;
  } else {
    v = Math.max(5, Math.min(72, v));
  }
  fontSizeInput.value = String(v);
  if (v !== selFontSize.value) {
    applyStyleToSelection('fontSize', v);
  }
}

function onFontSizeKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    ;(e.target as HTMLInputElement).blur();
  }
}

function toggleFontSizeMenu(e?: MouseEvent) {
  if (e) e.preventDefault();
  fontSizeMenuOpen.value = !fontSizeMenuOpen.value;
  if (fontSizeMenuOpen.value) {
    mergeMenuOpen.value = false;
    borderMenuOpen.value = false;
    textColorMenuOpen.value = false;
    fillColorMenuOpen.value = false;
  }
}

function onFontSizeStepUp() {
  const cur = selFontSize.value === 0 ? DEFAULT_FONT_SIZE : selFontSize.value;
  const next = Math.min(72, cur + 1);
  applyStyleToSelection('fontSize', next);
  fontSizeInput.value = String(next);
  fontSizeMenuOpen.value = false;
}

function onFontSizeStepDown() {
  const cur = selFontSize.value === 0 ? DEFAULT_FONT_SIZE : selFontSize.value;
  const next = Math.max(5, cur - 1);
  applyStyleToSelection('fontSize', next);
  fontSizeInput.value = String(next);
  fontSizeMenuOpen.value = false;
}

// ============ 字体样式：粗体 / 斜体 / 下划线 / 删除线 ============
function selStyleActive(prop: string): boolean {
  const sel = selection.value;
  if (!sel) return false;
  let first: boolean | undefined;
  let mixed = false;
  for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
    for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
      const st = cells[cellKey(c, r)]?.style;
      const v = Boolean(st?.[prop]);
      if (first === undefined) first = v;
      else if (v !== first) mixed = true;
    }
  }
  return !mixed && first === true;
}

const selFontWeight = computed(() => selStyleActive('fontWeight'));
const selFontStyle = computed(() => selStyleActive('fontStyle'));
const selUnderline = computed(() => selStyleActive('underline'));
const selStrikethrough = computed(() => selStyleActive('strikethrough'));

function toggleFontWeight() {
  applyStyleToSelection('fontWeight', selFontWeight.value ? '' : 'bold');
}
function toggleFontStyle() {
  applyStyleToSelection('fontStyle', selFontStyle.value ? '' : 'italic');
}
function toggleUnderline() {
  applyStyleToSelection('underline', selUnderline.value ? '' : 'underline');
}
function toggleStrikethrough() {
  applyStyleToSelection('strikethrough', selStrikethrough.value ? '' : 'line-through');
}

// ============ 文字颜色 / 填充颜色 ============
const cachedTextColor = ref<string>('');
const cachedFillColor = ref<string>('');
const textColorMenuOpen = ref(false);
const fillColorMenuOpen = ref(false);

function toggleTextColorMenu() {
  textColorMenuOpen.value = !textColorMenuOpen.value;
  fillColorMenuOpen.value = false;
  borderMenuOpen.value = false;
  mergeMenuOpen.value = false;
}
function toggleFillColorMenu() {
  fillColorMenuOpen.value = !fillColorMenuOpen.value;
  textColorMenuOpen.value = false;
  borderMenuOpen.value = false;
  mergeMenuOpen.value = false;
}
function onBorderMenuToggle(v: boolean) {
  borderMenuOpen.value = v;
  if (v) {
    textColorMenuOpen.value = false;
    fillColorMenuOpen.value = false;
    mergeMenuOpen.value = false;
  }
}
function onTextColorChange(v: string) {
  cachedTextColor.value = v;
  applyStyleToSelection('color', v === '' ? '' : v);
}
function onFillColorChange(v: string) {
  cachedFillColor.value = v;
  applyStyleToSelection('backgroundColor', v === '' ? '' : v);
}
function applyCachedTextColor() {
  applyStyleToSelection('color', cachedTextColor.value === '' ? '' : cachedTextColor.value);
}
function applyCachedFillColor() {
  applyStyleToSelection('backgroundColor', cachedFillColor.value === '' ? '' : cachedFillColor.value);
}

const selTextColor = computed(() => {
  const sel = selection.value;
  if (!sel) return '';
  let first: string | undefined;
  let mixed = false;
  for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
    for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
      const st = cells[cellKey(c, r)]?.style;
      const v = typeof st?.color === 'string' ? st.color : '';
      if (first === undefined) first = v;
      else if (v !== first) mixed = true;
    }
  }
  return mixed ? '' : (first ?? '');
});

const selFillColor = computed(() => {
  const sel = selection.value;
  if (!sel) return '';
  let first: string | undefined;
  let mixed = false;
  for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
    for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
      const st = cells[cellKey(c, r)]?.style;
      const v = typeof st?.backgroundColor === 'string' ? st.backgroundColor : '';
      if (first === undefined) first = v;
      else if (v !== first) mixed = true;
    }
  }
  return mixed ? '' : (first ?? '');
});

// ============ 边框 ============
const cachedBorder = ref<BorderType>('none');
const borderMenuOpen = ref(false);

/** 边框默认颜色（与网格线区分） */
const BORDER_COLOR = '#444';

/**
 * 将 BorderType 转换为每个单元格四边的边框宽度 { top, bottom, left, right }。
 * 宽度 0 = 无边框，1 = 细线，2 = 粗线。
 * 行业通行规则：每个单元格存储自己的四边边框，相邻单元格共享的边线
 *   由较宽的一方决定渲染（例如 A 的右边框=2，B 的左边框=1，则共享边画宽度 2）。
 */
function borderTypeToWidths(bt: BorderType, col: number, row: number, sel: SelectionRange): { top: number; bottom: number; left: number; right: number } {
  // 合并单元格的锚点：使用合并区域的边界来判断是否在选区边缘
  const m = findMerge(col, row);
  const ec = m ? m.range.endCol : col;
  const er = m ? m.range.endRow : row;
  const sc = m ? m.range.startCol : col;
  const sr = m ? m.range.startRow : row;
  const isEdgeTop = sr === sel.startRow;
  const isEdgeBottom = er === sel.endRow;
  const isEdgeLeft = sc === sel.startCol;
  const isEdgeRight = ec === sel.endCol;
  const w = { top: 0, bottom: 0, left: 0, right: 0 };
  switch (bt) {
    case 'none':
      return w;
    case 'bottom':
      if (isEdgeBottom) w.bottom = 1;
      break;
    case 'top':
      if (isEdgeTop) w.top = 1;
      break;
    case 'left':
      if (isEdgeLeft) w.left = 1;
      break;
    case 'right':
      if (isEdgeRight) w.right = 1;
      break;
    case 'all':
      w.top = 1; w.bottom = 1; w.left = 1; w.right = 1;
      break;
    case 'outer':
      if (isEdgeTop) w.top = 1;
      if (isEdgeBottom) w.bottom = 1;
      if (isEdgeLeft) w.left = 1;
      if (isEdgeRight) w.right = 1;
      break;
    case 'thickOuter':
      if (isEdgeTop) w.top = 2;
      if (isEdgeBottom) w.bottom = 2;
      if (isEdgeLeft) w.left = 2;
      if (isEdgeRight) w.right = 2;
      break;
  }
  return w;
}

function onBorderChange(bt: BorderType) {
  cachedBorder.value = bt;
  const sel = selection.value;
  if (!sel) return;
  saveUndo();
  if (bt === 'none') {
    // 清除选区内所有边框属性（跳过合并区域的非锚点单元格）
    for (let c = sel.startCol; c <= sel.endCol; c++) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        const m = findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        applyBorderToCell(c, r, { top: 0, bottom: 0, left: 0, right: 0 }, true);
      }
    }
  } else {
    // 对选区中每个单元格只增加对应边框（跳过合并区域的非锚点单元格）
    for (let c = sel.startCol; c <= sel.endCol; c++) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        const m = findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const w = borderTypeToWidths(bt, c, r, sel);
        applyBorderToCell(c, r, w, false);
      }
    }
  }
  scheduleRender();
  emitModelData();
}

/** 设置单个单元格某侧边框宽度（处理合并单元格，操作锚点样式）。
 *  width=0 且 clearZero=true 时删除该侧边框属性。 */
function setCellBorderSide(col: number, row: number, side: 'Top' | 'Bottom' | 'Left' | 'Right', width: number, clearZero: boolean) {
  if (col < 0 || row < 0 || col >= colCount || row >= rowCount) return;
  const m = findMerge(col, row);
  if (m) {
    // 只在合并区域的外边缘侧才同步
    if (side === 'Top' && row !== m.range.startRow) return;
    if (side === 'Bottom' && row !== m.range.endRow) return;
    if (side === 'Left' && col !== m.range.startCol) return;
    if (side === 'Right' && col !== m.range.endCol) return;
  }
  const k = m ? m.anchor : cellKey(col, row);
  const val = cells[k]?.value ?? '';
  const st = cells[k]?.style ? { ...cells[k]!.style } : {};
  const prop = `border${side}Width`;
  if (width === 0) {
    if (clearZero) delete st[prop];
  } else {
    st[prop] = width;
    st.borderColor = BORDER_COLOR;
  }
  const dirs = ['Top', 'Bottom', 'Left', 'Right'] as const;
  const hasBorder = dirs.some(d => st[`border${d}Width`] !== undefined);
  if (!hasBorder) delete st.borderColor;
  const style = Object.keys(st).length ? st : null;
  if (val === '' && style === null) delCell(k);
  else cells[k] = { value: val, style };
}

/** 读取单元格当前四边边框宽度，同步到相邻单元格的对应边。 */
function syncCellBorders(col: number, row: number) {
  const m = findMerge(col, row);
  const k = m ? m.anchor : cellKey(col, row);
  const st = cells[k]?.style;
  const wT = (st?.borderTopWidth as number) || 0;
  const wB = (st?.borderBottomWidth as number) || 0;
  const wL = (st?.borderLeftWidth as number) || 0;
  const wR = (st?.borderRightWidth as number) || 0;
  // 当前单元格的上边框 → 上方相邻单元格的下边框
  setCellBorderSide(col, row - 1, 'Bottom', wT, true);
  // 当前单元格的下边框 → 下方相邻单元格的上边框
  setCellBorderSide(col, row + 1, 'Top', wB, true);
  // 当前单元格的左边框 → 左侧相邻单元格的右边框
  setCellBorderSide(col - 1, row, 'Right', wL, true);
  // 当前单元格的右边框 → 右侧相邻单元格的左边框
  setCellBorderSide(col + 1, row, 'Left', wR, true);
}

function applyBorderToCell(col: number, row: number, w: { top: number; bottom: number; left: number; right: number }, clearZero: boolean = true) {
  const k = cellKey(col, row);
  const val = cells[k]?.value ?? '';
  const st = cells[k]?.style ? { ...cells[k]!.style } : {};
  // 边框属性存储为 borderTopWidth / borderBottomWidth / borderLeftWidth / borderRightWidth
  // 颜色统一用 borderColor（当前只有默认颜色）
  const dirs = ['Top', 'Bottom', 'Left', 'Right'] as const;
  const vals = [w.top, w.bottom, w.left, w.right];
  for (let i = 0; i < 4; i++) {
    const prop = `border${dirs[i]}Width`;
    if (vals[i] === 0) {
      // clearZero=false 时只增加边框，不删除已有边框
      if (clearZero) delete st[prop];
    } else {
      st[prop] = vals[i];
      st.borderColor = BORDER_COLOR;
    }
  }
  // 如果没有设置任何边框宽度，清除 borderColor
  const hasBorder = dirs.some(d => st[`border${d}Width`] !== undefined);
  if (!hasBorder) delete st.borderColor;
  const style = Object.keys(st).length ? st : null;
  if (val === '' && style === null) delCell(k);
  else cells[k] = { value: val, style };
  // 同步相邻单元格的对应边框
  syncCellBorders(col, row);
}

function applyCachedBorder() {
  onBorderChange(cachedBorder.value);
}

/** 获取单元格某侧边框宽度（0 表示无边框）。
 *  合并单元格：锚点的边框属性代表整个合并区域的外边框；
 *  合并区域内部的覆盖单元格返回 0。 */
function cellBorderWidth(col: number, row: number, side: 'Top' | 'Bottom' | 'Left' | 'Right'): number {
  const m = findMerge(col, row);
  if (m) {
    const anchorStyle = cells[m.anchor]?.style;
    if (side === 'Top' && row === m.range.startRow) return (anchorStyle?.borderTopWidth as number) || 0;
    if (side === 'Bottom' && row === m.range.endRow) return (anchorStyle?.borderBottomWidth as number) || 0;
    if (side === 'Left' && col === m.range.startCol) return (anchorStyle?.borderLeftWidth as number) || 0;
    if (side === 'Right' && col === m.range.endCol) return (anchorStyle?.borderRightWidth as number) || 0;
    return 0;
  }
  const st = cells[cellKey(col, row)]?.style;
  return (st?.[`border${side}Width`] as number) || 0;
}

// ============ 合并单元格：操作 ============
const mergeMenuOpen = ref(false);

function onMergeMenuToggle(v: boolean) {
  mergeMenuOpen.value = v;
  if (v) {
    textColorMenuOpen.value = false;
    fillColorMenuOpen.value = false;
    borderMenuOpen.value = false;
    fontSizeMenuOpen.value = false;
  }
}

/** 移除与指定范围重叠的所有合并 */
function removeOverlappingMerges(sC: number, sR: number, eC: number, eR: number) {
  const toRemove: string[] = [];
  for (const key in merges) {
    const m = merges[key];
    if (!m) continue;
    if (m.startCol <= eC && m.endCol >= sC && m.startRow <= eR && m.endRow >= sR) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) delete merges[key];
}

/** 合并后居中：保留左上角值，清除其他单元格值，水平居中 */
function mergeAndCenter() {
  const sel = selection.value;
  if (!sel || (sel.startCol === sel.endCol && sel.startRow === sel.endRow)) return;
  saveUndo();
  removeOverlappingMerges(sel.startCol, sel.startRow, sel.endCol, sel.endRow);
  // 保留左上角值，清除其他单元格
  const anchorKey = cellKey(sel.startCol, sel.startRow);
  const anchorVal = cells[anchorKey]?.value ?? '';
  for (let c = sel.startCol; c <= sel.endCol; c++) {
    for (let r = sel.startRow; r <= sel.endRow; r++) {
      if (c === sel.startCol && r === sel.startRow) continue;
      clearCellsInRange(c, c, r, r);
    }
  }
  // 水平居中
  const st = cells[anchorKey]?.style ? { ...cells[anchorKey]!.style } : {};
  st.textAlign = 'center';
  cells[anchorKey] = { value: anchorVal, style: st };
  // 记录合并
  merges[anchorKey] = { startCol: sel.startCol, startRow: sel.startRow, endCol: sel.endCol, endRow: sel.endRow };
  selectCell(sel.startCol, sel.startRow);
  scheduleRender();
  emitModelData();
}

/** 跨越合并：每行单独合并 */
function mergeAcross() {
  const sel = selection.value;
  if (!sel || sel.startCol === sel.endCol) return;
  saveUndo();
  for (let r = sel.startRow; r <= sel.endRow; r++) {
    removeOverlappingMerges(sel.startCol, r, sel.endCol, r);
    const anchorKey = cellKey(sel.startCol, r);
    const anchorVal = cells[anchorKey]?.value ?? '';
    for (let c = sel.startCol + 1; c <= sel.endCol; c++) {
      clearCellsInRange(c, c, r, r);
    }
    merges[anchorKey] = { startCol: sel.startCol, startRow: r, endCol: sel.endCol, endRow: r };
  }
  // 重新选中区域以更新活跃单元格为合并锚点
  selectRange(sel.startCol, sel.startRow, sel.endCol, sel.endRow);
  scheduleRender();
  emitModelData();
}

/** 合并单元格（不改变对齐） */
function mergeCells() {
  const sel = selection.value;
  if (!sel || (sel.startCol === sel.endCol && sel.startRow === sel.endRow)) return;
  saveUndo();
  removeOverlappingMerges(sel.startCol, sel.startRow, sel.endCol, sel.endRow);
  const anchorKey = cellKey(sel.startCol, sel.startRow);
  const anchorVal = cells[anchorKey]?.value ?? '';
  for (let c = sel.startCol; c <= sel.endCol; c++) {
    for (let r = sel.startRow; r <= sel.endRow; r++) {
      if (c === sel.startCol && r === sel.startRow) continue;
      clearCellsInRange(c, c, r, r);
    }
  }
  merges[anchorKey] = { startCol: sel.startCol, startRow: sel.startRow, endCol: sel.endCol, endRow: sel.endRow };
  selectCell(sel.startCol, sel.startRow);
  scheduleRender();
  emitModelData();
}

/** 取消合并单元格 */
function unmergeCells() {
  const sel = selection.value;
  if (!sel) return;
  saveUndo();
  removeOverlappingMerges(sel.startCol, sel.startRow, sel.endCol, sel.endRow);
  scheduleRender();
  emitModelData();
}

/** 工具栏左侧按钮：单选已合并单元格时取消合并，否则合并后居中 */
function onApplyMerge() {
  const sel = selection.value;
  if (!sel) return;
  // 检查选区是否恰好是一个合并区域
  const m = findMerge(sel.startCol, sel.startRow);
  if (m && sel.startCol === m.range.startCol && sel.startRow === m.range.startRow
      && sel.endCol === m.range.endCol && sel.endRow === m.range.endRow) {
    unmergeCells();
  } else {
    mergeAndCenter();
  }
}

function onMergeChange(v: MergeType) {
  switch (v) {
    case 'mergeCenter': mergeAndCenter(); break;
    case 'mergeAcross': mergeAcross(); break;
    case 'mergeCells': mergeCells(); break;
    case 'unmergeCells': unmergeCells(); break;
  }
}

// ============ 剪贴板 ============
let copySourceRange: SelectionRange | null = null;
/** 内部复制时缓存的源单元格样式 [row][col] */
let copySourceStyles: (Record<string, unknown> | null)[][] = [];

/** 捕获选区内单元格样式到 copySourceStyles */
function captureStyles(cS: number, cE: number, rS: number, rE: number) {
  copySourceStyles = [];
  for (let r = rS; r <= rE; r++) {
    const row: (Record<string, unknown> | null)[] = [];
    for (let c = cS; c <= cE; c++) {
      const st = cells[cellKey(c, r)]?.style;
      row.push(st ? { ...st } : null);
    }
    copySourceStyles.push(row);
  }
}

/** 设置单元格值和样式（用于粘贴） */
function setCellWithStyle(c: number, r: number, val: string, style: Record<string, unknown> | null) {
  const k = cellKey(c, r);
  clearEvalCache();
  if (val === '' || val == null) {
    formulaDeps.clear(k);
    if (style) {
      cells[k] = { value: '', style: { ...style } };
    } else {
      delCell(k);
    }
    formulaDeps.markDirty(k);
    return;
  }
  cells[k] = { value: val, style: style ? { ...style } : null };
  if (val.startsWith('=')) {
    formulaDeps.set(k, parseFormulaRefs(val.slice(1), colCount, rowCount));
  } else {
    formulaDeps.clear(k);
  }
  formulaDeps.markDirty(k);
}

function copyToClipboard() {
  const s = selection.value;
  if (!s) return;
  copySourceRange = { ...s };
  captureStyles(s.startCol, s.endCol, s.startRow, s.endRow);
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
    copySourceRange = { ...s };
    captureStyles(0, colCount - 1, s.startRow, s.endRow);
    const ls: string[] = [];
    for (let r = s.startRow; r <= s.endRow; r++) {
      const row: string[] = [];
      for (let c = 0; c < colCount; c++) row.push(getCellRaw(c, r));
      ls.push(row.join('\t'));
    }
    writeClipboardText(ls.join('\n'));
  } else if (s.startRow === 0 && s.endRow === rowCount - 1) {
    copySourceRange = { ...s };
    captureStyles(s.startCol, s.endCol, 0, rowCount - 1);
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
  const hasSrcStyles = src && copySourceStyles.length > 0;
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
        if (hasSrcStyles && r < copySourceStyles.length && c < (copySourceStyles[r]?.length ?? 0)) {
          // 内部复制：同时粘贴值和样式
          const srcStyle = copySourceStyles[r]![c] ?? null;
          setCellWithStyle(tc, tr, val, srcStyle);
          // 同步相邻单元格边框
          syncCellBorders(tc, tr);
        } else {
          // 外部粘贴：仅粘贴值
          setCellValue(tc, tr, val);
        }
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
    rowHeights.value[r] = rowHeights.value[r + dr];
  }
  for (let r = rowCount - dr; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) delCell(cellKey(c, r));
    rowHeights.value[r] = undefined;
  }
  // 同步删除边界处的新相邻单元格边框
  if (rS > 0) {
    for (let c = 0; c < colCount; c++) {
      syncCellBorders(c, rS - 1);
      syncCellBorders(c, rS);
    }
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
    rowHeights.value[r] = rowHeights.value[r - n];
  }
  for (let r = rE + 1; r <= rE + n; r++) {
    for (let c = 0; c < colCount; c++) delCell(cellKey(c, r));
    rowHeights.value[r] = undefined;
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
  // 同步删除边界处的新相邻单元格边框
  if (cS > 0) {
    for (let r = 0; r < rowCount; r++) {
      syncCellBorders(cS - 1, r);
      syncCellBorders(cS, r);
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
    colWidths: new Array(colCount).fill(DEFAULT_COL_WIDTH),
    rowHeights: new Array(rowCount).fill(undefined),
  };
}
const sheets = ref<SheetState[]>([mkSheet('Sheet1')]);
const activeSheetIndex = ref(0);
function saveSheet() {
  const s = sheets.value[activeSheetIndex.value];
  if (!s) return;
  s.cells = { ...cells };
  s.merges = { ...merges };
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
  // 清空并重新加载合并信息
  Object.keys(merges).forEach((k) => delete merges[k]);
  if (s.merges) Object.assign(merges, s.merges);
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
  saveUndo();
  cancelEdit();
  saveSheet();
  sheets.value.push(mkSheet(n ?? `Sheet${sheets.value.length + 1}`));
  loadSheet(sheets.value.length - 1);
  return sheets.value.length - 1;
}
function removeSheet(i: number) {
  if (sheets.value.length <= 1) return activeSheetIndex.value;
  saveUndo();
  cancelEdit();
  sheets.value.splice(i, 1);
  loadSheet(Math.min(i, sheets.value.length - 1));
  return activeSheetIndex.value;
}
function renameSheet(i: number, n: string) {
  if (sheets.value[i] && n.trim()) {
    saveUndo();
    sheets.value[i]!.name = n.trim();
  }
}
function dupSheet(i: number) {
  saveUndo();
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
  saveUndo();
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
    if (s.merges && Object.keys(s.merges).length) {
      sh.merges = { ...s.merges };
    }
    const cw: Record<number, number> = {};
    for (let i = 0; i < s.colWidths.length; i++) {
      if (s.colWidths[i] !== 100) cw[i] = s.colWidths[i]!;
    }
    if (Object.keys(cw).length) sh.colWidths = cw;
    const rh: Record<number, number> = {};
    for (let i = 0; i < s.rowHeights.length; i++) {
      const hv = s.rowHeights[i];
      if (hv !== undefined && hv !== null) rh[i] = hv;
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
// 溢出菜单通过 Teleport 渲染到 body，需要显式传递 CSS 变量
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
const maxScrollX = computed(() => Math.max(0, totalWidth.value - Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE)));
const maxScrollY = computed(() => Math.max(0, totalHeight.value - Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE)));
function clampScroll(sx: number | null, sy: number | null) {
  const gw = Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE);
  const gh = Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE);
  scrollX.value = Math.max(0, Math.min(sx ?? scrollX.value, Math.max(0, totalWidth.value - gw)));
  scrollY.value = Math.max(0, Math.min(sy ?? scrollY.value, Math.max(0, totalHeight.value - gh)));
}
function canFocusHiddenEditor() {
  if (typeof window === 'undefined') return false;
  return !window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
}
function focusEditInput(selectAllText = false) {
  nextTick(() => {
    const inp = editInputRef.value;
    if (!inp) return;
    if (!editingCell.value && !canFocusHiddenEditor()) {
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
  const rect = wrapper.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
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
  const rH: number[] = [];
  for (let i = 0; i < rowCount; i++) rH[i] = rP[i + 1]! - rP[i]!;

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
  rCtx.rect(HW, HH, W - HW, H - HH);
  rCtx.clip();
  const sel = selection.value;
  const ed = editingCell.value;
  
  // 第一步：绘制背景色、选中状态、文本内容
  for (let row = sR; row <= eR; row++) {
    for (let col = sC; col <= eC; col++) {
      const mergeInfo = findMerge(col, row);
      if (mergeInfo && !(col === mergeInfo.range.startCol && row === mergeInfo.range.startRow)) {
        continue;
      }
      const x = HW + cP[col]! - sx;
      const y = HH + rP[row]! - sy;
      let cw = cW[col]!;
      let rh = rH[row]!;
      if (mergeInfo) {
        cw = cP[mergeInfo.range.endCol + 1]! - cP[col]!;
        rh = rP[mergeInfo.range.endRow + 1]! - rP[row]!;
      }
      if (x + cw < HW || y + rh < HH || x > W || y > H) continue;
      
      // 单元格背景色
      const stBg = cells[cellKey(col, row)]?.style;
      const bgColor = typeof stBg?.backgroundColor === 'string' ? stBg.backgroundColor : '';
      if (bgColor) {
        rCtx.fillStyle = bgColor;
        rCtx.fillRect(x, y, cw, rh);
      }
      // 选中状态背景（半透明，叠加在单元格背景色之上）
      if (isSelected(col, row)) {
        rCtx.fillStyle = cs.selectionBg;
        rCtx.fillRect(x, y, cw, rh);
      }
      // 激活单元格边框
      if (activeCell.value.col === col && activeCell.value.row === row) {
        rCtx.strokeStyle = cs.activeCellBorder;
        rCtx.lineWidth = 2;
        rCtx.strokeRect(x + 1, y + 1, cw - 2, rh - 2);
      }
      // 网格线
      rCtx.strokeStyle = cs.gridLine;
      rCtx.lineWidth = 0.5;
      rCtx.strokeRect(x + 0.25, y + 0.25, cw - 0.5, rh - 0.5);
      // 文本内容
      if (!(ed && ed.col === col && ed.row === row)) {
        const v = getCellValue(col, row);
        if (v) {
          const st = cells[cellKey(col, row)]?.style;
          const fsz = cellFontSize(col, row);
          const ffa = typeof st?.fontFamily === 'string' && st.fontFamily ? st.fontFamily : DEFAULT_FONT_FAMILY;
          const fw = st?.fontWeight === 'bold' ? 'bold' : 'normal';
          const fs = st?.fontStyle === 'italic' ? 'italic' : 'normal';
          const hasU = st?.underline === 'underline';
          const hasS = st?.strikethrough === 'line-through';
          const txtColor = typeof st?.color === 'string' ? st.color : '';
          const hAlign = typeof st?.textAlign === 'string' ? st.textAlign : 'left';
          const vAlign = typeof st?.verticalAlign === 'string' ? st.verticalAlign : 'top';
          rCtx.fillStyle = txtColor || cs.cellText;
          rCtx.font = `${fs} ${fw} ${fsz}px ${ffa}`;
          rCtx.textBaseline = 'alphabetic';
          rCtx.save();
          rCtx.beginPath();
          rCtx.rect(x + 5, y + 1, cw - 10, rh - 2);
          rCtx.clip();
          const stWrap = st?.wrap === 'wrap';
          const textLines = getWrappedLines(rCtx, v, cw - 10, stWrap);
          let maxAsc = 0;
          let maxDesc = 0;
          for (const line of textLines) {
            const m = rCtx.measureText(line);
            const rawAsc = m.actualBoundingBoxAscent;
            const rawDesc = m.actualBoundingBoxDescent;
            const a = rawAsc || fsz * 0.8;
            const d = rawDesc || fsz * 0.2;
            maxAsc = Math.max(maxAsc, a);
            maxDesc = Math.max(maxDesc, d);
          }
          maxAsc = Math.max(maxAsc, fsz * 0.5);
          maxDesc = Math.max(maxDesc, fsz * 0.15);
          const lineH = fsz;
          const totalH = textLines.length * lineH;
          let ty: number;
          if (vAlign === 'middle') ty = y + (rh - totalH) / 2 + maxAsc;
          else if (vAlign === 'bottom') ty = y + rh - BASE_CELL_VPAD - maxDesc - (textLines.length - 1) * lineH;
          else ty = y + BASE_CELL_VPAD + maxAsc;
          for (let li = 0; li < textLines.length; li++) {
            const line = textLines[li]!;
            const lineTy = ty + li * lineH;
            const m = rCtx.measureText(line);
            let tx: number;
            if (hAlign === 'center') tx = x + cw / 2 - m.width / 2;
            else if (hAlign === 'right') tx = x + cw - 5 - m.width;
            else tx = x + 5;
            rCtx.fillText(line, tx, lineTy);
            if (hasU) {
              rCtx.strokeStyle = txtColor || cs.cellText;
              rCtx.lineWidth = 1;
              rCtx.beginPath();
              rCtx.moveTo(tx, lineTy + maxDesc + 1);
              rCtx.lineTo(tx + m.width, lineTy + maxDesc + 1);
              rCtx.stroke();
            }
            if (hasS) {
              rCtx.strokeStyle = txtColor || cs.cellText;
              rCtx.lineWidth = 1;
              const midY = lineTy - lineH * 0.25;
              rCtx.beginPath();
              rCtx.moveTo(tx, midY);
              rCtx.lineTo(tx + m.width, midY);
              rCtx.stroke();
            }
          }
          rCtx.restore();
        }
      }
    }
  }
  
  // 第二步：绘制边框（在所有背景色和文本之后绘制）
  for (let row = sR; row <= eR; row++) {
    for (let col = sC; col <= eC; col++) {
      const mergeInfo = findMerge(col, row);
      if (mergeInfo && !(col === mergeInfo.range.startCol && row === mergeInfo.range.startRow)) {
        continue;
      }
      const x = HW + cP[col]! - sx;
      const y = HH + rP[row]! - sy;
      let cw = cW[col]!;
      let rh = rH[row]!;
      if (mergeInfo) {
        cw = cP[mergeInfo.range.endCol + 1]! - cP[col]!;
        rh = rP[mergeInfo.range.endRow + 1]! - rP[row]!;
      }
      if (x + cw < HW || y + rh < HH || x > W || y > H) continue;
      
      const cst = cells[cellKey(col, row)]?.style;
      const ownT = (cst?.borderTopWidth as number) || 0;
      const ownL = (cst?.borderLeftWidth as number) || 0;
      const ownB = (cst?.borderBottomWidth as number) || 0;
      const ownR = (cst?.borderRightWidth as number) || 0;
      const wT = Math.max(ownT, cellBorderWidth(col, row - 1, 'Bottom'));
      const wL = Math.max(ownL, cellBorderWidth(col - 1, row, 'Right'));
      const wB = Math.max(ownB, cellBorderWidth(col, row + 1, 'Top'));
      const wR = Math.max(ownR, cellBorderWidth(col + 1, row, 'Left'));
      
      if (wT > 0 || wL > 0 || wB > 0 || wR > 0) {
        rCtx.fillStyle = BORDER_COLOR;
        // 上边框
        if (wT > 0) {
          rCtx.fillRect(x, y, cw, wT);
        }
        // 下边框
        if (wB > 0) {
          rCtx.fillRect(x, y + rh - wB, cw, wB);
        }
        // 左边框
        if (wL > 0) {
          rCtx.fillRect(x, y, wL, rh);
        }
        // 右边框
        if (wR > 0) {
          rCtx.fillRect(x + cw - wR, y, wR, rh);
        }
      }
    }
  }
  
  // 第三步：在对角单元格的对应角落绘制小方块以填充缺口
  // 例如：单元格左上角有上边框+左边框 → 在左上方向的对角单元格(col-1,row-1)的右下角画小方块
  for (let row = sR; row <= eR; row++) {
    for (let col = sC; col <= eC; col++) {
      const mergeInfo = findMerge(col, row);
      if (mergeInfo && !(col === mergeInfo.range.startCol && row === mergeInfo.range.startRow)) {
        continue;
      }
      const x = HW + cP[col]! - sx;
      const y = HH + rP[row]! - sy;
      let cw = cW[col]!;
      let rh = rH[row]!;
      if (mergeInfo) {
        cw = cP[mergeInfo.range.endCol + 1]! - cP[col]!;
        rh = rP[mergeInfo.range.endRow + 1]! - rP[row]!;
      }
      if (x + cw < HW || y + rh < HH || x > W || y > H) continue;
      
      const ownT = (cells[cellKey(col, row)]?.style?.borderTopWidth as number) || 0;
      const ownL = (cells[cellKey(col, row)]?.style?.borderLeftWidth as number) || 0;
      const ownB = (cells[cellKey(col, row)]?.style?.borderBottomWidth as number) || 0;
      const ownR = (cells[cellKey(col, row)]?.style?.borderRightWidth as number) || 0;
      const wT = Math.max(ownT, cellBorderWidth(col, row - 1, 'Bottom'));
      const wL = Math.max(ownL, cellBorderWidth(col - 1, row, 'Right'));
      const wB = Math.max(ownB, cellBorderWidth(col, row + 1, 'Top'));
      const wR = Math.max(ownR, cellBorderWidth(col + 1, row, 'Left'));
      
      rCtx.fillStyle = BORDER_COLOR;
      // 左上角：有上边框+左边框 → 在(col-1,row-1)的右下角画方块
      // 宽度=左边框粗细，高度=上边框粗细
      if (wT > 0 && wL > 0) {
        rCtx.fillRect(x - wL, y - wT, wL, wT);
      }
      // 右上角：有上边框+右边框 → 在(col+1,row-1)的左下角画方块
      // 宽度=右边框粗细，高度=上边框粗细
      if (wT > 0 && wR > 0) {
        rCtx.fillRect(x + cw, y - wT, wR, wT);
      }
      // 左下角：有下边框+左边框 → 在(col-1,row+1)的右上角画方块
      // 宽度=左边框粗细，高度=下边框粗细
      if (wB > 0 && wL > 0) {
        rCtx.fillRect(x - wL, y + rh, wL, wB);
      }
      // 右下角：有下边框+右边框 → 在(col+1,row+1)的左上角画方块
      // 宽度=右边框粗细，高度=下边框粗细
      if (wB > 0 && wR > 0) {
        rCtx.fillRect(x + cw, y + rh, wR, wB);
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
  editValue.value = (e.target as HTMLTextAreaElement).value;
}
function onFormulaBarKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitEdit();
    moveActive(0, 1);
    ensureVisible(activeCell.value.col, activeCell.value.row);
    formulaBarRef.value?.blur();
    scheduleRender();
    focusEditInput();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
    formulaBarRef.value?.blur();
    scheduleRender();
    focusEditInput();
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
      for (let r = 0; r < rowCount; r++) rowHeights.value[r] = undefined;
      scheduleRender();
      emitModelData();
    } },
  ]);
}
function onRowHdrCtx(e: MouseEvent, row: number) {
  e.preventDefault();
  const mx = e.clientX, my = e.clientY;
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
    { label: `${t(locale.value, 'rowHeight')}...`, action: () => openDimPanel('row', mx, my) },
    {
      label: t(locale.value, 'autoRowHeight'),
      action: () => resetRowHeight(),
    },
  ]);
}
function onColHdrCtx(e: MouseEvent, col: number) {
  e.preventDefault();
  const mx = e.clientX, my = e.clientY;
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
    { label: `${t(locale.value, 'colWidth')}...`, action: () => openDimPanel('col', mx, my) },
    {
      label: t(locale.value, 'defaultColWidth'),
      action: () => resetColWidth(),
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

// ============ 行高/列宽浮动设置栏 ============
const dimInputRef = ref<HTMLInputElement | null>(null);
const dimPanel = ref<{ type: 'row' | 'col'; x: number; y: number; value: string; error: string } | null>(null);
let dimCloseHandler: (() => void) | null = null;
function rdlDim() {
  if (dimCloseHandler) {
    document.removeEventListener('mousedown', dimCloseHandler);
    dimCloseHandler = null;
  }
}
function openDimPanel(type: 'row' | 'col', x: number, y: number) {
  rdlDim();
  const s = selection.value;
  let cur = '';
  if (s) {
    const v = type === 'row' ? getRowHeight(s.startRow) : colWidths.value[s.startCol];
    cur = v != null && v > 0 ? String(Math.round(v)) : '';
  }
  const pw = 220, ph = 118;
  let px = x, py = y;
  if (px + pw > window.innerWidth) px = window.innerWidth - pw - 8;
  if (py + ph > window.innerHeight) py = window.innerHeight - ph - 8;
  if (px < 8) px = 8;
  if (py < 8) py = 8;
  dimPanel.value = { type, x: px, y: py, value: cur, error: '' };
  dimCloseHandler = () => { dimPanel.value = null; };
  setTimeout(() => document.addEventListener('mousedown', dimCloseHandler!, { once: true }), 0);
  nextTick(() => {
    const inp = dimInputRef.value;
    if (inp) {
      inp.focus();
      inp.select();
    }
  });
}
function onDimInput(e: Event) {
  const p = dimPanel.value;
  if (!p) return;
  const input = e.target as HTMLInputElement;
  // type=number 时过滤小数点、科学计数法等，只保留正整数
  const raw = input.value;
  const cleaned = raw.replace(/[^\d]/g, '');
  p.value = cleaned;
  if (raw !== cleaned) input.value = cleaned;
  p.error = '';
}
function onDimKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyDimPanel();
  } else if (e.key === 'Escape') {
    closeDimPanel();
  }
}
function onDimBlur() {
  const p = dimPanel.value;
  if (!p) return;
  const raw = p.value.trim();
  const num = Number(raw);
  const isRow = p.type === 'row';
  const min = isRow ? MIN_ROW_HEIGHT : MIN_COL_WIDTH;
  const max = isRow ? MAX_ROW_HEIGHT : MAX_COL_WIDTH;
  if (raw === '' || !Number.isFinite(num)) {
    // 空值或非法值：关闭面板，不应用
    closeDimPanel();
    return;
  }
  // 钳制到合法范围
  const clamped = Math.max(min, Math.min(max, Math.round(num)));
  p.value = String(clamped);
  p.error = '';
}
function applyDimPanel() {
  const p = dimPanel.value;
  const s = selection.value;
  if (!p || !s) return;
  const raw = p.value.trim();
  const num = Number(raw);
  const isRow = p.type === 'row';
  const min = isRow ? MIN_ROW_HEIGHT : MIN_COL_WIDTH;
  const max = isRow ? MAX_ROW_HEIGHT : MAX_COL_WIDTH;
  if (raw === '' || !Number.isFinite(num)) {
    p.error = t(locale.value, 'dimNumberError');
    return;
  }
  if (num < min || num > max) {
    p.error = t(locale.value, 'dimRangeError').replace('{min}', String(min)).replace('{max}', String(max));
    return;
  }
  const v = num;
  saveUndo();
  if (isRow) {
    for (let r = s.startRow; r <= s.endRow; r++) rowHeights.value[r] = v;
  } else {
    for (let c = s.startCol; c <= s.endCol; c++) colWidths.value[c] = v;
  }
  scheduleRender();
  emitModelData();
  closeDimPanel();
}
function closeDimPanel() {
  rdlDim();
  dimPanel.value = null;
}
function resetRowHeight() {
  const s = selection.value;
  if (!s) return;
  saveUndo();
  for (let r = s.startRow; r <= s.endRow; r++) rowHeights.value[r] = undefined;
  scheduleRender();
  emitModelData();
}
function resetColWidth() {
  const s = selection.value;
  if (!s) return;
  saveUndo();
  for (let c = s.startCol; c <= s.endCol; c++) colWidths.value[c] = DEFAULT_COL_WIDTH;
  scheduleRender();
  emitModelData();
}

// ============ 编辑输入框 CSS ============
const editInputStyle = computed(() => {
  const hidden = !editingCell.value;
  const pos = editingCell.value ?? activeCell.value;
  const c = pos.col, r = pos.row;
  const st = cells[cellKey(c, r)]?.style;
  const fsz = cellFontSize(c, r);
  const ffa = typeof st?.fontFamily === 'string' && st.fontFamily ? st.fontFamily : DEFAULT_FONT_FAMILY;
  const fw = st?.fontWeight === 'bold' ? 'bold' : 'normal';
  const fs = st?.fontStyle === 'italic' ? 'italic' : 'normal';
  const td = st?.underline === 'underline' ? 'underline' : st?.strikethrough === 'line-through' ? 'line-through' : 'none';
  const tdBoth = st?.underline === 'underline' && st?.strikethrough === 'line-through' ? 'underline line-through' : td;
  const tc = typeof st?.color === 'string' ? st.color : undefined;
  const bg = typeof st?.backgroundColor === 'string' ? st.backgroundColor : undefined;
  const hAlign = typeof st?.textAlign === 'string' ? st.textAlign : 'left';
  const vAlign = typeof st?.verticalAlign === 'string' ? st.verticalAlign : 'top';
  // 合并单元格使用合并后的总宽高
  const m = findMerge(c, r);
  const cwVal = m ? colPositions.value[m.range.endCol + 1]! - colPositions.value[c]! : colWidths.value[c]!;
  const rhVal = m ? rowPositions.value[m.range.endRow + 1]! - rowPositions.value[r]! : getRowHeight(r);
  const BORDER = 2;
  // 使用与 Canvas 相同的字体度量
  const { ascent: asc, descent: desc } = measureFontMetrics(ffa, fsz, fw, fs);
  const textH = asc + desc;
  const numLines = editValue.value ? editValue.value.split('\n').length : 1;
  const totalTextH = numLines * textH;
  // textarea 使用 line-height: 1，文字顶部 = border + paddingTop
  // 需要：border + paddingTop = BASE_CELL_VPAD (top对齐时)
  const pv = BASE_CELL_VPAD - BORDER;
  const availH = Math.max(0, rhVal - BORDER * 2 - totalTextH);
  let padTop = 0, padBottom = 0;
  if (vAlign === 'middle') { padTop = Math.floor((rhVal - totalTextH) / 2); padBottom = Math.max(0, rhVal - totalTextH - padTop); }
  else if (vAlign === 'top') { padTop = pv; padBottom = Math.max(0, rhVal - totalTextH - padTop); }
  else if (vAlign === 'bottom') { padBottom = pv; padTop = Math.max(0, rhVal - totalTextH - padBottom); }
  return {
    left: `${HEADER_WIDTH + colPositions.value[c]! - scrollX.value}px`,
    top: `${HEADER_HEIGHT + rowPositions.value[r]! - scrollY.value}px`,
    width: `${cwVal}px`,
    height: `${rhVal}px`,
    fontFamily: ffa,
    fontSize: `${fsz}px`,
    lineHeight: 1,
    fontWeight: fw,
    fontStyle: fs,
    textDecoration: tdBoth,
    textAlign: hAlign as 'left' | 'center' | 'right',
    paddingTop: `${padTop}px`,
    paddingRight: '3px',
    paddingBottom: `${padBottom}px`,
    paddingLeft: '3px',
    opacity: hidden ? 0 : 1,
    pointerEvents: hidden ? 'none' as const : 'auto' as const,
    color: hidden ? 'transparent' : tc,
    caretColor: hidden ? 'transparent' : undefined,
    borderColor: hidden ? 'transparent' : undefined,
    background: hidden ? 'transparent' : bg,
    boxShadow: hidden ? 'none' : undefined,
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
  e.preventDefault();
  ctxMenu.value = null;
  const p = getCanvasXY(e, canvasRef.value);
  if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
    const gx = p.x - HEADER_WIDTH + scrollX.value;
    const c = hitCol(gx);
    if (c >= 0 && Math.abs(p.x - (HEADER_WIDTH + colPositions.value[c + 1]! - scrollX.value)) <= 4) {
      saveUndo();
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
      saveUndo();
      isResizingR = true;
      rszTR = r;
      rszSS = getRowHeight(r);
      rszSG = gy;
      scheduleRender();
      return;
    }
  }
  if (p.x < HEADER_WIDTH || p.y < HEADER_HEIGHT) {
    commitEdit();
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
  focusEditInput();
  scheduleRender();
}
function onMouseMove(e: MouseEvent) {
  if (isResizingC) {
    const x = getCanvasXY(e, canvasRef.value).x;
    const d = (x - HEADER_WIDTH + scrollX.value) - rszSG;
    const newW = rszSS + d;
    if (newW >= MIN_COL_WIDTH && newW <= MAX_COL_WIDTH) colWidths.value[rszTC] = newW;
    else if (newW < MIN_COL_WIDTH) colWidths.value[rszTC] = MIN_COL_WIDTH;
    else colWidths.value[rszTC] = MAX_COL_WIDTH;
    scheduleRender();
    return;
  }
  if (isResizingR) {
    const y = getCanvasXY(e, canvasRef.value).y;
    const d = (y - HEADER_HEIGHT + scrollY.value) - rszSG;
    const newH = rszSS + d;
    if (newH >= MIN_ROW_HEIGHT && newH <= MAX_ROW_HEIGHT) rowHeights.value[rszTR] = newH;
    else if (newH < MIN_ROW_HEIGHT) rowHeights.value[rszTR] = MIN_ROW_HEIGHT;
    else rowHeights.value[rszTR] = MAX_ROW_HEIGHT;
    scheduleRender();
    return;
  }
  if (!isDragging) {
    const cvs = canvasRef.value;
    if (!cvs) return;
    // 格式刷激活时，光标切换为复制/刷子样式
    if (paintFmt.value) {
      cvs.style.cursor = 'copy';
      return;
    }
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
function onMouseUp(e: MouseEvent) {
  const w = isResizingC || isResizingR;
  isDragging = false;
  isResizingC = false;
  isResizingR = false;
  if (w) scheduleOptEmit();
  // 格式刷：松开时应用格式（支持单元格区域、表头整行整列、左上角全选）
  if (paintFmt.value) {
    applyPaintFormat();
  }
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
  focusEditInput();
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
      focusEditInput();
      ltT = 0;
    } else {
      commitEdit();
      selectCell(tSC, tSR);
      scheduleRender();
      ltT = n;
    }
    ltC = tSC;
    ltR = tSR;
    focusEditInput();
  }
}

// 键盘
function isImeKeydown(e: KeyboardEvent) {
  return e.isComposing || e.key === 'Process' || e.keyCode === 229;
}
function isPlainPrintableKey(e: KeyboardEvent) {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
}
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
      focusEditInput();
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
      paintFmt.value = null;
      scheduleRender();
      return;
    case isPlainPrintableKey(e):
      if (isImeKeydown(e)) {
        ensureVisible(activeCell.value.col, activeCell.value.row);
        startEdit('');
        scheduleRender();
        focusEditInput();
        return;
      }
      e.preventDefault();
      ensureVisible(activeCell.value.col, activeCell.value.row);
      startEdit(e.key);
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
let isEditComposing = false;
let compositionJustEnded = false;
function onEditInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value;
  if (!editingCell.value) {
    ensureVisible(activeCell.value.col, activeCell.value.row);
    startEdit(val);
    scheduleRender();
    return;
  }
  editValue.value = val;
}
function onEditCompositionStart() {
  isEditComposing = true;
  if (!editingCell.value) {
    ensureVisible(activeCell.value.col, activeCell.value.row);
    startEdit('');
    scheduleRender();
  }
}
function onEditCompositionEnd(e: CompositionEvent) {
  isEditComposing = false;
  compositionJustEnded = true;
  setTimeout(() => {
    compositionJustEnded = false;
  }, 0);
  editValue.value = (e.target as HTMLTextAreaElement).value;
}
function onEditKd(e: KeyboardEvent) {
  if (!editingCell.value) {
    if (isPlainPrintableKey(e) || isImeKeydown(e)) return;
    onKeydown(e);
    return;
  }
  if (isEditComposing || isImeKeydown(e)) return;
  if (compositionJustEnded && (e.key === 'Enter' || e.key === 'Escape')) return;
  if (e.key === 'Enter' && (e.altKey || e.metaKey)) {
    // Alt+Enter 插入换行符
    e.preventDefault();
    const inp = editInputRef.value;
    if (!inp) return;
    const start = inp.selectionStart ?? inp.value.length;
    const end = inp.selectionEnd ?? inp.value.length;
    const val = inp.value;
    const newVal = val.slice(0, start) + '\n' + val.slice(end);
    editValue.value = newVal;
    inp.value = newVal;
    inp.selectionStart = inp.selectionEnd = start + 1;
    scheduleRender();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    commitEdit();
    moveActive(0, 1);
    ensureVisible(activeCell.value.col, activeCell.value.row);
    scheduleRender();
    focusEditInput();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    commitEdit();
    moveActive(e.shiftKey ? -1 : 1, 0);
    ensureVisible(activeCell.value.col, activeCell.value.row);
    scheduleRender();
    focusEditInput();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
    scheduleRender();
    focusEditInput();
  }
}

function onEditPaste(e: ClipboardEvent) {
  // 粘贴时保留换行符，默认 textarea 已支持，无需特殊处理
  // 但需要确保不会提交到单元格，等用户确认
  if (!editingCell.value) return;
  // 让默认粘贴行为发生，textarea 天然支持多行
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
    focusEditInput();
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
watch(() => ({ ...merges }), () => { nextTick(emitModelData); scheduleRender(); }, { deep: false });
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
    if (s.merges) {
      for (const [k, mr] of Object.entries(s.merges)) {
        sh.merges![k] = { ...mr };
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
    <!-- 工具栏 -->
    <Toolbar
      :locale="locale"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :paint-fmt-active="paintFmt !== null"
      :has-selection="hasSelection"
      :font-family-options="fontFamilyOptions"
      :font-size-options="fontSizeOptions"
      :sel-font-family="selFontFamily"
      :sel-font-size="selFontSize"
      :font-size-input="fontSizeInput"
      :font-size-menu-open="fontSizeMenuOpen"
      :sel-font-weight="selFontWeight"
      :sel-font-style="selFontStyle"
      :sel-underline="selUnderline"
      :sel-strikethrough="selStrikethrough"
      :sel-text-color="selTextColor"
      :text-color-menu-open="textColorMenuOpen"
      :sel-fill-color="selFillColor"
      :fill-color-menu-open="fillColorMenuOpen"
      :cached-text-color="cachedTextColor"
      :cached-fill-color="cachedFillColor"
      :border-menu-open="borderMenuOpen"
      :cached-border="cachedBorder"
      :h-align-options="hAlignOptions"
      :v-align-options="vAlignOptions"
      :sel-h-align="selHAlign"
      :sel-v-align="selVAlign"
      :sel-wrap="selWrap"
      :merge-menu-open="mergeMenuOpen"
      :theme-vars="toolbarThemeVars"
      @undo="undo()"
      @redo="redo()"
      @paint-format="onPaintFormat"
      @clear-format="clearFormat()"
      @font-family-change="onFontFamilyChange($event)"
      @font-size-input="onFontSizeInput($event)"
      @font-size-blur="onFontSizeBlur"
      @font-size-keydown="onFontSizeKeydown($event)"
      @font-size-change="onFontSizeChange($event)"
      @update:font-size-menu-open="fontSizeMenuOpen = $event"
      @font-size-toggle="toggleFontSizeMenu()"
      @font-size-step-up="onFontSizeStepUp"
      @font-size-step-down="onFontSizeStepDown"
      @bold-toggle="toggleFontWeight"
      @italic-toggle="toggleFontStyle"
      @underline-toggle="toggleUnderline"
      @strikethrough-toggle="toggleStrikethrough"
      @text-color-change="onTextColorChange($event)"
      @update:text-color-menu-open="textColorMenuOpen = $event"
      @fill-color-change="onFillColorChange($event)"
      @update:fill-color-menu-open="fillColorMenuOpen = $event"
      @apply-text-color="applyCachedTextColor"
      @apply-fill-color="applyCachedFillColor"
      @update:border-menu-open="onBorderMenuToggle($event)"
      @border-change="onBorderChange($event)"
      @apply-border="applyCachedBorder"
      @h-align-change="onHAlignChange($event)"
      @v-align-change="onVAlignChange($event)"
      @wrap-toggle="onWrapToggle"
      @update:merge-menu-open="onMergeMenuToggle($event)"
      @merge-change="onMergeChange($event)"
      @apply-merge="onApplyMerge"
    />

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
        @focus="onCanvasFocus"
        @keydown="onKeydown"
        @contextmenu="onCanvasCtx"
        @touchstart.prevent="onTouchStart"
        @touchmove.prevent="onTouchMove"
        @touchend="onTouchEnd"
      />
      <textarea
        ref="editInputRef"
        class="cell-editor"
        :value="editValue"
        :style="editInputStyle"
        @input="onEditInput"
        @keydown="onEditKd"
        @compositionstart="onEditCompositionStart"
        @compositionend="onEditCompositionEnd"
        @blur="onEditBlur"
        @paste="onEditPaste"
      ></textarea>
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

    <!-- Sheet 标签栏 -->
    <Tabbar
      :locale="locale"
      :sheets="sheets"
      :active-sheet-index="activeSheetIndex"
      :ren-tab="renTab"
      :ren-tab-val="renTabVal"
      @tab-click="onTabClick($event)"
      @tab-dblclick="onTabDblClick($event)"
      @tab-contextmenu="onTabCtxMenu($event.ev, $event.i)"
      @tab-rename-input="renTabVal = $event"
      @tab-rename-keydown="onTabRenameKd($event)"
      @tab-rename-commit="commitTabRename"
      @tabbar-contextmenu="onTabBarCtx($event)"
      @add-sheet="addSheet(); scheduleRender()"
    />

    <!-- 右键菜单 -->
    <Teleport to="body">
      <Transition name="menu-pop">
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
      </Transition>
    </Teleport>

    <!-- 行高/列宽浮动设置栏 -->
    <Teleport to="body">
      <Transition name="menu-pop">
      <div
        v-if="dimPanel"
        class="dim-panel"
        :style="{ left: dimPanel.x + 'px', top: dimPanel.y + 'px' }"
        @mousedown.stop
        @click.stop
      >
        <div class="dim-panel__title">
          {{ dimPanel.type === 'row' ? t(locale, 'rowHeight') : t(locale, 'colWidth') }}
        </div>
        <div class="dim-panel__body">
          <input
            ref="dimInputRef"
            class="dim-panel__input"
            :class="{ 'dim-panel__input--error': dimPanel.error }"
            type="number"
            step="1"
            min="1"
            inputmode="numeric"
            :value="dimPanel.value"
            @input="onDimInput"
            @keydown="onDimKeydown"
            @blur="onDimBlur"
          >
          <span class="dim-panel__unit">px</span>
        </div>
        <div
          v-if="dimPanel.error"
          class="dim-panel__error"
        >
          {{ dimPanel.error }}
        </div>
        <div class="dim-panel__footer">
          <button
            class="dim-panel__btn dim-panel__btn--primary"
            @click="applyDimPanel"
          >
            {{ t(locale, 'ok') }}
          </button>
          <button
            class="dim-panel__btn"
            @click="closeDimPanel"
          >
            {{ t(locale, 'cancel') }}
          </button>
        </div>
      </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.spreadsheet-outer { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.formula-bar { display: flex; align-items: start; height: 36px; min-height: 36px; padding: 0; gap: 0; }
.formula-bar__cell-label { width: 48px; min-width: 48px; height: 28px; line-height: 28px; margin-top: 4px; text-align: center; font-size: 12px; font-weight: 600; color: var(--sp-formula-bar-label-color); background: var(--sp-formula-bar-label-bg); border: 1px solid var(--sp-formula-bar-label-border); border-radius: 2px; user-select: none; }
.formula-bar__input { flex: 1; height: 28px; margin-top: 4px; border: 1px solid var(--sp-formula-bar-input-border); border-radius: 2px; outline: none; padding: 0 6px; margin-left: 4px; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; color: var(--sp-formula-bar-input-color); background: var(--sp-formula-bar-input-bg); }
.formula-bar__input:focus { border-color: var(--sp-formula-bar-input-focus-border); box-shadow: 0 0 0 1px var(--sp-formula-bar-input-focus-shadow); }
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
.cell-editor { position: absolute; border: 2px solid var(--sp-cell-editor-border); outline: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; color: var(--sp-cell-editor-color); background: var(--sp-cell-editor-bg); box-shadow: 0 0 0 1px var(--sp-cell-editor-shadow); z-index: 10; box-sizing: border-box; min-width: 0; overflow: hidden; padding: 0; margin: 0; -webkit-appearance: none; appearance: none; resize: none; white-space: pre-wrap; word-break: break-all; }
</style>

<style>
.context-menu { position: fixed; z-index: 10000; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 4px 0; min-width: 120px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; transform-origin: top left; }
.context-menu__item { padding: 6px 20px; cursor: pointer; color: #333; white-space: nowrap; position: relative; display: flex; align-items: center; justify-content: space-between; }
.context-menu__item:hover { background: #e8f0fe; }
.context-menu__item--disabled { color: #bbb; cursor: default; }
.context-menu__item--disabled:hover { background: transparent; }
.context-menu__arrow { margin-left: 16px; margin-right: -5px; width: 0; height: 0; border-top: 3px solid transparent; border-bottom: 3px solid transparent; border-left: 4px solid #888; }
.context-submenu { display: none; position: absolute; left: 100%; top: -4px; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 4px 0; min-width: 100px; z-index: 10001; }
.context-submenu--left { left: auto; right: 100%; }
.context-menu__item:hover > .context-submenu { display: block; }
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
.dim-panel__unit { font-size: 12px; color: #888; }
.dim-panel__error { margin-top: 6px; font-size: 12px; color: #d93025; line-height: 1.4; }
.dim-panel__footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.dim-panel__btn { height: 26px; padding: 0 14px; border: 1px solid #ccc; border-radius: 3px; background: #fff; color: #333; font-size: 13px; cursor: pointer; }
.dim-panel__btn:hover { background: #f0f0f0; }
.dim-panel__btn--primary { border-color: #0078d7; background: #0078d7; color: #fff; }
.dim-panel__btn--primary:hover { background: #0069c0; }
</style>

