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

export interface CellData {
  value: string;
  style: Record<string, unknown> | null;
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
  [cellRef: string]: { value: string; style?: Record<string, unknown> };
}

export interface SheetModelData {
  name: string;
  cells: Record<string, { value: string; style?: Record<string, unknown> }>;
  colWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
}

export interface SheetState {
  id: string;
  name: string;
  cells: Record<string, CellData>;
  selection: SelectionRange | null;
  activeCell: CellCoord;
  scrollX: number;
  scrollY: number;
  colWidths: number[];
  rowHeights: number[];
}

export interface UndoSnapshot {
  cells: Record<string, CellData>;
  colWidths: number[];
  rowHeights: number[];
}

export interface ContextMenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
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
}

export interface Point {
  x: number;
  y: number;
}
