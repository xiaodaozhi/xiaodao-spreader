/**
 * 主题：CSS 变量统一放在 theme.css（.spreadsheet-outer / .sp-spreader-overlay 写 light，
 * 二者加 .dark 即切换为 dark 变量），dark 状态仅作用于组件子树，不挂 <html> 全局类，
 * 以免污染调用方项目。本文件只保留两件事：
 *  - useTheme：JS 侧（canvas 绘制）用的主题色对象，仍按 props.theme 取 light / dark。
 *  - buildOuterStyle：仅计算组件根尺寸（width / height），主题变量交给 theme.css。
 */
import { computed, type ComputedRef } from 'vue';
import { lightTheme, darkTheme } from './constants';
import type { ThemeColors } from './types';

export function useTheme(theme: ComputedRef<'light' | 'dark'>): ComputedRef<ThemeColors> {
  return computed<ThemeColors>(() => theme.value === 'dark' ? darkTheme : lightTheme);
}

export function buildOuterStyle(
  width: number | string | undefined,
  height: number | string | undefined,
  resolveSize: (val: number | string | undefined) => number | null,
): Record<string, string> {
  const style: Record<string, string> = {};
  const pw = resolveSize(width);
  const ph = resolveSize(height);
  if (pw != null) style.width = `${pw}px`;
  if (ph != null) style.height = `${ph}px`;
  return style;
}
