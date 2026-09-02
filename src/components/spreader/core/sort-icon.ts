/**
 * Sort Icon — 排序图标的单一数据源。
 *
 * toolbar 触发按钮与 sort-picker 下拉项渲染的是同一套排序图标
 * （左侧三条渐宽横线 + 右侧方向箭头，viewBox 0 0 1024 1024），
 * 此前两处各维护一份 SORT_BARS / SORT_ARROW_PATHS，靠注释「保持一致」约束。
 * 现统一收敛到此模块，两处都从这里取，杜绝不同步。
 */

import type { SortOrder } from './sort-core';

/** 左侧三条渐宽横线 */
export interface SortBar { name: string; x1: number; y1: number; x2: number; y2: number }

export const SORT_BARS: SortBar[] = [
  { name: 'bar1', x1: 96, y1: 224, x2: 352, y2: 224 },
  { name: 'bar2', x1: 96, y1: 512, x2: 512, y2: 512 },
  { name: 'bar3', x1: 96, y1: 800, x2: 672, y2: 800 },
];

/** 右侧方向箭头路径 */
export const SORT_ARROW_PATHS: Record<SortOrder, string> = {
  // 升序：箭头向上
  asc: 'M832 800V288M672 448l160-160 160 160',
  // 降序：箭头向下
  desc: 'M832 224v512M672 576l160 160 160-160',
};

/** 下拉菜单选项顺序 */
export const SORT_OPTIONS: { key: SortOrder; i18nKey: string }[] = [
  { key: 'asc', i18nKey: 'sortAsc' },
  { key: 'desc', i18nKey: 'sortDesc' },
];
