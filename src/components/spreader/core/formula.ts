// ============ 公式引擎 ============

import type { CellData } from './types';
import { cellKey, labelToCol, parseCellRef as utilParseCellRef } from './utils';

/**
 * 公式求值结果：
 * - number：SUM / AVERAGE / COUNT 等数值类公式
 * - string：IF / VLOOKUP 文本返回 / CONCATENATE 等文本类公式
 * - null：求值时出现错误（循环引用、参数非法、未找到等），渲染为 #ERROR
 */
export type FormulaValue = string | number | null;

/** 插入函数对话框可选的公式预设（与 dispatch 支持的函数保持一致） */
export const FORMULA_PRESETS: { name: string; snippet: string }[] = [
  { name: 'SUM', snippet: 'SUM(A1:A10)' },
  { name: 'AVERAGE', snippet: 'AVERAGE(A1:A10)' },
  { name: 'COUNT', snippet: 'COUNT(A1:A10)' },
  { name: 'IF', snippet: 'IF(A1>0, B1, C1)' },
  { name: 'VLOOKUP', snippet: 'VLOOKUP(A1, B1:C10, 2, FALSE)' },
  { name: 'CONCATENATE', snippet: 'CONCATENATE(A1, B1)' },
  { name: 'MAX', snippet: 'MAX(A1:A10)' },
  { name: 'MIN', snippet: 'MIN(A1:A10)' },
  { name: 'SIN', snippet: 'SIN(A1)' },
  { name: 'SUMIF', snippet: 'SUMIF(A1:A10, ">0", B1:B10)' },
  { name: 'PMT', snippet: 'PMT(0.05/12, 360, 100000)' },
  { name: 'STDEV', snippet: 'STDEV(A1:A10)' },
];

/** 公式结构校验结果：ok=结构合法可求值；name=顶层函数名（大写），无法识别结构时为 null */
export interface FormulaCheck {
  ok: boolean;
  name: string | null;
}

/** 各函数的顶层参数数量约束（与 dispatch 的实际要求一致） */
const FN_ARG_COUNTS: Record<string, { min: number; max: number }> = {
  SUM: { min: 1, max: 1 },
  AVERAGE: { min: 1, max: 1 },
  COUNT: { min: 1, max: 1 },
  IF: { min: 3, max: 3 },
  VLOOKUP: { min: 3, max: 4 },
  CONCATENATE: { min: 1, max: Infinity },
  MAX: { min: 1, max: 1 },
  MIN: { min: 1, max: 1 },
  SIN: { min: 1, max: 1 },
  SUMIF: { min: 2, max: 3 },
  PMT: { min: 3, max: 5 },
  STDEV: { min: 1, max: 1 },
};

/** 判断字符串中括号是否配平（跳过引号字符串内的括号） */
function parensBalanced(s: string): boolean {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (ch === inStr) {
        if (s[i + 1] === inStr) i++;
        else inStr = null;
      }
      continue;
    }
    if (ch === '"' || ch === '\'') {
      inStr = ch;
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * 校验公式文本结构：以 = 开头、=FUNC(args) 顶层结构、FUNC 受支持、
 * 括号配平、顶层参数数量合规且非空。用于插入函数对话框「插入」按钮的可用性判断。
 */
export function checkFormulaStructure(text: string): FormulaCheck {
  const s = text.trim();
  if (!s.startsWith('=')) return { ok: false, name: null };
  const fm = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/.exec(s.slice(1).trim());
  if (!fm) return { ok: false, name: null };
  const name = fm[1]!.toUpperCase();
  const spec = FN_ARG_COUNTS[name];
  if (!spec) return { ok: false, name };
  const inner = fm[2]!;
  if (!parensBalanced(inner)) return { ok: false, name };
  const args = splitTopLevelArgs(inner);
  const count = args.length === 1 && args[0]!.trim() === '' ? 0 : args.length;
  if (count < spec.min || count > spec.max) return { ok: false, name };
  if (args.some((a) => a.trim() === '')) return { ok: false, name };
  return { ok: true, name };
}

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

/** 将普通（非公式）单元格原始值转为标量：可解析为数字的返回 number，否则返回原字符串 */
function scalarOfPlain(raw: string): FormulaValue {
  const t = raw.trim();
  if (t === '') return '';
  const n = Number(t);
  if (!isNaN(n) && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    return n;
  }
  return raw;
}

/** 获取单元格标量值（用于公式参数求值）。公式单元格会递归求值，空单元格返回 '' */
export function getCellScalar(
  col: number,
  row: number,
  cells: Record<string, CellData>,
  colCount: number,
  rowCount: number,
): FormulaValue {
  const cell = cells[cellKey(col, row)];
  if (!cell) return '';
  const raw = cell.value;
  if (raw.startsWith('=')) return evalFormula(cellKey(col, row), cells, colCount, rowCount);
  return scalarOfPlain(raw);
}

/** 获取单元格数值（用于 SUM/AVERAGE/COUNT 等数值上下文），非数值按 0 处理 */
export function getNumericValue(
  col: number,
  row: number,
  cells: Record<string, CellData>,
  colCount: number,
  rowCount: number,
): number {
  const v = getCellScalar(col, row, cells, colCount, rowCount);
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

/** 公式求值结果缓存：key → 求值结果（含 null 错误结果） */
const evalCache = new Map<string, FormulaValue>();
/** 正在求值中的单元格集合，专门用于循环引用检测（避免与错误结果混淆） */
const inProgress = new Set<string>();

export function clearEvalCache(): void {
  evalCache.clear();
  inProgress.clear();
}

export function getEvalCache(): Map<string, FormulaValue> {
  return evalCache;
}

/** 对指定单元格公式求值，返回标量结果；普通值则解析为标量（数字或字符串） */
export function evalFormula(
  key: string,
  cells: Record<string, CellData>,
  colCount: number,
  rowCount: number,
): FormulaValue {
  return _evalFormula(key, cells, colCount, rowCount, 0);
}

function _evalFormula(
  key: string,
  cells: Record<string, CellData>,
  colCount: number,
  rowCount: number,
  depth: number,
): FormulaValue {
  if (depth > 20) return null;
  if (inProgress.has(key)) return null; // 循环引用
  if (evalCache.has(key)) return evalCache.get(key)!;

  inProgress.add(key);
  const cell = cells[key];
  let result: FormulaValue;
  if (!cell) {
    result = null;
  } else {
    const raw = cell.value;
    if (!raw.startsWith('=')) {
      result = scalarOfPlain(raw);
    } else {
      const formula = raw.slice(1).trim();
      const fm = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/.exec(formula);
      result = fm
        ? dispatch(fm[1]!.toUpperCase(), fm[2]!, cells, colCount, rowCount, depth + 1)
        : evalExpr(formula, cells, colCount, rowCount, depth + 1);
    }
  }
  inProgress.delete(key);
  evalCache.set(key, result);
  return result;
}

// ============ 表达式与参数解析 ============

/** 判断标量是否为「真」（数字非 0、非空字符串为真，空串/空为伪） */
function truthy(v: FormulaValue): boolean {
  if (v === null || v === '') return false;
  if (typeof v === 'number') return v !== 0;
  return true;
}

/** 两个标量按类型比较是否相等 */
function valuesEqual(a: FormulaValue, b: FormulaValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a ?? '') === String(b ?? '');
}

/** 按比较运算符比较两个标量 */
function compareValues(l: FormulaValue, r: FormulaValue, op: string): boolean {
  let cmp: number;
  if (typeof l === 'number' && typeof r === 'number') {
    cmp = l < r ? -1 : l > r ? 1 : 0;
  } else {
    const ls = String(l ?? '');
    const rs = String(r ?? '');
    cmp = ls < rs ? -1 : ls > rs ? 1 : 0;
  }
  switch (op) {
    case '=': return cmp === 0;
    case '<>': return cmp !== 0;
    case '<': return cmp < 0;
    case '>': return cmp > 0;
    case '<=': return cmp <= 0;
    case '>=': return cmp >= 0;
  }
  return false;
}

/** 将 SUMIF 的条件值字面量转为标量：带引号字符串去引号、可解析数字转 number、其余按字面字符串 */
function evalCriteriaScalar(
  s: string,
  _cells: Record<string, CellData>,
  _colCount: number,
  _rowCount: number,
): FormulaValue {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === '\'' && t[t.length - 1] === '\''))) {
    return t.slice(1, -1);
  }
  const n = Number(t);
  if (!isNaN(n) && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return n;
  // 未加引号的文本条件按字面字符串处理（如 apple）
  return t;
}

/**
 * 判断单元格标量是否符合 SUMIF 的条件表达式：
 * - 以 < <= > >= = <> 开头：按比较运算符（右侧经 evalCriteriaScalar 解析）判定
 * - 否则：按相等判定（右侧经 evalCriteriaScalar 解析）
 */
function matchCriteria(
  cellVal: FormulaValue,
  criteriaExpr: string,
  _cells: Record<string, CellData>,
  _colCount: number,
  _rowCount: number,
  _depth: number,
): boolean {
  const c = criteriaExpr.trim();
  // 先剥离可能的外层引号（如 ">1" / '>1' 整体被引号包裹，运算符也在其中）
  let inner = c;
  if (inner.length >= 2 && ((inner[0] === '"' && inner[inner.length - 1] === '"') || (inner[0] === '\'' && inner[inner.length - 1] === '\''))) {
    inner = inner.slice(1, -1);
  }
  const m = /^([<>=]+)([\s\S]*)$/.exec(inner);
  if (m) {
    const op = m[1]!;
    const rhs = evalCriteriaScalar(m[2]!, _cells, _colCount, _rowCount);
    return compareValues(cellVal, rhs, op);
  }
  const rhs = evalCriteriaScalar(inner, _cells, _colCount, _rowCount);
  return valuesEqual(cellVal, rhs);
}

/**
 * 求表达式的布尔值：
 * - 若含顶层比较运算符（< <= > >= = <>），按比较结果返回
 * - 否则按标量真值返回
 */
function evalCondition(
  expr: string,
  cells: Record<string, CellData>,
  colCount: number,
  rowCount: number,
  depth: number,
): boolean {
  const e = expr.trim();
  const cmpOps = ['<=', '>=', '<>'];
  let foundOp: string | null = null;
  let idx = -1;
  let inStr: string | null = null;
  let depthP = 0;
  for (let i = 0; i < e.length; i++) {
    const ch = e[i]!;
    if (inStr) {
      if (ch === inStr) {
        if (e[i + 1] === inStr) {
          i++;
        } else {
          inStr = null;
        }
      }
      continue;
    }
    if (ch === '"' || ch === '\'') {
      inStr = ch;
      continue;
    }
    if (ch === '(') {
      depthP++;
    }
    if (ch === ')') {
      depthP--;
    }
    if (depthP === 0 && (ch === '<' || ch === '>' || ch === '=')) {
      const two = e.slice(i, i + 2);
      const op = cmpOps.includes(two) ? two : ch;
      foundOp = op;
      idx = i;
      break;
    }
  }
  if (foundOp && idx >= 0) {
    const left = e.slice(0, idx).trim();
    const right = e.slice(idx + foundOp.length).trim();
    const lv = evalExpr(left, cells, colCount, rowCount, depth);
    const rv = evalExpr(right, cells, colCount, rowCount, depth);
    return compareValues(lv, rv, foundOp);
  }
  const v = evalExpr(e, cells, colCount, rowCount, depth);
  return truthy(v);
}

/** 将函数参数的内层字符串按顶层逗号拆分为各参数（忽略括号内与引号内的逗号） */
function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (inStr) {
      cur += ch;
      if (ch === inStr) {
        if (inner[i + 1] === inStr) {
          i++;
          cur += inStr;
        } else {
          inStr = null;
        }
      }
      continue;
    }
    if (ch === '"' || ch === '\'') {
      inStr = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') {
      depth++;
    }
    if (ch === ')') {
      depth--;
    }
    if (ch === ',' && depth === 0) {
      args.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  args.push(cur);
  return args;
}

/**
 * 求单个标量表达式的值：
 * - 字符串字面量（" 或 ' 包裹，支持双写转义）
 * - 函数调用（递归分发）
 * - 单元格引用（解析为标量）
 * - 数字字面量
 */
/**
 * 对单个标量表达式求值，支持：
 * - 字符串字面量（" 或 ' 包裹，双写转义）
 * - 数字字面量、TRUE/FALSE 布尔字面量
 * - 单元格引用（解析为标量）
 * - 四则运算（+ - * /，含括号与一元负号）
 * - 嵌套函数调用（递归分发）
 */
function evalExpr(
  expr: string,
  cells: Record<string, CellData>,
  colCount: number,
  rowCount: number,
  depth: number,
): FormulaValue {
  if (depth > 20) return null;
  const e = expr.trim();
  if (e === '') return null;
  const up = e.toUpperCase();
  if (up === 'TRUE') return 1;
  if (up === 'FALSE') return 0;

  const toks = tokenize(e);
  if (toks.length === 0) return null;
  let pos = 0;

  const parseAdd = (): FormulaValue => {
    let left = parseMul();
    while (pos < toks.length) {
      const t = toks[pos]!;
      if (t.type === 'op' && (t.val === '+' || t.val === '-')) {
        pos++;
        left = applyArith(left, parseMul(), t.val);
      } else break;
    }
    return left;
  };
  const parseMul = (): FormulaValue => {
    let left = parseUnary();
    while (pos < toks.length) {
      const t = toks[pos]!;
      if (t.type === 'op' && (t.val === '*' || t.val === '/')) {
        pos++;
        left = applyArith(left, parseUnary(), t.val);
      } else break;
    }
    return left;
  };
  const parseUnary = (): FormulaValue => {
    const t = toks[pos];
    if (t && t.type === 'op' && t.val === '-') {
      pos++;
      return applyArith(0, parseUnary(), '-');
    }
    if (t && t.type === 'op' && t.val === '+') {
      pos++;
      return parseUnary();
    }
    return parsePrimary();
  };
  const parsePrimary = (): FormulaValue => {
    const t = toks[pos];
    if (!t) return null;
    if (t.type === 'num') {
      pos++;
      return Number(t.val);
    }
    if (t.type === 'str') {
      pos++;
      return t.val;
    }
    if (t.type === 'lp') {
      pos++;
      const v = parseAdd();
      if (toks[pos] && toks[pos]!.type === 'rp') {
        pos++;
      }
      return v;
    }
    if (t.type === 'ref') {
      pos++;
      const ref = utilParseCellRef(t.val, colCount, rowCount);
      if (!ref) return null;
      return getCellScalar(ref.col, ref.row, cells, colCount, rowCount);
    }
    if (t.type === 'func') {
      const name = t.val.toUpperCase();
      pos++;
      if (toks[pos] && toks[pos]!.type === 'lp') {
        const lpTok = toks[pos]!;
        let d = 0;
        let rpTok: Tok | null = null;
        let k = pos;
        for (; k < toks.length; k++) {
          if (toks[k]!.type === 'lp') {
            d++;
          } else if (toks[k]!.type === 'rp') {
            d--;
            if (d === 0) {
              rpTok = toks[k]!;
              break;
            }
          }
        }
        if (rpTok) {
          const inner = e.slice(lpTok.start + 1, rpTok.start);
          pos = k + 1;
          return dispatch(name, inner, cells, colCount, rowCount, depth + 1);
        }
      }
      return null;
    }
    pos++; // 跳过未知 token，避免死循环
    return null;
  };

  return parseAdd();
}

interface Tok {
  type: 'num' | 'str' | 'ref' | 'func' | 'op' | 'lp' | 'rp' | 'comma';
  val: string;
  start: number;
}

/** 将表达式拆分为令牌（忽略空白，跳过冒号等未知符号） */
function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === '\'') {
      const q = ch;
      const start = i;
      i++;
      let str = '';
      while (i < s.length) {
        if (s[i] === q) {
          if (s[i + 1] === q) {
            str += q;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        str += s[i];
        i++;
      }
      toks.push({ type: 'str', val: str, start });
      continue;
    }
    if (/[0-9]/.test(ch) || ch === '.') {
      const start = i;
      let num = '';
      if (ch === '.') {
        num += '.';
        i++;
      }
      while (i < s.length && /[0-9]/.test(s[i]!)) {
        num += s[i];
        i++;
      }
      if (s[i] === '.') {
        num += '.';
        i++;
        while (i < s.length && /[0-9]/.test(s[i]!)) {
          num += s[i];
          i++;
        }
      }
      if (s[i] === 'e' || s[i] === 'E') {
        num += s[i];
        i++;
        if (s[i] === '+' || s[i] === '-') {
          num += s[i];
          i++;
        }
        while (i < s.length && /[0-9]/.test(s[i]!)) {
          num += s[i];
          i++;
        }
      }
      toks.push({ type: 'num', val: num, start });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      let name = '';
      while (i < s.length && /[A-Za-z0-9_]/.test(s[i]!)) {
        name += s[i];
        i++;
      }
      if (s[i] === '(') {
        toks.push({ type: 'func', val: name, start });
      } else {
        toks.push({ type: 'ref', val: name, start });
      }
      continue;
    }
    if (ch === '(') {
      toks.push({ type: 'lp', val: ch, start: i });
      i++;
      continue;
    }
    if (ch === ')') {
      toks.push({ type: 'rp', val: ch, start: i });
      i++;
      continue;
    }
    if (ch === ',') {
      toks.push({ type: 'comma', val: ch, start: i });
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      toks.push({ type: 'op', val: ch, start: i });
      i++;
      continue;
    }
    i++; // 跳过未知符号（如区域引用的 ":"）
  }
  return toks;
}

/** 执行四则运算；任一操作数非数字则视为错误（返回 null） */
function applyArith(l: FormulaValue, r: FormulaValue, op: string): FormulaValue {
  if (typeof l !== 'number' || typeof r !== 'number') return null;
  switch (op) {
    case '+': return l + r;
    case '-': return l - r;
    case '*': return l * r;
    case '/': return r === 0 ? null : l / r;
  }
  return null;
}

// ============ 各函数实现 ============

/** 分发具体函数求值 */
function dispatch(
  name: string,
  inner: string,
  cells: Record<string, CellData>,
  colCount: number,
  rowCount: number,
  depth: number,
): FormulaValue {
  switch (name) {
    case 'SUM':
    case 'AVERAGE':
    case 'COUNT': {
      const range = parseRangeRef(inner.trim(), colCount, rowCount);
      if (!range) return null;
      if (name === 'COUNT') {
        let count = 0;
        for (let c = range.sc; c <= range.ec; c++) {
          for (let r = range.sr; r <= range.er; r++) {
            if (typeof getCellScalar(c, r, cells, colCount, rowCount) === 'number') count++;
          }
        }
        return count;
      }
      let sum = 0;
      for (let c = range.sc; c <= range.ec; c++) {
        for (let r = range.sr; r <= range.er; r++) {
          sum += getNumericValue(c, r, cells, colCount, rowCount);
        }
      }
      if (isNaN(sum)) return null;
      if (name === 'AVERAGE') {
        const cnt = (range.ec - range.sc + 1) * (range.er - range.sr + 1);
        if (cnt === 0) return null;
        return sum / cnt;
      }
      return sum;
    }

    case 'IF': {
      const args = splitTopLevelArgs(inner);
      if (args.length < 3) return null;
      const cond = evalCondition(args[0]!, cells, colCount, rowCount, depth);
      return cond
        ? evalExpr(args[1]!, cells, colCount, rowCount, depth)
        : evalExpr(args[2]!, cells, colCount, rowCount, depth);
    }

    case 'VLOOKUP': {
      const args = splitTopLevelArgs(inner);
      if (args.length < 3) return null;
      const lookup = evalExpr(args[0]!, cells, colCount, rowCount, depth);
      const range = parseRangeRef(args[1]!.trim(), colCount, rowCount);
      if (!range) return null;
      const colIdxRaw = evalExpr(args[2]!, cells, colCount, rowCount, depth);
      const colIdx = typeof colIdxRaw === 'number'
        ? colIdxRaw
        : parseFloat(String(colIdxRaw));
      if (isNaN(colIdx)) return null;
      const targetCol = range.sc + (colIdx - 1);
      if (targetCol < range.sc || targetCol > range.ec) return null;
      const approx = args.length >= 4
        ? truthy(evalExpr(args[3]!, cells, colCount, rowCount, depth))
        : false;
      if (approx) {
        // 近似匹配：首列升序，取 ≤ lookup 的最大项（仅对数值首列有意义）
        let bestRow = -1;
        let bestVal = -Infinity;
        for (let r = range.sr; r <= range.er; r++) {
          const cv = getCellScalar(range.sc, r, cells, colCount, rowCount);
          if (typeof cv === 'number' && typeof lookup === 'number' && cv <= lookup && cv > bestVal) {
            bestVal = cv;
            bestRow = r;
          }
        }
        if (bestRow >= 0) return getCellScalar(targetCol, bestRow, cells, colCount, rowCount);
        return null;
      }
      // 精确匹配
      for (let r = range.sr; r <= range.er; r++) {
        const cv = getCellScalar(range.sc, r, cells, colCount, rowCount);
        if (valuesEqual(cv, lookup)) {
          return getCellScalar(targetCol, r, cells, colCount, rowCount);
        }
      }
      return null;
    }

    case 'CONCATENATE': {
      const args = splitTopLevelArgs(inner);
      let out = '';
      for (const a of args) {
        const v = evalExpr(a, cells, colCount, rowCount, depth);
        out += v === null ? '' : (typeof v === 'number' ? String(v) : v);
      }
      return out;
    }

    case 'MAX':
    case 'MIN': {
      const range = parseRangeRef(inner.trim(), colCount, rowCount);
      if (!range) return null;
      const nums: number[] = [];
      for (let c = range.sc; c <= range.ec; c++) {
        for (let r = range.sr; r <= range.er; r++) {
          const v = getCellScalar(c, r, cells, colCount, rowCount);
          if (typeof v === 'number') nums.push(v);
        }
      }
      if (nums.length === 0) return null;
      return name === 'MAX' ? Math.max(...nums) : Math.min(...nums);
    }

    case 'STDEV': {
      const range = parseRangeRef(inner.trim(), colCount, rowCount);
      if (!range) return null;
      const nums: number[] = [];
      for (let c = range.sc; c <= range.ec; c++) {
        for (let r = range.sr; r <= range.er; r++) {
          const v = getCellScalar(c, r, cells, colCount, rowCount);
          if (typeof v === 'number') nums.push(v);
        }
      }
      const n = nums.length;
      if (n < 2) return null;
      const mean = nums.reduce((a, b) => a + b, 0) / n;
      const variance = nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
      return Math.sqrt(variance);
    }

    case 'SIN': {
      const args = splitTopLevelArgs(inner);
      if (args.length !== 1) return null;
      const v = evalExpr(args[0]!, cells, colCount, rowCount, depth);
      if (typeof v !== 'number') return null;
      return Math.sin(v);
    }

    case 'SUMIF': {
      const args = splitTopLevelArgs(inner);
      if (args.length < 2 || args.length > 3) return null;
      const range = parseRangeRef(args[0]!.trim(), colCount, rowCount);
      if (!range) return null;
      const sumRange = args.length === 3
        ? parseRangeRef(args[2]!.trim(), colCount, rowCount)
        : range;
      if (!sumRange) return null;
      let sum = 0;
      for (let r = range.sr; r <= range.er; r++) {
        for (let c = range.sc; c <= range.ec; c++) {
          const cellVal = getCellScalar(c, r, cells, colCount, rowCount);
          if (matchCriteria(cellVal, args[1]!, cells, colCount, rowCount, depth)) {
            sum += getNumericValue(
              sumRange.sc + (c - range.sc),
              sumRange.sr + (r - range.sr),
              cells, colCount, rowCount,
            );
          }
        }
      }
      return sum;
    }

    case 'PMT': {
      const args = splitTopLevelArgs(inner);
      if (args.length < 3 || args.length > 5) return null;
      const rate = evalExpr(args[0]!, cells, colCount, rowCount, depth);
      const nper = evalExpr(args[1]!, cells, colCount, rowCount, depth);
      const pv = evalExpr(args[2]!, cells, colCount, rowCount, depth);
      if (typeof rate !== 'number' || typeof nper !== 'number' || typeof pv !== 'number') return null;
      const fvRaw = args.length >= 4 ? evalExpr(args[3]!, cells, colCount, rowCount, depth) : 0;
      const fv = typeof fvRaw === 'number' ? fvRaw : 0;
      const typeRaw = args.length >= 5 ? evalExpr(args[4]!, cells, colCount, rowCount, depth) : 0;
      const type = truthy(typeRaw) ? 1 : 0;
      if (rate === 0) {
        if (nper === 0) return null;
        return -(pv + fv) / nper;
      }
      const pow = Math.pow(1 + rate, nper);
      return -(fv + pv * pow) * rate / ((1 + rate * type) * (pow - 1));
    }

    default:
      return null;
  }
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
  return result === null ? '#ERROR' : String(result);
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
