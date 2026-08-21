// UI 主组件
export { default } from './components/spreadsheet.vue';
export { default as Spreader } from './components/spreadsheet.vue';

// 核心类型/常量/工具
export * from './core/types';
export * from './core/constants';
export * from './core/utils';
export * from './core/formula';
export * from './core/theme';

// 子组件类型导出
export type { BorderType } from './components/pickers/borderPicker.vue';
