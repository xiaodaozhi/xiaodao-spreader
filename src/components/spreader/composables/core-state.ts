import { ref, reactive, computed, type ComputedRef, type Ref } from 'vue';
import { HEADER_HEIGHT, HEADER_WIDTH, SB_SIZE, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, MAX_ROW_HEIGHT, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '../core/constants';
import { FormulaDeps, clearEvalCache, computeCellValue, parseFormulaRefs } from '../core/formula';
import type { CellCoord, CellData, SelectionRange } from '../core/types';

// ============ 共享 State 接口 ============
export interface CoreState {
  // Props 基础配置
  props: {
    rowCount: number;
    colCount: number;
    width?: number | string;
    height?: number | string;
    theme?: 'light' | 'dark';
    locale?: string;
  };
  locale: ComputedRef<string>;
  colCount: number;
  rowCount: number;

  // 核心数据
  cells: Record<string, CellData>;
  merges: Record<string, SelectionRange>;
  formulaDeps: FormulaDeps;
  selection: Ref<SelectionRange | null>;
  activeCell: Ref<CellCoord>;
  editingCell: Ref<CellCoord | null>;
  editValue: Ref<string>;
  colWidths: Ref<number[]>;
  rowHeights: Ref<(number | undefined)[]>;
  scrollX: Ref<number>;
  scrollY: Ref<number>;

  // 字体度量
  BASE_CELL_VPAD: number;
  fontMetricsCache: Map<string, { ascent: number; descent: number }>;
  fontMetricsCanvas: HTMLCanvasElement | null;
  measureFontMetrics: (family: string, size: number, weight: string, style: string) => { ascent: number; descent: number };
  _getFontMetricsForCell: (c: number, r: number) => { ascent: number; descent: number };
  getWrappedLines: (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, wrap: boolean) => string[];
  cellFontSize: (c: number, r: number) => number;

  // 行列位置
  colPositions: ComputedRef<number[]>;
  getRowHeight: (r: number) => number;
  _isAutoRow: (r: number) => boolean;
  rowPositions: ComputedRef<number[]>;
  totalWidth: ComputedRef<number>;
  totalHeight: ComputedRef<number>;

  // 选区操作
  selectCell: (c: number, r: number) => void;
  selectRange: (sC: number, sR: number, eC: number, eR: number) => void;
  selectAll: () => void;
  isSelected: (c: number, r: number) => boolean;
  cellKey: (c: number, r: number) => string;
  delCell: (k: string) => void;

  // 合并辅助
  findMerge: (c: number, r: number) => { range: SelectionRange; anchor: string } | null;
  _isMergeAnchor: (c: number, r: number) => boolean;
  _mergedSpan: (c: number, r: number) => { w: number; h: number };
  expandSelectionForMerges: (sC: number, sR: number, eC: number, eR: number) => SelectionRange;

  // 单元格读写
  getCellRaw: (c: number, r: number) => string;
  getCellValue: (c: number, r: number) => string;
  setCellValue: (c: number, r: number, v: string | null | undefined) => void;
  clearCellsInRange: (cS: number, cE: number, rS: number, rE: number) => void;

  // 编辑状态
  startEdit: (initialValue?: string) => void;
  commitEdit: () => void;
  cancelEdit: () => void;

  // 导航
  moveActive: (dC: number, dR: number) => void;
  ensureVisible: (c: number, r: number) => void;

  // 二分命中
  hitCol: (x: number) => number;
  hitRow: (y: number) => number;

  // ===== 后续模块注入的占位函数 =====
  saveUndo?: () => void;
  scheduleRender?: () => void;
  emitModelData?: () => void;
  syncCellBorders?: (col: number, row: number) => void;
  viewSize?: { w: number; h: number };
  clampScroll?: (sx: number | null, sy: number | null) => void;
}

// ============ 工厂函数 ============
export function createCoreState(
  rawProps: {
    rowCount?: number;
    colCount?: number;
    width?: number | string;
    height?: number | string;
    theme?: 'light' | 'dark';
    locale?: string;
  },
  defaults: { rowCount: number; colCount: number; theme: 'light' | 'dark'; locale: string },
): CoreState {
  const props = {
    rowCount: rawProps.rowCount ?? defaults.rowCount,
    colCount: rawProps.colCount ?? defaults.colCount,
    width: rawProps.width,
    height: rawProps.height,
    theme: rawProps.theme ?? defaults.theme,
    locale: rawProps.locale ?? defaults.locale,
  };

  const locale = computed(() => (props.locale === 'zh-CN' ? 'zh-CN' : 'en-US'));
  const colCount = props.colCount;
  const rowCount = props.rowCount;

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
  const BASE_CELL_VPAD = (DEFAULT_ROW_HEIGHT - DEFAULT_FONT_SIZE) / 2;

  // ============ 字体度量 ============
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

  // 先声明 cellKey、findMerge、cellFontSize 等在后面会赋值的引用
  let cellKeyFn: (c: number, r: number) => string = (c, r) => `${c},${r}`;
  let findMergeFn: (c: number, r: number) => { range: SelectionRange; anchor: string } | null = () => null;
  let cellFontSizeFn: (c: number, r: number) => number = () => DEFAULT_FONT_SIZE;
  let colPositionsRef: ComputedRef<number[]> = computed(() => [0]);
  let getRowHeightFn: (r: number) => number = () => DEFAULT_ROW_HEIGHT;
  let expandSelectionForMergesFn: (sC: number, sR: number, eC: number, eR: number) => SelectionRange = (sC, sR, eC, eR) => ({
    startCol: Math.min(sC, eC), startRow: Math.min(sR, eR),
    endCol: Math.max(sC, eC), endRow: Math.max(sR, eR),
  });

  function _getFontMetricsForCell(c: number, r: number): { ascent: number; descent: number } {
    const st = cells[cellKeyFn(c, r)]?.style;
    const fsz = cellFontSizeFn(c, r);
    const ffa = typeof st?.fontFamily === 'string' && st.fontFamily ? st.fontFamily : DEFAULT_FONT_FAMILY;
    const fw = st?.fontWeight === 'bold' ? 'bold' : 'normal';
    const fs = st?.fontStyle === 'italic' ? 'italic' : 'normal';
    return measureFontMetrics(ffa, fsz, fw, fs);
  }

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

  function cellFontSize(c: number, r: number): number {
    const st = cells[cellKeyFn(c, r)]?.style;
    return typeof st?.fontSize === 'number' && st.fontSize > 0 ? st.fontSize : DEFAULT_FONT_SIZE;
  }
  cellFontSizeFn = cellFontSize;

  // ============ 列位置/行位置计算 ============
  const colPositions = computed(() => {
    const p = [0];
    for (let i = 0; i < colCount; i++) p.push(p[i]! + colWidths.value[i]!);
    return p;
  });
  colPositionsRef = colPositions;

  // 后续注入的 viewSize / clampScroll（由 ensureVisible 使用）
  const viewSizeProxy = { w: 800, h: 600 };
  let clampScrollFn: (sx: number | null, sy: number | null) => void = () => {};

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
      const st = cells[cellKeyFn(c, r)]?.style;
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
          const mergeInfo = findMergeFn(c, r);
          let wrapWidth: number;
          if (mergeInfo && c === mergeInfo.range.startCol && r === mergeInfo.range.startRow) {
            wrapWidth = colPositionsRef.value[mergeInfo.range.endCol + 1]! - colPositionsRef.value[c]!;
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
  getRowHeightFn = getRowHeight;

  function _isAutoRow(r: number): boolean {
    return rowHeights.value[r] === undefined;
  }

  const rowPositions = computed(() => {
    const p = [0];
    for (let i = 0; i < rowCount; i++) p.push(p[i]! + getRowHeightFn(i));
    return p;
  });

  const totalWidth = computed(() => colPositions.value[colCount]!);
  const totalHeight = computed(() => rowPositions.value[rowCount]!);

  // ============ 选区操作 ============
  function cellKey(c: number, r: number) {
    return `${c},${r}`;
  }
  cellKeyFn = cellKey;

  function delCell(k: string) {
    Reflect.deleteProperty(cells, k);
  }

  function selectCell(c: number, r: number) {
    const m = findMergeFn(c, r);
    if (m) {
      activeCell.value = { col: m.range.startCol, row: m.range.startRow };
      selection.value = { ...m.range };
    } else {
      activeCell.value = { col: c, row: r };
      selection.value = { startCol: c, startRow: r, endCol: c, endRow: r };
    }
  }

  function selectRange(sC: number, sR: number, eC: number, eR: number) {
    const m = findMergeFn(sC, sR);
    activeCell.value = m ? { col: m.range.startCol, row: m.range.startRow } : { col: sC, row: sR };
    selection.value = expandSelectionForMergesFn(sC, sR, eC, eR);
  }

  function selectAll() {
    selectRange(0, 0, colCount - 1, rowCount - 1);
  }

  function isSelected(c: number, r: number) {
    const s = selection.value;
    return s ? c >= s.startCol && c <= s.endCol && r >= s.startRow && r <= s.endRow : false;
  }

  // ============ 合并单元格：辅助函数 ============
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
  findMergeFn = findMerge;

  function _isMergeAnchor(c: number, r: number): boolean {
    return merges[cellKey(c, r)] !== undefined;
  }

  function _mergedSpan(c: number, r: number): { w: number; h: number } {
    const m = findMergeFn(c, r);
    if (m && c === m.range.startCol && r === m.range.startRow) {
      const w = colPositions.value[m.range.endCol + 1]! - colPositions.value[c]!;
      const h = rowPositions.value[m.range.endRow + 1]! - rowPositions.value[r]!;
      return { w, h };
    }
    return { w: colWidths.value[c]!, h: getRowHeightFn(r) };
  }

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
        const overlap = m.startCol <= maxC && m.endCol >= minC && m.startRow <= maxR && m.endRow >= minR;
        if (overlap) {
          if (m.startCol < minC) {
            minC = m.startCol;
            changed = true;
          }
          if (m.endCol > maxC) {
            maxC = m.endCol;
            changed = true;
          }
          if (m.startRow < minR) {
            minR = m.startRow;
            changed = true;
          }
          if (m.endRow > maxR) {
            maxR = m.endRow;
            changed = true;
          }
        }
      }
    }
    return { startCol: minC, startRow: minR, endCol: maxC, endRow: maxR };
  }
  expandSelectionForMergesFn = expandSelectionForMerges;

  // ============ 单元格读写 ============
  // 先占位，后续 syncCellBorders 由其他模块注入
  let syncCellBordersFn: (col: number, row: number) => void = () => {};

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
      const st = cells[k]?.style ?? null;
      if (st) {
        cells[k] = { value: '', style: st };
      } else {
        delCell(k);
      }
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
        syncCellBordersFn(c, r);
      }
    }
  }

  // ============ 编辑状态 ============
  // saveUndo 后续注入
  let saveUndoFn: () => void = () => {};

  function startEdit(initialValue?: string) {
    if (!editingCell.value) {
      editingCell.value = { ...activeCell.value };
      editValue.value = initialValue ?? getCellRaw(activeCell.value.col, activeCell.value.row);
    }
  }

  function commitEdit() {
    if (editingCell.value) {
      saveUndoFn();
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

    const curMerge = findMergeFn(cur.col, cur.row);
    const targetMerge = findMergeFn(newC, newR);

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
    const gw = Math.max(0, viewSizeProxy.w - HEADER_WIDTH - SB_SIZE);
    const gh = Math.max(0, viewSizeProxy.h - HEADER_HEIGHT - SB_SIZE);
    const cx = colPositions.value[c]!;
    const cy = rowPositions.value[r]!;
    const m = findMergeFn(c, r);
    const cw = m ? colPositions.value[m.range.endCol + 1]! - colPositions.value[c]! : colWidths.value[c]!;
    const ch = m ? rowPositions.value[m.range.endRow + 1]! - rowPositions.value[r]! : getRowHeightFn(r);
    let sx = scrollX.value;
    let sy = scrollY.value;
    if (cx < sx) sx = cx;
    else if (cx + cw > sx + gw) sx = cx + cw - gw;
    if (cy < sy) sy = cy;
    else if (cy + ch > sy + gh) sy = cy + ch - gh;
    clampScrollFn(sx, sy);
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

  // ============ 组装 State ============
  const state: CoreState = {
    props,
    locale,
    colCount,
    rowCount,

    cells,
    merges,
    formulaDeps,
    selection,
    activeCell,
    editingCell,
    editValue,
    colWidths,
    rowHeights,
    scrollX,
    scrollY,

    BASE_CELL_VPAD,
    fontMetricsCache,
    fontMetricsCanvas,
    measureFontMetrics,
    _getFontMetricsForCell,
    getWrappedLines,
    cellFontSize,

    colPositions,
    getRowHeight,
    _isAutoRow,
    rowPositions,
    totalWidth,
    totalHeight,

    selectCell,
    selectRange,
    selectAll,
    isSelected,
    cellKey,
    delCell,

    findMerge,
    _isMergeAnchor,
    _mergedSpan,
    expandSelectionForMerges,

    getCellRaw,
    getCellValue,
    setCellValue,
    clearCellsInRange,

    startEdit,
    commitEdit,
    cancelEdit,

    moveActive,
    ensureVisible,

    hitCol,
    hitRow,

    // viewSize 引用
    viewSize: viewSizeProxy,
  };

  // 设置内部函数对 state 的反向引用
  saveUndoFn = () => state.saveUndo?.();
  syncCellBordersFn = (c, r) => state.syncCellBorders?.(c, r);
  clampScrollFn = (sx, sy) => state.clampScroll?.(sx, sy);

  return state;
}
