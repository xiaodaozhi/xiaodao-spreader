import { ref, reactive, computed, watchEffect, type ComputedRef, type Ref } from 'vue';
import { HEADER_HEIGHT, HEADER_WIDTH, SB_SIZE, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, MAX_ROW_HEIGHT, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '../core/constants';
import { FormulaDeps, clearEvalCache, computeCellValue, parseFormulaRefs } from '../core/formula';
import { formatNumber } from '../core/number-format';
import type { CellCoord, CellData, SelectionRange } from '../core/types';

/** 选区触发方式，影响「合并单元格是否扩大选区」。
 *  - 'cell'：单元格点击/拖动（默认）→ 保持现有 expandSelectionForMerges 行为
 *  - 'row' ：行头点击/拖动 → Excel 风格「穿透」合并，选区矩形保持用户点击的行范围
 *  - 'col' ：列头点击/拖动 → 同上，选区矩形保持用户点击的列范围
 *  - 'all' ：左上角全选按钮 → expandSelectionForMerges 行为
 */
export type SelectionMode = 'cell' | 'row' | 'col' | 'all';

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
  selectRange: (sC: number, sR: number, eC: number, eR: number, mode?: SelectionMode) => void;
  selectAll: () => void;
  isSelected: (c: number, r: number) => boolean;
  /** 渲染高亮专用：整行/整列选择模式下「穿透」合并单元格，仅判断 (c,r) 自身是否在选区矩形内 */
  isCellSelected: (c: number, r: number) => boolean;
  selectionMode: Ref<SelectionMode>;
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
  /** 查找高亮钩子：返回某单元格当前的高亮类型（由 find-replace 模块注入） */
  findHighlight?: (col: number, row: number) => 'active' | 'match' | null;
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
  const props = reactive({
    rowCount: rawProps.rowCount ?? defaults.rowCount,
    colCount: rawProps.colCount ?? defaults.colCount,
    width: rawProps.width,
    height: rawProps.height,
    theme: rawProps.theme ?? defaults.theme,
    locale: rawProps.locale ?? defaults.locale,
  });

  // 同步外部 props 变化到内部 reactive props
  watchEffect(() => {
    props.rowCount = rawProps.rowCount ?? defaults.rowCount;
    props.colCount = rawProps.colCount ?? defaults.colCount;
    props.width = rawProps.width;
    props.height = rawProps.height;
    props.theme = rawProps.theme ?? defaults.theme;
    props.locale = rawProps.locale ?? defaults.locale;
  });

  const locale = computed(() => (props.locale === 'zh-CN' ? 'zh-CN' : 'en-US'));
  const colCount = props.colCount;
  const rowCount = props.rowCount;

  // ============ 核心数据 ============
  const cells = reactive<Record<string, CellData>>({});
  const merges = reactive<Record<string, SelectionRange>>({});
  const formulaDeps = new FormulaDeps();
  const selection = ref<SelectionRange | null>(null);
  const selectionMode = ref<SelectionMode>('cell');
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
    if (!fontMetricsCanvas) {
      if (typeof document === 'undefined') return { ascent: size * 0.88, descent: size * 0.28 };
      fontMetricsCanvas = document.createElement('canvas');
    }
    const ctx = fontMetricsCanvas.getContext('2d');
    if (!ctx) return { ascent: size * 0.88, descent: size * 0.28 };
    ctx.font = key;

    // 1) 优先使用 TextMetrics.fontBoundingBoxAscent / Descent —— 这是字体级别的、
    //    与具体文本内容无关的「字体全包围盒」度量，能统一覆盖拉丁、CJK、
    //    组合重音、下标字母等所有字形，避免纯英文 vs 含中文 ascent 不一致。
    const probe = ctx.measureText(' ');
    const fbAsc = (probe as unknown as { fontBoundingBoxAscent?: number }).fontBoundingBoxAscent;
    const fbDesc = (probe as unknown as { fontBoundingBoxDescent?: number }).fontBoundingBoxDescent;
    if (typeof fbAsc === 'number' && typeof fbDesc === 'number' && fbAsc > 0 && fbDesc > 0) {
      const result = { ascent: fbAsc, descent: fbDesc };
      fontMetricsCache.set(key, result);
      return result;
    }

    // 2) 浏览器不支持 fontBoundingBox 时：使用多字符取最大联合包围盒，
    //    涵盖大写拉丁 (M)、CJK 表意字 (中)、下伸小写 (y)、重音大写 (Ä)、
    //    全宽数字 (０)，逼近真实字体最大升/降部。
    const probes = ['M', '中', 'y', '\u00c4', '\uff10'];
    let bestAsc = 0;
    let bestDesc = 0;
    for (const p of probes) {
      const m = ctx.measureText(p);
      const a = (m.actualBoundingBoxAscent || 0);
      const d = (m.actualBoundingBoxDescent || 0);
      if (a > bestAsc) bestAsc = a;
      if (d > bestDesc) bestDesc = d;
    }
    const ascent = Math.max(bestAsc, size * 0.88);
    const descent = Math.max(bestDesc, size * 0.28);
    const result = { ascent, descent };
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
    let maxAsc: number;
    let maxDesc: number;
    let maxLines: number = 1;
    const ctx = fontMetricsCanvas ? fontMetricsCanvas.getContext('2d') : null;
    // 先用默认字号的统一度量做初值，避免该行全部无内容时度量为 0
    const defMetrics = measureFontMetrics(DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, 'normal', 'normal');
    maxAsc = defMetrics.ascent;
    maxDesc = defMetrics.descent;
    for (let c = 0; c < colCount; c++) {
      const fs = cellFontSize(c, r);
      const st = cells[cellKeyFn(c, r)]?.style;
      const ffa = typeof st?.fontFamily === 'string' && st.fontFamily ? st.fontFamily : DEFAULT_FONT_FAMILY;
      const fw = st?.fontWeight === 'bold' ? 'bold' : 'normal';
      const fstyle = st?.fontStyle === 'italic' ? 'italic' : 'normal';
      // 使用统一字体度量（内容无关），保证纯英文和含中文单元格使用同一 ascent/descent
      const metrics = measureFontMetrics(ffa, fs, fw, fstyle);
      if (metrics.ascent > maxAsc) maxAsc = metrics.ascent;
      if (metrics.descent > maxDesc) maxDesc = metrics.descent;
      if (fs > maxFs) maxFs = fs;
      const nf = typeof st?.numberFormat === 'string' ? st.numberFormat : '';
      const rawV = getCellValue(c, r);
      const v = formatNumber(rawV, nf, locale.value);
      if (v) {
        const stWrap = st?.wrap === 'wrap';
        let cellLines: number;
        if (stWrap && ctx) {
          ctx.font = `${fstyle} ${fw} ${fs}px ${ffa}`;
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
      }
    }
    // 自动行高公式：BASE_CELL_VPAD*2 + n*(ascent + descent)
    // 必须与 Canvas 渲染使用的 lineH 保持一致，避免文字被截断或空白过大
    const lineH = maxAsc + maxDesc;
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
    selectionMode.value = 'cell';
    const m = findMergeFn(c, r);
    if (m) {
      activeCell.value = { col: m.range.startCol, row: m.range.startRow };
      selection.value = { ...m.range };
    } else {
      activeCell.value = { col: c, row: r };
      selection.value = { startCol: c, startRow: r, endCol: c, endRow: r };
    }
  }

  function selectRange(sC: number, sR: number, eC: number, eR: number, mode: SelectionMode = 'cell') {
    const m = findMergeFn(sC, sR);
    // activeCell 仍然锚定到合并格起点（进入焦点等行为保持不变）
    activeCell.value = m ? { col: m.range.startCol, row: m.range.startRow } : { col: sC, row: sR };
    selectionMode.value = mode;
    if (mode === 'row' || mode === 'col') {
      // 整行 / 整列选择：Excel 风格「穿透合并单元格」，
      // 选区矩形严格保持用户点击的行列范围，不因为交叉的合并格而扩大。
      const minC = Math.min(sC, eC);
      const maxC = Math.max(sC, eC);
      const minR = Math.min(sR, eR);
      const maxR = Math.max(sR, eR);
      selection.value = { startCol: minC, startRow: minR, endCol: maxC, endRow: maxR };
    } else {
      selection.value = expandSelectionForMergesFn(sC, sR, eC, eR);
    }
  }

  function selectAll() {
    selectRange(0, 0, colCount - 1, rowCount - 1, 'all');
  }

  function isSelected(c: number, r: number) {
    const s = selection.value;
    if (!s) return false;
    // 'cell' / 'all' 模式：选区矩形已经 expand 过合并格，普通矩形判断即可。
    // （合并格 expand 后其整个范围都在选区内，因此对 anchor 与其他格子都自然返回 true）
    if (selectionMode.value === 'cell' || selectionMode.value === 'all') {
      return c >= s.startCol && c <= s.endCol && r >= s.startRow && r <= s.endRow;
    }
    // 'row' / 'col' 模式：选区矩形没有被 expand，判断「穿透」合并格 ——
    // 单元格自身坐标落在矩形内即视为选中，不再要求整个合并格覆盖到矩形。
    return c >= s.startCol && c <= s.endCol && r >= s.startRow && r <= s.endRow;
  }

  /** 渲染高亮专用：与 isSelected 语义一致，方便未来区分 anchor-cell 整格填充等特殊场景。 */
  function isCellSelected(c: number, r: number) {
    return isSelected(c, r);
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
      if (initialValue !== undefined) {
        editValue.value = initialValue;
      } else if (!editValue.value) {
        editValue.value = getCellRaw(activeCell.value.col, activeCell.value.row);
      }
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
    isCellSelected,
    selectionMode,
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

    // 查找高亮：默认无高亮（find-replace 模块会覆盖注入）
    findHighlight: (_col: number, _row: number) => null,
  };

  // 设置内部函数对 state 的反向引用
  saveUndoFn = () => state.saveUndo?.();
  syncCellBordersFn = (c, r) => state.syncCellBorders?.(c, r);
  clampScrollFn = (sx, sy) => state.clampScroll?.(sx, sy);

  return state;
}
