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
