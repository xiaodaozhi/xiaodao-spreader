// ============ 公式引擎 ============

import type { CellData } from './types';
import { cellKey, labelToCol, parseCellRef as utilParseCellRef } from './utils';

/** 解析区域引用（如 "A1:B5" → {sc, sr, ec, er}） */
export function parseRangeRef(
  rangeRef: string,
  colCount: number,
  rowCount: number,
): { sc: number; sr: number; ec: number; er: number } | null {
  const parts = rangeRef.split(':');
  if (parts.length !== 2) return null;
  const s = utilParseCellRef(parts[0]!, colCount, rowCount);
  const e = utilParseCellRef(parts[1]!, colCount, rowCount);
  if (!s || !e) return null;
  return {
    sc: Math.min(s.col, e.col),
    sr: Math.min(s.row, e.row),
    ec: Math.max(s.col, e.col),
    er: Math.max(s.row, e.row),
  };
}

/** 获取单元格数值（用于公式参数求值），返回 0 表示空或非数值 */
export function getNumericValue(
  col: number,
  row: number,
  cells: Record<string, CellData>,
  colCount: number,
  rowCount: number,
): number {
  const cell = cells[cellKey(col, row)];
  if (!cell) return 0;
  const raw = cell.value;
  if (raw.startsWith('=')) return evalFormula(cellKey(col, row), cells, colCount, rowCount) ?? 0;
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

/** 公式求值缓存 */
const evalCache = new Map<string, number>();

export function clearEvalCache(): void {
  evalCache.clear();
}

export function getEvalCache(): Map<string, number> {
  return evalCache;
}

/** 对指定单元格公式求值，返回数值结果；若为普通值则尝试解析为数字 */
export function evalFormula(
  key: string,
  cells: Record<string, CellData>,
  colCount: number,
  rowCount: number,
): number | null {
  return _evalFormula(key, cells, colCount, rowCount, 0);
}

function _evalFormula(
  key: string,
  cells: Record<string, CellData>,
  colCount: number,
  rowCount: number,
  depth: number,
): number | null {
  if (depth > 20) return NaN;

  if (evalCache.has(key)) return NaN;
  evalCache.set(key, NaN);

  const cell = cells[key];
  if (!cell) return NaN;
  const raw = cell.value;
  if (!raw.startsWith('=')) {
    const n = parseFloat(raw);
    const v = isNaN(n) ? 0 : n;
    evalCache.set(key, v);
    return v;
  }
  const formula = raw.slice(1).trim();
  const upper = formula.toUpperCase();

  if (upper.startsWith('SUM(') && formula.endsWith(')')) {
    const inner = formula.slice(4, -1).trim();
    const range = parseRangeRef(inner, colCount, rowCount);
    if (range) {
      let sum = 0;
      for (let c = range.sc; c <= range.ec; c++) {
        for (let r = range.sr; r <= range.er; r++) {
          sum += getNumericValue(c, r, cells, colCount, rowCount);
        }
      }
      if (isNaN(sum)) return NaN;
      evalCache.set(key, sum);
      return sum;
    }
    return NaN;
  }

  return NaN;
}

/** 解析公式中引用的单元格列表（用于依赖追踪） */
export function parseFormulaRefs(formula: string, colCount: number, rowCount: number): string[] {
  const refs: string[] = [];
  const pattern = /(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(formula)) !== null) {
    const start = utilParseCellRef(m[1]!, colCount, rowCount);
    if (!start) continue;
    if (m[2]) {
      const end = utilParseCellRef(m[2]!, colCount, rowCount);
      if (!end) continue;
      for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c++) {
        for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++) {
          refs.push(cellKey(c, r));
        }
      }
    } else {
      refs.push(cellKey(start.col, start.row));
    }
  }
  return refs;
}

/** 计算单元格显示值（公式则求值，否则返回原值） */
export function computeCellValue(
  col: number,
  row: number,
  cells: Record<string, CellData>,
  colCount: number,
  rowCount: number,
): string {
  const cell = cells[cellKey(col, row)];
  if (!cell) return '';
  const raw = cell.value;
  if (!raw.startsWith('=')) return raw;
  const result = evalFormula(cellKey(col, row), cells, colCount, rowCount);
  return isNaN(result!) ? '#ERROR' : String(result);
}

/** 将公式中所有单元格引用偏移 dCol, dRow（支持 $ 绝对引用） */
export function shiftFormulaRefs(
  formula: string,
  dCol: number,
  dRow: number,
  colCount: number,
  rowCount: number,
  colToLabelFn: (col: number) => string,
): string {
  if (dCol === 0 && dRow === 0) return formula;
  return formula.replace(
    /(\$?)([A-Z]+)(\$?)(\d+)/gi,
    (_match, colAbs: string, colStr: string, rowAbs: string, rowStr: string) => {
      const col = colAbs ? labelToCol(colStr) : labelToCol(colStr) + dCol;
      const row = rowAbs ? parseInt(rowStr, 10) - 1 : parseInt(rowStr, 10) - 1 + dRow;
      let newColStr: string;
      if (col < 0) {
        newColStr = 'A';
      } else if (col >= colCount) {
        newColStr = colToLabelFn(colCount - 1);
      } else {
        newColStr = colToLabelFn(col);
      }
      let newRowStr: string;
      if (row < 0) {
        newRowStr = '1';
      } else if (row >= rowCount) {
        newRowStr = String(rowCount);
      } else {
        newRowStr = String(row + 1);
      }
      return (colAbs || '') + newColStr + (rowAbs || '') + newRowStr;
    },
  );
}

/**
 * 公式依赖追踪管理器
 * 正向：formulaKey → [depKey, ...]
 * 反向：depKey → Set<formulaKey>
 */
export class FormulaDeps {
  private deps = new Map<string, string[]>();
  private rev = new Map<string, Set<string>>();
  private dirty = new Set<string>();

  clear(key: string): void {
    const existing = this.deps.get(key);
    if (existing) {
      for (const dep of existing) {
        this.rev.get(dep)?.delete(key);
      }
      this.deps.delete(key);
    }
  }

  set(key: string, newDeps: string[]): void {
    this.clear(key);
    if (newDeps.length === 0) return;
    this.deps.set(key, newDeps);
    for (const dep of newDeps) {
      if (!this.rev.has(dep)) this.rev.set(dep, new Set());
      this.rev.get(dep)!.add(key);
    }
  }

  markDirty(key: string): void {
    const stack: string[] = [key];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const dependents = this.rev.get(cur);
      if (!dependents) continue;
      for (const fk of dependents) {
        if (this.dirty.has(fk)) continue;
        this.dirty.add(fk);
        stack.push(fk);
      }
    }
  }

  getDirtyAndClear(): Set<string> {
    const d = this.dirty;
    this.dirty = new Set();
    return d;
  }

  /** 从 cells 快照重建所有依赖关系 */
  rebuild(cells: Record<string, CellData>, colCount: number, rowCount: number): void {
    this.deps.clear();
    this.rev.clear();
    this.dirty.clear();
    evalCache.clear();
    for (const [k, v] of Object.entries(cells)) {
      if (v.value.startsWith('=')) {
        const refs = parseFormulaRefs(v.value.slice(1), colCount, rowCount);
        this.set(k, refs);
      }
    }
  }
}
