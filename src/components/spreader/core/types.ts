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
  /**
   * 渲染优先级标记（可选）：该边由一次边框操作「显式写入」时置为 true。
   * 作用：相邻公共边解析（resolveSharedBorder）中，若仅一侧带 owner，则该侧优先，
   * 用于修复「选区外框/上边框/左边框被相邻单元格旧 border 覆盖」的问题。
   * 属于持久化数据（随 BorderPool 一起序列化）；旧数据缺省视为 undefined（非 owner）。
   * 不表示跨单元格同步；A.right 与 B.left 仍各自独立存储。
   */
  owner?: boolean;
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
  /** 批注引用：指向 Sheet 级 notes 池中的一个 CellNote；与 value/style 完全独立 */
  noteId?: string;
}

// ============ 单元格批注（Cell Note / Annotation）============
/**
 * 批注是绑定到 Cell 的独立附加元数据，不属于 cell.value / formula / style。
 * 采用「Note Pool」存储：Sheet 级 notes 池按 id 存放，cell 只保存 noteId 引用，
 * 便于扩展 Threaded Comment，且多个操作（排序/插入删除）移动 cell 时 noteId 随数据移动。
 * 第一阶段实现与多人协作 Threaded Comment 无关。
 */
export interface CellNote {
  /** 稳定唯一 ID（不可用数组 index） */
  id: string;
  /** 批注正文（多行文本，含换行） */
  text: string;
  /** 作者信息（可选） */
  author?: string;
  /** 创建时间（epoch ms） */
  createdAt: number;
  /** 最近修改时间（epoch ms） */
  updatedAt: number;
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
  rows: number;
  cols: number;
}

// ============ 数据筛选（AutoFilter）============
/** 单列筛选类型 */
export type FilterColumnType = 'values' | 'text' | 'number' | 'date';

/** 条件筛选算子（文本 / 数字 / 日期通用，按 type 决定可用集合） */
export type FilterOperator
  = | 'equals'      // 等于
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

// ============ 条件格式（Conditional Formatting）============
/** 条件类型：第一阶段完整实现前 8 种；后几种为第二阶段预留（数据模型保留，暂不完整实现 UI/Renderer） */
export type CFConditionType
  = | 'cellIs'            // 单元格值比较（等于/不等于/大于/大于等于/小于/小于等于/介于/不介于）
    | 'textContains'      // 文本包含
    | 'textNotContains'   // 文本不包含
    | 'blank'             // 空白
    | 'notBlank'          // 非空白
    | 'duplicate'         // 重复值
    | 'unique'            // 唯一值
    | 'formula'           // 公式（结果为真时命中）
    | 'colorScale'        // 色阶（第二阶段，预留）
    | 'dataBar'           // 数据条（第二阶段，预留）
    | 'iconSet'           // 图标集（第二阶段，预留）
    | 'topBottom'         // 前/后 N 项（第二阶段，预留）
    | 'aboveBelowAverage'; // 高于/低于平均值（第二阶段，预留）

/** 单元格值比较算子 */
export type CellIsOperator
  = | 'equal'
    | 'notEqual'
    | 'greaterThan'
    | 'greaterThanOrEqual'
    | 'lessThan'
    | 'lessThanOrEqual'
    | 'between'
    | 'notBetween';

export interface CFCellIsCondition {
  type: 'cellIs';
  operator: CellIsOperator;
  /** 比较值（文本/数字原始文本）。between / notBetween 需要 value2 */
  value: string;
  /** between / notBetween 的第二个值 */
  value2?: string;
}

export interface CFTextCondition {
  type: 'textContains' | 'textNotContains';
  value: string;
}

export interface CFBlankCondition {
  type: 'blank' | 'notBlank';
}

export interface CFDuplicateCondition {
  type: 'duplicate' | 'unique';
}

export interface CFFormulaCondition {
  type: 'formula';
  /** 公式（不含前导 '='）；相对/绝对引用以规则范围左上角为基准 */
  formula: string;
}

/** 第二阶段可视类型占位（暂不完整实现 UI/Renderer，仅保留数据模型） */
export interface CFColorScaleCondition { type: 'colorScale' }
export interface CFDataBarCondition { type: 'dataBar' }
export interface CFIconSetCondition { type: 'iconSet' }
export interface CFTopBottomCondition { type: 'topBottom'; top: boolean; percent: boolean; n: number }
export interface CFAboveBelowAverageCondition { type: 'aboveBelowAverage'; above: boolean }

export type ConditionalFormattingCondition
  = | CFCellIsCondition
    | CFTextCondition
    | CFBlankCondition
    | CFDuplicateCondition
    | CFFormulaCondition
    | CFColorScaleCondition
    | CFDataBarCondition
    | CFIconSetCondition
    | CFTopBottomCondition
    | CFAboveBelowAverageCondition;

/** 条件格式要设置的格式（仅格式属性，不持久化选中状态）。渲染时与基础样式临时合成，不写回 cell.style */
export interface ConditionalFormattingFormat {
  backgroundColor?: string;
  color?: string;
  fontWeight?: 'bold' | '';
  fontStyle?: 'italic' | '';
  underline?: 'underline' | '';
  strikethrough?: 'line-through' | '';
}

/** 单条条件格式规则：属于 Sheet，而非 Cell */
export interface ConditionalFormattingRule {
  /** 稳定唯一 ID（禁止数组 index） */
  id: string;
  condition: ConditionalFormattingCondition;
  format: ConditionalFormattingFormat;
  /** 应用范围（支持多区域） */
  ranges: SelectionRange[];
  /** 优先级：越小越高（Excel 风格） */
  priority: number;
  /** 命中后停止后续规则 */
  stopIfTrue: boolean;
  /** 是否启用 */
  enabled: boolean;
}

// ============ 数据验证（Data Validation）============
/** 数据验证类型（对齐 Excel：整数 / 小数 / 列表 / 日期 / 时间 / 文本长度 / 自定义） */
export type DataValidationType
  = | 'any'
    | 'list'
    | 'wholeNumber'
    | 'decimal'
    | 'date'
    | 'time'
    | 'textLength'
    | 'custom';

/** 条件运算符（数值 / 日期 / 时间 / 文本长度通用） */
export type DataValidationOperator
  = | 'between'
    | 'notBetween'
    | 'equal'
    | 'notEqual'
    | 'greaterThan'
    | 'greaterThanOrEqual'
    | 'lessThan'
    | 'lessThanOrEqual';

/** 出错警告样式：停止（拒绝提交）/ 警告（可确认继续）/ 信息（提示后由用户决定） */
export type DataValidationErrorStyle = 'stop' | 'warning' | 'information';

/** 下拉列表数据源：
 *  - values：直接输入的逗号分隔常量列表；
 *  - range：引用工作表区域（可跨表），支持动态列表（区域数据变化时下拉项同步更新）。
 */
export type DataValidationListSource
  = | { type: 'values'; values: string[] }
    | { type: 'range'; range: SelectionRange; /** 目标工作表 id 或名称；缺省表示当前工作表 */ sheetId?: string };

/** 单条数据验证规则：属于 Sheet 而非 Cell；仅描述「输入约束 + UI 行为」，不写入 cell style */
export interface DataValidationRule {
  /** 稳定唯一 ID（禁止数组 index） */
  id: string;
  /** 应用范围（支持多区域） */
  ranges: SelectionRange[];
  type: DataValidationType;
  operator?: DataValidationOperator;
  /** 条件值 1（between/notBetween 时为下界） */
  formula1?: string;
  /** 条件值 2（between/notBetween 时为上界） */
  formula2?: string;
  /** list 类型的数据源（优先于 values） */
  listSource?: DataValidationListSource;
  /** 兼容字段：list + 常量列表时与 listSource.values 保持同步 */
  values?: string[];
  /** 忽略空值（默认 true） */
  allowBlank?: boolean;
  /** list 类型是否显示单元格内下拉箭头（默认 true） */
  showDropdown?: boolean;
  /** 选中单元格时显示输入信息（默认 false） */
  showInputMessage?: boolean;
  inputTitle?: string;
  inputMessage?: string;
  /** 无效数据时显示错误警告（默认 true） */
  showErrorMessage?: boolean;
  /** 出错警告样式（默认 stop） */
  errorStyle?: DataValidationErrorStyle;
  errorTitle?: string;
  errorMessage?: string;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/** 单条规则的验证结果严重级别（与 errorStyle 对应） */
export type DataValidationSeverity = 'stop' | 'warning' | 'information';

/** 数据验证结果：valid=false 时携带最严重的那条失败规则与提示文案 */
export interface DataValidationResult {
  valid: boolean;
  /** 命中的失败规则（多条失败时取严重级别最高的一条） */
  rule?: DataValidationRule;
  severity?: DataValidationSeverity;
  title?: string;
  message?: string;
}

// ============ 行列分组 / 折叠（Outline / Grouping）============
/** 单个行列分组的最大支持层级：固定为 1，即仅支持一层分组（分组之间互不嵌套） */
export const MAX_OUTLINE_LEVEL = 1;

/** 维度分组：属于 Sheet 的结构元数据。start/end 为 0-based 闭区间，且 start <= end */
export interface DimensionOutline {
  /** 稳定唯一 ID（禁止数组 index） */
  id: string;
  axis: 'row' | 'column';
  start: number;
  end: number;
  /** 由嵌套关系计算得到的层级（1 起），非用户手工输入 */
  level: number;
  /** 是否折叠（折叠时隐藏组内 Detail，逻辑行列仍存在） */
  collapsed: boolean;
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
  // 注意：不持久化 colCount/rowCount。加载时由内容推导网格尺寸
  // （见 core/model-dims.ts 的 deriveModelDims），保证超出默认 26×200 的数据仍可访问。
  /** 冻结窗格状态；缺省视为未冻结 { rows: 0, cols: 0 } */
  freeze?: FreezePane;
  /** 数据筛选状态；缺省视为未启用筛选 */
  filter?: SheetFilter;
  /** 条件格式规则集合；缺省视为无规则 */
  conditionalFormats?: ConditionalFormattingRule[];
  /** 数据验证规则集合；旧数据缺省视为无数据验证 */
  dataValidations?: DataValidationRule[];
  /** 行分组集合；旧数据缺省视为无分组 */
  rowOutlines?: DimensionOutline[];
  /** 列分组集合；旧数据缺省视为无分组 */
  columnOutlines?: DimensionOutline[];
  /** 单元格批注池：按 noteId 存放，cell.noteId 引用之；与 cell value/style 完全独立 */
  notes?: Record<string, CellNote>;
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
  /** 条件格式规则集合；缺省为空数组 */
  conditionalFormats: ConditionalFormattingRule[];
  /** 数据验证规则集合；缺省为空数组 */
  dataValidations: DataValidationRule[];
  /** 行分组集合；缺省为空数组 */
  rowOutlines: DimensionOutline[];
  /** 列分组集合；缺省为空数组 */
  columnOutlines: DimensionOutline[];
  /** 单元格批注池：按 noteId 存放，cell.noteId 引用之 */
  notes: Record<string, CellNote>;
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
  outlineGroupBg1: string;
  outlineGroupBg2: string;
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
  /** 次级文本（如对话框 label），light #666 / dark #aaa */
  toolbarTextSecondary: string;
  /** 弱化文本（如空状态提示），light #999 / dark #888 */
  toolbarTextMuted: string;
  /** 下拉/右键菜单选中项底色，light #e5f1fb / dark 半透明蓝（配 toolbarBtnActiveColor 文字色） */
  toolbarItemActiveBg: string;

  // 查找高亮
  findMatchBg: string;
  findActiveBg: string;
}

export interface Point {
  x: number;
  y: number;
}
