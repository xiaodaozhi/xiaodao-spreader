// ============ 自动填充引擎（纯函数，无 Vue / Canvas 依赖）============
// 仅依赖同目录的 types / number-format / formula。所有函数不修改入参；
// applyAutoFillPlan 返回增量 { cells, merges }，不 mutate sheet。
// 参考 core/sort-core.ts、find-replace-core.ts 的纯函数风格。

import type { CellCoord, SelectionRange } from './types';
import { isNumericValue, parseDateTimeInput } from './number-format';
import { shiftFormulaRefs } from './formula';

// ============ 类型定义 ============
export type FillValue
  = | { kind: 'number'; num: number }
    | { kind: 'text'; text: string }
    | { kind: 'text-number'; prefix: string; num: number; digits: number } // digits = 数字部分原始位数（用于前导零）
    | { kind: 'date'; serial: number }
    | { kind: 'formula'; formula: string };

export type FillPattern
  = | { kind: 'copy'; sourceValues: FillValue[] }
    | { kind: 'linear'; step: number; base: number; sourceLen: number }
    | { kind: 'text-number'; prefix: string; step: number; base: number; digits: number; sourceLen: number }
    | { kind: 'date-linear'; step: number; baseSerial: number; sourceLen: number }
    | { kind: 'text-series'; step: number; baseCharCode: number; sourceLen: number }
    | { kind: 'formula' };

export interface AutofillSheetLike {
  cells: Record<string, { value: string; styleId?: number }>;
  styles: ReadonlyArray<unknown>; // 仅用于类型约束，plan 不直接读取
}

export interface FillResult {
  cells: Record<string, { value: string; styleId?: number }>;
  merges: Record<string, { startCol: number; startRow: number; endCol: number; endRow: number }>;
}

// FillValue 各分支类型（用于推断时 narrowing / 安全断言）
type NumberFV = Extract<FillValue, { kind: 'number' }>;
type TextFV = Extract<FillValue, { kind: 'text' }>;
type TextNumberFV = Extract<FillValue, { kind: 'text-number' }>;
type DateFV = Extract<FillValue, { kind: 'date' }>;

/** 局部 cellKey（格式 "col,row"），与 core-state 一致但不依赖 CoreState */
function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/**
 * 将单元格原始值解析为 FillValue。
 * 优先级：公式 → 日期 → 文本+数字 → 纯数字 → 纯文本。
 */
export function parseFillValue(value: string, locale: string): FillValue {
  // 1. 公式
  if (value.startsWith('=')) return { kind: 'formula', formula: value };

  // 2. 日期 / 时间
  const dt = parseDateTimeInput(value, locale);
  if (dt) return { kind: 'date', serial: dt.serial };

  // 3. 文本 + 数字（prefix 非空，数字部分纯数字；prefix 可含中文）
  const m = /^(.*?)(\d+)$/.exec(value);
  if (m) {
    const prefix = m[1]!;
    const numStr = m[2]!;
    if (prefix !== '' && /^\d+$/.test(numStr)) {
      return { kind: 'text-number', prefix, num: parseInt(numStr, 10), digits: numStr.length };
    }
  }

  // 4. 纯数字
  if (isNumericValue(value)) return { kind: 'number', num: parseFloat(value) };

  // 5. 纯文本
  return { kind: 'text', text: value };
}

/** 判断数值数组是否呈常量等差（首项差为 step） */
function isConstantDiff(arr: number[], step: number): boolean {
  for (let i = 2; i < arr.length; i++) {
    if (arr[i]! - arr[i - 1]! !== step) return false;
  }
  return true;
}

/**
 * 由源值序列推断填充模式。
 * - 任一公式 → formula
 * - 全为日期 → date-linear
 * - 全为纯数字：单值 copy；多值等差 linear；非等差 copy
 * - 全为文本+数字且 prefix 相同：单值 copy；多值等差 text-number；否则 copy
 * - 全为单字符 ASCII 字母且 charCode 等差 → text-series
 * - 其余 → copy
 */
export function inferFillPattern(sourceValues: FillValue[]): FillPattern {
  const n = sourceValues.length;
  if (n === 0) return { kind: 'copy', sourceValues: [] };

  // 任一公式 → 公式模式（具体平移由 applyAutoFillPlan 处理）
  if (sourceValues.some((v) => v.kind === 'formula')) return { kind: 'formula' };

  // 全为日期 → 日期等差
  if (sourceValues.every((v) => v.kind === 'date')) {
    const first = sourceValues[0] as DateFV;
    const step = n >= 2 ? (sourceValues[1] as DateFV).serial - first.serial : 1;
    return { kind: 'date-linear', baseSerial: first.serial, step, sourceLen: n };
  }

  // 全为纯数字
  if (sourceValues.every((v) => v.kind === 'number')) {
    if (n === 1) return { kind: 'copy', sourceValues: [...sourceValues] };
    const nums = sourceValues.map((v) => (v as NumberFV).num);
    const step = nums[1]! - nums[0]!;
    if (isConstantDiff(nums, step)) {
      return { kind: 'linear', step, base: nums[0]!, sourceLen: n };
    }
    return { kind: 'copy', sourceValues: [...sourceValues] };
  }

  // 全为文本+数字 且 prefix 相同
  if (sourceValues.every((v) => v.kind === 'text-number')) {
    const first = sourceValues[0] as TextNumberFV;
    const samePrefix = sourceValues.every(
      (v) => v.kind === 'text-number' && (v as TextNumberFV).prefix === first.prefix,
    );
    if (samePrefix) {
      if (n === 1) return { kind: 'copy', sourceValues: [...sourceValues] };
      const numArr = sourceValues.map((v) => (v as TextNumberFV).num);
      const step = numArr[1]! - numArr[0]!;
      if (isConstantDiff(numArr, step)) {
        return {
          kind: 'text-number',
          prefix: first.prefix,
          step,
          base: first.num,
          digits: first.digits,
          sourceLen: n,
        };
      }
    }
    return { kind: 'copy', sourceValues: [...sourceValues] };
  }

  // 全为单字符 ASCII 字母 且 charCode 等差 → 字母序列
  if (sourceValues.every((v) => v.kind === 'text')) {
    const allSingleLetter = sourceValues.every(
      (v) => (v as TextFV).text.length === 1 && /[a-zA-Z]/.test((v as TextFV).text),
    );
    if (n >= 2 && allSingleLetter) {
      const codes = sourceValues.map((v) => (v as TextFV).text.charCodeAt(0));
      const step = codes[1]! - codes[0]!;
      if (step !== 0 && isConstantDiff(codes, step)) {
        return { kind: 'text-series', step, baseCharCode: codes[0]!, sourceLen: n };
      }
    }
    return { kind: 'copy', sourceValues: [...sourceValues] };
  }

  // 其余 → 复制
  return { kind: 'copy', sourceValues: [...sourceValues] };
}

/**
 * 生成目标区域第 index 个（0-based，相对目标起点、靠近源的一端）的填充值（正向：下/右）。
 * 目标第 index 个的逻辑索引为 sourceLen + index。
 */
export function generateFillValue(pattern: FillPattern, index: number, sourceLen: number): FillValue {
  switch (pattern.kind) {
    case 'copy': {
      const len = pattern.sourceValues.length;
      if (len === 0) return { kind: 'text', text: '' };
      return pattern.sourceValues[index % len]!;
    }
    case 'linear':
      return { kind: 'number', num: pattern.base + pattern.step * (sourceLen + index) };
    case 'text-number':
      return {
        kind: 'text-number',
        prefix: pattern.prefix,
        num: pattern.base + pattern.step * (sourceLen + index),
        digits: pattern.digits,
      };
    case 'date-linear':
      return { kind: 'date', serial: pattern.baseSerial + pattern.step * (sourceLen + index) };
    case 'text-series':
      return {
        kind: 'text',
        text: String.fromCharCode(pattern.baseCharCode + pattern.step * (sourceLen + index)),
      };
    case 'formula':
      return { kind: 'formula', formula: '' };
  }
}

/**
 * 反向（上/左）填充值生成：index=0 为靠近源的一端，从源首项继续向后延伸。
 * 与 generateFillValue 关于源区间对称。
 */
function generateFillValueBackward(pattern: FillPattern, index: number): FillValue {
  switch (pattern.kind) {
    case 'copy': {
      const len = pattern.sourceValues.length;
      if (len === 0) return { kind: 'text', text: '' };
      return pattern.sourceValues[len - 1 - (index % len)]!;
    }
    case 'linear':
      return { kind: 'number', num: pattern.base - pattern.step * (index + 1) };
    case 'text-number':
      return {
        kind: 'text-number',
        prefix: pattern.prefix,
        num: pattern.base - pattern.step * (index + 1),
        digits: pattern.digits,
      };
    case 'date-linear':
      return { kind: 'date', serial: pattern.baseSerial - pattern.step * (index + 1) };
    case 'text-series':
      return {
        kind: 'text',
        text: String.fromCharCode(pattern.baseCharCode - pattern.step * (index + 1)),
      };
    case 'formula':
      return { kind: 'formula', formula: '' };
  }
}

/**
 * 将 FillValue 转为单元格数据（value + 透传源 styleId）。
 * 日期存序列号字符串，渲染时由 numberFormat 格式化。
 */
export function fillValueToCellData(
  fv: FillValue,
  sourceStyleId?: number,
): { value: string; styleId?: number } {
  switch (fv.kind) {
    case 'formula':
      return { value: fv.formula, styleId: sourceStyleId };
    case 'number':
      return { value: String(fv.num), styleId: sourceStyleId };
    case 'text':
      return { value: fv.text, styleId: sourceStyleId };
    case 'text-number':
      return { value: fv.prefix + String(fv.num).padStart(fv.digits, '0'), styleId: sourceStyleId };
    case 'date':
      return { value: String(fv.serial), styleId: sourceStyleId };
  }
}

/**
 * 根据源选区与拖拽目标格计算目标区域及方向。
 * 落在源内返回 null。
 */
export function computeTargetRange(
  sourceRange: SelectionRange,
  draggedCell: CellCoord,
): { targetRange: SelectionRange; direction: 'up' | 'down' | 'left' | 'right' } | null {
  const dRow = draggedCell.row < sourceRange.startRow
    ? sourceRange.startRow - draggedCell.row
    : (draggedCell.row > sourceRange.endRow ? draggedCell.row - sourceRange.endRow : 0);
  const dCol = draggedCell.col < sourceRange.startCol
    ? sourceRange.startCol - draggedCell.col
    : (draggedCell.col > sourceRange.endCol ? draggedCell.col - sourceRange.endCol : 0);
  if (dRow === 0 && dCol === 0) return null;

  const direction: 'up' | 'down' | 'left' | 'right' = dRow >= dCol
    ? (draggedCell.row < sourceRange.startRow ? 'up' : 'down')
    : (draggedCell.col < sourceRange.startCol ? 'left' : 'right');

  let targetRange: SelectionRange;
  switch (direction) {
    case 'down':
      targetRange = {
        startCol: sourceRange.startCol,
        startRow: sourceRange.endRow + 1,
        endCol: sourceRange.endCol,
        endRow: draggedCell.row,
      };
      break;
    case 'up':
      targetRange = {
        startCol: sourceRange.startCol,
        startRow: draggedCell.row,
        endCol: sourceRange.endCol,
        endRow: sourceRange.startRow - 1,
      };
      break;
    case 'right':
      targetRange = {
        startCol: sourceRange.endCol + 1,
        startRow: sourceRange.startRow,
        endCol: draggedCell.col,
        endRow: sourceRange.endRow,
      };
      break;
    case 'left':
      targetRange = {
        startCol: draggedCell.col,
        startRow: sourceRange.startRow,
        endCol: sourceRange.startCol - 1,
        endRow: sourceRange.endRow,
      };
      break;
  }
  return { targetRange, direction };
}

/**
 * 平移公式引用以适配目标单元格（$ 绝对引用由 shiftFormulaRefs 处理）。
 */
export function translateFormulaForTarget(
  sourceFormula: string,
  sourceCell: CellCoord,
  targetCell: CellCoord,
  colCount: number,
  rowCount: number,
  colToLabelFn: (col: number) => string,
): string {
  return shiftFormulaRefs(
    sourceFormula,
    targetCell.col - sourceCell.col,
    targetCell.row - sourceCell.row,
    colCount,
    rowCount,
    colToLabelFn,
  );
}

/** 两矩形是否相交 */
function intersects(a: SelectionRange, b: SelectionRange): boolean {
  return !(a.endCol < b.startCol || a.startCol > b.endCol || a.endRow < b.startRow || a.startRow > b.endRow);
}

/** outer 是否完全包含 inner */
function contains(outer: SelectionRange, inner: SelectionRange): boolean {
  return (
    inner.startCol >= outer.startCol
    && inner.endCol <= outer.endCol
    && inner.startRow >= outer.startRow
    && inner.endRow <= outer.endRow
  );
}

/** 合并兼容性校验结果：
 * - 'ok'：兼容；
 * - 'source-overlap'：源区域与某合并格部分相交（既非完全包含也非不相交）；
 * - 'target-merge-size'：目标区域命中的合并格跨距不一致（对齐 Excel「要执行此操作，所有合并单元格必须大小相同」）。
 */
export type MergeCompatibilityResult = {
  ok: boolean;
  reason: 'ok' | 'source-overlap' | 'target-merge-size';
};

/**
 * 校验源/目标区域与已有合并的兼容性：
 * - 源区域不能与任何 merge 部分相交（要么完全包含，要么不相交）；
 * - 目标区域与「未被源完全包含」的 merge 相交时，要求这些 merge 行/列跨距全部一致。
 */
export function validateMergeCompatibility(
  sourceRange: SelectionRange,
  targetRange: SelectionRange,
  merges: Record<string, SelectionRange>,
): MergeCompatibilityResult {
  const keys = Object.keys(merges);
  for (const key of keys) {
    const m = merges[key]!;
    if (intersects(sourceRange, m) && !contains(sourceRange, m)) {
      return { ok: false, reason: 'source-overlap' };
    }
  }
  const hit: SelectionRange[] = [];
  for (const key of keys) {
    const m = merges[key]!;
    // 目标区域与「源已完全包含」的合并格相交属于合法场景（如整块合并格被整体选中再向外填充），
    // 不对其判为不兼容，否则选中单个合并格时填充柄会被误判为灰色 / 不可拖拽。
    if (contains(sourceRange, m)) continue;
    if (intersects(targetRange, m)) hit.push(m);
  }
  if (hit.length === 0) return { ok: true, reason: 'ok' };
  const refH = hit[0]!.endRow - hit[0]!.startRow;
  const refW = hit[0]!.endCol - hit[0]!.startCol;
  for (const m of hit) {
    if (m.endRow - m.startRow !== refH || m.endCol - m.startCol !== refW) {
      return { ok: false, reason: 'target-merge-size' };
    }
  }
  return { ok: true, reason: 'ok' };
}

/** 选取目标单元应继承的源 styleId */
function pickSourceStyleId(
  pattern: FillPattern,
  sourceStyleIds: (number | undefined)[],
  index: number,
  reverse: boolean,
): number | undefined {
  const len = sourceStyleIds.length;
  if (len === 0) return undefined;
  if (pattern.kind === 'copy') {
    const pos = reverse ? len - 1 - (index % len) : index % len;
    return sourceStyleIds[pos];
  }
  // 线性 / 日期 / 文本数字 / 字母序列：正向取源末，反向取源首
  return reverse ? sourceStyleIds[0] : sourceStyleIds[len - 1];
}

/**
 * 自动填充核心：根据源/目标区域与方向生成填充增量（纯函数，不 mutate sheet）。
 * - down/right：正向延伸；up/left：反向延伸。
 * - 公式按源位置循环并平移引用；其余按模式生成。
 * - merges 暂返回空对象（merge 复制由后续任务决定）。
 */
export function applyAutoFillPlan(
  sourceRange: SelectionRange,
  targetRange: SelectionRange,
  sheet: { cells: Record<string, { value: string; styleId?: number }>; styles?: ReadonlyArray<unknown> },
  direction: 'up' | 'down' | 'left' | 'right',
  locale: string,
  colCount: number,
  rowCount: number,
  colToLabelFn: (col: number) => string,
): FillResult {
  const result: FillResult = { cells: {}, merges: {} };
  const vertical = direction === 'up' || direction === 'down';
  const reverse = direction === 'up' || direction === 'left';

  if (vertical) {
    const sourceHeight = sourceRange.endRow - sourceRange.startRow + 1;
    for (let c = sourceRange.startCol; c <= sourceRange.endCol; c++) {
      // 收集该列源值（自上而下）
      const sourceValues: FillValue[] = [];
      const sourceStyleIds: (number | undefined)[] = [];
      for (let r = sourceRange.startRow; r <= sourceRange.endRow; r++) {
        const cell = sheet.cells[cellKey(c, r)];
        sourceValues.push(cell ? parseFillValue(cell.value, locale) : { kind: 'text', text: '' });
        sourceStyleIds.push(cell?.styleId);
      }
      const pattern = inferFillPattern(sourceValues);
      const sourceLen = sourceValues.length;

      for (let tr = targetRange.startRow; tr <= targetRange.endRow; tr++) {
        // index 0 = 靠近源的一端
        const index = reverse ? targetRange.endRow - tr : tr - targetRange.startRow;

        if (pattern.kind === 'formula') {
          // 按源位置循环：down 从首行起，up 从末行起
          const sourceRow = reverse
            ? sourceRange.endRow - (((targetRange.endRow - tr) % sourceHeight) + sourceHeight) % sourceHeight
            : sourceRange.startRow + (((tr - sourceRange.startRow) % sourceHeight) + sourceHeight) % sourceHeight;
          const srcCell = sheet.cells[cellKey(c, sourceRow)];
          const srcValue = srcCell ? srcCell.value : '';
          const translated = translateFormulaForTarget(
            srcValue,
            { col: c, row: sourceRow },
            { col: c, row: tr },
            colCount,
            rowCount,
            colToLabelFn,
          );
          result.cells[cellKey(c, tr)] = fillValueToCellData(
            { kind: 'formula', formula: translated },
            srcCell?.styleId,
          );
        } else {
          const fv = reverse
            ? generateFillValueBackward(pattern, index)
            : generateFillValue(pattern, index, sourceLen);
          const srcStyleId = pickSourceStyleId(pattern, sourceStyleIds, index, reverse);
          result.cells[cellKey(c, tr)] = fillValueToCellData(fv, srcStyleId);
        }
      }
    }
  } else {
    const sourceWidth = sourceRange.endCol - sourceRange.startCol + 1;
    for (let r = sourceRange.startRow; r <= sourceRange.endRow; r++) {
      // 收集该行源值（自左而右）
      const sourceValues: FillValue[] = [];
      const sourceStyleIds: (number | undefined)[] = [];
      for (let cc = sourceRange.startCol; cc <= sourceRange.endCol; cc++) {
        const cell = sheet.cells[cellKey(cc, r)];
        sourceValues.push(cell ? parseFillValue(cell.value, locale) : { kind: 'text', text: '' });
        sourceStyleIds.push(cell?.styleId);
      }
      const pattern = inferFillPattern(sourceValues);
      const sourceLen = sourceValues.length;

      for (let tc = targetRange.startCol; tc <= targetRange.endCol; tc++) {
        const index = reverse ? targetRange.endCol - tc : tc - targetRange.startCol;

        if (pattern.kind === 'formula') {
          const sourceCol = reverse
            ? sourceRange.endCol - (((targetRange.endCol - tc) % sourceWidth) + sourceWidth) % sourceWidth
            : sourceRange.startCol + (((tc - sourceRange.startCol) % sourceWidth) + sourceWidth) % sourceWidth;
          const srcCell = sheet.cells[cellKey(sourceCol, r)];
          const srcValue = srcCell ? srcCell.value : '';
          const translated = translateFormulaForTarget(
            srcValue,
            { col: sourceCol, row: r },
            { col: tc, row: r },
            colCount,
            rowCount,
            colToLabelFn,
          );
          result.cells[cellKey(tc, r)] = fillValueToCellData(
            { kind: 'formula', formula: translated },
            srcCell?.styleId,
          );
        } else {
          const fv = reverse
            ? generateFillValueBackward(pattern, index)
            : generateFillValue(pattern, index, sourceLen);
          const srcStyleId = pickSourceStyleId(pattern, sourceStyleIds, index, reverse);
          result.cells[cellKey(tc, r)] = fillValueToCellData(fv, srcStyleId);
        }
      }
    }
  }

  return result;
}
