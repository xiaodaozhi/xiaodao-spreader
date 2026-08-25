import { ref, reactive, computed, watch, nextTick, type Ref, type ComputedRef } from 'vue';
import { DEFAULT_COL_WIDTH, lightTheme, darkTheme } from '../core/constants';
import type { ThemeColors, SheetState, SheetModelData, CellStyle } from '../core/types';
import { resolveSize } from '../core/utils';
import { buildOuterStyle } from '../core/theme';
import type { CoreState } from './core-state';
import type { UndoStylesState } from './undo-styles';

export interface SheetsOpsState {
  // 行列增删
  deleteRows: (rS: number, rE: number) => void;
  insertRows: (rS: number, rE: number) => void;
  insertCols: (cS: number, cE: number) => void;
  deleteCols: (cS: number, cE: number) => void;

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
  mkSheet: (name: string) => SheetState;

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
    if (rS > 0) {
      for (let c = 0; c < s.colCount; c++) {
        s.syncCellBorders?.(c, rS - 1);
        s.syncCellBorders?.(c, rS);
      }
    }
  }

  function insertRows(rS: number, rE: number) {
    const n = rE - rS + 1;
    if (rE >= s.rowCount - 1) return;
    const rebuiltMerges = adjustMergesForInsertRows(rS, rE);
    for (let r = s.rowCount - 1; r > rE; r--) {
      for (let c = 0; c < s.colCount; c++) {
        const sk = s.cellKey(c, r - n), dk = s.cellKey(c, r);
        if (s.cells[sk]) s.cells[dk] = s.cells[sk]!;
        else s.delCell(dk);
      }
      s.rowHeights.value[r] = s.rowHeights.value[r - n];
    }
    for (let r = rE + 1; r <= rE + n; r++) {
      for (let c = 0; c < s.colCount; c++) s.delCell(s.cellKey(c, r));
      s.rowHeights.value[r] = undefined;
    }
    applyAdjustedMerges(rebuiltMerges);
  }

  function insertCols(cS: number, cE: number) {
    const n = cE - cS + 1;
    if (cE >= s.colCount - 1) return;
    const rebuiltMerges = adjustMergesForInsertCols(cS, cE);
    for (let c = s.colCount - 1; c > cE; c--) {
      for (let r = 0; r < s.rowCount; r++) {
        const sk = s.cellKey(c - n, r), dk = s.cellKey(c, r);
        if (s.cells[sk]) s.cells[dk] = s.cells[sk]!;
        else s.delCell(dk);
      }
      s.colWidths.value[c] = s.colWidths.value[c - n]!;
    }
    for (let c = cE + 1; c <= cE + n; c++) {
      for (let r = 0; r < s.rowCount; r++) s.delCell(s.cellKey(c, r));
      s.colWidths.value[c] = DEFAULT_COL_WIDTH;
    }
    applyAdjustedMerges(rebuiltMerges);
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
    if (cS > 0) {
      for (let r = 0; r < s.rowCount; r++) {
        s.syncCellBorders?.(cS - 1, r);
        s.syncCellBorders?.(cS, r);
      }
    }
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
  function mkSheet(name: string): SheetState {
    return {
      id: nid(), name, cells: {}, merges: {},
      styles: [{}],
      selection: { startCol: 0, startRow: 0, endCol: 0, endRow: 0 },
      activeCell: { col: 0, row: 0 },
      scrollX: 0, scrollY: 0,
      colWidths: new Array(s.colCount).fill(DEFAULT_COL_WIDTH),
      rowHeights: new Array(s.rowCount).fill(undefined),
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
    s.syncStyles(sh.styles);
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
      selection: src.selection ? { ...src.selection } : null,
      activeCell: src.activeCell ? { ...src.activeCell } : { col: 0, row: 0 },
      scrollX: src.scrollX, scrollY: src.scrollY,
      colWidths: [...src.colWidths], rowHeights: [...src.rowHeights],
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
    s.scrollX.value = Math.max(0, Math.min(sx ?? s.scrollX.value, Math.max(0, s.totalWidth.value - gw)));
    s.scrollY.value = Math.max(0, Math.min(sy ?? s.scrollY.value, Math.max(0, s.totalHeight.value - gh)));
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
