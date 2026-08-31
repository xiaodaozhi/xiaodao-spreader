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
  DataValidationRule,
  DataValidationType,
  DataValidationOperator,
  DataValidationErrorStyle,
  DataValidationListSource,
  DataValidationResult,
  DataValidationSeverity,
  ConditionalFormattingRule,
  ConditionalFormattingCondition,
  ConditionalFormattingFormat,
} from './core/types';

export {
  validateCellValue,
  evaluateDataValidationRule,
  resolveListItems,
  DataValidationIndex,
  genDataValidationId,
} from './core/data-validation';

export { StylePool, resolveStyle, migrateCells, cloneCells } from './core/style-pool';
