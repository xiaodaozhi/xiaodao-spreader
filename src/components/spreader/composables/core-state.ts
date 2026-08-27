import { ref, reactive, computed, watchEffect, shallowRef, type ComputedRef, type Ref } from 'vue';
import { HEADER_HEIGHT, HEADER_WIDTH, SB_SIZE, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, MAX_ROW_HEIGHT, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '../core/constants';
import { FormulaDeps, clearEvalCache, computeCellValue, parseFormulaRefs } from '../core/formula';
import { formatNumber, isGeneralFormat, parseDateTimeInput, parseNumericText } from '../core/number-format';
import { applyAutoFillPlan, validateMergeCompatibility } from '../core/autofill';
import { colToLabel } from '../core/utils';
import type { CellCoord, CellData, CellStyle, SelectionRange, BorderStyle, BorderSide, FreezePane, ViewportRegion, SheetFilter, FilterColumn } from '../core/types';
import { isRowVisible as _isRowVisible, getColumnCandidates as _getColumnCandidates, type FilterCellAccessor, type FilterCandidates } from '../core/filter-core';
import { resolveStyle as _resolveStyle } from '../core/style-pool';
import type { BorderPool } from '../core/border-pool';
import { getCellBorderSide as _getCellBorderSide } from '../core/border-pool';

/** 选区触发方式，影响「合并单元格是否扩大选区」。
 *  - 'cell'：单元格点击/拖动（默认）→ 保持现有 expandSelectionForMerges 行为
 *  - 'row' ：行头点击/拖动 → Excel 风格「穿透」合并，选区矩形保持用户点击的行范围
 *  - 'col' ：列头点击/拖动 → 同上，选区矩形保持用户点击的列范围
 *  - 'all' ：左上角全选按钮 → expandSelectionForMerges 行为
 */
export type SelectionMode = 'cell' | 'row' | 'col' | 'all';

/** AutoFill 拖拽状态 */
export interface AutoFillState {
  active: boolean;
  sourceRange: SelectionRange | null;
  targetRange: SelectionRange | null;
  direction: 'up' | 'down' | 'left' | 'right' | null;
  preview: boolean;
}

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
  /** 当前工作表逻辑有效列数（0-based exclusive），响应式，可在运行期动态增长 */
  colCount: number;
  /** 当前工作表逻辑有效行数（0-based exclusive），响应式，可在运行期动态增长 */
  rowCount: number;

  /** 按需扩展工作表逻辑范围：当 minCol+1 > colCount 或 minRow+1 > rowCount 时，
   *  按缓冲增量将 dims 扩展到至少覆盖目标坐标，并用默认值补齐 colWidths/rowHeights。
   *  不创建任何空 Cell，不收缩范围。 */
  ensureCapacity: (minCol: number, minRow: number) => void;
  /** 当前 colCount/rowCount 是否为动态扩展（与初始 props 不同），供加载逻辑判断 */
  hasDynamicDims: () => boolean;
  /** 直接设置当前工作表的逻辑范围（加载/撤销恢复等受控内部场景使用；会同时裁剪或补齐 colWidths/rowHeights） */
  setDims: (colCount: number, rowCount: number) => void;

  // 核心数据
  cells: Record<string, CellData>;
  /** 表格级样式池（reactive 数组），styles[0] 始终为默认空样式 */
  styles: CellStyle[];
  /** 表格级边框池（reactive 数组），borders[0] 始终为默认空边框 */
  borders: BorderStyle[];
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

  // 冻结窗格
  freeze: FreezePane;
  setFreeze: (rows: number, cols: number) => void;
  clearFreeze: () => void;
  getFreeze: () => FreezePane;

  // 数据筛选（AutoFilter）
  filter: Ref<SheetFilter | null>;
  getFilter: () => SheetFilter | null;
  setFilter: (f: SheetFilter | null, silent?: boolean) => void;
  enableFilter: (range: SelectionRange) => void;
  clearFilter: () => void;
  clearFilterColumn: (col: number) => void;
  setFilterColumn: (col: number, colFilter: FilterColumn | null) => void;
  /** 获取某列候选值列表（级联：仅统计其它列已筛选后的可见行） */
  getColumnCandidates: (col: number) => FilterCandidates;
  /** 探测数据实际占用范围（有值或样式的单元格包围盒）；无数据返回 null */
  getDataRange: () => SelectionRange | null;
  isRowHidden: (r: number) => boolean;
  getFilteredOutRows: () => Set<number>;
  getVisibleRowCount: () => number;
  getVisibleRowAt: (index: number) => number;
  getVisibleRowIndex: (row: number) => number;
  /** 基于真实行高/列宽计算冻结区域尺寸 */
  getFrozenMetrics: () => { frozenRowsHeight: number; frozenColumnsWidth: number };
  /** 返回四个 viewport 区域（未冻结时 corner/rows/columns 尺寸为 0） */
  getViewportRegions: () => ViewportRegion[];
  /** 逻辑单元格 -> Canvas 屏幕矩形 */
  cellToScreenRect: (row: number, col: number) => { x: number; y: number; width: number; height: number };
  /** Canvas 屏幕坐标 -> 逻辑单元格 { col, row } | null */
  screenToCell: (x: number, y: number) => { col: number; row: number } | null;
  /** 判断单元格是否落在冻结区域 */
  isCellFrozen: (row: number, col: number) => boolean;
  /** 将单元格滚入 Body 可视区；冻结区域内不滚动 */
  scrollCellIntoView: (row: number, col: number) => void;

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

  // StylePool 运行时辅助
  /** 注册样式到池中，返回 styleId（去重） */
  registerStyle: (style: CellStyle) => number;
  /** 解析单元格样式（通过 styleId 查 styles 数组） */
  resolveStyle: (cell: CellData | undefined) => CellStyle | null;
  /** 重建 styleIndex（从当前 styles 数组） */
  rebuildStyleIndex: () => void;
  /** 同步 styles 数组内容（用于 sheet 切换/加载） */
  syncStyles: (newStyles: CellStyle[]) => void;

  // BorderPool 运行时辅助
  /** 注册边框到池中，返回 borderId（去重） */
  registerBorder: (border: BorderStyle) => number;
  /** 解析边框（通过 borderId 查 borders 数组） */
  resolveBorder: (borderId: number) => BorderStyle;
  /** 重建 borderIndex（从当前 borders 数组） */
  rebuildBorderIndex: () => void;
  /** 同步 borders 数组内容（用于 sheet 切换/加载） */
  syncBorders: (newBorders: BorderStyle[]) => void;
  /** 获取单元格的某一侧 BorderSide */
  getCellBorderSide: (cell: CellData | undefined, side: 'top' | 'right' | 'bottom' | 'left') => BorderSide | undefined;

  // Merge 边框辅助
  /** 获取某 grid cell 所属 merge 的 owner key（左上角），不属于 merge 返回 null */
  getMergeOwner: (c: number, r: number) => string | null;
  /** 判断两个 grid cell 是否属于同一 merge 内部 */
  isSameMergeInternal: (c1: number, r1: number, c2: number, r2: number) => boolean;

  saveUndo?: () => void;
  scheduleRender?: () => void;
  emitModelData?: () => void;
  viewSize?: { w: number; h: number };
  clampScroll?: (sx: number | null, sy: number | null) => void;
  /** 查找高亮钩子：返回某单元格当前的高亮类型（由 find-replace 模块注入） */
  findHighlight?: (col: number, row: number) => 'active' | 'match' | null;

  // 自动填充（AutoFill / Fill Handle）
  /** AutoFill 拖拽状态：active 时 render 绘制预览，mouseup 触发 applyAutoFill */
  autoFillState: Ref<AutoFillState>;
  /** 一次性提交 AutoFill：saveUndo → ensureCapacity → applyAutoFillPlan → 写入 cells + formulaDeps → selectRange → scheduleRender */
  applyAutoFill: (sourceRange: SelectionRange, targetRange: SelectionRange, direction: 'up' | 'down' | 'left' | 'right') => void;
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
  // 初始逻辑范围：取 props 默认值（26/200）。每个 Sheet 可在加载时覆盖。
  const initColCount = props.colCount;
  const initRowCount = props.rowCount;
  const dims = reactive({ colCount: initColCount, rowCount: initRowCount });

  // 扩展缓冲步长：一次扩展足够的行列，减少频繁扩展开销
  const EXTEND_COL_STEP = 8;
  const EXTEND_ROW_STEP = 32;

  // ============ 核心数据 ============
  const cells = reactive<Record<string, CellData>>({});
  // 样式池：styles[0] 始终为默认空样式，reactive 保证渲染时 Vue 能跟踪属性访问
  const styles = reactive<CellStyle[]>([{}]);
  // 边框池：borders[0] 始终为默认空边框，reactive 保证渲染时 Vue 能跟踪属性访问
  const borders = reactive<BorderStyle[]>([{}]);
  // 运行时去重索引：stableKey → styleId，不参与持久化
  let styleIndex = new Map<string, number>();
  styleIndex.set('{}', 0);
  // 边框运行时去重索引：stableKey → borderId，不参与持久化
  let borderIndex = new Map<string, number>();
  borderIndex.set('{}', 0);

  /** 生成稳定的样式 key（属性排序后 JSON.stringify） */
  function stableStyleKey(style: CellStyle): string {
    const keys = Object.keys(style).sort();
    const obj: Record<string, unknown> = {};
    for (const k of keys) obj[k] = style[k];
    return JSON.stringify(obj);
  }

  /** 生成稳定的边框 key */
  function stableBorderKey(border: BorderStyle): string {
    const sides: (keyof BorderStyle)[] = ['top', 'right', 'bottom', 'left'];
    const obj: Record<string, unknown> = {};
    for (const side of sides) {
      const s = border[side];
      if (s && (s.width !== undefined || s.color !== undefined || s.style !== undefined)) {
        const sideObj: Record<string, unknown> = {};
        if (s.width !== undefined) sideObj.width = s.width;
        if (s.color !== undefined) sideObj.color = s.color;
        if (s.style !== undefined) sideObj.style = s.style;
        obj[side] = sideObj;
      }
    }
    return JSON.stringify(obj);
  }

  /** 注册样式到池中，返回 styleId（去重） */
  function registerStyle(style: CellStyle): number {
    if (!style || Object.keys(style).length === 0) return 0;
    const key = stableStyleKey(style);
    const existing = styleIndex.get(key);
    if (existing !== undefined) return existing;
    const id = styles.length;
    styles.push(Object.freeze({ ...style }));
    styleIndex.set(key, id);
    return id;
  }

  /** 解析单元格样式（通过 styleId 查 styles 数组） */
  function resolveStyleFn(cell: CellData | undefined): CellStyle | null {
    return _resolveStyle(cell, styles);
  }

  /** 重建 styleIndex（从当前 styles 数组） */
  function rebuildStyleIndex(): void {
    styleIndex = new Map();
    for (let i = 0; i < styles.length; i++) {
      styleIndex.set(stableStyleKey(styles[i]!), i);
    }
  }

  /** 同步 styles 数组内容（用于 sheet 切换/加载） */
  function syncStyles(newStyles: CellStyle[]): void {
    styles.splice(0, styles.length, ...newStyles);
    rebuildStyleIndex();
  }

  /** 注册边框到池中，返回 borderId（去重） */
  function registerBorder(border: BorderStyle): number {
    if (!border || (!border.top && !border.right && !border.bottom && !border.left)) return 0;
    const key = stableBorderKey(border);
    const existing = borderIndex.get(key);
    if (existing !== undefined) return existing;
    const id = borders.length;
    borders.push(Object.freeze({
      top: border.top ? Object.freeze({ ...border.top }) : undefined,
      right: border.right ? Object.freeze({ ...border.right }) : undefined,
      bottom: border.bottom ? Object.freeze({ ...border.bottom }) : undefined,
      left: border.left ? Object.freeze({ ...border.left }) : undefined,
    }) as BorderStyle);
    borderIndex.set(key, id);
    return id;
  }

  /** 解析边框（通过 borderId 查 borders 数组） */
  function resolveBorderFn(borderId: number): BorderStyle {
    return borders[borderId] ?? {};
  }

  /** 重建 borderIndex（从当前 borders 数组） */
  function rebuildBorderIndex(): void {
    borderIndex = new Map();
    for (let i = 0; i < borders.length; i++) {
      borderIndex.set(stableBorderKey(borders[i]!), i);
    }
  }

  /** 同步 borders 数组内容（用于 sheet 切换/加载） */
  function syncBorders(newBorders: BorderStyle[]): void {
    borders.splice(0, borders.length, ...newBorders);
    rebuildBorderIndex();
  }

  /** 获取单元格的某一侧 BorderSide */
  function getCellBorderSideFn(cell: CellData | undefined, side: 'top' | 'right' | 'bottom' | 'left'): BorderSide | undefined {
    return _getCellBorderSide(cell, side, styles, { get: (id: number) => borders[id] ?? {} } as BorderPool);
  }

  /** 获取某 grid cell 所属 merge 的 owner key */
  function getMergeOwner(c: number, r: number): string | null {
    const m = findMergeFn(c, r);
    return m ? m.anchor : null;
  }

  /** 判断两个 grid cell 是否属于同一 merge 内部 */
  function isSameMergeInternal(c1: number, r1: number, c2: number, r2: number): boolean {
    const m1 = findMergeFn(c1, r1);
    const m2 = findMergeFn(c2, r2);
    if (!m1 || !m2) return false;
    return m1.anchor === m2.anchor;
  }

  const merges = reactive<Record<string, SelectionRange>>({});
  const formulaDeps = new FormulaDeps();
  const selection = ref<SelectionRange | null>(null);
  const selectionMode = ref<SelectionMode>('cell');
  const activeCell = ref<CellCoord>({ col: 0, row: 0 });
  const editingCell = ref<CellCoord | null>(null);
  const editValue = ref('');
  const colWidths = ref<number[]>(new Array(dims.colCount).fill(DEFAULT_COL_WIDTH));
  const rowHeights = ref<(number | undefined)[]>(new Array(dims.rowCount).fill(undefined));
  const scrollX = ref(0);
  const scrollY = ref(0);
  // 冻结窗格状态（默认未冻结）
  const freeze = reactive<FreezePane>({ rows: 0, cols: 0 });

  // 数据筛选状态（默认 null = 未启用）
  const filter = ref<SheetFilter | null>(null);

  // AutoFill 拖拽状态（shallowRef：整体替换，避免深层响应式开销）
  const autoFillState = shallowRef<AutoFillState>({
    active: false,
    sourceRange: null,
    targetRange: null,
    direction: null,
    preview: false,
  });

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

  // ============ 高 DPI 字号缩放 ============
  // 基于默认字体的实际行高（ascent + descent）计算内边距，
  // 确保单行默认文本的自动行高 = DEFAULT_ROW_HEIGHT，与空行一致。
  const _defMetrics = measureFontMetrics(DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, 'normal', 'normal');
  const _defLineH = _defMetrics.ascent + _defMetrics.descent;
  const BASE_CELL_VPAD = Math.max(0, (DEFAULT_ROW_HEIGHT - _defLineH) / 2);

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
    const st = resolveStyleFn(cells[cellKeyFn(c, r)]);
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
    const st = resolveStyleFn(cells[cellKeyFn(c, r)]);
    return typeof st?.fontSize === 'number' && st.fontSize > 0 ? st.fontSize : DEFAULT_FONT_SIZE;
  }
  cellFontSizeFn = cellFontSize;

  // ============ 列位置/行位置计算 ============
  const colPositions = computed(() => {
    const p = [0];
    for (let i = 0; i < dims.colCount; i++) p.push(p[i]! + colWidths.value[i]!);
    return p;
  });
  colPositionsRef = colPositions;

  // 后续注入的 viewSize / clampScroll（由 ensureVisible 使用）
  const viewSizeProxy = { w: 800, h: 600 };
  let clampScrollFn: (sx: number | null, sy: number | null) => void = () => {};

  const rowsWithData = computed<Set<number>>(() => {
    const set = new Set<number>();
    for (const key in cells) {
      const commaIdx = key.indexOf(',');
      if (commaIdx < 0) continue;
      const r = parseInt(key.substring(commaIdx + 1), 10);
      const cell = cells[key];
      if (cell && (cell.value !== '' || cell.styleId !== undefined)) set.add(r);
    }
    for (let r = 0; r < rowHeights.value.length; r++) {
      if (rowHeights.value[r] !== undefined) set.add(r);
    }
    for (const key in merges) {
      const commaIdx = key.indexOf(',');
      if (commaIdx < 0) continue;
      const r = parseInt(key.substring(commaIdx + 1), 10);
      set.add(r);
    }
    return set;
  });

  function getRowHeight(r: number): number {
    // 被筛选隐藏的行：视觉高度为 0（原始 rowHeight 不变，恢复筛选后高度复原）
    if (filter.value && filteredOutRows.value.has(r)) return 0;
    const h = rowHeights.value[r];
    if (h !== undefined && h !== null && h > 0) return h;
    if (!rowsWithData.value.has(r)) return DEFAULT_ROW_HEIGHT;
    let maxFs = DEFAULT_FONT_SIZE;
    let maxAsc: number;
    let maxDesc: number;
    let maxLines: number = 1;
    const ctx = fontMetricsCanvas ? fontMetricsCanvas.getContext('2d') : null;
    // 先用默认字号的统一度量做初值，避免该行全部无内容时度量为 0
    const defMetrics = measureFontMetrics(DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, 'normal', 'normal');
    maxAsc = defMetrics.ascent;
    maxDesc = defMetrics.descent;
    for (let c = 0; c < dims.colCount; c++) {
      const fs = cellFontSize(c, r);
      const st = resolveStyleFn(cells[cellKeyFn(c, r)]);
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

  // ============ 数据筛选（AutoFilter） ============
  const filterAccessor: FilterCellAccessor = {
    getValue: (c, r) => getCellValue(c, r),
    getFormat: (c, r) => resolveStyleFn(cells[cellKeyFn(c, r)])?.numberFormat,
  };

  /** 被筛选隐藏的行集合（缓存，依赖 filter / cells 变化重算） */
  const filteredOutRows = computed<Set<number>>(() => {
    const set = new Set<number>();
    const f = filter.value;
    if (!f) return set;
    const { range } = f;
    for (let r = range.startRow + 1; r <= range.endRow; r++) {
      if (!_isRowVisibleForFilter(r)) set.add(r);
    }
    return set;
  });

  function _isRowVisibleForFilter(row: number): boolean {
    return _isRowVisible(filter.value, row, filterAccessor, locale.value);
  }

  function getFilteredOutRows(): Set<number> {
    return filteredOutRows.value;
  }

  function isRowHidden(r: number): boolean {
    return filter.value ? filteredOutRows.value.has(r) : false;
  }

  /** 可见行总数（排除被筛选隐藏的行） */
  function getVisibleRowCount(): number {
    if (!filter.value) return dims.rowCount;
    return dims.rowCount - filteredOutRows.value.size;
  }

  /** 第 index 个可见行对应的逻辑行索引（index 从 0 开始，仅计可见行） */
  function getVisibleRowAt(index: number): number {
    let count = -1;
    for (let r = 0; r < dims.rowCount; r++) {
      if (!isRowHidden(r)) {
        count++;
        if (count === index) return r;
      }
    }
    return -1;
  }

  /** 逻辑行 row 是第几个可见行（不可见返回 -1） */
  function getVisibleRowIndex(row: number): number {
    if (isRowHidden(row)) return -1;
    let idx = 0;
    for (let r = 0; r < row; r++) {
      if (!isRowHidden(r)) idx++;
    }
    return idx;
  }

  function getFilter(): SheetFilter | null {
    return filter.value;
  }

  function setFilter(f: SheetFilter | null, silent = false) {
    filter.value = f;
    if (silent) return; // 加载/恢复场景：跳过滚动 clamp、重绘与 emit（避免触发 saveSheet 回写覆盖其它持久化状态）
    // 隐藏区域可能改变总高度，重新 clamp 滚动并重绘
    clampScrollFn(scrollX.value, scrollY.value);
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  /** 在选区/数据区域上启用筛选，自动确定筛选范围并确定表头行为首行 */
  function enableFilter(range: SelectionRange) {
    const f: SheetFilter = {
      range: {
        startCol: Math.min(range.startCol, range.endCol),
        endCol: Math.max(range.startCol, range.endCol),
        startRow: Math.min(range.startRow, range.endRow),
        endRow: Math.max(range.startRow, range.endRow),
      },
      columns: {},
    };
    filter.value = f;
    clampScrollFn(scrollX.value, scrollY.value);
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  function clearFilter() {
    if (!filter.value) return;
    filter.value = null;
    clampScrollFn(scrollX.value, scrollY.value);
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  function clearFilterColumn(col: number) {
    if (!filter.value) return;
    const next = { ...filter.value, columns: { ...filter.value.columns } };
    delete next.columns[col];
    filter.value = next;
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  function setFilterColumn(col: number, colFilter: FilterColumn | null) {
    if (!filter.value) return;
    const next = { ...filter.value, columns: { ...filter.value.columns } };
    if (colFilter) next.columns[col] = colFilter;
    else delete next.columns[col];
    filter.value = next;
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  /** 级联候选值：仅统计「其它已筛选列」过滤后的可见行 */
  function getColumnCandidates(col: number): FilterCandidates {
    const f = filter.value;
    if (!f) return { values: [], hasBlank: false };
    return _getColumnCandidates(f, col, filterAccessor, locale.value);
  }

  /** 探测数据实际占用范围（有值或样式的单元格包围盒）；无数据返回 null */
  function getDataRange(): SelectionRange | null {
    let minC = Infinity, minR = Infinity, maxC = -1, maxR = -1;
    for (const key in cells) {
      const i = key.indexOf(',');
      if (i < 0) continue;
      const c = parseInt(key.substring(0, i), 10);
      const r = parseInt(key.substring(i + 1), 10);
      const cell = cells[key];
      if (cell && (cell.value !== '' || cell.styleId !== undefined)) {
        if (c < minC) minC = c;
        if (r < minR) minR = r;
        if (c > maxC) maxC = c;
        if (r > maxR) maxR = r;
      }
    }
    if (maxC < 0) return null;
    return { startCol: minC, startRow: minR, endCol: maxC, endRow: maxR };
  }

  const rowPositions = computed(() => {
    const p = [0];
    for (let i = 0; i < dims.rowCount; i++) p.push(p[i]! + getRowHeightFn(i));
    return p;
  });

  const totalWidth = computed(() => colPositions.value[dims.colCount]!);
  const totalHeight = computed(() => rowPositions.value[dims.rowCount]!);

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
    selectRange(0, 0, dims.colCount - 1, dims.rowCount - 1, 'all');
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

  function getCellRaw(c: number, r: number) {
    return cells[cellKey(c, r)]?.value ?? '';
  }

  function getCellValue(c: number, r: number) {
    clearEvalCache();
    return computeCellValue(c, r, cells, dims.colCount, dims.rowCount);
  }

  function setCellValue(c: number, r: number, v: string | null | undefined) {
    // 按需扩展：允许写入超出当前逻辑范围的坐标，保证粘贴/拖拽/末尾输入等操作不被截断
    if (c >= 0 && r >= 0) ensureCapacity(c, r);
    const k = cellKey(c, r);
    clearEvalCache();
    if (v === '' || v == null) {
      formulaDeps.clear(k);
      const styleId = cells[k]?.styleId;
      if (styleId !== undefined && styleId > 0) {
        cells[k] = { value: '', styleId };
      } else {
        delCell(k);
      }
      formulaDeps.markDirty(k);
      return;
    }
    const val = String(v);
    // 常规单元格：常见日期/时间/日期时间字符串自动识别（对齐 Excel 输入语义）——
    // 转为序列值并套用对应格式代码；仅当当前格式为常规时生效（文本/已设格式不干预）
    if (!val.startsWith('=')) {
      const oldStyle = resolveStyleFn(cells[k]);
      const nf = typeof oldStyle?.numberFormat === 'string' ? oldStyle.numberFormat : '';
      if (isGeneralFormat(nf)) {
        const dt = parseDateTimeInput(val, locale.value);
        if (dt) {
          const newStyle: CellStyle = { ...(oldStyle ?? {}), numberFormat: dt.format };
          cells[k] = { value: String(dt.serial), styleId: registerStyle(newStyle) };
          formulaDeps.clear(k);
          formulaDeps.markDirty(k);
          return;
        }
        // 数字文本（千分位/百分比/货币）自动识别：转为数值并套用对应格式（对齐 Excel 输入语义）
        const nt = parseNumericText(val, locale.value);
        if (nt) {
          const newStyle: CellStyle = { ...(oldStyle ?? {}), numberFormat: nt.format };
          cells[k] = { value: String(nt.num), styleId: registerStyle(newStyle) };
          formulaDeps.clear(k);
          formulaDeps.markDirty(k);
          return;
        }
      }
    }
    const styleId = cells[k]?.styleId;
    const cell: CellData = { value: val };
    if (styleId !== undefined && styleId > 0) cell.styleId = styleId;
    cells[k] = cell;
    if (val.startsWith('=')) {
      formulaDeps.set(k, parseFormulaRefs(val.slice(1), dims.colCount, dims.rowCount));
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
    // 先计算不钳制的目标位置
    let newC = Math.max(0, cur.col + dC);
    let newR = Math.max(0, cur.row + dR);

    // 如果目标超出当前范围，先扩展
    if (newC >= dims.colCount || newR >= dims.rowCount) {
      ensureCapacity(newC, newR);
    }

    // 现在再获取 merge 信息（扩展后范围已足够）
    const curMerge = findMergeFn(cur.col, cur.row);
    const targetMerge = findMergeFn(newC, newR);

    if (curMerge && targetMerge && curMerge.anchor === targetMerge.anchor) {
      if (dC > 0) newC = curMerge.range.endCol + 1;
      else if (dC < 0) newC = curMerge.range.startCol - 1;
      if (dR > 0) newR = curMerge.range.endRow + 1;
      else if (dR < 0) newR = curMerge.range.startRow - 1;
      // 处理 merge 后可能再次超出
      if (newC >= dims.colCount || newR >= dims.rowCount) {
        ensureCapacity(newC, newR);
      }
    }

    // 最后钳制到有效范围
    newC = Math.max(0, Math.min(dims.colCount - 1, newC));
    newR = Math.max(0, Math.min(dims.rowCount - 1, newR));

    selectCell(newC, newR);
  }

  function ensureVisible(c: number, r: number) {
    // 委托给 scrollCellIntoView（冻结感知版本）；未冻结时行为与历史一致
    scrollCellIntoView(r, c);
  }

  // ============ 二分命中 ============
  function hitCol(x: number) {
    const p = colPositions.value;
    if (x < 0 || x >= p[dims.colCount]!) return -1;
    let lo = 0, hi = dims.colCount - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (p[m]! <= x) lo = m;
      else hi = m - 1;
    }
    return lo;
  }

  function hitRow(y: number) {
    const p = rowPositions.value;
    if (y < 0 || y >= p[dims.rowCount]!) return -1;
    let lo = 0, hi = dims.rowCount - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (p[m]! <= y) lo = m;
      else hi = m - 1;
    }
    return lo;
  }

  // ============ 冻结窗格 ============
  function setFreeze(rows: number, cols: number) {
    const clampedRows = Math.max(0, Math.min(Math.floor(rows), dims.rowCount));
    const clampedCols = Math.max(0, Math.min(Math.floor(cols), dims.colCount));
    freeze.rows = clampedRows;
    freeze.cols = clampedCols;
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  function clearFreeze() {
    freeze.rows = 0;
    freeze.cols = 0;
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  function getFreeze() {
    return { rows: freeze.rows, cols: freeze.cols };
  }

  function getFrozenMetrics() {
    let frozenColumnsWidth = 0;
    let frozenRowsHeight = 0;
    if (freeze.cols > 0) {
      const cw = colWidths.value;
      const n = Math.min(freeze.cols, cw.length);
      for (let c = 0; c < n; c++) frozenColumnsWidth += cw[c]!;
    }
    if (freeze.rows > 0) {
      for (let r = 0; r < freeze.rows; r++) frozenRowsHeight += getRowHeightFn(r);
    }
    return { frozenRowsHeight, frozenColumnsWidth };
  }

  function getViewportRegions() {
    const { frozenColumnsWidth, frozenRowsHeight } = getFrozenMetrics();
    const bodyLeft = HEADER_WIDTH + frozenColumnsWidth;
    const bodyTop = HEADER_HEIGHT + frozenRowsHeight;
    const bodyWidth = Math.max(0, viewSizeProxy.w - HEADER_WIDTH - SB_SIZE - frozenColumnsWidth);
    const bodyHeight = Math.max(0, viewSizeProxy.h - HEADER_HEIGHT - SB_SIZE - frozenRowsHeight);
    const regions: ViewportRegion[] = [];
    if (frozenRowsHeight > 0 && frozenColumnsWidth > 0) {
      regions.push({
        kind: 'corner', x: HEADER_WIDTH, y: HEADER_HEIGHT,
        width: frozenColumnsWidth, height: frozenRowsHeight, scrollLeft: 0, scrollTop: 0,
      });
    }
    if (frozenRowsHeight > 0) {
      regions.push({
        kind: 'rows', x: bodyLeft, y: HEADER_HEIGHT,
        width: bodyWidth, height: frozenRowsHeight, scrollLeft: scrollX.value, scrollTop: 0,
      });
    }
    if (frozenColumnsWidth > 0) {
      regions.push({
        kind: 'columns', x: HEADER_WIDTH, y: bodyTop,
        width: frozenColumnsWidth, height: bodyHeight, scrollLeft: 0, scrollTop: scrollY.value,
      });
    }
    regions.push({
      kind: 'body', x: bodyLeft, y: bodyTop,
      width: bodyWidth, height: bodyHeight, scrollLeft: scrollX.value, scrollTop: scrollY.value,
    });
    return regions;
  }

  function cellToScreenRect(row: number, col: number) {
    const cP = colPositions.value;
    const rP = rowPositions.value;
    const cW = colWidths.value;
    const logicalX = cP[col] ?? 0;
    const logicalY = rP[row] ?? 0;
    const m = findMergeFn(col, row);
    const cw = m ? (cP[m.range.endCol + 1] ?? logicalX) - logicalX : (cW[col] ?? 0);
    const rh = m ? (rP[m.range.endRow + 1] ?? logicalY) - logicalY : getRowHeightFn(row);
    const colFrozen = col < freeze.cols;
    const rowFrozen = row < freeze.rows;
    // 冻结方向不参与滚动偏移；body 方向使用 body-relative scrollX/scrollY
    const screenX = colFrozen ? (HEADER_WIDTH + logicalX) : (HEADER_WIDTH + logicalX - scrollX.value);
    const screenY = rowFrozen ? (HEADER_HEIGHT + logicalY) : (HEADER_HEIGHT + logicalY - scrollY.value);
    return { x: screenX, y: screenY, width: cw, height: rh };
  }

  function screenToCell(x: number, y: number) {
    const { frozenColumnsWidth, frozenRowsHeight } = getFrozenMetrics();
    if (x < HEADER_WIDTH || y < HEADER_HEIGHT) return null;
    const colFrozen = frozenColumnsWidth > 0 && x < HEADER_WIDTH + frozenColumnsWidth;
    const rowFrozen = frozenRowsHeight > 0 && y < HEADER_HEIGHT + frozenRowsHeight;
    const logicalX = colFrozen ? (x - HEADER_WIDTH) : (x - HEADER_WIDTH + scrollX.value);
    const logicalY = rowFrozen ? (y - HEADER_HEIGHT) : (y - HEADER_HEIGHT + scrollY.value);
    const col = hitCol(logicalX);
    const row = hitRow(logicalY);
    if (col < 0 || row < 0) return null;
    return { col, row };
  }

  function isCellFrozen(row: number, col: number) {
    return row < freeze.rows || col < freeze.cols;
  }

  function scrollCellIntoView(row: number, col: number) {
    if (isCellFrozen(row, col)) return;
    const { frozenColumnsWidth, frozenRowsHeight } = getFrozenMetrics();
    const gw = Math.max(0, viewSizeProxy.w - HEADER_WIDTH - SB_SIZE - frozenColumnsWidth);
    const gh = Math.max(0, viewSizeProxy.h - HEADER_HEIGHT - SB_SIZE - frozenRowsHeight);
    const cP = colPositions.value;
    const rP = rowPositions.value;
    // body-relative 逻辑坐标：扣掉冻结区域尺寸
    const cx = (cP[col] ?? 0) - frozenColumnsWidth;
    const cy = (rP[row] ?? 0) - frozenRowsHeight;
    const m = findMergeFn(col, row);
    const cw = m ? (cP[m.range.endCol + 1] ?? 0) - (cP[col] ?? 0) : (colWidths.value[col] ?? 0);
    const ch = m ? (rP[m.range.endRow + 1] ?? 0) - (rP[row] ?? 0) : getRowHeightFn(row);
    let sx = scrollX.value;
    let sy = scrollY.value;
    if (cx < sx) sx = cx;
    else if (cx + cw > sx + gw) sx = cx + cw - gw;
    if (cy < sy) sy = cy;
    else if (cy + ch > sy + gh) sy = cy + ch - gh;
    sx = Math.max(0, sx);
    sy = Math.max(0, sy);
    clampScrollFn(sx, sy);
  }

  function ensureCapacity(minCol: number, minRow: number) {
    const targetCol = minCol + 1; // colCount 为 exclusive（最大列 index+1）
    const targetRow = minRow + 1;
    let grew = false;
    if (targetCol >= dims.colCount) {
      const newColCount = Math.max(dims.colCount + EXTEND_COL_STEP, targetCol);
      const added = newColCount - dims.colCount;
      const cw = colWidths.value;
      for (let i = 0; i < added; i++) cw.push(DEFAULT_COL_WIDTH);
      dims.colCount = newColCount;
      grew = true;
    }
    if (targetRow >= dims.rowCount) {
      const newRowCount = Math.max(dims.rowCount + EXTEND_ROW_STEP, targetRow);
      const added = newRowCount - dims.rowCount;
      const rh = rowHeights.value;
      for (let i = 0; i < added; i++) rh.push(undefined);
      dims.rowCount = newRowCount;
      grew = true;
    }
    if (grew) state.scheduleRender?.();
  }

  function hasDynamicDims(): boolean {
    return dims.colCount !== initColCount || dims.rowCount !== initRowCount;
  }

  // ============ AutoFill 提交入口 ============
  // 一次操作一个 Undo 快照：saveUndo → ensureCapacity → applyAutoFillPlan → 写入 cells + formulaDeps → selectRange → scheduleRender
  // 不走 setCellValue：避免触发 setCellValue 内部的日期/数字格式自动识别（会覆盖 styleId 透传）
  function applyAutoFill(
    sourceRange: SelectionRange,
    targetRange: SelectionRange,
    direction: 'up' | 'down' | 'left' | 'right',
  ) {
    // Merge 兼容性校验（双保险）
    if (!validateMergeCompatibility(sourceRange, targetRange, merges)) return;

    // 1. 一次 Undo 快照
    state.saveUndo?.();

    // 2. 动态扩展（折叠进同一 Undo step）
    ensureCapacity(targetRange.endCol, targetRange.endRow);

    // 3. 纯函数计算目标 cells 增量
    const plan = applyAutoFillPlan(
      sourceRange,
      targetRange,
      { cells, styles },
      direction,
      locale.value,
      dims.colCount,
      dims.rowCount,
      colToLabel,
    );

    // 4. 写入 cells + formulaDeps 更新
    clearEvalCache();
    for (const [k, cell] of Object.entries(plan.cells)) {
      const val = cell.value;
      if (val === '' && (cell.styleId === undefined || cell.styleId === 0)) {
        // 空值无样式：删除 cell（与 setCellValue 语义一致）
        formulaDeps.clear(k);
        delCell(k);
      } else {
        cells[k] = { value: val, ...(cell.styleId !== undefined && cell.styleId > 0 ? { styleId: cell.styleId } : {}) };
        if (val.startsWith('=')) {
          formulaDeps.set(k, parseFormulaRefs(val.slice(1), dims.colCount, dims.rowCount));
        } else {
          formulaDeps.clear(k);
        }
      }
      formulaDeps.markDirty(k);
    }

    // 5. selection 更新为新范围（源 + 目标）
    const newRange: SelectionRange = {
      startCol: Math.min(sourceRange.startCol, targetRange.startCol),
      startRow: Math.min(sourceRange.startRow, targetRange.startRow),
      endCol: Math.max(sourceRange.endCol, targetRange.endCol),
      endRow: Math.max(sourceRange.endRow, targetRange.endRow),
    };
    selectRange(newRange.startCol, newRange.startRow, newRange.endCol, newRange.endRow);

    // 6. 触发依赖重算 + 渲染 + 持久化
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  function setDims(newCol: number, newRow: number) {
    let changed = false;
    const nc = Math.max(1, Math.floor(newCol));
    const nr = Math.max(1, Math.floor(newRow));
    if (nc !== dims.colCount) {
      if (nc > dims.colCount) {
        const cw = colWidths.value;
        for (let i = dims.colCount; i < nc; i++) cw.push(DEFAULT_COL_WIDTH);
      } else {
        colWidths.value = colWidths.value.slice(0, nc);
      }
      dims.colCount = nc;
      changed = true;
    }
    if (nr !== dims.rowCount) {
      if (nr > dims.rowCount) {
        const rh = rowHeights.value;
        for (let i = dims.rowCount; i < nr; i++) rh.push(undefined);
      } else {
        rowHeights.value = rowHeights.value.slice(0, nr);
      }
      dims.rowCount = nr;
      changed = true;
    }
    if (changed) state.scheduleRender?.();
  }

  // ============ 组装 State ============
  const state: CoreState = {
    props,
    locale,
    get colCount() { return dims.colCount; },
    get rowCount() { return dims.rowCount; },
    ensureCapacity,
    hasDynamicDims,
    setDims,

    cells,
    styles,
    borders,
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

    // 冻结窗格
    freeze,
    setFreeze,
    clearFreeze,
    getFreeze,
    getFrozenMetrics,

    // 数据筛选（AutoFilter）
    filter,
    getFilter,
    setFilter,
    enableFilter,
    clearFilter,
    clearFilterColumn,
    setFilterColumn,
    getColumnCandidates,
    getDataRange,
    isRowHidden,
    getFilteredOutRows,
    getVisibleRowCount,
    getVisibleRowAt,
    getVisibleRowIndex,
    getViewportRegions,
    cellToScreenRect,
    screenToCell,
    isCellFrozen,
    scrollCellIntoView,

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

    // StylePool 运行时辅助
    registerStyle,
    resolveStyle: resolveStyleFn,
    rebuildStyleIndex,
    syncStyles,

    // BorderPool 运行时辅助
    registerBorder,
    resolveBorder: resolveBorderFn,
    rebuildBorderIndex,
    syncBorders,
    getCellBorderSide: getCellBorderSideFn,

    // Merge 边框辅助
    getMergeOwner,
    isSameMergeInternal,

    // viewSize 引用
    viewSize: viewSizeProxy,

    // 查找高亮：默认无高亮（find-replace 模块会覆盖注入）
    findHighlight: (_col: number, _row: number) => null,

    // AutoFill / Fill Handle
    autoFillState,
    applyAutoFill,
  };

  // 设置内部函数对 state 的反向引用
  saveUndoFn = () => state.saveUndo?.();
  clampScrollFn = (sx, sy) => state.clampScroll?.(sx, sy);

  return state;
}
