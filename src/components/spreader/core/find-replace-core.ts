// ============ 查找和替换：纯算法核心（零 Vue 依赖，可单测）============
import type { FindResult, FindScope, SelectionRange } from './types';

/** 转义正则特殊字符，用于大小写不敏感的全局替换 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断单元格原始值是否匹配查找条件。
 * - 始终基于单元格原始 value（string），不基于格式化文本。
 * - 默认不区分大小写、非完整匹配；可开启区分大小写 / 完整匹配。
 */
export function cellMatches(
  raw: string,
  find: string,
  matchCase: boolean,
  matchEntireCell: boolean,
): boolean {
  if (!find) return false;
  if (matchEntireCell) {
    return matchCase ? raw === find : raw.toLowerCase() === find.toLowerCase();
  }
  return matchCase
    ? raw.includes(find)
    : raw.toLowerCase().includes(find.toLowerCase());
}

/** 单次替换：仅替换第一个匹配项（保持单元格其余内容不变） */
export function replaceFirst(
  raw: string,
  find: string,
  replace: string,
  matchCase: boolean,
): string {
  if (!find) return raw;
  if (matchCase) {
    const idx = raw.indexOf(find);
    if (idx < 0) return raw;
    return raw.slice(0, idx) + replace + raw.slice(idx + find.length);
  }
  const idx = raw.toLowerCase().indexOf(find.toLowerCase());
  if (idx < 0) return raw;
  return raw.slice(0, idx) + replace + raw.slice(idx + find.length);
}

/** 全部替换：替换所有匹配项（大小写不敏感时替换函数避免 $ 被当作分组引用） */
export function replaceAllOccurrences(
  raw: string,
  find: string,
  replace: string,
  matchCase: boolean,
): string {
  if (!find) return raw;
  if (matchCase) {
    if (raw.indexOf(find) < 0) return raw;
    return raw.split(find).join(replace);
  }
  if (raw.toLowerCase().indexOf(find.toLowerCase()) < 0) return raw;
  return raw.replace(new RegExp(escapeRegExp(find), 'gi'), () => replace);
}

/**
 * 扫描某个 Sheet 的 cells，返回所有匹配坐标。
 * - range 给定时仅扫描该矩形范围（用于「当前选区」）。
 * - range 为空时扫描整张表（用于「当前工作表」/「整个工作簿」）。
 * cells 仅读取 value 字段；key 通过 cellKey(c,r) 构造以匹配 range 扫描。
 */
export function scanSheetCells(
  cells: Record<string, { value: string }>,
  sheetIndex: number,
  cellKey: (c: number, r: number) => string,
  find: string,
  matchCase: boolean,
  matchEntireCell: boolean,
  range?: SelectionRange,
): FindResult[] {
  const out: FindResult[] = [];
  if (range) {
    for (let r = range.startRow; r <= range.endRow; r++) {
      for (let c = range.startCol; c <= range.endCol; c++) {
        const cd = cells[cellKey(c, r)];
        if (cd && cellMatches(cd.value, find, matchCase, matchEntireCell)) {
          out.push({ sheetIndex, col: c, row: r });
        }
      }
    }
    return out;
  }
  for (const k in cells) {
    const cd = cells[k];
    if (!cd) continue;
    if (cellMatches(cd.value, find, matchCase, matchEntireCell)) {
      const parts = k.split(',');
      const c = Number(parts[0]);
      const r = Number(parts[1]);
      if (!Number.isNaN(c) && !Number.isNaN(r)) out.push({ sheetIndex, col: c, row: r });
    }
  }
  return out;
}

export type { FindScope, FindResult, SelectionRange };
