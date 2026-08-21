import type { ThemeColors } from './types';

// ============ 布局常量 ============
export const HEADER_WIDTH = 52;
export const HEADER_HEIGHT = 24;
export const DEFAULT_COL_WIDTH = 100;
export const DEFAULT_ROW_HEIGHT = 24;
export const MIN_COL_WIDTH = 30;
export const MIN_ROW_HEIGHT = 24;
export const MAX_COL_WIDTH = 1000;
export const MAX_ROW_HEIGHT = 500;

// ============ 滚动条常量 ============
export const SB_SIZE = 11;
export const ARROW_SIZE = 11;
export const SCROLL_STEP = 50;

// ============ 撤销/重做 ============
export const UNDO_MAX = 50;

// ============ 国际化文本 ============
export const i18n: Record<string, Record<string, string>> = {
  'zh-CN': {
    insert: '插入',
    delete: '删除',
    rename: '重命名',
    moveLeft: '左移',
    moveRight: '右移',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    addSheet: '新建工作表',
    moveSheetLeft: '左移',
    moveSheetRight: '右移',
    scrollUp: '向上滚动',
    scrollDown: '向下滚动',
    scrollLeft: '向左滚动',
    scrollRight: '向右滚动',
    calculate: '计算',
    sum: '求和',
    undo: '撤销',
    redo: '重做',
    paintFormat: '格式刷',
    clearFormat: '清除格式',
    fontFamily: '字体',
    fontSize: '字号',
    fontSizeIncrease: '增大字号',
    fontSizeDecrease: '减小字号',
    bold: '加粗',
    italic: '斜体',
    underline: '下划线',
    strikethrough: '删除线',
    fontColor: '文字颜色',
    fillColor: '填充颜色',
    borders: '边框',
    hAlign: '水平对齐',
    vAlign: '垂直对齐',
    alignLeft: '左端对齐',
    alignCenter: '居中对齐',
    alignRight: '右端对齐',
    alignTop: '顶端对齐',
    alignMiddle: '垂直居中',
    alignBottom: '底端对齐',
    wrap: '自动换行',
    mergeCells: '合并单元格',
    mergeCenter: '合并后居中',
    mergeAcross: '跨越合并',
    unmergeCells: '取消合并单元格',
    borderBottom: '下框线',
    borderTop: '上框线',
    borderLeft: '左框线',
    borderRight: '右框线',
    borderNone: '无框线',
    borderAll: '所有框线',
    borderOuter: '外框线',
    borderThickOuter: '粗外框线',
    fontDefault: '默认',
    rowHeight: '行高',
    colWidth: '列宽',
    autoRowHeight: '自动行高',
    defaultColWidth: '默认列宽',
    ok: '确定',
    cancel: '取消',
    dimNumberError: '请输入数字',
    dimRangeError: '请输入 {min}~{max} 之间的数值',
    colorAutomatic: '自动',
    colorNoFill: '无填充',
    colorWhite: '白色',
    colorBlack: '黑色',
    colorLightGray: '浅灰',
    colorLightBlue: '浅蓝',
    colorLightOrange: '浅橙',
    colorLightYellow: '浅黄',
    colorLightGreen: '浅绿',
    colorPaleBlue: '淡蓝',
    colorPaleOrange: '淡橙',
    colorPaleYellow: '淡黄',
    colorPaleGreen: '淡绿',
    colorSilver: '银色',
    colorSkyBlue: '天蓝',
    colorCoral: '珊瑚',
    colorGold: '金色',
    colorMint: '薄荷',
    colorGray: '灰色',
    colorMediumBlue: '中蓝',
    colorOrange: '橙色',
    colorAmber: '琥珀',
    colorMediumGreen: '中绿',
    colorDarkGray: '深灰',
    colorRoyalBlue: '宝蓝',
    colorRed: '红色',
    colorDarkGold: '深金',
    colorDarkGreen: '深绿',
    colorCharcoal: '炭灰',
    colorDeepBlue: '深蓝',
    colorDarkRed: '深红',
    colorOlive: '橄榄',
    colorForest: '森林',
    colorSlate: '石板灰',
    colorNavy: '藏青',
    colorCrimson: '绯红',
    colorDarkOlive: '深橄榄',
    colorDeepForest: '深林',
    colorDarkSlate: '深石板灰',
    colorMidnight: '午夜蓝',
    colorMaroon: '栗色',
    colorCoffee: '咖啡色',
    colorEvergreen: '常青',
    colorDarkNavy: '深藏青',
    colorDarkMaroon: '深栗',
    colorDarkCoffee: '深咖',
    colorInkGreen: '墨绿',
  },
  'en-US': {
    insert: 'Insert',
    delete: 'Delete',
    rename: 'Rename',
    moveLeft: 'Move Left',
    moveRight: 'Move Right',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    addSheet: 'Add new sheet',
    moveSheetLeft: 'Move Left',
    moveSheetRight: 'Move Right',
    scrollUp: 'Scroll up',
    scrollDown: 'Scroll down',
    scrollLeft: 'Scroll left',
    scrollRight: 'Scroll right',
    calculate: 'Calculate',
    sum: 'Sum',
    undo: 'Undo',
    redo: 'Redo',
    paintFormat: 'Paint Format',
    clearFormat: 'Clear Format',
    fontFamily: 'Font Family',
    fontSize: 'Font Size',
    fontSizeIncrease: 'Increase Font Size',
    fontSizeDecrease: 'Decrease Font Size',
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strikethrough: 'Strikethrough',
    fontColor: 'Font Color',
    fillColor: 'Fill Color',
    borders: 'Borders',
    hAlign: 'Horizontal Align',
    vAlign: 'Vertical Align',
    alignLeft: 'Align Left',
    alignCenter: 'Align Center',
    alignRight: 'Align Right',
    alignTop: 'Align Top',
    alignMiddle: 'Align Middle',
    alignBottom: 'Align Bottom',
    wrap: 'Wrap Text',
    mergeCells: 'Merge Cells',
    mergeCenter: 'Merge & Center',
    mergeAcross: 'Merge Across',
    unmergeCells: 'Unmerge Cells',
    borderBottom: 'Bottom Border',
    borderTop: 'Top Border',
    borderLeft: 'Left Border',
    borderRight: 'Right Border',
    borderNone: 'No Border',
    borderAll: 'All Borders',
    borderOuter: 'Outside Borders',
    borderThickOuter: 'Thick Box Border',
    fontDefault: 'Default',
    rowHeight: 'Row Height',
    colWidth: 'Column Width',
    autoRowHeight: 'Auto Row Height',
    defaultColWidth: 'Default Column Width',
    ok: 'OK',
    cancel: 'Cancel',
    dimNumberError: 'Please enter a number',
    dimRangeError: 'Please enter a value between {min} and {max}',
    colorAutomatic: 'Automatic',
    colorNoFill: 'No Fill',
    colorWhite: 'White',
    colorBlack: 'Black',
    colorLightGray: 'Light Gray',
    colorLightBlue: 'Light Blue',
    colorLightOrange: 'Light Orange',
    colorLightYellow: 'Light Yellow',
    colorLightGreen: 'Light Green',
    colorPaleBlue: 'Pale Blue',
    colorPaleOrange: 'Pale Orange',
    colorPaleYellow: 'Pale Yellow',
    colorPaleGreen: 'Pale Green',
    colorSilver: 'Silver',
    colorSkyBlue: 'Sky Blue',
    colorCoral: 'Coral',
    colorGold: 'Gold',
    colorMint: 'Mint',
    colorGray: 'Gray',
    colorMediumBlue: 'Medium Blue',
    colorOrange: 'Orange',
    colorAmber: 'Amber',
    colorMediumGreen: 'Medium Green',
    colorDarkGray: 'Dark Gray',
    colorRoyalBlue: 'Royal Blue',
    colorRed: 'Red',
    colorDarkGold: 'Dark Gold',
    colorDarkGreen: 'Dark Green',
    colorCharcoal: 'Charcoal',
    colorDeepBlue: 'Deep Blue',
    colorDarkRed: 'Dark Red',
    colorOlive: 'Olive',
    colorForest: 'Forest',
    colorSlate: 'Slate',
    colorNavy: 'Navy',
    colorCrimson: 'Crimson',
    colorDarkOlive: 'Dark Olive',
    colorDeepForest: 'Deep Forest',
    colorDarkSlate: 'Dark Slate',
    colorMidnight: 'Midnight',
    colorMaroon: 'Maroon',
    colorCoffee: 'Coffee',
    colorEvergreen: 'Evergreen',
    colorDarkNavy: 'Dark Navy',
    colorDarkMaroon: 'Dark Maroon',
    colorDarkCoffee: 'Dark Coffee',
    colorInkGreen: 'Ink Green',
  },
};

export function t(locale: string, key: string): string {
  return i18n[locale]?.[key] ?? key;
}

// ============ 字体常量 ============
export const DEFAULT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif';
export const DEFAULT_FONT_SIZE = 10;

export interface FontOption {
  label: string;
  value: string | number;
  /** 触发器/菜单项图标，提供时以图标取代文本标签展示在触发器上 */
  icon?: string;
}

export const FONT_FAMILIES: FontOption[] = [
  { label: '', value: '' },
  { label: '微软雅黑', value: '"Microsoft YaHei", "微软雅黑", sans-serif' },
  { label: '宋体', value: '"SimSun", "宋体", serif' },
  { label: '黑体', value: '"SimHei", "黑体", sans-serif' },
  { label: '楷体', value: '"KaiTi", "楷体", serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Arial Black', value: '"Arial Black", sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Impact', value: 'Impact, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
];

export const FONT_SIZES: FontOption[] = [
  { label: '9', value: 9 },
  { label: '10', value: 10 },
  { label: '11', value: 11 },
  { label: '12', value: 12 },
  { label: '13', value: 13 },
  { label: '14', value: 14 },
  { label: '16', value: 16 },
  { label: '18', value: 18 },
  { label: '20', value: 20 },
  { label: '24', value: 24 },
  { label: '28', value: 28 },
  { label: '32', value: 32 },
  { label: '36', value: 36 },
  { label: '48', value: 48 },
  { label: '72', value: 72 },
];

// ============ 对齐选项 ============
// 图标统一 1:1 (viewBox 24x24)、无外框，仅以线条示意对齐方向
export interface AlignOption {
  value: string;
  labelKey: string;
  icon: string;
}

const H_ALIGN_LEFT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="19" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="17" y2="18"/></svg>';
const H_ALIGN_CENTER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>';
const H_ALIGN_RIGHT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="7" y1="18" x2="21" y2="18"/></svg>';

// 垂直对齐：三条竖线（中间稍短），顶端/底端对齐附加横线（与竖线留间距）
const V_ALIGN_TOP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="7" x2="6" y2="20"/><line x1="12" y1="7" x2="12" y2="16"/><line x1="18" y1="7" x2="18" y2="20"/><line x1="4" y1="3" x2="20" y2="3"/></svg>';
const V_ALIGN_MIDDLE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="4" x2="6" y2="20"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="18" y1="4" x2="18" y2="20"/></svg>';
const V_ALIGN_BOTTOM_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="4" x2="6" y2="17"/><line x1="12" y1="8" x2="12" y2="17"/><line x1="18" y1="4" x2="18" y2="17"/><line x1="4" y1="21" x2="20" y2="21"/></svg>';

export const H_ALIGN_OPTIONS: AlignOption[] = [
  { value: 'left', labelKey: 'alignLeft', icon: H_ALIGN_LEFT_ICON },
  { value: 'center', labelKey: 'alignCenter', icon: H_ALIGN_CENTER_ICON },
  { value: 'right', labelKey: 'alignRight', icon: H_ALIGN_RIGHT_ICON },
];

export const V_ALIGN_OPTIONS: AlignOption[] = [
  { value: 'top', labelKey: 'alignTop', icon: V_ALIGN_TOP_ICON },
  { value: 'middle', labelKey: 'alignMiddle', icon: V_ALIGN_MIDDLE_ICON },
  { value: 'bottom', labelKey: 'alignBottom', icon: V_ALIGN_BOTTOM_ICON },
];

export const WRAP_ICON = '<svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M896 179.2a38.4 38.4 0 0 0-76.8 0v665.6a38.4 38.4 0 0 0 76.8 0v-665.6zM204.8 281.6A38.4 38.4 0 0 0 204.8 358.4h179.2a38.4 38.4 0 0 0 0-76.8H204.8zM550.4 281.6a38.4 38.4 0 0 0 0 76.8h51.2c35.328 0 64 28.672 64 64v179.2c0 35.328-28.672 64-64 64H246.272l36.864-36.864a38.4 38.4 0 1 0-54.272-54.272l-102.4 102.4a38.4 38.4 0 0 0 0 54.272l102.4 102.4a38.4 38.4 0 0 0 54.272-54.272l-36.864-36.864h355.328a140.8 140.8 0 0 0 140.8-140.8v-179.2a140.8 140.8 0 0 0-140.8-140.8h-51.2z" /></svg>';

// ============ 合并单元格选项 ============
export type MergeType = 'mergeCenter' | 'mergeAcross' | 'mergeCells' | 'unmergeCells';

export interface MergeOption {
  key: MergeType;
  labelKey: string;
  icon: string;
}

// 合并后居中：两个方框 + 中间双向箭头 + A字
const MERGE_CENTER_ICON = '<svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M709.952 465.92l88-76.032C801.92 385.984 806.656 384 812.032 384s10.048 1.984 14.08 5.952C830.08 393.92 832 398.656 832 403.968L832 448l32 0C881.664 448 896 462.336 896 480S881.664 512 864 512L832 512l0 44.032c0 5.376-1.92 10.112-5.952 14.08C822.08 574.08 817.344 576 812.032 576s-10.048-1.92-14.08-5.952L709.952 494.08C705.984 490.112 704 485.376 704 480S705.984 469.952 709.952 465.92zM378.048 465.92 290.048 389.952C286.08 385.984 281.344 384 275.968 384s-10.048 1.984-14.08 5.952C257.92 393.92 256 398.656 256 403.968L256 448 224 448C206.336 448 192 462.336 192 480S206.336 512 224 512L256 512l0 44.032c0 5.376 1.92 10.112 5.952 14.08C265.92 574.08 270.656 576 275.968 576s10.048-1.92 14.08-5.952L378.048 494.08C382.016 490.112 384 485.376 384 480S382.016 469.952 378.048 465.92zM448 128 128 128l0 704 320 0 0-128 64 0 0 128c0 35.392-28.608 64-64 64L128 896c-35.392 0-64-28.608-64-64L64 128c0-35.392 28.608-64 64-64l320 0 0 0c35.392 0 64 28.608 64 64l0 128L448 256 448 128M640 128l320 0 0 704-320 0 0-128L576 704l0 128c0 35.392 28.608 64 64 64l320 0c35.392 0 64-28.608 64-64L1024 128c0-35.392-28.608-64-64-64l-320 0 0 0C604.608 64 576 92.608 576 128l0 128 64 0L640 128M722.304 642.304c0 8.512-3.52 16.32-10.496 23.36s-15.424 10.624-25.344 10.624c-5.76 0-10.688-1.088-14.72-3.136-4.096-2.048-7.616-4.928-10.432-8.512s-5.824-9.088-9.024-16.512-5.952-13.952-8.32-19.648l-17.28-46.016L479.36 582.464 462.08 629.568c-6.72 18.304-12.48 30.656-17.344 37.12s-12.544 9.6-23.424 9.6c-9.28 0-17.408-3.456-24.512-10.24s-10.624-14.592-10.624-23.232c0-4.992 0.896-10.176 2.496-15.488S393.024 614.592 396.8 605.056l92.672-238.016C492.096 360.256 495.296 352 499.008 342.464s7.68-17.536 11.904-23.872 9.664-11.456 16.576-15.36c6.784-3.968 15.232-5.888 25.344-5.888 10.176 0 18.752 1.92 25.472 5.888 6.848 3.968 12.352 8.96 16.64 15.104 4.096 6.208 7.744 12.8 10.624 19.904s6.528 16.576 11.008 28.352l94.656 236.48C718.592 621.056 722.304 634.112 722.304 642.304zM606.912 526.784 552.32 375.552 498.624 526.784 606.912 526.784z"/></svg>';
// 跨越合并：四格方框 + 向右箭头
const MERGE_ACROSS_ICON = '<svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M832 64c70.4 0 128 57.6 128 128v640c0 70.4-57.6 128-128 128H192c-70.4 0-128-57.6-128-128V192c0-70.4 57.6-128 128-128h640zM448 768H128v64c0 38.4 25.6 64 64 64h256v-128z m448 0H512v128h320c38.4 0 64-25.6 64-64v-64z m0-448H128v384h768V320zM633.6 390.4l96 96c6.4 6.4 6.4 12.8 6.4 19.2 0 6.4-6.4 12.8-6.4 19.2L633.6 633.6c-12.8 12.8-32 12.8-44.8 0-12.8-12.8-12.8-32-6.4-44.8l44.8-44.8H288c-19.2 0-32-12.8-32-32s12.8-32 32-32h339.2l-44.8-44.8c-6.4-12.8-6.4-32 0-44.8 12.8-12.8 38.4-12.8 51.2 0zM448 128H192c-38.4 0-64 25.6-64 64v64h320V128z m384 0H512v128h384V192c0-38.4-25.6-64-64-64z"/></svg>';
// 合并单元格：两个方框 + 中间向内双向箭头
const MERGE_CELLS_ICON = '<svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M512 480c0 5.376-1.984 10.112-5.952 14.08L354.048 634.048C350.08 638.08 345.344 640 339.968 640s-10.048-1.92-14.08-5.952C321.92 630.144 320 625.344 320 620.032L320 512 224 512C206.336 512 192 497.664 192 480S206.336 448 224 448L320 448 320 339.968c0-5.376 1.92-10.048 5.952-14.08C329.92 321.984 334.656 320 339.968 320s10.048 1.984 14.08 5.952L506.048 465.92C510.016 469.952 512 474.624 512 480zM576 480c0 5.376 1.984 10.112 5.952 14.08l152 140.032C737.92 638.08 742.656 640 748.032 640s10.048-1.92 14.08-5.952C766.08 630.144 768 625.344 768 620.032L768 512l96 0C881.664 512 896 497.664 896 480S881.664 448 864 448L768 448 768 339.968c0-5.376-1.92-10.048-5.952-14.08C758.08 321.984 753.344 320 748.032 320s-10.048 1.984-14.08 5.952L581.952 465.92C577.984 469.952 576 474.624 576 480zM448 128l0 128 64 0L512 128c0-35.392-28.672-64-64-64l0 0L128 64C92.672 64 64 92.608 64 128l0 704c0 35.392 28.672 64 64 64l320 0c35.328 0 64-28.608 64-64l0-128L448 704l0 128L128 832 128 128 448 128M640 128l320 0 0 704-320 0 0-128L576 704l0 128c0 35.392 28.608 64 64 64l320 0c35.392 0 64-28.608 64-64L1024 128c0-35.392-28.608-64-64-64l-320 0 0 0C604.608 64 576 92.608 576 128l0 128 64 0L640 128"/></svg>';
// 拆分单元格：两个方框 + 中间向外双向箭头
const UNMERGE_ICON = '<svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M197.952 465.92l152-140.032C353.92 321.984 358.656 320 364.032 320s10.048 1.984 14.08 5.952C382.08 329.92 384 334.656 384 339.968L384 448l96 0C497.664 448 512 462.336 512 480S497.664 512 480 512L384 512l0 108.032c0 5.376-1.92 10.112-5.952 14.08C374.08 638.08 369.344 640 364.032 640S353.92 638.08 349.952 634.048L197.952 494.08C193.984 490.112 192 485.376 192 480S193.984 469.952 197.952 465.92zM890.048 465.92l-152-140.032C734.08 321.984 729.344 320 723.968 320s-10.048 1.984-14.08 5.952C705.92 329.92 704 334.656 704 339.968L704 448 608 448C590.336 448 576 462.336 576 480S590.336 512 608 512L704 512l0 108.032c0 5.376 1.92 10.112 5.952 14.08C713.92 638.08 718.656 640 723.968 640s10.048-1.92 14.08-5.952l152-140.032C894.016 490.112 896 485.376 896 480S894.016 469.952 890.048 465.92zM448 128l0 128 64 0L512 128c0-35.392-28.608-64-64-64l0 0L128 64C92.608 64 64 92.608 64 128l0 704c0 35.392 28.608 64 64 64l320 0c35.392 0 64-28.608 64-64l0-128L448 704l0 128L128 832 128 128 448 128M640 128l320 0 0 704-320 0 0-128L576 704l0 128c0 35.392 28.608 64 64 64l320 0c35.392 0 64-28.608 64-64L1024 128c0-35.392-28.608-64-64-64l-320 0 0 0C604.608 64 576 92.608 576 128l0 128 64 0L640 128"/></svg>';

export const MERGE_OPTIONS: MergeOption[] = [
  { key: 'mergeCenter', labelKey: 'mergeCenter', icon: MERGE_CENTER_ICON },
  { key: 'mergeAcross', labelKey: 'mergeAcross', icon: MERGE_ACROSS_ICON },
  { key: 'mergeCells', labelKey: 'mergeCells', icon: MERGE_CELLS_ICON },
  { key: 'unmergeCells', labelKey: 'unmergeCells', icon: UNMERGE_ICON },
];

// ============ 主题色盘 ============
export const lightTheme: ThemeColors = {
  bg: '#f4f4f4',
  gridBg: '#ffffff',
  headerBg: '#e8e8e8',
  headerBorder: '#c8c8c8',
  headerText: '#444',
  headerSep: '#b0b0b0',
  cornerBg: '#e0e0e0',
  gridLine: '#e0e0e0',
  selectionBg: 'rgba(0, 120, 215, 0.12)',
  activeCellBorder: '#0078d7',
  cellText: '#1a1a1a',
  scrollTrack: 'rgba(0,0,0,0.08)',
  scrollThumb: 'rgba(0,0,0,0.25)',
  formulaBarBg: '#f0f0f0',
  formulaBarBorder: '#c8c8c8',
  formulaBarLabelText: '#333',
  formulaBarLabelBg: '#fff',
  formulaBarLabelBorder: '#c0c0c0',
  formulaBarInputBg: '#fff',
  formulaBarInputBorder: '#c0c0c0',
  formulaBarInputText: '#1a1a1a',
  formulaBarInputFocusBorder: '#0078d7',
  formulaBarInputFocusShadow: 'rgba(0, 120, 215, 0.3)',
  wrapperBg: '#e8e8e8',
  cellEditorBorder: '#0078d7',
  cellEditorText: '#1a1a1a',
  cellEditorBg: '#fff',
  cellEditorShadow: '#0078d7',
  tabBarBg: '#e8e8e8',
  tabBarBorder: '#c0c0c0',
  tabActiveBg: '#ffffff',
  tabActiveText: '#1a1a1a',
  tabActiveBorder: '#0078d7',
  tabInactiveBg: '#dfdfdf',
  tabInactiveText: '#666',
  tabInactiveBorder: 'transparent',
  tabHoverBg: '#e0e0e0',
  tabAddBtnColor: '#555',
  tabAddBtnHoverBg: '#d0d0d0',
  tabScrollBtnColor: '#888',
  tabScrollBtnHoverBg: '#d0d0d0',
  scrollbarThumb: 'rgba(0,0,0,0.25)',
  scrollbarThumbHover: 'rgba(0,0,0,0.4)',
  scrollBtnBg: '#e8e8e8',
  scrollBtnColor: '#666',
  scrollBtnHoverBg: '#d0d0d0',
  scrollBtnActiveBg: '#c0c0c0',
  scrollTrackBg: 'rgba(0,0,0,0.06)',
  toolbarBg: '#f7f7f7',
  toolbarBorder: '#d8d8d8',
  toolbarBtnColor: '#444',
  toolbarBtnHoverBg: '#e6e6e6',
  toolbarBtnDisabledColor: '#b0b0b0',
  toolbarBtnActiveColor: '#0078d7',
};

export const darkTheme: ThemeColors = {
  bg: '#1e1e1e',
  gridBg: '#252526',
  headerBg: '#252525',
  headerBorder: '#3e3e3e',
  headerText: '#999',
  headerSep: '#3e3e3e',
  cornerBg: '#2a2a2a',
  gridLine: '#3e3e3e',
  selectionBg: 'rgba(0, 120, 215, 0.25)',
  activeCellBorder: '#0078d7',
  cellText: '#d4d4d4',
  scrollTrack: 'rgba(255,255,255,0.06)',
  scrollThumb: 'rgba(255,255,255,0.2)',
  formulaBarBg: '#2d2d2d',
  formulaBarBorder: '#3e3e3e',
  formulaBarLabelText: '#ccc',
  formulaBarLabelBg: '#3c3c3c',
  formulaBarLabelBorder: '#555',
  formulaBarInputBg: '#3c3c3c',
  formulaBarInputBorder: '#555',
  formulaBarInputText: '#d4d4d4',
  formulaBarInputFocusBorder: '#0078d7',
  formulaBarInputFocusShadow: 'rgba(0, 120, 215, 0.4)',
  wrapperBg: '#1e1e1e',
  cellEditorBorder: '#0078d7',
  cellEditorText: '#d4d4d4',
  cellEditorBg: '#3c3c3c',
  cellEditorShadow: '#0078d7',
  tabBarBg: '#2a2a2a',
  tabBarBorder: '#3e3e3e',
  tabActiveBg: '#1e1e1e',
  tabActiveText: '#e0e0e0',
  tabActiveBorder: '#0078d7',
  tabInactiveBg: '#333333',
  tabInactiveText: '#888',
  tabInactiveBorder: 'transparent',
  tabHoverBg: '#3a3a3a',
  tabAddBtnColor: '#999',
  tabAddBtnHoverBg: '#3a3a3a',
  tabScrollBtnColor: '#777',
  tabScrollBtnHoverBg: '#3a3a3a',
  scrollbarThumb: 'rgba(255,255,255,0.2)',
  scrollbarThumbHover: 'rgba(255,255,255,0.35)',
  scrollBtnBg: '#2d2d2d',
  scrollBtnColor: '#999',
  scrollBtnHoverBg: '#3d3d3d',
  scrollBtnActiveBg: '#4d4d4d',
  scrollTrackBg: 'rgba(255,255,255,0.05)',
  toolbarBg: '#2a2a2a',
  toolbarBorder: '#3e3e3e',
  toolbarBtnColor: '#ccc',
  toolbarBtnHoverBg: '#3a3a3a',
  toolbarBtnDisabledColor: '#666',
  toolbarBtnActiveColor: '#4ea1ff',
};
