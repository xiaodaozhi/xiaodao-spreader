import { ref, reactive, computed, watchEffect, shallowRef, type ComputedRef, type Ref } from 'vue';
import { HEADER_HEIGHT, HEADER_WIDTH, SB_SIZE, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, MAX_ROW_HEIGHT, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, t } from '../core/constants';
import { FormulaDeps, clearEvalCache, computeCellValue, parseFormulaRefs } from '../core/formula';
import { formatNumber, isGeneralFormat, parseDateTimeInput, parseNumericText } from '../core/number-format';
import { applyAutoFillPlan, validateMergeCompatibility } from '../core/autofill';
import { colToLabel } from '../core/utils';
import type { CellCoord, CellData, CellStyle, SelectionRange, BorderStyle, BorderSide, FreezePane, ViewportRegion, SheetFilter, FilterColumn, ConditionalFormattingRule, ConditionalFormattingFormat, DataValidationRule, DataValidationResult, DataValidationSeverity, DimensionOutline } from '../core/types';
import { resolveConditionalFormatting, CfValueCache, genRuleId, type CFContext } from '../core/conditional-formatting';
import {
  DataValidationIndex,
  dvSeverityOf,
  genDataValidationId,
  hasDropdownIndicator,
  intersectDvRange,
  resolveListItems,
  subtractDvRange,
  validateCellValue as _validateCellValue,
  type DataValidationContext,
} from '../core/data-validation';
import { isRowVisible as _isRowVisible, getColumnCandidates as _getColumnCandidates, isColumnFiltered, type FilterCellAccessor, type FilterCandidates } from '../core/filter-core';
import {
  addOutline,
  addOutlineForDelete,
  addOutlineForInsert,
  clearOutlines,
  genOutlineId,
  outlineLevelAt,
  recomputeOutlineLevels,
  removeOutline as removeOutlineCore,
  setOutlineCollapsed as setOutlineCollapsedCore,
  validateGroup,
  type OutlineValidationResult,
} from '../core/outline-core';
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

/** 数据验证出错警告的用户选择：
 *  - 'continue'：确认继续（写入非法值）；
 *  - 'retry'  ：返回编辑态修正（stop 专用）；
 *  - 'cancel' ：放弃本次输入（不写入）。
 */
export type DataValidationAlertAction = 'continue' | 'retry' | 'cancel';

/** 出错警告弹窗需要展示的信息 */
export interface DataValidationAlertPayload {
  severity: DataValidationSeverity;
  title: string;
  message: string;
  col: number;
  row: number;
}

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
  /** 探测以 anchor 为中心的「当前数据区域」（连续非空单元格块）；空 anchor 返回 null */
  getCurrentRegion: (anchorC: number, anchorR: number) => SelectionRange | null;
  /** 自动检测筛选范围：多选选区优先，否则以 active cell 当前区域推断；完全无数据返回 null */
  detectFilterRange: () => SelectionRange | null;
  /** 切换 AutoFilter：无则创建（自动检测范围），有则移除整个 AutoFilter */
  toggleAutoFilter: () => void;
  /** 某列是否落在当前 AutoFilter Range 内（决定表头箭头是否绘制） */
  isColumnInFilterRange: (col: number) => boolean;
  /** 当前 AutoFilter Range（无则 null） */
  getFilterRange: () => SelectionRange | null;
  /** 是否已启用 AutoFilter */
  isFilterEnabled: () => boolean;
  /** 某列是否已应用筛选条件（用于高亮箭头图标） */
  isFilterColumnActive: (col: number) => boolean;
  isRowHidden: (r: number) => boolean;
  getFilteredOutRows: () => Set<number>;
  getVisibleRowCount: () => number;
  getVisibleRowAt: (index: number) => number;
  getVisibleRowIndex: (row: number) => number;

  // ============ 行列分组 / 折叠（Outline）============
  /** 当前工作表行分组集合（稳定 ID，展开/折叠状态） */
  getRowOutlines: () => DimensionOutline[];
  /** 当前工作表列分组集合 */
  getColumnOutlines: () => DimensionOutline[];
  /** 在某组上创建分组；返回是否成功（失败给出提示码） */
  addRowGroup: (start: number, end: number) => OutlineValidationResult;
  addColumnGroup: (start: number, end: number) => OutlineValidationResult;
  /** 取消组合：完整覆盖某个分组才允许 Ungroup，返回是否成功 */
  removeOutline: (id: string) => boolean;
  clearRowGroups: () => void;
  clearColumnGroups: () => void;
  clearAllOutlines: () => void;
  /** 设置分组折叠状态（一次一个视图状态操作，不影响结构） */
  setOutlineCollapsed: (id: string, collapsed: boolean, silent?: boolean) => void;
  toggleOutline: (id: string) => void;
  /** 当前最大分组层级（0 = 无分组） */
  getOutlineLevel: (axis: 'row' | 'column') => number;
  /** Outline gutter 总尺寸：无分组为 0；否则 = 等级控件条 + 层级数×单级宽度。axis='row' → 左侧 gutter 宽，axis='column' → 顶部 gutter 高 */
  getOutlineGutterSize: (axis: 'row' | 'column') => number;
  /** 逻辑行/列当前所处的分组层级（0 = 不在任何分组内） */
  getRowOutlineLevel: (row: number) => number;
  getColumnOutlineLevel: (col: number) => number;
  /** 逻辑行/列当前是否被折叠分组隐藏 */
  isRowCollapsed: (row: number) => boolean;
  isColumnCollapsed: (col: number) => boolean;
  /** 逻辑行列是否可见（Filter + Outline 组合） */
  isRowVisible: (row: number) => boolean;
  isColumnVisible: (col: number) => boolean;
  /** 列是否隐藏（当前仅由列分组折叠决定） */
  isColHidden: (col: number) => boolean;
  /** 逻辑列宽（折叠列返回 0，供布局/命中测试使用） */
  getColWidth: (c: number) => number;
  /** outline 引擎注入：行列增删后的结构调整（由 sheets-ops 调用） */
  adjustOutlinesForInsertRows: (index: number, count: number) => void;
  adjustOutlinesForDeleteRows: (index: number, count: number) => void;
  adjustOutlinesForInsertCols: (index: number, count: number) => void;
  adjustOutlinesForDeleteCols: (index: number, count: number) => void;
  /** 设置当前工作表的分组集合（加载/撤销恢复等受控场景；同时重算层级） */
  syncOutlines: (rowOutlines: DimensionOutline[] | undefined, columnOutlines: DimensionOutline[] | undefined) => void;
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
  /** 提交编辑：数据验证发生在写入之前。
   *  @returns Promise<boolean> —— true 表示已写入；false 表示被数据验证拦截（仍保持编辑态） */
  commitEdit: () => Promise<boolean>;
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
  // 条件格式（Conditional Formatting）
  conditionalFormats: ConditionalFormattingRule[];
  resolveConditionalFormat: (col: number, row: number) => ConditionalFormattingFormat | null;
  addConditionalFormatRule: (rule: ConditionalFormattingRule) => void;
  updateConditionalFormatRule: (id: string, patch: Partial<ConditionalFormattingRule>) => void;
  removeConditionalFormatRule: (id: string) => void;
  moveConditionalFormatRule: (id: string, dir: 'up' | 'down') => void;
  clearConditionalFormats: (scope: 'selection' | 'sheet') => void;
  invalidateConditionalFormatCache: () => void;
  clampScroll?: (sx: number | null, sy: number | null) => void;
  /** 查找高亮钩子：返回某单元格当前的高亮类型（由 find-replace 模块注入） */
  findHighlight?: (col: number, row: number) => 'active' | 'match' | null;

  // ============ 数据验证（Data Validation）============
  // 注意：本组 API 统一采用 (row, col) 参数顺序，与 Excel/Univer 的「先行后列」习惯一致。
  /** 当前工作表的全部数据验证规则（规则属于 Sheet，不属于 Cell） */
  dataValidations: DataValidationRule[];
  /** 命中该单元格的全部规则（经空间索引，不遍历整表） */
  getDataValidationRules: (row: number, col: number) => DataValidationRule[];
  /** 命中该单元格的首条规则（用于「打开数据验证对话框」时回填已有规则） */
  getDataValidationRule: (row: number, col: number) => DataValidationRule | null;
  hasDataValidation: (row: number, col: number) => boolean;
  /** 命中且需要显示下拉箭头的 list 规则 */
  getListValidation: (row: number, col: number) => DataValidationRule | null;
  /** 下拉列表数据（去重、跟随源区域变化） */
  getValidationDropdown: (row: number, col: number) => { rule: DataValidationRule; items: string[] } | null;
  /** 选中单元格时展示的输入信息 */
  getValidationInputMessage: (row: number, col: number) => { title: string; message: string } | null;
  /** 核心校验入口：编辑 / 粘贴 / AutoFill 等所有输入链路统一调用 */
  validateCell: (row: number, col: number, value: string | null | undefined) => DataValidationResult;
  /** 批量校验（粘贴 / 填充等原子操作）：返回最严重的那条失败结果 */
  validateCells: (entries: { col: number; row: number; value: string | null | undefined }[]) => DataValidationResult;
  /** 新建规则（一个完整的规则级 Undo） */
  createDataValidation: (rule: DataValidationRule, opts?: { silent?: boolean }) => DataValidationRule;
  /** 更新既有规则（按 id），不存在则视为新建 */
  updateDataValidation: (id: string, patch: Partial<DataValidationRule>, opts?: { silent?: boolean }) => void;
  removeDataValidation: (id: string, opts?: { silent?: boolean }) => void;
  /** 清除指定范围的验证（规则的 Range 会被拆分/缩小）；range 为 null 时清除整个工作表 */
  clearDataValidation: (range: SelectionRange | null, opts?: { silent?: boolean }) => void;
  /** 与给定矩形相交的规则（复制携带规则时用） */
  getDataValidationsInRange: (range: SelectionRange) => { rule: DataValidationRule; range: SelectionRange }[];
  /** 将一批规则应用到目标矩形（先扣除目标区域已有规则，再写入） */
  applyDataValidationsToRange: (rules: DataValidationRule[], target: SelectionRange, opts?: { silent?: boolean }) => void;
  /** 规则集合 / 源区域数据变化后失效索引与列表缓存 */
  invalidateDataValidationCache: () => void;
  /** 出错警告弹窗是否打开（编辑器 blur 提交需要避让，避免重入） */
  isValidationAlertOpen: () => boolean;
  /** 出错警告弹窗钩子（由 spreader.vue 注入；未注入时按「stop 拒绝 / 其它放行」处理） */
  showValidationAlert?: (payload: DataValidationAlertPayload) => Promise<DataValidationAlertAction>;
  /** 复用出错警告流程：传入校验失败结果，返回用户决策（供下拉选择等非编辑器入口调用） */
  confirmInvalidValue: (res: DataValidationResult, col: number, row: number) => Promise<DataValidationAlertAction>;
  /** 按 id 或名称取其它工作表的 cells（list 跨表引用，由 spreader.vue 注入） */
  getSheetCellsById?: (sheetId: string) => Record<string, CellData> | null;
  /** 请求打开「数据验证」对话框（由 spreader.vue 注入，供右键菜单 / 工具栏使用） */
  requestDataValidationDialog?: () => void;

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

  // 条件格式规则（属于当前工作表，随 saveSheet 持久化到 SheetState）
  const conditionalFormats = reactive<ConditionalFormattingRule[]>([]);
  // 重复/唯一值统计缓存（不序列化、不持久化）
  const cfCache = new CfValueCache();

  // ============ 数据验证（Data Validation）============
  // 规则属于当前工作表（不是 Cell），随 saveSheet 持久化到 SheetState。
  // dvIndex：行分带空间索引，避免「编辑一个 Cell → 遍历全部规则」。
  // dvListCache：list 规则引用区域时的解析缓存，源区域数据变化时整体失效。
  const dataValidations = reactive<DataValidationRule[]>([]);
  const dvIndex = new DataValidationIndex(dataValidations);
  const dvListCache = new Map<string, string[]>();
  let dvAlertDepth = 0;

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

  // 行列分组（当前工作表，随 saveSheet 持久化；每个 Sheet 独立）
  const rowOutlines = ref<DimensionOutline[]>([]);
  const columnOutlines = ref<DimensionOutline[]>([]);

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
    // 使用 getColWidth（感知分组折叠返回 0），使列折叠时坐标同步收敛
    for (let i = 0; i < dims.colCount; i++) p.push(p[i]! + getColWidth(i));
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
    // 被筛选隐藏或分组折叠隐藏的行：视觉高度为 0（原始 rowHeight 不变，恢复后高度复原）
    if (isRowHidden(r)) return 0;
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
    // Filter 与 Outline 折叠的可见性合并：二者独立，逻辑行始终存在
    if (isOutlineRowCollapsed(r)) return true;
    return filter.value ? filteredOutRows.value.has(r) : false;
  }

  /** 可见行总数（排除被筛选隐藏或分组折叠隐藏的行；统一可见性映射） */
  function getVisibleRowCount(): number {
    let n = 0;
    for (let r = 0; r < dims.rowCount; r++) {
      if (!isRowHidden(r)) n++;
    }
    return n;
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

  // ============ 行列分组 / 折叠（Outline） ============
  /** 被某已折叠行分组隐藏的行集合（缓存，依赖 rowOutlines 变化重算） */
  const outlineCollapsedRows = computed<Set<number>>(() => {
    const set = new Set<number>();
    const outlines = rowOutlines.value;
    for (let i = 0; i < outlines.length; i++) {
      const o = outlines[i]!;
      if (!o.collapsed) continue;
      for (let d = Math.max(0, o.start); d <= o.end && d < dims.rowCount; d++) set.add(d);
    }
    return set;
  });
  /** 被某已折叠列分组隐藏的列集合 */
  const outlineCollapsedCols = computed<Set<number>>(() => {
    const set = new Set<number>();
    const outlines = columnOutlines.value;
    for (let i = 0; i < outlines.length; i++) {
      const o = outlines[i]!;
      if (!o.collapsed) continue;
      for (let d = Math.max(0, o.start); d <= o.end && d < dims.colCount; d++) set.add(d);
    }
    return set;
  });

  /** 行是否被某已折叠分组隐藏（纯结构状态，不含 Filter） */
  function isOutlineRowCollapsed(row: number): boolean {
    return outlineCollapsedRows.value.has(row);
  }
  function isOutlineColCollapsed(col: number): boolean {
    return outlineCollapsedCols.value.has(col);
  }

  function isRowCollapsed(row: number): boolean {
    return isOutlineRowCollapsed(row);
  }
  function isColumnCollapsed(col: number): boolean {
    return isOutlineColCollapsed(col);
  }
  function isRowVisible(row: number): boolean {
    return !isRowHidden(row);
  }
  function isColumnVisible(col: number): boolean {
    return !isOutlineColCollapsed(col);
  }
  function isColHidden(col: number): boolean {
    return isOutlineColCollapsed(col);
  }
  function getColWidth(c: number): number {
    return isColHidden(c) ? 0 : colWidths.value[c] ?? DEFAULT_COL_WIDTH;
  }

  function getRowOutlineLevel(row: number): number {
    return outlineLevelAt(rowOutlines.value, row);
  }
  function getColumnOutlineLevel(col: number): number {
    return outlineLevelAt(columnOutlines.value, col);
  }
  function getOutlineLevel(axis: 'row' | 'column'): number {
    const outlines = axis === 'row' ? rowOutlines.value : columnOutlines.value;
    let max = 0;
    for (let i = 0; i < outlines.length; i++) {
      const lv = outlines[i]!.level;
      if (lv > max) max = lv;
    }
    return max;
  }

  /** Outline gutter 总尺寸：改为浮动显示后不再预留独立分区，恒为 0。 */
  function getOutlineGutterSize(_axis: 'row' | 'column'): number {
    return 0;
  }
  /** 行分组 gutter 宽：浮动显示，不预留分区 → 0 */
  const outlineGapX = () => getOutlineGutterSize('row');
  /** 列分组 gutter 高：浮动显示，不预留分区 → 0 */
  const outlineGapY = () => getOutlineGutterSize('column');

  function getRowOutlines(): DimensionOutline[] {
    return rowOutlines.value.map((o) => ({ ...o }));
  }
  function getColumnOutlines(): DimensionOutline[] {
    return columnOutlines.value.map((o) => ({ ...o }));
  }

  /** 分组结构/折叠变化后的统一收尾：重clamp滚动、重绘、持久化 */
  function afterOutlineChange(silent = false) {
    if (silent) return;
    clampScrollFn(scrollX.value, scrollY.value);
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  function addRowGroup(start: number, end: number): OutlineValidationResult {
    const v = validateGroup(rowOutlines.value, start, end);
    if (!v.ok || v.level === undefined) return v;
    state.saveUndo?.();
    rowOutlines.value = recomputeOutlineLevels(
      addOutline(rowOutlines.value, 'row', start, end, genOutlineId(rowOutlines.value, 'row')).outlines,
    );
    afterOutlineChange();
    return { ok: true, level: v.level };
  }

  function addColumnGroup(start: number, end: number): OutlineValidationResult {
    const v = validateGroup(columnOutlines.value, start, end);
    if (!v.ok || v.level === undefined) return v;
    state.saveUndo?.();
    columnOutlines.value = recomputeOutlineLevels(
      addOutline(columnOutlines.value, 'column', start, end, genOutlineId(columnOutlines.value, 'column')).outlines,
    );
    afterOutlineChange();
    return { ok: true, level: v.level };
  }

  function removeOutline(id: string): boolean {
    const inRows = rowOutlines.value.some((o) => o.id === id);
    const inCols = !inRows && columnOutlines.value.some((o) => o.id === id);
    if (!inRows && !inCols) return false;
    state.saveUndo?.();
    if (inRows) rowOutlines.value = recomputeOutlineLevels(removeOutlineCore(rowOutlines.value, id));
    else columnOutlines.value = recomputeOutlineLevels(removeOutlineCore(columnOutlines.value, id));
    afterOutlineChange();
    return true;
  }

  function clearRowGroups() {
    if (!rowOutlines.value.length) return;
    state.saveUndo?.();
    rowOutlines.value = clearOutlines();
    afterOutlineChange();
  }
  function clearColumnGroups() {
    if (!columnOutlines.value.length) return;
    state.saveUndo?.();
    columnOutlines.value = clearOutlines();
    afterOutlineChange();
  }
  function clearAllOutlines() {
    if (!rowOutlines.value.length && !columnOutlines.value.length) return;
    state.saveUndo?.();
    rowOutlines.value = clearOutlines();
    columnOutlines.value = clearOutlines();
    afterOutlineChange();
  }

  function setOutlineCollapsed(id: string, collapsed: boolean, silent = false) {
    const nextR = setOutlineCollapsedCore(rowOutlines.value, id, collapsed);
    const nextC = setOutlineCollapsedCore(columnOutlines.value, id, collapsed);
    if (nextR === rowOutlines.value && nextC === columnOutlines.value) return;
    if (!silent) state.saveUndo?.();
    rowOutlines.value = nextR;
    columnOutlines.value = nextC;
    afterOutlineChange(silent);
  }

  function toggleOutline(id: string) {
    const o = rowOutlines.value.find((x) => x.id === id) ?? columnOutlines.value.find((x) => x.id === id);
    if (!o) return;
    setOutlineCollapsed(id, !o.collapsed);
  }

  function adjustOutlinesForInsertRows(index: number, count: number) {
    if (!rowOutlines.value.length) return;
    rowOutlines.value = recomputeOutlineLevels(addOutlineForInsert(rowOutlines.value, index, count));
    afterOutlineChange();
  }
  function adjustOutlinesForDeleteRows(index: number, count: number) {
    if (!rowOutlines.value.length) return;
    rowOutlines.value = recomputeOutlineLevels(addOutlineForDelete(rowOutlines.value, index, count));
    afterOutlineChange();
  }
  function adjustOutlinesForInsertCols(index: number, count: number) {
    if (!columnOutlines.value.length) return;
    columnOutlines.value = recomputeOutlineLevels(addOutlineForInsert(columnOutlines.value, index, count));
    afterOutlineChange();
  }
  function adjustOutlinesForDeleteCols(index: number, count: number) {
    if (!columnOutlines.value.length) return;
    columnOutlines.value = recomputeOutlineLevels(addOutlineForDelete(columnOutlines.value, index, count));
    afterOutlineChange();
  }

  function syncOutlines(rows: DimensionOutline[] | undefined, columns: DimensionOutline[] | undefined) {
    if (rows) rowOutlines.value = recomputeOutlineLevels([...rows]);
    if (columns) columnOutlines.value = recomputeOutlineLevels([...columns]);
    afterOutlineChange(true);
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
    const { [col]: _removed, ...rest } = filter.value.columns;
    filter.value = { ...filter.value, columns: rest };
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  function setFilterColumn(col: number, colFilter: FilterColumn | null) {
    if (!filter.value) return;
    if (colFilter) {
      filter.value = { ...filter.value, columns: { ...filter.value.columns, [col]: colFilter } };
    } else {
      const { [col]: _removed, ...rest } = filter.value.columns;
      filter.value = { ...filter.value, columns: rest };
    }
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  /** 级联候选值：仅统计「其它已筛选列」过滤后的可见行 */
  function getColumnCandidates(col: number): FilterCandidates {
    const f = filter.value;
    if (!f) return { values: [], hasBlank: false };
    return _getColumnCandidates(f, col, filterAccessor, locale.value);
  }

  /** 探测以 anchor 为中心的「当前数据区域」（连续非空单元格块）。
   *  算法：从 anchor 向上下扩展到首个全空行，再在所得行区间内向左右扩展到首个全空列。
   *  空 anchor（自身无数据）返回 null。 */
  function getCurrentRegion(anchorC: number, anchorR: number): SelectionRange | null {
    const cCount = dims.colCount, rCount = dims.rowCount;
    const has = (c: number, r: number): boolean => {
      const cell = cells[cellKey(c, r)];
      return !!cell && (cell.value !== '' || cell.styleId !== undefined);
    };
    if (!has(anchorC, anchorR)) return null;
    const rowHasAny = (r: number): boolean => {
      for (let c = 0; c < cCount; c++) if (has(c, r)) return true;
      return false;
    };
    const colHasAnyInRows = (c: number, r1: number, r2: number): boolean => {
      for (let r = r1; r <= r2; r++) if (has(c, r)) return true;
      return false;
    };
    let top = anchorR;
    while (top > 0 && rowHasAny(top - 1)) top--;
    let bottom = anchorR;
    while (bottom < rCount - 1 && rowHasAny(bottom + 1)) bottom++;
    let left = anchorC;
    while (left > 0 && colHasAnyInRows(left - 1, top, bottom)) left--;
    let right = anchorC;
    while (right < cCount - 1 && colHasAnyInRows(right + 1, top, bottom)) right++;
    return { startCol: left, startRow: top, endCol: right, endRow: bottom };
  }

  /** 自动检测筛选范围（Excel 普通区域 AutoFilter 语义）：
   *  - 多行选区（含数据）→ 整块选区矩形即筛选范围（Excel：显式选区优先）；
   *  - 单选单元格 / 单行多选（同一行）→ 选中的行即作为「表头行」，列范围严格取选区涵盖的列（不向左右探测），
   *    再从表头行「向下」智能延伸到该行范围内连续有内容的最后一行；
   *  - 选区及其向下延伸均无内容 → 回退到整个数据占用范围（getDataRange）；仍无则 null（不创建无效 AutoFilter）。
   *  说明：单选单元格与单行多选共用同一套「向下智能探测」逻辑，保证两者都能进入筛选态。 */
  function detectFilterRange(): SelectionRange | null {
    const sel = selection.value;
    const multiRow = !!sel && sel.startRow !== sel.endRow;

    // 多行选区：整块选区矩形即为筛选范围
    if (multiRow) {
      return {
        startCol: Math.min(sel.startCol, sel.endCol),
        endCol: Math.max(sel.startCol, sel.endCol),
        startRow: Math.min(sel.startRow, sel.endRow),
        endRow: Math.max(sel.startRow, sel.endRow),
      };
    }

    // 单选单元格 或 单行多选：选中的行作为表头行，向下智能探测有内容的连续区域
    const ac = activeCell.value;
    const anchorCol = sel ? sel.startCol : ac.col;
    const anchorRow = sel ? sel.startRow : ac.row;

    const has = (c: number, r: number): boolean => {
      const cell = cells[cellKey(c, r)];
      return !!cell && (cell.value !== '' || cell.styleId !== undefined);
    };

    // 列范围：严格取选区所涵盖的列（单选单元格即该列；单行多选即选区列），不向左右探测
    let sc: number, ec: number;
    if (sel) {
      sc = Math.min(sel.startCol, sel.endCol);
      ec = Math.max(sel.startCol, sel.endCol);
    } else {
      sc = ac.col;
      ec = ac.col;
    }

    // 向下探测：从表头行向下逐行延伸到该列范围连续有内容的最后一行；
    // 一旦碰到（跨多格）已合并单元格即停止，合并单元格不计入数据区——其往往属独立分区而非列表数据。
    let bottom = anchorRow;
    while (bottom < dims.rowCount - 1) {
      const next = bottom + 1;
      let any = false;
      let merged = false;
      for (let c = sc; c <= ec; c++) {
        if (has(c, next)) any = true;
        const m = findMerge(c, next);
        if (m && (m.range.startCol !== m.range.endCol || m.range.startRow !== m.range.endRow)) merged = true;
      }
      if (merged) break;
      if (!any) break;
      bottom++;
    }

    // 选区本身及其向下延伸均无内容 → 回退到整体数据区；仍无则 null（不创建无效 AutoFilter）
    if (!has(anchorCol, anchorRow) && bottom === anchorRow) {
      return getDataRange();
    }
    return { startCol: sc, endCol: ec, startRow: anchorRow, endRow: bottom };
  }

  /** 切换 AutoFilter（Sheet 同时只允许一个 AutoFilter Range）：
   *  - 未启用 → 自动检测范围并创建；
   *  - 已启用 → 整体移除（恢复隐藏行、清除所有条件、移除表头箭头）；
   *  工具栏按钮与 Ctrl+Shift+L 均为纯切换：激活态点击即取消整个筛选态，不重新划定范围。 */
  function toggleAutoFilter() {
    if (filter.value) {
      clearFilter();
      return;
    }
    const range = detectFilterRange();
    if (!range) return;
    enableFilter(range);
  }

  function isColumnInFilterRange(col: number): boolean {
    const f = filter.value;
    if (!f) return false;
    return col >= f.range.startCol && col <= f.range.endCol;
  }

  function getFilterRange(): SelectionRange | null {
    return filter.value ? { ...filter.value.range } : null;
  }

  function isFilterEnabled(): boolean {
    return !!filter.value;
  }

  function isFilterColumnActive(col: number): boolean {
    const f = filter.value;
    if (!f) return false;
    return isColumnFiltered(f.columns[col]);
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
    return { w: getColWidth(c), h: getRowHeightFn(r) };
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
    // 值变化可能影响 duplicate/unique 统计与公式条件：条件格式缓存一并失效
    cfCache.invalidate();
    // 值变化可能改变 list 规则的源区域内容：下拉列表缓存一并失效
    if (dataValidations.length > 0) invalidateDataValidationCache();
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
    cfCache.invalidate();
    if (dataValidations.length > 0) invalidateDataValidationCache();
  }

  // ============ 条件格式（Conditional Formatting）============
  /** 构建条件格式求值上下文 */
  function buildCFContext(): CFContext {
    return {
      cells,
      colCount: dims.colCount,
      rowCount: dims.rowCount,
      locale: locale.value,
      getCellValue: (c: number, r: number) => getCellValue(c, r),
    };
  }

  /** 临时合成某单元格的条件格式（Base + CF），不写回 cell.style */
  function resolveConditionalFormat(col: number, row: number): ConditionalFormattingFormat | null {
    if (conditionalFormats.length === 0) return null;
    return resolveConditionalFormatting(col, row, conditionalFormats, buildCFContext(), cfCache);
  }

  /** 新增规则（保存前快照到 Undo） */
  function addConditionalFormatRule(rule: ConditionalFormattingRule) {
    state.saveUndo?.();
    const next: ConditionalFormattingRule = {
      id: rule.id || genRuleId(),
      condition: rule.condition,
      format: rule.format,
      ranges: rule.ranges,
      priority: rule.priority,
      stopIfTrue: rule.stopIfTrue,
      enabled: rule.enabled !== false,
    };
    conditionalFormats.push(next);
    cfCache.invalidate();
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  /** 更新既有规则（保存前快照到 Undo） */
  function updateConditionalFormatRule(id: string, patch: Partial<ConditionalFormattingRule>) {
    state.saveUndo?.();
    const idx = conditionalFormats.findIndex((r) => r.id === id);
    if (idx < 0) return;
    conditionalFormats[idx] = { ...conditionalFormats[idx]!, ...patch, id };
    cfCache.invalidate();
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  /** 删除规则（保存前快照到 Undo） */
  function removeConditionalFormatRule(id: string) {
    state.saveUndo?.();
    const idx = conditionalFormats.findIndex((r) => r.id === id);
    if (idx < 0) return;
    conditionalFormats.splice(idx, 1);
    cfCache.invalidate();
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  /** 调整优先级顺序：dir 'up' 表示提升（priority 减小），'down' 表示降低 */
  function moveConditionalFormatRule(id: string, dir: 'up' | 'down') {
    state.saveUndo?.();
    const sorted = [...conditionalFormats].sort((a, b) => a.priority - b.priority);
    const idx = sorted.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const swapWith = dir === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= sorted.length) return;
    const a = sorted[idx]!;
    const b = sorted[swapWith]!;
    const tmp = a.priority;
    a.priority = b.priority;
    b.priority = tmp;
    cfCache.invalidate();
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  function invalidateConditionalFormatCache() {
    cfCache.invalidate();
  }

  /** 清除规则：scope 'selection' 仅移除命中当前选区的规则范围，'sheet' 清空当前工作表全部规则 */
  function clearConditionalFormats(scope: 'selection' | 'sheet') {
    state.saveUndo?.();
    if (scope === 'sheet') {
      conditionalFormats.splice(0, conditionalFormats.length);
    } else {
      const sel = state.selection.value;
      if (!sel) return;
      for (let i = conditionalFormats.length - 1; i >= 0; i--) {
        const rule = conditionalFormats[i]!;
        rule.ranges = rule.ranges.filter(
          (rg) => !(rg.startCol <= sel.endCol && rg.endCol >= sel.startCol
            && rg.startRow <= sel.endRow && rg.endRow >= sel.startRow),
        );
        if (rule.ranges.length === 0) conditionalFormats.splice(i, 1);
      }
    }
    cfCache.invalidate();
    state.scheduleRender?.();
    state.emitModelData?.();
  }

  // ============ 数据验证（Data Validation）============

  /** 规则集合 / 列表源数据变化 → 失效索引与列表缓存 */
  function invalidateDataValidationCache(): void {
    dvIndex.invalidate();
    dvListCache.clear();
  }

  /** 构建数据验证求值上下文（引擎保持纯净，所有外部依赖在此注入） */
  function buildDVContext(): DataValidationContext {
    return {
      cells,
      colCount: dims.colCount,
      rowCount: dims.rowCount,
      locale: locale.value,
      getCellValue: (c: number, r: number) => getCellValue(c, r),
      getSheetCells: (sheetId: string) => (state.getSheetCellsById ? state.getSheetCellsById(sheetId) : null),
    };
  }

  function getDataValidationRules(row: number, col: number): DataValidationRule[] {
    // 合并单元格：统一按左上角（anchor）判定，避免在合并区内产生多套判定结果
    const m = findMergeFn(col, row);
    const rc = m ? { col: m.range.startCol, row: m.range.startRow } : { col, row };
    return dvIndex.getRules(rc.col, rc.row, dataValidations);
  }

  function getDataValidationRule(row: number, col: number): DataValidationRule | null {
    const list = getDataValidationRules(row, col);
    return list.length ? list[0]! : null;
  }

  function hasDataValidation(row: number, col: number): boolean {
    return getDataValidationRules(row, col).length > 0;
  }

  function getListValidation(row: number, col: number): DataValidationRule | null {
    // 合并单元格：统一按左上角（anchor）判定，避免在合并区内产生多套判定结果
    const m = findMergeFn(col, row);
    const rc = m ? { col: m.range.startCol, row: m.range.startRow } : { col, row };
    // 渲染热路径：走索引的零分配查询，不构造中间数组
    return dvIndex.findRule(rc.col, rc.row, hasDropdownIndicator, dataValidations);
  }

  /** list 规则的候选项（带缓存；源区域数据变化时由 invalidateDataValidationCache 失效） */
  function getListItems(rule: DataValidationRule): string[] {
    const src = rule.listSource;
    const cacheKey = src && src.type === 'range'
      ? `range:${src.sheetId ?? ''}:${src.range.startCol},${src.range.startRow},${src.range.endCol},${src.range.endRow}`
      : `values:${(src && src.type === 'values' ? src.values : rule.values ?? []).join('\u0001')}`;
    const cached = dvListCache.get(cacheKey);
    if (cached) return cached;
    const items = resolveListItems(rule, buildDVContext());
    dvListCache.set(cacheKey, items);
    return items;
  }

  function getValidationDropdown(row: number, col: number): { rule: DataValidationRule; items: string[] } | null {
    const rule = getListValidation(row, col);
    if (!rule) return null;
    return { rule, items: getListItems(rule) };
  }

  function getValidationInputMessage(row: number, col: number): { title: string; message: string } | null {
    for (const rule of getDataValidationRules(row, col)) {
      if (rule.enabled === false) continue;
      if (!rule.showInputMessage) continue;
      const title = rule.inputTitle ?? '';
      const message = rule.inputMessage ?? '';
      if (!title && !message) continue;
      return { title, message };
    }
    return null;
  }

  function validateCell(row: number, col: number, value: string | null | undefined): DataValidationResult {
    const rules = getDataValidationRules(row, col);
    if (rules.length === 0) return { valid: true };
    return _validateCellValue(value, col, row, rules, buildDVContext());
  }

  function validateCells(
    entries: { col: number; row: number; value: string | null | undefined }[],
  ): DataValidationResult {
    const ctx = buildDVContext();
    const rank: Record<string, number> = { stop: 3, warning: 2, information: 1 };
    let worst: DataValidationResult | null = null;
    let worstRank = 0;
    for (const e of entries) {
      const rules = getDataValidationRules(e.row, e.col);
      if (rules.length === 0) continue;
      const res = _validateCellValue(e.value, e.col, e.row, rules, ctx);
      if (res.valid) continue;
      const r = rank[dvSeverityOf(res.rule!)] ?? 0;
      if (r > worstRank) {
        worstRank = r;
        worst = res;
      }
    }
    return worst ?? { valid: true };
  }

  /** 新建规则；silent=true 表示由调用方统一负责 Undo（如粘贴） */
  function createDataValidation(rule: DataValidationRule, opts?: { silent?: boolean }): DataValidationRule {
    if (!opts?.silent) state.saveUndo?.();
    const next: DataValidationRule = {
      ...rule,
      id: rule.id || genDataValidationId(),
      ranges: (rule.ranges ?? []).map((r) => ({ ...r })),
      enabled: rule.enabled !== false,
    };
    dataValidations.push(next);
    invalidateDataValidationCache();
    if (!opts?.silent) {
      state.scheduleRender?.();
      state.emitModelData?.();
    }
    return next;
  }

  function updateDataValidation(
    id: string,
    patch: Partial<DataValidationRule>,
    opts?: { silent?: boolean },
  ): void {
    const idx = dataValidations.findIndex((r) => r.id === id);
    if (idx < 0) {
      // 按 id 找不到（例如规则已被清除）→ 退化为新建，保持调用方语义简单
      createDataValidation({ id, ...patch } as DataValidationRule, opts);
      return;
    }
    if (!opts?.silent) state.saveUndo?.();
    dataValidations[idx] = { ...dataValidations[idx]!, ...patch, id };
    invalidateDataValidationCache();
    if (!opts?.silent) {
      state.scheduleRender?.();
      state.emitModelData?.();
    }
  }

  function removeDataValidation(id: string, opts?: { silent?: boolean }): void {
    const idx = dataValidations.findIndex((r) => r.id === id);
    if (idx < 0) return;
    if (!opts?.silent) state.saveUndo?.();
    dataValidations.splice(idx, 1);
    invalidateDataValidationCache();
    if (!opts?.silent) {
      state.scheduleRender?.();
      state.emitModelData?.();
    }
  }

  /**
   * 清除指定范围的数据验证：
   *  - 规则的 Range 会被矩形差集拆分/缩小，剩余为空才删除整条规则；
   *  - range 为 null 表示清除当前工作表全部规则。
   */
  function clearDataValidation(range: SelectionRange | null, opts?: { silent?: boolean }): void {
    if (!range) {
      if (dataValidations.length === 0) return;
      if (!opts?.silent) state.saveUndo?.();
      dataValidations.splice(0, dataValidations.length);
      invalidateDataValidationCache();
      if (!opts?.silent) {
        state.scheduleRender?.();
        state.emitModelData?.();
      }
      return;
    }
    const cut: SelectionRange = {
      startCol: Math.min(range.startCol, range.endCol),
      endCol: Math.max(range.startCol, range.endCol),
      startRow: Math.min(range.startRow, range.endRow),
      endRow: Math.max(range.startRow, range.endRow),
    };
    const touched = dataValidations.filter((r) => (r.ranges ?? []).some((rg) => {
      return !(rg.endCol < cut.startCol || rg.startCol > cut.endCol
        || rg.endRow < cut.startRow || rg.startRow > cut.endRow);
    }));
    if (touched.length === 0) return;
    if (!opts?.silent) state.saveUndo?.();
    for (let i = dataValidations.length - 1; i >= 0; i--) {
      const rule = dataValidations[i]!;
      const nextRanges: SelectionRange[] = [];
      for (const rg of rule.ranges ?? []) {
        nextRanges.push(...subtractDvRange(rg, cut));
      }
      if (nextRanges.length === 0) dataValidations.splice(i, 1);
      else rule.ranges = nextRanges;
    }
    invalidateDataValidationCache();
    if (!opts?.silent) {
      state.scheduleRender?.();
      state.emitModelData?.();
    }
  }

  function getDataValidationsInRange(range: SelectionRange): { rule: DataValidationRule; range: SelectionRange }[] {
    const out: { rule: DataValidationRule; range: SelectionRange }[] = [];
    for (const rule of dataValidations) {
      for (const rg of rule.ranges ?? []) {
        const it = intersectDvRange(rg, range);
        if (it) out.push({ rule, range: it });
      }
    }
    return out;
  }

  /** 将一批规则应用到目标矩形：先扣除目标区域已有规则，再写入（复制粘贴携带规则） */
  function applyDataValidationsToRange(
    rules: DataValidationRule[],
    target: SelectionRange,
    opts?: { silent?: boolean },
  ): void {
    if (!rules.length) return;
    if (!opts?.silent) state.saveUndo?.();
    // 1) 扣除目标区域（含未被覆盖的规则残余）
    for (let i = dataValidations.length - 1; i >= 0; i--) {
      const rule = dataValidations[i]!;
      const nextRanges: SelectionRange[] = [];
      for (const rg of rule.ranges ?? []) nextRanges.push(...subtractDvRange(rg, target));
      if (nextRanges.length === 0) dataValidations.splice(i, 1);
      else rule.ranges = nextRanges;
    }
    // 2) 写入新规则（区域裁剪到目标矩形内）
    for (const rule of rules) {
      const clipped: SelectionRange[] = [];
      for (const rg of rule.ranges ?? []) {
        const it = intersectDvRange(rg, target);
        if (it) clipped.push(it);
      }
      if (!clipped.length) continue;
      dataValidations.push({ ...rule, id: genDataValidationId(), ranges: clipped });
    }
    invalidateDataValidationCache();
    if (!opts?.silent) {
      state.scheduleRender?.();
      state.emitModelData?.();
    }
  }

  /**
   * 出错警告：把「是否继续」的决策交给 UI 层（异步）。
   * 未注入钩子（如纯逻辑/测试环境）时：stop 拒绝写入，warning / information 放行。
   */
  async function resolveValidationAlert(
    res: DataValidationResult,
    col: number,
    row: number,
  ): Promise<DataValidationAlertAction> {
    const severity = res.severity ?? 'stop';
    const showError = !res.rule || res.rule.showErrorMessage !== false;
    if (!showError) return severity === 'stop' ? 'cancel' : 'continue';
    const hook = state.showValidationAlert;
    if (!hook) return severity === 'stop' ? 'cancel' : 'continue';
    dvAlertDepth++;
    try {
      return await hook({
        severity,
        title: res.title ?? '',
        message: res.message ?? '',
        col,
        row,
      });
    } catch {
      return 'cancel';
    } finally {
      dvAlertDepth = Math.max(0, dvAlertDepth - 1);
    }
  }

  function isValidationAlertOpen(): boolean {
    return dvAlertDepth > 0;
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

  /**
   * 提交编辑：数据验证发生在 Cell mutation 之前。
   *  - 校验通过 → 写入并退出编辑；
   *  - 校验失败且为 stop（或用户在警告中选择取消）→ 不写入任何数据，保持编辑态等待修正；
   *  - warning / information 用户确认继续 → 写入（不再二次校验，避免死循环）。
   * @returns 是否已写入单元格
   */
  async function commitEdit(): Promise<boolean> {
    const cur = editingCell.value;
    if (!cur) return false;
    const col = cur.col;
    const row = cur.row;
    const value = editValue.value;
    const res = validateCell(row, col, value);
    if (!res.valid) {
      const action = await resolveValidationAlert(res, col, row);
      // 'retry' / 'cancel' 均不写入；保持编辑态，由调用方把焦点交还编辑器
      if (action !== 'continue') return false;
    }
    saveUndoFn();
    setCellValue(col, row, value);
    editingCell.value = null;
    editValue.value = '';
    return true;
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
    const gX = outlineGapX();
    const gY = outlineGapY();
    const bodyLeft = HEADER_WIDTH + gX + frozenColumnsWidth;
    const bodyTop = HEADER_HEIGHT + gY + frozenRowsHeight;
    const bodyWidth = Math.max(0, viewSizeProxy.w - HEADER_WIDTH - gX - SB_SIZE - frozenColumnsWidth);
    const bodyHeight = Math.max(0, viewSizeProxy.h - HEADER_HEIGHT - gY - SB_SIZE - frozenRowsHeight);
    const regions: ViewportRegion[] = [];
    if (frozenRowsHeight > 0 && frozenColumnsWidth > 0) {
      regions.push({
        kind: 'corner', x: HEADER_WIDTH + gX, y: HEADER_HEIGHT + gY,
        width: frozenColumnsWidth, height: frozenRowsHeight, scrollLeft: 0, scrollTop: 0,
      });
    }
    if (frozenRowsHeight > 0) {
      regions.push({
        kind: 'rows', x: bodyLeft, y: HEADER_HEIGHT + gY,
        width: bodyWidth, height: frozenRowsHeight, scrollLeft: scrollX.value, scrollTop: 0,
      });
    }
    if (frozenColumnsWidth > 0) {
      regions.push({
        kind: 'columns', x: HEADER_WIDTH + gX, y: bodyTop,
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
    const logicalX = cP[col] ?? 0;
    const logicalY = rP[row] ?? 0;
    const m = findMergeFn(col, row);
    // 非合并格宽高：用折叠感知的位置差（折叠列 → 0），避免折叠后仍按原始列宽绘制导致内容重叠
    const cw = m ? (cP[m.range.endCol + 1] ?? logicalX) - logicalX : ((cP[col + 1] ?? logicalX) - logicalX);
    const rh = m ? (rP[m.range.endRow + 1] ?? logicalY) - logicalY : getRowHeightFn(row);
    const colFrozen = col < freeze.cols;
    const rowFrozen = row < freeze.rows;
    // 冻结方向不参与滚动偏移；body 方向使用 body-relative scrollX/scrollY
    // 整体网格向右/下平移 Outline gutter 尺寸，保证与拓展后的表头对齐
    const screenX = (colFrozen ? 0 : -scrollX.value) + HEADER_WIDTH + outlineGapX() + logicalX;
    const screenY = (rowFrozen ? 0 : -scrollY.value) + HEADER_HEIGHT + outlineGapY() + logicalY;
    return { x: screenX, y: screenY, width: cw, height: rh };
  }

  function screenToCell(x: number, y: number) {
    const { frozenColumnsWidth, frozenRowsHeight } = getFrozenMetrics();
    const gX = outlineGapX();
    const gY = outlineGapY();
    if (x < HEADER_WIDTH + gX || y < HEADER_HEIGHT + gY) return null;
    const colFrozen = frozenColumnsWidth > 0 && x < HEADER_WIDTH + gX + frozenColumnsWidth;
    const rowFrozen = frozenRowsHeight > 0 && y < HEADER_HEIGHT + gY + frozenRowsHeight;
    const logicalX = colFrozen ? (x - HEADER_WIDTH - gX) : (x - HEADER_WIDTH - gX + scrollX.value);
    const logicalY = rowFrozen ? (y - HEADER_HEIGHT - gY) : (y - HEADER_HEIGHT - gY + scrollY.value);
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
    const gw = Math.max(0, viewSizeProxy.w - HEADER_WIDTH - outlineGapX() - SB_SIZE - frozenColumnsWidth);
    const gh = Math.max(0, viewSizeProxy.h - HEADER_HEIGHT - outlineGapY() - SB_SIZE - frozenRowsHeight);
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
  // 一次操作一个 Undo 快照：数据验证 → saveUndo → ensureCapacity → applyAutoFillPlan → 写入 cells + formulaDeps → selectRange → scheduleRender
  // 不走 setCellValue：避免触发 setCellValue 内部的日期/数字格式自动识别（会覆盖 styleId 透传）
  function applyAutoFill(
    sourceRange: SelectionRange,
    targetRange: SelectionRange,
    direction: 'up' | 'down' | 'left' | 'right',
  ) {
    // Merge 兼容性校验（双保险）
    const mergeRes = validateMergeCompatibility(sourceRange, targetRange, merges);
    if (!mergeRes.ok) {
      if (mergeRes.reason === 'target-merge-size') {
        window.alert(t(locale.value, 'autofillMergeSizeError'));
      }
      return;
    }

    // 1. 先纯函数计算目标 cells 增量（不落盘），供数据验证整体校验
    const draftPlan = applyAutoFillPlan(
      sourceRange,
      targetRange,
      { cells, styles },
      direction,
      locale.value,
      dims.colCount,
      dims.rowCount,
      colToLabel,
    );

    // 2. 数据验证：整个 targetRange 作为一次原子操作。
    //    存在 Stop 级非法结果则整次 AutoFill 取消（不产生任何写入、不产生 Undo 快照）。
    const entries = Object.entries(draftPlan.cells).map(([k, cell]) => {
      const comma = k.indexOf(',');
      return {
        col: parseInt(k.substring(0, comma), 10),
        row: parseInt(k.substring(comma + 1), 10),
        value: cell ? cell.value : '',
      };
    });
    const vRes = validateCells(entries);
    if (!vRes.valid) {
      void (async () => {
        const action = await resolveValidationAlert(vRes, targetRange.startCol, targetRange.startRow);
        if (action !== 'continue') return;
        writeAutoFillPlan(sourceRange, targetRange, direction);
      })();
      return;
    }

    writeAutoFillPlan(sourceRange, targetRange, direction);
  }

  /** AutoFill 实际写入（校验通过后调用）：saveUndo → ensureCapacity → 计算 plan → 写入 */
  function writeAutoFillPlan(
    sourceRange: SelectionRange,
    targetRange: SelectionRange,
    direction: 'up' | 'down' | 'left' | 'right',
  ) {
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
      // 仅写合并格 anchor：跳过非 anchor 的合并格成员（其值由 anchor 统一展示）
      const comma = k.indexOf(',');
      const col = parseInt(k.substring(0, comma), 10);
      const row = parseInt(k.substring(comma + 1), 10);
      const m = findMerge(col, row);
      if (m && !(col === m.range.startCol && row === m.range.startRow)) continue;
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
    getCurrentRegion,
    detectFilterRange,
    toggleAutoFilter,
    isColumnInFilterRange,
    getFilterRange,
    isFilterEnabled,
    isFilterColumnActive,
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

    // ============ 行列分组 / 折叠（Outline）============
    getRowOutlines,
    getColumnOutlines,
    addRowGroup,
    addColumnGroup,
    removeOutline,
    clearRowGroups,
    clearColumnGroups,
    clearAllOutlines,
    setOutlineCollapsed,
    toggleOutline,
    getOutlineLevel,
    getOutlineGutterSize,
    getRowOutlineLevel,
    getColumnOutlineLevel,
    isRowCollapsed,
    isColumnCollapsed,
    isRowVisible,
    isColumnVisible,
    isColHidden,
    getColWidth,
    adjustOutlinesForInsertRows,
    adjustOutlinesForDeleteRows,
    adjustOutlinesForInsertCols,
    adjustOutlinesForDeleteCols,
    syncOutlines,

    // viewSize 引用
    viewSize: viewSizeProxy,

    // 查找高亮：默认无高亮（find-replace 模块会覆盖注入）
    findHighlight: (_col: number, _row: number) => null,

    // AutoFill / Fill Handle
    autoFillState,
    applyAutoFill,

    // 条件格式（Conditional Formatting）
    conditionalFormats,
    resolveConditionalFormat,
    addConditionalFormatRule,
    updateConditionalFormatRule,
    removeConditionalFormatRule,
    moveConditionalFormatRule,
    clearConditionalFormats,
    invalidateConditionalFormatCache,

    // 数据验证（Data Validation）
    dataValidations,
    getDataValidationRules,
    getDataValidationRule,
    hasDataValidation,
    getListValidation,
    getValidationDropdown,
    getValidationInputMessage,
    validateCell,
    validateCells,
    createDataValidation,
    updateDataValidation,
    removeDataValidation,
    clearDataValidation,
    getDataValidationsInRange,
    applyDataValidationsToRange,
    invalidateDataValidationCache,
    isValidationAlertOpen,
    confirmInvalidValue: resolveValidationAlert,
  };

  // 设置内部函数对 state 的反向引用
  saveUndoFn = () => state.saveUndo?.();
  clampScrollFn = (sx, sy) => state.clampScroll?.(sx, sy);

  return state;
}
