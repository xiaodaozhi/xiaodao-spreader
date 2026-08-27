// ============ 数据筛选引擎（纯函数，无 Vue 依赖） ============
// - 复用 number-format 的 isNumericValue / parseDateTimeInput / formatNumber，保持与输入/显示语义一致。
// - 过滤只隐藏不符合条件的行，绝不修改原始 cell 数据、公式引用或数据顺序。
// - 多列筛选为 AND 关系：一行必须同时满足所有列的筛选条件才可见。
// - 候选值列表基于「其它已筛选列过滤后的可见行」生成，形成级联（cascading）下拉。

import type { SheetFilter, FilterColumn, FilterCondition, FilterColumnType } from './types';
import { isNumericValue, parseDateTimeInput, formatNumber } from './number-format';

/** 空白哨兵：值列表中用此字符串表示「空白」项（原始空值无法作为 map key 区分） */
export const FILTER_BLANK = '__filter_blank__';

/** 单元格读取抽象：供引擎从任意数据源（core-state / 测试）取值与格式 */
export interface FilterCellAccessor {
  /** 返回单元格原始值（string）；公式结果请在此展开 */
  getValue: (col: number, row: number) => string;
  /** 返回单元格数字格式（用于展示与类型判定） */
  getFormat: (col: number, row: number) => string | undefined | null;
}

/** 取单元格展示文本（与渲染一致）。空值回退原始串避免丢失信息。 */
export function getDisplayValue(value: string, format: string | undefined | null, locale: string): string {
  const v = formatNumber(value, format, locale);
  return v;
}

/** 解析单元格为可比的数值（数字列 / 日期列）；不可解析返回 null */
function getNumericValue(value: string, format: string | undefined | null, locale: string, type: FilterColumnType): number | null {
  if (isNumericValue(value)) return Number(value);
  if (type === 'date') {
    const dt = parseDateTimeInput(value, locale);
    if (dt) return dt.serial;
  }
  return null;
}

/** 解析条件比较值为数值（数字列 / 日期列）；不可解析返回 null */
function getConditionNumber(condValue: string | undefined, type: FilterColumnType, locale: string): number | null {
  if (condValue == null) return null;
  if (isNumericValue(condValue)) return Number(condValue);
  if (type === 'date') {
    const dt = parseDateTimeInput(condValue, locale);
    if (dt) return dt.serial;
  }
  return null;
}

/** 按条件算子判定单元格是否满足（文本匹配大小写不敏感，对齐 Excel） */
function matchCondition(
  cond: FilterCondition,
  value: string,
  format: string | undefined | null,
  locale: string,
  type: FilterColumnType,
): boolean {
  const disp = formatNumber(value, format, locale);
  switch (cond.operator) {
    case 'blank':
      return value.trim() === '';
    case 'notBlank':
      return value.trim() !== '';
    case 'equals':
    case 'notEquals': {
      const eq = cond.operator === 'equals';
      if (type === 'number' || type === 'date') {
        const cv = getNumericValue(value, format, locale, type);
        const tv = getConditionNumber(cond.value, type, locale);
        if (cv == null || tv == null) return false;
        return eq ? cv === tv : cv !== tv;
      }
      const cmp = disp.toLowerCase() === (cond.value ?? '').toLowerCase();
      return eq ? cmp : !cmp;
    }
    case 'contains':
      return disp.toLowerCase().includes((cond.value ?? '').toLowerCase());
    case 'notContains':
      return !disp.toLowerCase().includes((cond.value ?? '').toLowerCase());
    case 'startsWith':
      return disp.toLowerCase().startsWith((cond.value ?? '').toLowerCase());
    case 'endsWith':
      return disp.toLowerCase().endsWith((cond.value ?? '').toLowerCase());
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const cv = getNumericValue(value, format, locale, type);
      const tv = getConditionNumber(cond.value, type, locale);
      if (cv == null || tv == null) return false;
      if (cond.operator === 'gt') return cv > tv;
      if (cond.operator === 'gte') return cv >= tv;
      if (cond.operator === 'lt') return cv < tv;
      return cv <= tv;
    }
    case 'between': {
      const cv = getNumericValue(value, format, locale, type);
      const t1 = getConditionNumber(cond.value, type, locale);
      const t2 = getConditionNumber(cond.value2, type, locale);
      if (cv == null || t1 == null || t2 == null) return false;
      const lo = Math.min(t1, t2);
      const hi = Math.max(t1, t2);
      return cv >= lo && cv <= hi;
    }
  }
  return true;
}

/** 按单列筛选定义判定单元格是否满足（值列表 / 条件） */
export function matchColumn(
  col: FilterColumn,
  value: string,
  format: string | undefined | null,
  locale: string,
): boolean {
  if (col.type === 'values') {
    const vals = col.values ?? [];
    if (vals.length === 0) return true; // 未选任何值时视为不过滤
    if (value.trim() === '') return vals.includes(FILTER_BLANK);
    const disp = formatNumber(value, format, locale);
    return vals.includes(value) || vals.includes(disp);
  }
  if (!col.condition) return true;
  return matchCondition(col.condition, value, format, locale, col.type);
}

/** 某行是否满足整张筛选（多列 AND） */
export function isRowVisible(
  filter: SheetFilter | null,
  row: number,
  acc: FilterCellAccessor,
  locale: string,
): boolean {
  if (!filter) return true;
  const { columns, range } = filter;
  for (const colKey in columns) {
    const c = Number(colKey);
    if (c < range.startCol || c > range.endCol) continue;
    const fc = columns[colKey]!;
    const value = acc.getValue(c, row);
    const format = acc.getFormat(c, row);
    if (!matchColumn(fc, value, format, locale)) return false;
  }
  return true;
}

export interface FilterCandidates {
  /** 候选值（展示字符串，已去重、稳定排序） */
  values: string[];
  /** 该列是否存在空白单元格 */
  hasBlank: boolean;
}

/**
 * 获取某列的候选值列表（级联：仅统计「其它列已筛选」后可见的行）。
 * 排序：若全部可解析为数字则按数值升序；否则按 locale 文本（numeric）升序。
 */
export function getColumnCandidates(
  filter: SheetFilter,
  col: number,
  acc: FilterCellAccessor,
  locale: string,
): FilterCandidates {
  const seen = new Set<string>();
  const list: string[] = [];
  let hasBlank = false;
  const { range, columns } = filter;
  for (let r = range.startRow + 1; r <= range.endRow; r++) {
    // 先用其它列过滤，形成级联下拉
    let visibleByOthers = true;
    for (const key in columns) {
      const c = Number(key);
      if (c === col) continue;
      const fc = columns[key]!;
      if (!matchColumn(fc, acc.getValue(c, r), acc.getFormat(c, r), locale)) {
        visibleByOthers = false;
        break;
      }
    }
    if (!visibleByOthers) continue;
    const raw = acc.getValue(col, r);
    const disp = formatNumber(raw, acc.getFormat(col, r), locale);
    if (raw.trim() === '') {
      hasBlank = true;
      continue;
    }
    if (!seen.has(disp)) {
      seen.add(disp);
      list.push(disp);
    }
  }
  const allNumeric = list.length > 0 && list.every((v) => isNumericValue(v));
  if (allNumeric) {
    list.sort((a, b) => Number(a) - Number(b));
  } else {
    list.sort((a, b) => a.localeCompare(b, locale, { numeric: true }));
  }
  return { values: list, hasBlank };
}

/** 判断是否处于「该列已设置筛选」状态（用于图标高亮） */
export function isColumnFiltered(col: FilterColumn | undefined): boolean {
  if (!col) return false;
  if (col.type === 'values') return (col.values?.length ?? 0) > 0;
  return !!col.condition;
}
