// 组件库对外出口：
// 统一 re-export 组件与类型（即 xiaodao-spreader 包的入口）。
export { default, Spreader } from './components/spreader';

export type {
  CellCoord,
  SelectionRange,
  CellData,
  CellStyle,
  BorderStyle,
  BorderSide,
  BorderSource,
  Range,
  SpreadsheetOptions,
  SpreadsheetData,
  SheetModelData,
  SheetState,
  UndoSnapshot,
  ContextMenuItem,
  ThemeColors,
  Point,
} from './components/spreader';
