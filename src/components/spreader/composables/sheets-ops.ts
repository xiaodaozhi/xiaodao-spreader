import { ref, reactive, computed, watch, nextTick, type Ref, type ComputedRef } from 'vue';
import { DEFAULT_COL_WIDTH, lightTheme, darkTheme } from '../core/constants';
import type { ThemeColors, SheetState, SheetModelData, CellData, SelectionRange } from '../core/types';
import { resolveSize } from '../core/utils';
import { buildOuterStyle } from '../core/theme';
import { clearEvalCache } from '../core/formula';
import { parseSortKeyByDisplay, buildSortedRowOrder, looksLikeHeader, type SortOrder, type SortKey } from '../core/sort-core';
import type { CoreState } from './core-state';
import type { UndoStylesState } from './undo-styles';

export interface SheetsOpsState {
  // 行列增删
  deleteRows: (rS: number, rE: number) => void;
  insertRows: (rS: number, rE: number) => void;
  insertCols: (cS: number, cE: number) => void;
  deleteCols: (cS: number, cE: number) => void;

  // 列排序（以整行为移动单位，依据选中列范围的第一列）
  sortSelectedColumns: (order: SortOrder, range?: SelectionRange) => void;
  canSortColumns: (sC: number, eC: number) => boolean;

  // 工具栏排序下拉框（分体式，与边框下拉框交互一致）
  sortMenuOpen: Ref<boolean>;
  /** 上一次使用的排序方向：功能按钮默认升序，从下拉选择后记忆该项 */
  cachedSortOrder: Ref<SortOrder>;
  onSortMenuToggle: (v: boolean) => void;
  onSortChange: (order: SortOrder) => void;
  applyCachedSort: () => void;

  // 排序提醒弹窗（扩展选区 / 以当前选区排序）
  sortConfirmOpen: Ref<boolean>;
  prepareSortConfirmation: (order: SortOrder) => boolean;
  confirmSort: (expand: boolean) => void;
  cancelSortConfirmation: () => void;

  // 多 Sheet 管理
  sheets: Ref<SheetState[]>;
  activeSheetIndex: Ref<number>;
  saveSheet: () => void;
  loadSheet: (i: number) => void;
  switchSheet: (i: number) => void;
  addSheet: (n?: string) => number;
  removeSheet: (i: number) => number;
  renameSheet: (i: number, n: string) => void;
  dupSheet: (i: number) => number;
  moveSheet: (i: number, d: number) => void;
  sheetCount: ComputedRef<number>;
  mkSheet: (name: string, dims?: { colCount?: number; rowCount?: number }) => SheetState;

  // v-model emit
  emitModelData: () => void;
  scheduleOptEmit: () => void;

  // 主题 & CSS
  themeColors: ComputedRef<ThemeColors>;
  outerStyle: ComputedRef<Record<string, string>>;
  toolbarThemeVars: ComputedRef<Record<string, string>>;

  // 模板 refs & 滚动控制
  wrapperRef: Ref<HTMLDivElement | null>;
  canvasRef: Ref<HTMLCanvasElement | null>;
  editInputRef: Ref<HTMLTextAreaElement | null>;
  formulaBarRef: Ref<HTMLTextAreaElement | null>;
  viewSize: { w: number; h: number };
  maxScrollX: ComputedRef<number>;
  maxScrollY: ComputedRef<number>;
  clampScroll: (sx: number | null, sy: number | null) => void;
  canFocusHiddenEditor: () => boolean;
  focusEditInput: (selectAllText?: boolean) => void;
  onCanvasFocus: () => void;

  // 行高/列宽重置
  resetRowHeight: () => void;
  resetColWidth: () => void;

  // 外部 modelData
  modelData: Ref<SheetModelData[]>;
}

export function createSheetsOps(
  s: CoreState,
  us: UndoStylesState,
  rawModelData: Ref<SheetModelData[]>,
  _applySizeCallback?: () => void,
  lastEmittedDataRef?: { value: string },
): SheetsOpsState {
  // ============ 行/列插入/删除 ============
  function deleteRows(rS: number, rE: number) {
    const dr = rE - rS + 1;
    // 先对 merges 做调整规划（此时旧 anchor cell 的 value/style 还在未被删，可用于迁移）
    const rebuiltMerges = adjustMergesForDeleteRows(rS, rE);
    for (let r = rS; r <= rE; r++) {
      for (let c = 0; c < s.colCount; c++) s.delCell(s.cellKey(c, r));
    }
    for (let r = rS; r < s.rowCount - dr; r++) {
      for (let c = 0; c < s.colCount; c++) {
        const sk = s.cellKey(c, r + dr), dk = s.cellKey(c, r);
        if (s.cells[sk]) {
          s.cells[dk] = s.cells[sk]!;
          s.delCell(sk);
        } else {
          s.delCell(dk);
        }
      }
      s.rowHeights.value[r] = s.rowHeights.value[r + dr];
    }
    for (let r = s.rowCount - dr; r < s.rowCount; r++) {
      for (let c = 0; c < s.colCount; c++) s.delCell(s.cellKey(c, r));
      s.rowHeights.value[r] = undefined;
    }
    // 写入新的 merges 并迁移 anchor cell 数据（此时新坐标对应的 cells 已经就位）
    applyAdjustedMerges(rebuiltMerges);
  }

  function insertRows(rS: number, rE: number) {
    const n = rE - rS + 1;
    const currentRowCount = s.rowCount;
    const origColCount = s.colCount;
    const { lastRow } = findLastDataExtents();
    if (lastRow >= rS && lastRow + n >= currentRowCount) {
      s.ensureCapacity(origColCount - 1, currentRowCount - 1 + n);
    }
    const origRowCount = s.rowCount; // 扩展后的实际行数
    const rebuiltMerges = adjustMergesForInsertRows(rS, rE);
    // 移动所有行（包括扩展的行），从最后一行开始，向下移动
    for (let r = origRowCount - 1; r > rE; r--) {
      for (let c = 0; c < origColCount; c++) {
        const sk = s.cellKey(c, r - n), dk = s.cellKey(c, r);
        if (s.cells[sk]) s.cells[dk] = s.cells[sk]!;
        else s.delCell(dk);
      }
      s.rowHeights.value[r] = s.rowHeights.value[r - n];
    }
    // 清空插入位置的新行（rS 到 rE 变成了新的空行）
    for (let r = rS; r <= rE; r++) {
      for (let c = 0; c < s.colCount; c++) s.delCell(s.cellKey(c, r));
      s.rowHeights.value[r] = undefined;
    }
    applyAdjustedMerges(rebuiltMerges);
  }

  function insertCols(cS: number, cE: number) {
    const n = cE - cS + 1;
    const currentColCount = s.colCount;
    const origRowCount = s.rowCount;
    const { lastCol } = findLastDataExtents();
    if (lastCol >= cS && lastCol + n >= currentColCount) {
      s.ensureCapacity(currentColCount - 1 + n, origRowCount - 1);
    }
    const origColCount = s.colCount; // 扩展后的实际列数
    const origRowCount2 = s.rowCount; // 扩展后的实际行数
    const rebuiltMerges = adjustMergesForInsertCols(cS, cE);
    // 移动所有列（包括扩展的列），从最后一列开始，向右移动
    for (let c = origColCount - 1; c > cE; c--) {
      for (let r = 0; r < origRowCount2; r++) {
        const sk = s.cellKey(c - n, r), dk = s.cellKey(c, r);
        if (s.cells[sk]) s.cells[dk] = s.cells[sk]!;
        else s.delCell(dk);
      }
      s.colWidths.value[c] = s.colWidths.value[c - n]!;
    }
    // 清空插入位置的新列（cS 到 cE 变成了新的空列）
    for (let c = cS; c <= cE; c++) {
      for (let r = 0; r < s.rowCount; r++) s.delCell(s.cellKey(c, r));
      s.colWidths.value[c] = DEFAULT_COL_WIDTH;
    }
    applyAdjustedMerges(rebuiltMerges);
  }

  // 同时找到最后一个有数据的行和列
  function findLastDataExtents(): { lastCol: number; lastRow: number } {
    let lastCol = -1, lastRow = -1;
    for (const key in s.cells) {
      const parts = key.split(',');
      if (parts.length === 2) {
        const c = parseInt(parts[0]!, 10);
        const r = parseInt(parts[1]!, 10);
        const cell = s.cells[key];
        if (cell && (cell.value !== '' || cell.styleId !== undefined)) {
          if (c > lastCol) lastCol = c;
          if (r > lastRow) lastRow = r;
        }
      }
    }
    for (let c = s.colCount - 1; c >= 0; c--) {
      const w = s.colWidths.value[c];
      if (w !== undefined && w !== DEFAULT_COL_WIDTH) {
        if (c > lastCol) lastCol = c;
        break;
      }
    }
    for (let r = s.rowCount - 1; r >= 0; r--) {
      if (s.rowHeights.value[r] !== undefined) {
        if (r > lastRow) lastRow = r;
        break;
      }
    }
    return { lastCol, lastRow };
  }

  function deleteCols(cS: number, cE: number) {
    const dc = cE - cS + 1;
    const rebuiltMerges = adjustMergesForDeleteCols(cS, cE);
    for (let c = cS; c <= cE; c++) {
      for (let r = 0; r < s.rowCount; r++) s.delCell(s.cellKey(c, r));
    }
    for (let c = cS; c < s.colCount - dc; c++) {
      for (let r = 0; r < s.rowCount; r++) {
        const sk = s.cellKey(c + dc, r), dk = s.cellKey(c, r);
        if (s.cells[sk]) {
          s.cells[dk] = s.cells[sk]!;
          s.delCell(sk);
        } else {
          s.delCell(dk);
        }
      }
      s.colWidths.value[c] = s.colWidths.value[c + dc]!;
    }
    for (let c = s.colCount - dc; c < s.colCount; c++) {
      for (let r = 0; r < s.rowCount; r++) s.delCell(s.cellKey(c, r));
      s.colWidths.value[c] = DEFAULT_COL_WIDTH;
    }
    applyAdjustedMerges(rebuiltMerges);
  }

  // ============ 列排序 ============
  // 以「整行」为移动单位：按第一列 sC 对选中列范围 [sC..eC] 的数据行排序，
  // 仅移动 value（数据），styleId 留在原地不随行重排。
  // 阻断条件（对齐 Excel）：区域内存在公式单元格或相交的合并单元格 → 不可排序。
  interface SortRangeInfo {
    firstRow: number;
    lastRow: number;
    /** 实际参与排序的起始行（识别出表头时为首个数据行） */
    sortStart: number;
    blocked: boolean;
  }

  /** 取单元格（原始）数字格式代码，供排序按展示内容解析比较键 */
  function getCellNF(c: number, r: number): string {
    const st = s.resolveStyle(s.cells[s.cellKey(c, r)]);
    return typeof st?.numberFormat === 'string' ? st.numberFormat : '';
  }

  /** 判断第 c 列在 [r1, r2] 行范围内是否有非空单元格 */
  function colHasData(c: number, r1: number, r2: number): boolean {
    for (let r = r1; r <= r2; r++) {
      if (s.getCellRaw(c, r).trim() !== '') return true;
    }
    return false;
  }

  /**
   * 排序场景下的「扩展选定区域」：只横向扩展到相邻有数据的列，行范围保持选区不变。
   * 以选区当前行列范围为基准，逐列检查（在选区行范围内）是否有数据，直到遇到空列。
   */
  function getCurrentRegion(sel: SelectionRange): SelectionRange {
    const { startRow: r1, endRow: r2, startCol: c1, endCol: c2 } = sel;
    let nc1 = c1, nc2 = c2;
    while (nc1 > 0 && colHasData(nc1 - 1, r1, r2)) nc1--;
    while (nc2 < s.colCount - 1 && colHasData(nc2 + 1, r1, r2)) nc2++;
    return { startRow: r1, endRow: r2, startCol: nc1, endCol: nc2 };
  }

  /** 当选区不是完整横向数据块时，需要弹出排序提醒 */
  function needsSortConfirmation(sel: SelectionRange): boolean {
    const expanded = getCurrentRegion(sel);
    return expanded.startCol !== sel.startCol || expanded.endCol !== sel.endCol;
  }

  function analyzeSortRange(sC: number, eC: number, rowRange?: { startRow: number; endRow: number }, keyCol: number = sC): SortRangeInfo | null {
    let rStart: number, rEnd: number;
    if (rowRange) {
      rStart = rowRange.startRow;
      rEnd = rowRange.endRow;
    } else {
      const sel = s.selection.value;
      // 单格选择沿用整列排序语义（与历史行为一致）；多行选区则仅对选区排序，
      // 避免整列中其他行（如标题行）的合并单元格/公式误伤干净的选区
      const single = !!sel && sel.startRow === sel.endRow && sel.startCol === sel.endCol;
      rStart = single || !sel ? 0 : sel.startRow;
      rEnd = single || !sel ? s.rowCount - 1 : sel.endRow;
    }
    let firstRow = -1, lastRow = -1;
    for (let r = rStart; r <= rEnd; r++) {
      let has = false;
      for (let c = sC; c <= eC; c++) {
        if (s.getCellRaw(c, r).trim() !== '') { has = true; break; }
      }
      if (has) {
        if (firstRow < 0) firstRow = r;
        lastRow = r;
      }
    }
    if (firstRow < 0) return null;
    // 表头启发式识别（基于关键列 keyCol，按展示内容解析比较键）
    const keys: SortKey[] = [];
    for (let r = firstRow; r <= lastRow; r++) {
      const raw = s.getCellRaw(keyCol, r);
      keys.push(parseSortKeyByDisplay(raw, getCellNF(keyCol, r), s.locale.value));
    }
    const sortStart = looksLikeHeader(keys) ? firstRow + 1 : firstRow;
    // 阻断：范围内存在公式单元格（排序会造成引用错位，现有公式架构不支持置换重写）
    let blocked = false;
    for (let r = firstRow; r <= lastRow && !blocked; r++) {
      for (let c = sC; c <= eC; c++) {
        const cell = s.cells[s.cellKey(c, r)];
        if (cell && cell.value.startsWith('=')) { blocked = true; break; }
      }
    }
    // 阻断：合并单元格与排序行范围相交（列已重叠）
    if (!blocked) {
      for (const k in s.merges) {
        const m = s.merges[k];
        if (!m) continue;
        if (m.startCol <= eC && m.endCol >= sC && m.startRow <= rEnd && m.endRow >= rStart) {
          blocked = true;
          break;
        }
      }
    }
    return { firstRow, lastRow, sortStart, blocked };
  }

  function canSortColumns(sC: number, eC: number): boolean {
    const info = analyzeSortRange(sC, eC);
    return !!info && !info.blocked && info.sortStart < info.lastRow;
  }

  function sortSelectedColumns(order: SortOrder, range?: SelectionRange, keyCol?: number) {
    const sel = range ?? s.selection.value;
    if (!sel) return;
    const sC = sel.startCol, eC = sel.endCol;
    const key = keyCol ?? sC; // 排序基准列：扩展选区后仍用原始选区首列，不偏移
    const info = analyzeSortRange(sC, eC, { startRow: sel.startRow, endRow: sel.endRow }, key);
    if (!info || info.blocked || info.sortStart >= info.lastRow) return;
    const nCols = eC - sC + 1;
    const nRows = info.lastRow - info.sortStart + 1;
    // 快照每行 CellData 引用（不克隆、不新建 Cell 对象）与关键列比较键
    const rows: (CellData | null)[][] = [];
    const keys: SortKey[] = [];
    for (let r = info.sortStart; r <= info.lastRow; r++) {
      const row: (CellData | null)[] = new Array(nCols);
      for (let c = sC; c <= eC; c++) {
        row[c - sC] = s.cells[s.cellKey(c, r)] ?? null;
      }
      rows.push(row);
      const raw = s.getCellRaw(key, r);
      keys.push(parseSortKeyByDisplay(raw, getCellNF(key, r), s.locale.value));
    }
    const perm = buildSortedRowOrder(keys, order, s.locale.value);
    // 置换结果与当前顺序一致 → 不产生无意义的撤销记录
    let changed = false;
    for (let i = 0; i < nRows; i++) {
      if (perm[i] !== i) { changed = true; break; }
    }
    if (!changed) return;
    us.saveUndo();
    // 一次性按置换写回：仅移动 value（数据），styleId 留在原地不随行重排。
    for (let i = 0; i < nRows; i++) {
      const src = rows[perm[i]!]!;
      const r = info.sortStart + i;
      for (let c = sC; c <= eC; c++) {
        const k = s.cellKey(c, r);
        const srcCell = src[c - sC];
        const val = srcCell ? srcCell.value : '';
        const destStyleId = s.cells[k]?.styleId; // 目标位置原有样式（保持不动）
        if (val !== '' || destStyleId !== undefined) {
          s.cells[k] = { value: val, styleId: destStyleId };
        } else {
          s.delCell(k);
        }
      }
    }
    // 失效求值缓存并标记外部公式依赖为脏（范围外引用坐标不变，与 Excel 语义一致）
    clearEvalCache();
    for (let r = info.sortStart; r <= info.lastRow; r++) {
      for (let c = sC; c <= eC; c++) s.formulaDeps.markDirty(s.cellKey(c, r));
    }
    s.scheduleRender?.();
    emitModelData();
  }

  // ============ 排序提醒弹窗（Excel 风格：扩展选区 / 以当前选区排序） ============
  const sortConfirmOpen = ref(false);
  const sortConfirmPending = ref<{ order: SortOrder; originalRange: SelectionRange; expandedRange: SelectionRange } | null>(null);

  /** 准备排序确认：若选区可扩展则弹出提醒并返回 true；调用方应直接 return，等待用户确认 */
  function prepareSortConfirmation(order: SortOrder): boolean {
    const sel = s.selection.value;
    if (!sel || !needsSortConfirmation(sel)) return false;
    const expanded = getCurrentRegion(sel);
    sortConfirmPending.value = { order, originalRange: sel, expandedRange: expanded };
    sortConfirmOpen.value = true;
    return true;
  }

  /** 用户确认排序：expand=true 用扩展区域排序，false 用原始选区排序；基准列始终为原始选区首列 */
  function confirmSort(expand: boolean): void {
    const pending = sortConfirmPending.value;
    if (!pending) return;
    const { order, originalRange, expandedRange } = pending;
    sortConfirmOpen.value = false;
    sortConfirmPending.value = null;
    const range = expand ? expandedRange : originalRange;
    sortSelectedColumns(order, range, originalRange.startCol);
    cachedSortOrder.value = order;
  }

  function cancelSortConfirmation(): void {
    sortConfirmOpen.value = false;
    sortConfirmPending.value = null;
  }

  // ============ 工具栏排序下拉框（分体式，与边框下拉框交互一致） ============
  const sortMenuOpen = ref(false);
  // 上一次使用的排序方向：功能按钮默认升序，从下拉菜单选择后记忆该项
  const cachedSortOrder = ref<SortOrder>('asc');

  function onSortMenuToggle(v: boolean) {
    sortMenuOpen.value = v;
    if (v) {
      us.textColorMenuOpen.value = false;
      us.fillColorMenuOpen.value = false;
      us.fontSizeMenuOpen.value = false;
    }
  }

  /** 下拉菜单选中：先检查是否需要排序提醒，需要则挂起等待用户确认 */
  function onSortChange(order: SortOrder) {
    if (prepareSortConfirmation(order)) return;
    cachedSortOrder.value = order;
    sortSelectedColumns(order);
  }

  /** 功能按钮：应用上一次从下拉菜单使用的排序项（默认升序） */
  function applyCachedSort() {
    if (prepareSortConfirmation(cachedSortOrder.value)) return;
    sortSelectedColumns(cachedSortOrder.value);
  }

  // ============ 合并单元格在 插入/删除 行列时的调整 ============
  // Excel 语义：
  //  * 删除行列时：若仅合并范围的一部分被删 → 合并范围相应"缩小"，剩余保持合并且样式跟随
  //    （若旧 anchor 被删 → 自动选删后剩下的左上角为新 anchor，并迁移 value+style）
  //  * 插入行列时：整体在插入点之后的合并 → 整体平移；插入点落在合并跨度内部 → 合并相应"扩大"吞掉新行/列

  function applyAdjustedMerges(
    rebuilt: Array<{ newAnchorKey: string; newRange: { startCol: number; startRow: number; endCol: number; endRow: number }; anchorCell?: { value: string; styleId: number } }>,
  ) {
    // 清空旧 merges
    Object.keys(s.merges).forEach((k) => Reflect.deleteProperty(s.merges, k));
    // 写入新 merges，并对需要迁移的 anchor cell 写入 value+styleId
    for (const entry of rebuilt) {
      if (entry.newRange.startCol > entry.newRange.endCol || entry.newRange.startRow > entry.newRange.endRow) continue;
      s.merges[entry.newAnchorKey] = { ...entry.newRange };
      if (entry.anchorCell) {
        const v = entry.anchorCell.value, sid = entry.anchorCell.styleId;
        if (v === '' && !sid) {
          // s.delCell(entry.newAnchorKey); — 不主动删，避免破坏已经由 cells 主流程正确就位的空 cell
        } else {
          s.cells[entry.newAnchorKey] = { value: v, styleId: sid || undefined };
        }
      }
    }
  }

  function adjustMergesForDeleteRows(rS: number, rE: number) {
    const d = rE - rS + 1;
    const rebuilt: Array<{ newAnchorKey: string; newRange: { startCol: number; startRow: number; endCol: number; endRow: number }; anchorCell?: { value: string; styleId: number } }> = [];
    for (const oldKey in s.merges) {
      const m = s.merges[oldKey];
      if (!m) continue;
      // 旧 anchor 的 value+styleId 快照（在 cells 主流程删/改之前保留）
      const oldAnchorCell = s.cells[oldKey] ? { value: s.cells[oldKey]!.value, styleId: s.cells[oldKey]!.styleId ?? 0 } : { value: '', styleId: 0 };
      const { startCol, endCol } = m;
      let { startRow, endRow } = m;

      // 完全在删除范围下 → 整段 -d，anchor 也 -d
      if (startRow > rE) {
        startRow -= d;
        endRow -= d;
        rebuilt.push({
          newAnchorKey: s.cellKey(startCol, startRow),
          newRange: { startCol, startRow, endCol, endRow },
        });
        continue;
      }
      // 完全在删除范围上 → 不动
      if (endRow < rS) {
        rebuilt.push({ newAnchorKey: oldKey, newRange: { startCol, startRow, endCol, endRow } });
        continue;
      }
      // 完全被删除包含 → 丢弃
      if (startRow >= rS && endRow <= rE) {
        continue;
      }
      // 部分交叉：新 start / end 逻辑
      // start：若 start 在删除区间 [rS,rE] → 新 start 是"删除后第一个保留行"= rS（上面的行都保持，下面 rE+1.. 的行整体下移 d 到 rS..）
      //        若 start < rS → 不变；若 start > rE → 已在"完全在后"分支处理过不会进这里
      if (startRow >= rS && startRow <= rE) {
        startRow = rS;  // 对应 rE+1 行被上移 d 后落到的位置
      }
      // end：若 end 在删除区间 [rS,rE] → 新 end = rS - 1
      //      若 end > rE → end -= d（删除区间下的行上移）
      //      若 end < rS → 不变（上面"完全在前"分支已处理，不会到这里）
      if (endRow >= rS && endRow <= rE) {
        endRow = rS - 1;
      } else if (endRow > rE) {
        endRow -= d;
      }
      // 非法范围丢弃
      if (startRow > endRow) continue;

      const newAnchorCol = startCol;
      const newAnchorRow = startRow;
      const newAnchorKey = s.cellKey(newAnchorCol, newAnchorRow);
      // 当旧 anchor 被删除 / 新 anchor 不等于旧 anchor 时，要迁移 value+style 到新 anchor
      const oldAnchorCoord = oldKey.split(',').map(Number);
      const oldAR = oldAnchorCoord[1]!;
      const anchorMoved
        = (oldAR >= rS && oldAR <= rE)             // 旧 anchor 行被删
          || (newAnchorCol !== m.startCol)            // 列方向合并也可能触发（下面的 deleteCols 才会用，这里行删除时通常相等，保守判断）
          || (newAnchorRow !== oldAR);
      rebuilt.push({
        newAnchorKey,
        newRange: { startCol, startRow, endCol, endRow },
        anchorCell: anchorMoved ? oldAnchorCell : undefined,
      });
    }
    return rebuilt;
  }

  function adjustMergesForDeleteCols(cS: number, cE: number) {
    const d = cE - cS + 1;
    const rebuilt: Array<{ newAnchorKey: string; newRange: { startCol: number; startRow: number; endCol: number; endRow: number }; anchorCell?: { value: string; styleId: number } }> = [];
    for (const oldKey in s.merges) {
      const m = s.merges[oldKey];
      if (!m) continue;
      const oldAnchorCell = s.cells[oldKey] ? { value: s.cells[oldKey]!.value, styleId: s.cells[oldKey]!.styleId ?? 0 } : { value: '', styleId: 0 };
      let { startCol, endCol } = m;
      const { startRow, endRow } = m;

      if (startCol > cE) {
        startCol -= d;
        endCol -= d;
        rebuilt.push({ newAnchorKey: s.cellKey(startCol, startRow), newRange: { startCol, startRow, endCol, endRow } });
        continue;
      }
      if (endCol < cS) {
        rebuilt.push({ newAnchorKey: oldKey, newRange: { startCol, startRow, endCol, endRow } });
        continue;
      }
      if (startCol >= cS && endCol <= cE) {
        continue;
      }
      if (startCol >= cS && startCol <= cE) {
        startCol = cS;
      }
      if (endCol >= cS && endCol <= cE) {
        endCol = cS - 1;
      } else if (endCol > cE) {
        endCol -= d;
      }
      if (startCol > endCol) continue;

      const newAnchorCol = startCol;
      const newAnchorRow = startRow;
      const newAnchorKey = s.cellKey(newAnchorCol, newAnchorRow);
      const oldAnchorCoord = oldKey.split(',').map(Number);
      const oldAC = oldAnchorCoord[0]!;
      const anchorMoved = (oldAC >= cS && oldAC <= cE) || newAnchorCol !== oldAC || newAnchorRow !== m.startRow;
      rebuilt.push({
        newAnchorKey,
        newRange: { startCol, startRow, endCol, endRow },
        anchorCell: anchorMoved ? oldAnchorCell : undefined,
      });
    }
    return rebuilt;
  }

  function adjustMergesForInsertRows(rS: number, rE: number) {
    const n = rE - rS + 1;
    const rebuilt: Array<{ newAnchorKey: string; newRange: { startCol: number; startRow: number; endCol: number; endRow: number } }> = [];
    for (const oldKey in s.merges) {
      const m = s.merges[oldKey];
      if (!m) continue;
      const { startCol, endCol } = m;
      let { startRow, endRow } = m;
      if (endRow < rS) {
        // 插入位置之上 → 不动
        rebuilt.push({ newAnchorKey: oldKey, newRange: { startCol, startRow, endCol, endRow } });
      } else if (startRow > rE) {
        // 插入位置之下 → 整体 +n（cells 主流程已经把这些行向下移了，anchor key 需要同步改）
        startRow += n;
        endRow += n;
        rebuilt.push({ newAnchorKey: s.cellKey(startCol, startRow), newRange: { startCol, startRow, endCol, endRow } });
      } else {
        // 插入位置落在合并跨度里 → 合并"扩大"，end += n，anchor 不变
        endRow += n;
        rebuilt.push({ newAnchorKey: oldKey, newRange: { startCol, startRow, endCol, endRow } });
      }
    }
    return rebuilt;
  }

  function adjustMergesForInsertCols(cS: number, cE: number) {
    const n = cE - cS + 1;
    const rebuilt: Array<{ newAnchorKey: string; newRange: { startCol: number; startRow: number; endCol: number; endRow: number } }> = [];
    for (const oldKey in s.merges) {
      const m = s.merges[oldKey];
      if (!m) continue;
      let { startCol, endCol } = m;
      const { startRow, endRow } = m;
      if (endCol < cS) {
        rebuilt.push({ newAnchorKey: oldKey, newRange: { startCol, startRow, endCol, endRow } });
      } else if (startCol > cE) {
        startCol += n;
        endCol += n;
        rebuilt.push({ newAnchorKey: s.cellKey(startCol, startRow), newRange: { startCol, startRow, endCol, endRow } });
      } else {
        endCol += n;
        rebuilt.push({ newAnchorKey: oldKey, newRange: { startCol, startRow, endCol, endRow } });
      }
    }
    return rebuilt;
  }

  // ============ 多 Sheet 管理 ============
  let sidN = 0;
  function nid() {
    sidN++;
    return `s_${sidN}`;
  }
  function mkSheet(name: string, dims?: { colCount?: number; rowCount?: number }): SheetState {
    const colC = Math.max(1, dims?.colCount ?? s.colCount);
    const rowC = Math.max(1, dims?.rowCount ?? s.rowCount);
    const cw: number[] = new Array(colC).fill(DEFAULT_COL_WIDTH);
    const rh: (number | undefined)[] = new Array(rowC).fill(undefined);
    return {
      id: nid(), name, cells: {}, merges: {},
      styles: [{}],
      borders: [{}],
      selection: { startCol: 0, startRow: 0, endCol: 0, endRow: 0 },
      activeCell: { col: 0, row: 0 },
      scrollX: 0, scrollY: 0,
      colWidths: cw,
      rowHeights: rh,
      colCount: colC,
      rowCount: rowC,
    };
  }
  const sheets = ref<SheetState[]>([mkSheet('Sheet1')]);
  const activeSheetIndex = ref(0);

  function saveSheet() {
    const sh = sheets.value[activeSheetIndex.value];
    if (!sh) return;
    sh.cells = { ...s.cells };
    sh.merges = { ...s.merges };
    sh.selection = s.selection.value ? { ...s.selection.value } : null;
    sh.activeCell = { ...s.activeCell.value };
    sh.scrollX = s.scrollX.value;
    sh.scrollY = s.scrollY.value;
    sh.colWidths = [...s.colWidths.value];
    sh.rowHeights = [...s.rowHeights.value];
    sh.styles = [...s.styles];
    sh.borders = [...s.borders];
    sh.colCount = s.colCount;
    sh.rowCount = s.rowCount;
  }

  function loadSheet(i: number) {
    const sh = sheets.value[i];
    if (!sh) return;
    Object.keys(s.cells).forEach((k) => s.delCell(k));
    Object.assign(s.cells, sh.cells);
    Object.keys(s.merges).forEach((k) => Reflect.deleteProperty(s.merges, k));
    if (sh.merges) Object.assign(s.merges, sh.merges);
    s.selection.value = sh.selection ? { ...sh.selection } : null;
    s.activeCell.value = { ...sh.activeCell };
    s.scrollX.value = sh.scrollX;
    s.scrollY.value = sh.scrollY;
    s.colWidths.value = [...sh.colWidths];
    s.rowHeights.value = [...sh.rowHeights];
    // 同步逻辑范围：通过 s.setDims 让 dims 与 colWidths/rowHeights 同步（含裁剪 / 补齐）
    const targetCol = Math.max(1, sh.colCount ?? s.colCount);
    const targetRow = Math.max(1, sh.rowCount ?? s.rowCount);
    s.setDims?.(targetCol, targetRow);
    s.syncStyles(sh.styles);
    s.syncBorders(sh.borders ?? [{}]);
    activeSheetIndex.value = i;
  }

  function switchSheet(i: number) {
    if (i === activeSheetIndex.value || i < 0 || i >= sheets.value.length) return;
    s.cancelEdit();
    saveSheet();
    loadSheet(i);
  }

  function addSheet(n?: string): number {
    us.saveUndo();
    s.cancelEdit();
    saveSheet();
    sheets.value.push(mkSheet(n ?? `Sheet${sheets.value.length + 1}`));
    loadSheet(sheets.value.length - 1);
    return sheets.value.length - 1;
  }

  function removeSheet(i: number): number {
    if (sheets.value.length <= 1) return activeSheetIndex.value;
    us.saveUndo();
    s.cancelEdit();
    sheets.value.splice(i, 1);
    loadSheet(Math.min(i, sheets.value.length - 1));
    return activeSheetIndex.value;
  }

  function renameSheet(i: number, n: string) {
    if (sheets.value[i] && n.trim()) {
      us.saveUndo();
      sheets.value[i]!.name = n.trim();
    }
  }

  function dupSheet(i: number): number {
    us.saveUndo();
    s.cancelEdit();
    saveSheet();
    const src = sheets.value[i];
    if (!src) return i;
    let bn = src.name;
    const m = bn.match(/^(.*?)\s*\((\d+)\)$/);
    let n = m ? parseInt(m[2]!, 10) + 1 : 2;
    if (m) bn = m[1]!;
    let nn = `${bn} (${n})`;
    const names = new Set(sheets.value.map((x) => x.name));
    while (names.has(nn)) {
      n++;
      nn = `${bn} (${n})`;
    }
    const cp: SheetState = {
      id: nid(), name: nn, cells: { ...src.cells },
      merges: src.merges ? { ...src.merges } : {},
      styles: [...src.styles],
      borders: src.borders ? [...src.borders] : [{}],
      selection: src.selection ? { ...src.selection } : null,
      activeCell: src.activeCell ? { ...src.activeCell } : { col: 0, row: 0 },
      scrollX: src.scrollX, scrollY: src.scrollY,
      colWidths: [...src.colWidths], rowHeights: [...src.rowHeights],
      colCount: src.colCount, rowCount: src.rowCount,
    };
    sheets.value.splice(i + 1, 0, cp);
    loadSheet(i + 1);
    return i + 1;
  }

  function moveSheet(i: number, d: number) {
    const ni = i + d;
    if (ni < 0 || ni >= sheets.value.length) return;
    us.saveUndo();
    const cur = activeSheetIndex.value;
    const src = sheets.value.splice(i, 1)[0]!;
    sheets.value.splice(ni, 0, src);
    if (cur === i) activeSheetIndex.value = ni;
    else if (i < cur && ni >= cur) activeSheetIndex.value = cur - 1;
    else if (i > cur && ni <= cur) activeSheetIndex.value = cur + 1;
    s.scheduleRender?.();
  }

  const sheetCount = computed(() => sheets.value.length);

  // ============ v-model emit ============
  let lastEmittedData = '';
  const modelData = rawModelData;

  function emitModelData() {
    saveSheet();
    const out: SheetModelData[] = sheets.value.map((sh) => {
      const cs: Record<string, { value: string; styleId?: number }> = {};
      for (const [k, v] of Object.entries(sh.cells)) {
        cs[k] = { value: v.value };
        if (v.styleId && v.styleId > 0) cs[k]!.styleId = v.styleId;
      }
      const smd: SheetModelData = { name: sh.name, cells: cs };
      // 输出样式池（styles[0] 始终为默认空样式 {}）
      if (sh.styles && sh.styles.length > 1) {
        smd.styles = [...sh.styles];
      }
      if (sh.borders && sh.borders.length > 1) {
        smd.borders = [...sh.borders];
      }
      if (sh.merges && Object.keys(sh.merges).length) {
        smd.merges = { ...sh.merges };
      }
      const cw: Record<number, number> = {};
      for (let i = 0; i < sh.colWidths.length; i++) {
        if (sh.colWidths[i] !== 100) cw[i] = sh.colWidths[i]!;
      }
      if (Object.keys(cw).length) smd.colWidths = cw;
      const rh: Record<number, number> = {};
      for (let i = 0; i < sh.rowHeights.length; i++) {
        const hv = sh.rowHeights[i];
        if (hv !== undefined && hv !== null) rh[i] = hv;
      }
      if (Object.keys(rh).length) smd.rowHeights = rh;
      // 输出逻辑有效范围：仅当与默认值不同时输出，保持旧数据兼容
      if (sh.colCount !== 26) smd.colCount = sh.colCount;
      if (sh.rowCount !== 200) smd.rowCount = sh.rowCount;
      return smd;
    });
    const js = JSON.stringify(out);
    if (js !== lastEmittedData) {
      lastEmittedData = js;
      modelData.value = out;
      if (lastEmittedDataRef) lastEmittedDataRef.value = js;
    }
  }
  // 反向注入到 core-state
  s.emitModelData = emitModelData;

  let pendingOptEmit = false;
  function scheduleOptEmit() {
    if (!pendingOptEmit) {
      pendingOptEmit = true;
      Promise.resolve().then(() => {
        pendingOptEmit = false;
        emitModelData();
      });
    }
  }

  // ============ 主题 & CSS ============
  const themeColors = computed(() => (s.props.theme === 'dark' ? darkTheme : lightTheme));
  const outerStyle = computed(() => buildOuterStyle(themeColors.value, s.props.width, s.props.height, resolveSize));
  const toolbarThemeVars = computed(() => {
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(outerStyle.value)) {
      if (k.startsWith('--')) vars[k] = v;
    }
    return vars;
  });

  // ============ 模板 refs & 滚动控制 ============
  const wrapperRef = ref<HTMLDivElement | null>(null);
  const canvasRef = ref<HTMLCanvasElement | null>(null);
  const editInputRef = ref<HTMLTextAreaElement | null>(null);
  const formulaBarRef = ref<HTMLTextAreaElement | null>(null);
  const viewSize = reactive({ w: 800, h: 600 });
  // 同时同步到 core-state 的 viewSize（用于 ensureVisible）
  if (s.viewSize) {
    watch(viewSize, (v) => {
      if (s.viewSize) {
        s.viewSize.w = v.w;
        s.viewSize.h = v.h;
      }
    }, { deep: true });
  }

  const HEADER_WIDTH = 48;
  const HEADER_HEIGHT = 28;
  const SB_SIZE = 11;

  const maxScrollX = computed(() => Math.max(0, s.totalWidth.value - Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE)));
  const maxScrollY = computed(() => Math.max(0, s.totalHeight.value - Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE)));

  function clampScroll(sx: number | null, sy: number | null) {
    const gw = Math.max(0, viewSize.w - HEADER_WIDTH - SB_SIZE);
    const gh = Math.max(0, viewSize.h - HEADER_HEIGHT - SB_SIZE);
    const newX = sx ?? s.scrollX.value;
    const newY = sy ?? s.scrollY.value;

    // 任何滚动操作（滚轮、拖拽滚动条、点击滚动条轨道）都在接近边界时触发动态扩展
    const nearMargin = 40;
    const maxX = Math.max(0, s.totalWidth.value - gw);
    const maxY = Math.max(0, s.totalHeight.value - gh);
    if (
      (newX >= maxX - nearMargin && newX > s.scrollX.value) ||
      (newY >= maxY - nearMargin && newY > s.scrollY.value)
    ) {
      const approxCol = Math.max(0, Math.ceil((newX + gw) / 100) + 2);
      const approxRow = Math.max(0, Math.ceil((newY + gh) / 24) + 2);
      s.ensureCapacity(approxCol, approxRow);
    }

    s.scrollX.value = Math.max(0, Math.min(newX, Math.max(0, s.totalWidth.value - gw)));
    s.scrollY.value = Math.max(0, Math.min(newY, Math.max(0, s.totalHeight.value - gh)));
  }
  // 反向注入到 core-state
  s.clampScroll = clampScroll;

  function canFocusHiddenEditor(): boolean {
    if (typeof window === 'undefined') return false;
    return !window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
  }

  function focusEditInput(selectAllText = false) {
    nextTick(() => {
      const inp = editInputRef.value;
      if (!inp) return;
      if (!s.editingCell.value && !canFocusHiddenEditor()) {
        if (document.activeElement === inp) inp.blur();
        return;
      }
      inp.focus({ preventScroll: true });
      if (selectAllText) inp.select();
    });
  }

  function onCanvasFocus() {
    focusEditInput();
  }

  // ============ 行高/列宽重置 ============
  function resetRowHeight() {
    const sel = s.selection.value;
    if (!sel) return;
    us.saveUndo();
    for (let r = sel.startRow; r <= sel.endRow; r++) s.rowHeights.value[r] = undefined;
    s.scheduleRender?.();
    emitModelData();
  }
  function resetColWidth() {
    const sel = s.selection.value;
    if (!sel) return;
    us.saveUndo();
    for (let c = sel.startCol; c <= sel.endCol; c++) s.colWidths.value[c] = DEFAULT_COL_WIDTH;
    s.scheduleRender?.();
    emitModelData();
  }

  return {
    deleteRows,
    insertRows,
    insertCols,
    deleteCols,

    sortSelectedColumns,
    canSortColumns,

    sortMenuOpen,
    cachedSortOrder,
    onSortMenuToggle,
    onSortChange,
    applyCachedSort,

    sortConfirmOpen,
    prepareSortConfirmation,
    confirmSort,
    cancelSortConfirmation,

    sheets,
    activeSheetIndex,
    saveSheet,
    loadSheet,
    switchSheet,
    addSheet,
    removeSheet,
    renameSheet,
    dupSheet,
    moveSheet,
    sheetCount,
    mkSheet,

    emitModelData,
    scheduleOptEmit,

    themeColors,
    outerStyle,
    toolbarThemeVars,

    wrapperRef,
    canvasRef,
    editInputRef,
    formulaBarRef,
    viewSize,
    maxScrollX,
    maxScrollY,
    clampScroll,
    canFocusHiddenEditor,
    focusEditInput,
    onCanvasFocus,

    resetRowHeight,
    resetColWidth,

    modelData,
  };
}
