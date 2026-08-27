// ============ 类型定义 ============
export interface CellCoord {
  col: number;
  row: number;
}

export interface SelectionRange {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

// ============ 边框类型 ============
/** 单边边框 */
export interface BorderSide {
  width?: number;
  color?: string;
  style?: string;  // 预留：solid/dashed/dotted 等
}

/** 四边边框组合 */
export interface BorderStyle {
  top?: BorderSide;
  right?: BorderSide;
  bottom?: BorderSide;
  left?: BorderSide;
}

/** 边框来源标识 */
export type BorderSource = 'cell' | 'merge';

/** 单元格样式：所有属性均为可选，方便后续扩展数字格式、边框、字体、填充、对齐等 */
export interface CellStyle {
  // 字体
  fontFamily?: string;
  fontSize?: number | string;
  fontWeight?: string;
  fontStyle?: string;
  underline?: string;
  strikethrough?: string;
  // 颜色
  color?: string;
  backgroundColor?: string;
  // 对齐
  textAlign?: string;
  verticalAlign?: string;
  wrap?: string;
  // 边框（新机制：通过 borderId 引用 BorderPool）
  borderId?: number;
  /** @deprecated 旧版边框属性，兼容历史数据使用，新代码请通过 borderId 访问 */
  borderTopWidth?: number;
  /** @deprecated 旧版边框属性，兼容历史数据使用，新代码请通过 borderId 访问 */
  borderBottomWidth?: number;
  /** @deprecated 旧版边框属性，兼容历史数据使用，新代码请通过 borderId 访问 */
  borderLeftWidth?: number;
  /** @deprecated 旧版边框属性，兼容历史数据使用，新代码请通过 borderId 访问 */
  borderRightWidth?: number;
  /** @deprecated 旧版边框颜色，兼容历史数据使用，新代码请通过 BorderStyle.color 访问 */
  borderColor?: string;
  // 数字格式
  numberFormat?: string;
  /**
   * 数字格式分类标记：'custom' 表示该格式由「增加/减少小数位数」等操作在常规单元格上自动生成，
   * 下拉/对话框应按「自定义」展示。仅存标记，渲染不受影响。
   */
  numberFormatCategory?: 'custom';
  // 后续扩展属性使用索引签名
  [key: string]: unknown;
}

/** 单元格数据：value 始终为 string，样式通过 styleId 引用表格级 styles 池 */
export interface CellData {
  value: string;
  styleId?: number;
}

// ============ 查找和替换 ============
/** 搜索范围：当前工作表 / 整个工作簿 / 当前选区 */
export type FindScope = 'sheet' | 'workbook' | 'selection';

/** 单次匹配结果：记录所在 Sheet 索引与单元格坐标 */
export interface FindResult {
  sheetIndex: number;
  col: number;
  row: number;
}

export interface Range {
  start: number;
  end: number;
}

export interface SpreadsheetOptions {
  rowCount?: number;
  colCount?: number;
  colWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
}

export interface SpreadsheetData {
  [cellRef: string]: { value: string; styleId?: number; style?: CellStyle };
}

/** 冻结窗格状态：rows/cols 为冻结的行数/列数（0 表示该方向未冻结） */
export interface FreezePane {
  rows:  number;
  cols: number;
}

// ============ 数据筛选（AutoFilter）============
/** 单列筛选类型 */
export type FilterColumnType = 'values' | 'text' | 'number' | 'date';

/** 条件筛选算子（文本 / 数字 / 日期通用，按 type 决定可用集合） */
export type FilterOperator =
  | 'equals'      // 等于
  | 'notEquals'   // 不等于
  | 'contains'    // 包含（文本）
  | 'notContains' // 不包含（文本）
  | 'startsWith'  // 开头是（文本）
  | 'endsWith'    // 结尾是（文本）
  | 'gt'          // 大于（数字/日期）
  | 'gte'         // 大于等于（数字/日期）
  | 'lt'          // 小于（数字/日期）
  | 'lte'         // 小于等于（数字/日期）
  | 'between'     // 介于（数字/日期，需 value + value2）
  | 'blank'       // 空白
  | 'notBlank';   // 非空白

/** 单列筛选条件（条件筛选模式） */
export interface FilterCondition {
  operator: FilterOperator;
  /** 比较值（文本/数字原始文本；日期为输入文本） */
  value?: string;
  /** 介于（between）的第二个值 */
  value2?: string;
}

/** 单列筛选定义 */
export interface FilterColumn {
  /** 筛选类型：值列表 / 文本条件 / 数字条件 / 日期条件 */
  type: FilterColumnType;
  /** 值列表模式下选中的值（可能包含 FILTER_BLANK 哨兵表示空白）；为空表示不过滤 */
  values?: string[];
  /** 条件模式下生效 */
  condition?: FilterCondition;
}

/** 工作表筛选状态：独立存储，不写入 cell style / data */
export interface SheetFilter {
  /** 筛选区域（含表头行）。startRow 通常为表头行，数据行为 startRow+1..endRow */
  range: SelectionRange;
  /** 按列索引（0-based）存储的列筛选；缺失的列表示不过滤 */
  columns: Record<number, FilterColumn>;
}

export interface SheetModelData {
  name: string;
  /** 表格级样式池：styles[0] 始终为默认空样式 {} */
  styles?: CellStyle[];
  /** 表格级边框池：borders[0] 始终为默认空边框 {} */
  borders?: BorderStyle[];
  cells: Record<string, { value: string; styleId?: number; style?: CellStyle }>;
  merges?: Record<string, SelectionRange>;
  colWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
  /** 工作表逻辑有效列数（0-based exclusive）。缺失时回退到默认 26 */
  colCount?: number;
  /** 工作表逻辑有效行数（0-based exclusive）。缺失时回退到默认 200 */
  rowCount?: number;
  /** 冻结窗格状态；缺省视为未冻结 { rows: 0, cols: 0 } */
  freeze?: FreezePane;
  /** 数据筛选状态；缺省视为未启用筛选 */
  filter?: SheetFilter;
}

export interface SheetState {
  id: string;
  name: string;
  cells: Record<string, CellData>;
  /** 表格级样式池：styles[0] 始终为默认空样式 {} */
  styles: CellStyle[];
  /** 表格级边框池：borders[0] 始终为默认空边框 {} */
  borders: BorderStyle[];
  merges: Record<string, SelectionRange>;
  selection: SelectionRange | null;
  activeCell: CellCoord;
  scrollX: number;
  scrollY: number;
  colWidths: number[];
  rowHeights: (number | undefined)[];
  /** 工作表逻辑有效列数（0-based exclusive）。随操作动态增长 */
  colCount: number;
  /** 工作表逻辑有效行数（0-based exclusive）。随操作动态增长 */
  rowCount: number;
  /** 冻结窗格状态（默认 { rows: 0, cols: 0 } 表示未冻结） */
  freeze: FreezePane;
  /** 数据筛选状态；缺省为 null 表示未启用筛选 */
  filter: SheetFilter | null;
}

/** 视口区域：冻结窗格将画布划分为四个独立滚动区域 */
export interface ViewportRegion {
  kind: 'corner' | 'rows' | 'columns' | 'body';
  x: number;
  y: number;
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface UndoSnapshot {
  cells: Record<string, CellData>;
  styles: CellStyle[];
  borders: BorderStyle[];
  colWidths: number[];
  rowHeights: (number | undefined)[];
}

export interface ContextMenuItem {
  label: string;
  action?: () => void;
  disabled?: boolean;
  children?: ContextMenuItem[];
}

export interface ThemeColors {
  bg: string;
  gridBg: string;
  headerBg: string;
  headerBorder: string;
  headerText: string;
  headerSep: string;
  cornerBg: string;
  gridLine: string;
  selectionBg: string;
  activeCellBorder: string;
  cellText: string;
  scrollTrack: string;
  scrollThumb: string;
  formulaBarBg: string;
  formulaBarBorder: string;
  formulaBarLabelText: string;
  formulaBarLabelBg: string;
  formulaBarLabelBorder: string;
  formulaBarInputBg: string;
  formulaBarInputBorder: string;
  formulaBarInputText: string;
  formulaBarInputFocusBorder: string;
  formulaBarInputFocusShadow: string;
  wrapperBg: string;
  cellEditorBorder: string;
  cellEditorText: string;
  cellEditorBg: string;
  cellEditorShadow: string;
  tabBarBg: string;
  tabBarBorder: string;
  tabActiveBg: string;
  tabActiveText: string;
  tabActiveBorder: string;
  tabInactiveBg: string;
  tabInactiveText: string;
  tabInactiveBorder: string;
  tabHoverBg: string;
  tabAddBtnColor: string;
  tabAddBtnHoverBg: string;
  tabScrollBtnColor: string;
  tabScrollBtnHoverBg: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  scrollBtnBg: string;
  scrollBtnColor: string;
  scrollBtnHoverBg: string;
  scrollBtnActiveBg: string;
  scrollTrackBg: string;
  toolbarBg: string;
  toolbarBorder: string;
  toolbarBtnColor: string;
  toolbarBtnHoverBg: string;
  toolbarBtnDisabledColor: string;
  toolbarBtnActiveColor: string;

  // 查找高亮
  findMatchBg: string;
  findActiveBg: string;
}

export interface Point {
  x: number;
  y: number;
}
