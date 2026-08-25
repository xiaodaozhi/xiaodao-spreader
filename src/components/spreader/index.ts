import Spreader from './components/spreader.vue';

export default Spreader;
export { Spreader };

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
} from './core/types';

export { StylePool, resolveStyle, migrateCells, cloneCells } from './core/style-pool';
