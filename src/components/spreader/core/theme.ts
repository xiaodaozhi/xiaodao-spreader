/**
 * 主题 CSS 变量组装：把 light / dark 的 ThemeColors 平铺成 --sp-* 自定义属性，
 * 由外层容器注入；Teleport 到 body 的浮层通过 documentElement 级变量继承主题
 * （见 spreader.vue 的 applyGlobalThemeVars）。
 */
import { computed, type ComputedRef } from 'vue';
import { lightTheme, darkTheme } from './constants';
import { DEFAULT_BORDER_COLOR, DARK_BORDER_COLOR } from './border-color';
import type { ThemeColors } from './types';

export function useTheme(theme: ComputedRef<'light' | 'dark'>): ComputedRef<ThemeColors> {
  return computed<ThemeColors>(() => theme.value === 'dark' ? darkTheme : lightTheme);
}

export function buildOuterStyle(
  colors: ThemeColors,
  width: number | string | undefined,
  height: number | string | undefined,
  resolveSize: (val: number | string | undefined) => number | null,
): Record<string, string> {
  const style: Record<string, string> = {};
  const pw = resolveSize(width);
  const ph = resolveSize(height);
  if (pw != null) style.width = `${pw}px`;
  if (ph != null) style.height = `${ph}px`;
  style['--sp-formula-bar-bg'] = colors.formulaBarBg;
  style['--sp-formula-bar-border'] = colors.formulaBarBorder;
  style['--sp-formula-bar-label-color'] = colors.formulaBarLabelText;
  style['--sp-formula-bar-label-bg'] = colors.formulaBarLabelBg;
  style['--sp-formula-bar-label-border'] = colors.formulaBarLabelBorder;
  style['--sp-formula-bar-input-bg'] = colors.formulaBarInputBg;
  style['--sp-formula-bar-input-border'] = colors.formulaBarInputBorder;
  style['--sp-formula-bar-input-color'] = colors.formulaBarInputText;
  style['--sp-formula-bar-input-focus-border'] = colors.formulaBarInputFocusBorder;
  style['--sp-formula-bar-input-focus-shadow'] = colors.formulaBarInputFocusShadow;
  style['--sp-wrapper-bg'] = colors.wrapperBg;
  style['--sp-cell-editor-border'] = colors.cellEditorBorder;
  style['--sp-cell-editor-color'] = colors.cellEditorText;
  style['--sp-cell-editor-bg'] = colors.cellEditorBg;
  style['--sp-cell-editor-shadow'] = colors.cellEditorShadow;
  style['--sp-tab-bar-bg'] = colors.tabBarBg;
  style['--sp-tab-bar-border'] = colors.tabBarBorder;
  style['--sp-tab-active-bg'] = colors.tabActiveBg;
  style['--sp-tab-active-color'] = colors.tabActiveText;
  style['--sp-tab-active-border'] = colors.tabActiveBorder;
  style['--sp-tab-inactive-bg'] = colors.tabInactiveBg;
  style['--sp-tab-inactive-color'] = colors.tabInactiveText;
  style['--sp-tab-inactive-border'] = colors.tabInactiveBorder;
  style['--sp-tab-hover-bg'] = colors.tabHoverBg;
  style['--sp-tab-add-btn-color'] = colors.tabAddBtnColor;
  style['--sp-tab-add-btn-hover-bg'] = colors.tabAddBtnHoverBg;
  style['--sp-tab-scroll-btn-color'] = colors.tabScrollBtnColor;
  style['--sp-tab-scroll-btn-hover-bg'] = colors.tabScrollBtnHoverBg;
  style['--sp-scroll-thumb'] = colors.scrollbarThumb;
  style['--sp-scroll-thumb-hover'] = colors.scrollbarThumbHover;
  style['--sp-scroll-btn-bg'] = colors.scrollBtnBg;
  style['--sp-scroll-btn-color'] = colors.scrollBtnColor;
  style['--sp-scroll-btn-hover-bg'] = colors.scrollBtnHoverBg;
  style['--sp-scroll-btn-active-bg'] = colors.scrollBtnActiveBg;
  style['--sp-scroll-track-bg'] = colors.scrollTrackBg;
  style['--sp-toolbar-bg'] = colors.toolbarBg;
  style['--sp-toolbar-border'] = colors.toolbarBorder;
  style['--sp-toolbar-btn-color'] = colors.toolbarBtnColor;
  style['--sp-toolbar-btn-hover-bg'] = colors.toolbarBtnHoverBg;
  style['--sp-toolbar-btn-disabled-color'] = colors.toolbarBtnDisabledColor;
  style['--sp-toolbar-btn-active-color'] = colors.toolbarBtnActiveColor;
  // 次级 / 弱化文本（对话框 label、空状态提示），随主题切换
  style['--sp-toolbar-text-secondary'] = colors.toolbarTextSecondary;
  style['--sp-toolbar-text-muted'] = colors.toolbarTextMuted;
  // 下拉 / 右键菜单选中项底色，随主题切换
  style['--sp-toolbar-item-active-bg'] = colors.toolbarItemActiveBg;
  // 危险按钮（如数据验证「全部清除」）hover 底色，随主题切换
  style['--sp-danger-hover-bg'] = colors.dangerHoverBg;
  // 查找/表单内提示说明文字色，随主题切换
  style['--sp-find-hint-color'] = colors.findHintColor;
  // 默认（自动）边框色：随主题切换，dark 下更亮以保证在深色背景可见
  style['--sp-border-default'] = colors === darkTheme ? DARK_BORDER_COLOR : DEFAULT_BORDER_COLOR;
  return style;
}
