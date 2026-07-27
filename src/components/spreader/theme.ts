import { computed, type ComputedRef } from 'vue';
import { lightTheme, darkTheme } from './constants';
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
  return style;
}
