import { ref, type Ref } from 'vue';
import { colToLabel, writeClipboardText } from '../core/utils';
import { clearEvalCache, parseFormulaRefs, shiftFormulaRefs } from '../core/formula';
import type { CoreState } from './core-state';
import type { UndoStylesState } from './undo-styles';
import type { BorderType } from '../components/pickers/borderPicker.vue';
import type { MergeType } from '../core/constants';
import type { SelectionRange } from '../core/types';

// ============ 共享 BordersMerge 接口 ============
export interface BordersMergeState {
  // 边框
  cachedBorder: Ref<BorderType>;
  borderMenuOpen: Ref<boolean>;
  BORDER_COLOR: string;
  borderTypeToWidths: (bt: BorderType, col: number, row: number, sel: SelectionRange) => { top: number; bottom: number; left: number; right: number };
  onBorderChange: (bt: BorderType) => void;
  setCellBorderSide: (col: number, row: number, side: 'Top' | 'Bottom' | 'Left' | 'Right', width: number, clearZero: boolean) => void;
  syncCellBorders: (col: number, row: number) => void;
  applyBorderToCell: (col: number, row: number, w: { top: number; bottom: number; left: number; right: number }, clearZero?: boolean) => void;
  applyCachedBorder: () => void;
  cellBorderWidth: (col: number, row: number, side: 'Top' | 'Bottom' | 'Left' | 'Right') => number;

  // 合并单元格
  mergeMenuOpen: Ref<boolean>;
  onMergeMenuToggle: (v: boolean) => void;
  removeOverlappingMerges: (sC: number, sR: number, eC: number, eR: number) => void;
  mergeAndCenter: () => void;
  mergeAcross: () => void;
  mergeCells: () => void;
  unmergeCells: () => void;
  onApplyMerge: () => void;
  onMergeChange: (v: MergeType) => void;

  // 剪贴板
  copySourceRange: SelectionRange | null;
  copySourceStyles: number[][];
  captureStyles: (cS: number, cE: number, rS: number, rE: number) => void;
  setCellWithStyle: (c: number, r: number, val: string, styleId: number | null) => void;
  copyToClipboard: () => void;
  copyRowCol: () => void;
  pasteFromClipboard: () => Promise<void>;
  cutSelected: () => void;
  clearSelected: () => void;

  // 求和
  sumSelected: () => void;
  // 平均值
  avgSelected: () => void;
  // 计数
  countSelected: () => void;

  // 计算下拉框
  calcMenuOpen: Ref<boolean>;
  onCalcMenuToggle: (v: boolean) => void;
  onCalcSum: () => void;
  onCalcAvg: () => void;
  onCalcCount: () => void;
}

export function createBordersMerge(
  s: CoreState,
  us: UndoStylesState,
): BordersMergeState {
  // ============ 边框 ============
  const cachedBorder = ref<BorderType>('none');
  const borderMenuOpen = ref(false);
  const BORDER_COLOR = '#444';

  function borderTypeToWidths(bt: BorderType, col: number, row: number, sel: SelectionRange): { top: number; bottom: number; left: number; right: number } {
    const m = s.findMerge(col, row);
    const ec = m ? m.range.endCol : col;
    const er = m ? m.range.endRow : row;
    const sc = m ? m.range.startCol : col;
    const sr = m ? m.range.startRow : row;
    const isEdgeTop = sr === sel.startRow;
    const isEdgeBottom = er === sel.endRow;
    const isEdgeLeft = sc === sel.startCol;
    const isEdgeRight = ec === sel.endCol;
    const w = { top: 0, bottom: 0, left: 0, right: 0 };
    switch (bt) {
      case 'none': return w;
      case 'bottom':
        if (isEdgeBottom) w.bottom = 1;
        break;
      case 'top':
        if (isEdgeTop) w.top = 1;
        break;
      case 'left':
        if (isEdgeLeft) w.left = 1;
        break;
      case 'right':
        if (isEdgeRight) w.right = 1;
        break;
      case 'all':
        w.top = 1;
        w.bottom = 1;
        w.left = 1;
        w.right = 1;
        break;
      case 'outer':
        if (isEdgeTop) w.top = 1;
        if (isEdgeBottom) w.bottom = 1;
        if (isEdgeLeft) w.left = 1;
        if (isEdgeRight) w.right = 1;
        break;
      case 'thickOuter':
        if (isEdgeTop) w.top = 2;
        if (isEdgeBottom) w.bottom = 2;
        if (isEdgeLeft) w.left = 2;
        if (isEdgeRight) w.right = 2;
        break;
    }
    return w;
  }

  function setCellBorderSide(col: number, row: number, side: 'Top' | 'Bottom' | 'Left' | 'Right', width: number, clearZero: boolean) {
    if (col < 0 || row < 0 || col >= s.colCount || row >= s.rowCount) return;
    const m = s.findMerge(col, row);
    if (m) {
      // ====================================================【双 BUG 修复 · 写入端】====================================================
      // 合并格的 4 条边框宽度存储在 anchor.style.border{Top/Bottom/Left/Right}Width 上，是**整条 span 的全局属性**。
      // 这里的 guard 通过"每条边只允许唯一合法角点写入"（见下 4 条）从源头防止 BUG 1：
      //   - BUG 1 场景：B2 设置 Top 时 syncCellBorders 会调用 setCellBorderSide(1, 0, 'Bottom', w, true) 试图写入 B1.Bottom，
      //     但 B1 属于 A1:C1 合并，其 Bottom 的合法写入点是 (startCol=0, endRow=0)=(0,0)，实际 (1,0) col 不符 → return，
      //     anchor.borderBottomWidth 保持不变 → 合并全局属性不被局部邻居污染 ✅
      //
      // 注：仅靠这个 guard 还不够，因为如果之后在渲染端用「合并整段 bottom 一个 fillRect + max(所有邻居列 Top) 取全局最大」来画，
      //     依然会造成「视觉上整条合并底因为 B2.Top=2 而全部变 2 粗」= BUG 1 等价复发。
      //     因此与 interactions.ts 第二步的【逐列/行分段绘制】配合形成完整修复方案：
      //       ① 写入端严格禁止局部格子写入全局边宽（本 guard）
      //       ② 渲染端合并格每一条横/竖边都按列/行分段 Math.max + 分段 fillRect，只让真正对齐邻居的那一列/行获得加宽（渲染端）
      // =================================================================================================================================
      // 各边合法写入角点定义：
      //   Top    → 合并格左上角 (startCol, startRow)  → 整条合并顶部只从"左上角顶边写入点"控制
      //   Bottom → 合并格左下角 (startCol, endRow)    → 整条合并底部只从"左下角底边写入点"控制（整列 span 的底部统一）
      //   Left   → 合并格左上角 (startCol, startRow)  → 整条合并左边只从"左上角左边写入点"控制
      //   Right  → 合并格右上角 (endCol, startRow)    → 整条合并右边只从"右上角右边写入点"控制
      if (side === 'Top'    && (col !== m.range.startCol || row !== m.range.startRow)) return;
      if (side === 'Bottom' && (col !== m.range.startCol || row !== m.range.endRow))   return;
      if (side === 'Left'   && (col !== m.range.startCol || row !== m.range.startRow)) return;
      if (side === 'Right'  && (col !== m.range.endCol   || row !== m.range.startRow)) return;
    }
    const k = m ? m.anchor : s.cellKey(col, row);
    const val = s.cells[k]?.value ?? '';
    const st = s.resolveStyle(s.cells[k]) ? { ...s.resolveStyle(s.cells[k])! } : {};
    const prop = `border${side}Width`;
    if (width === 0) {
      if (clearZero) Reflect.deleteProperty(st, prop);
    } else {
      st[prop] = width;
      st.borderColor = BORDER_COLOR;
    }
    const dirs = ['Top', 'Bottom', 'Left', 'Right'] as const;
    const hasBorder = dirs.some((d) => st[`border${d}Width`] !== undefined);
    if (!hasBorder) Reflect.deleteProperty(st, 'borderColor');
    if (val === '' && !Object.keys(st).length) s.delCell(k);
    else {
      const styleId = s.registerStyle(st);
      s.cells[k] = { value: val, styleId: styleId || undefined };
    }
  }

  function syncCellBorders(col: number, row: number) {
    const m = s.findMerge(col, row);
    const k = m ? m.anchor : s.cellKey(col, row);
    const st = s.resolveStyle(s.cells[k]);
    const wT = (st?.borderTopWidth as number) || 0;
    const wB = (st?.borderBottomWidth as number) || 0;
    const wL = (st?.borderLeftWidth as number) || 0;
    const wR = (st?.borderRightWidth as number) || 0;
    if (m) {
      // ==============================【双 BUG 修复 · 同步邻居】================================
      // 当前格属于合并格：以 anchor 上的全局边宽为源，向合并范围外的邻居单元格写入对应边。
      // 设计分工（与 interactions.ts 第二步分段渲染配合）：
      //   · 本函数只需要把合并格"全局边宽"同步到邻居格中「最靠边的一列/一行」即可。
      //     例如合并 A1:C1 的 bottom，只需要同步给 A2(0,1).Top = wB（左列起点），不需要也不应该强行
      //     把 B2(1,1).Top / C2(2,1).Top 也写为 wB，因为 B2/C2 自身可能有自定义的 Top 宽度，直接覆盖
      //     会造成 BUG 1 的兄弟问题（邻居局部宽度被合并全局边覆盖）。
      //
      //   · 更完整的"合并整条边与下方所有列邻居宽度叠加"的工作交由**渲染端分段绘制**完成：
      //     对 sC..eC 每列 cc，Bottom 段宽 = max(anchor.ownB, cells[cc, eR+1].Top)，逐列独立计算、逐列独立 fillRect。
      //     这样 A2/B2/C2 各自独立的 Top 都能正确与合并底做 Math.max 叠加，互不干扰。
      // ==========================================================================================
      const sR = m.range.startRow, eR = m.range.endRow;
      const sC = m.range.startCol, eC = m.range.endCol;
      // Top 宽度 → 合并上沿上方邻居（row=sR-1）的 Bottom。只写最左列 sC，对应 Left 合法角点。
      setCellBorderSide(sC, sR - 1, 'Bottom', wT, true);
      // Bottom 宽度 → 合并下沿下方邻居（row=eR+1）的 Top。只写最左列 sC，对应 Bottom 合法角点列。
      setCellBorderSide(sC, eR + 1, 'Top',    wB, true);
      // Left 宽度 → 合并左沿左方邻居（col=sC-1）的 Right。只写最上行 sR，对应 Left 合法角点行。
      setCellBorderSide(sC - 1, sR, 'Right',  wL, true);
      // Right 宽度 → 合并右沿右方邻居（col=eC+1）的 Left。只写最上行 sR，对应 Right 合法角点行。
      setCellBorderSide(eC + 1, sR, 'Left',   wR, true);
    } else {
      setCellBorderSide(col,     row - 1, 'Bottom', wT, true);
      setCellBorderSide(col,     row + 1, 'Top',    wB, true);
      setCellBorderSide(col - 1, row,     'Right',  wL, true);
      setCellBorderSide(col + 1, row,     'Left',   wR, true);
    }
  }
  // 反向注入到 core-state
  s.syncCellBorders = syncCellBorders;

  function applyBorderToCell(col: number, row: number, w: { top: number; bottom: number; left: number; right: number }, clearZero: boolean = true) {
    // ==================================================【边框写入统一入口】==================================================
    // 若 (col,row) 处于合并格内部（即用户点到合并格中间列/行然后 Apply 边框）：
    //   - 样式必须写入 anchor，因为渲染合并格时只读 anchor 的 style（否则边框看起来"没生效"）。
    //   - 后续 syncCellBorders 必须传 anchor 的 (startCol, startRow)，它会根据 merge 分支正确计算 4 个外部邻居。
    // ==========================================================================================================================
    const m = s.findMerge(col, row);
    const k = m ? m.anchor : s.cellKey(col, row);
    const val = s.cells[k]?.value ?? '';
    const st = s.resolveStyle(s.cells[k]) ? { ...s.resolveStyle(s.cells[k])! } : {};
    const dirs = ['Top', 'Bottom', 'Left', 'Right'] as const;
    const vals = [w.top, w.bottom, w.left, w.right];
    for (let i = 0; i < 4; i++) {
      const prop = `border${dirs[i]}Width`;
      if (vals[i] === 0) {
        if (clearZero) Reflect.deleteProperty(st, prop);
      } else {
        st[prop] = vals[i];
        st.borderColor = BORDER_COLOR;
      }
    }
    const hasBorder = dirs.some((d) => st[`border${d}Width`] !== undefined);
    if (!hasBorder) Reflect.deleteProperty(st, 'borderColor');
    if (val === '' && !Object.keys(st).length) s.delCell(k);
    else {
      const styleId = s.registerStyle(st);
      s.cells[k] = { value: val, styleId: styleId || undefined };
    }
    syncCellBorders(m ? m.range.startCol : col, m ? m.range.startRow : row);
  }

  function onBorderChange(bt: BorderType) {
    cachedBorder.value = bt;
    const sel = s.selection.value;
    if (!sel) return;
    us.saveUndo();
    if (bt === 'none') {
      for (let c = sel.startCol; c <= sel.endCol; c++) {
        for (let r = sel.startRow; r <= sel.endRow; r++) {
          const m = s.findMerge(c, r);
          if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
          applyBorderToCell(c, r, { top: 0, bottom: 0, left: 0, right: 0 }, true);
        }
      }
    } else {
      for (let c = sel.startCol; c <= sel.endCol; c++) {
        for (let r = sel.startRow; r <= sel.endRow; r++) {
          const m = s.findMerge(c, r);
          if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
          const w = borderTypeToWidths(bt, c, r, sel);
          applyBorderToCell(c, r, w, false);
        }
      }
    }
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  function applyCachedBorder() {
    onBorderChange(cachedBorder.value);
  }

  function cellBorderWidth(col: number, row: number, side: 'Top' | 'Bottom' | 'Left' | 'Right'): number {
    const m = s.findMerge(col, row);
    if (m) {
      const anchorStyle = s.resolveStyle(s.cells[m.anchor]);
      if (side === 'Top' && row === m.range.startRow) return (anchorStyle?.borderTopWidth as number) || 0;
      if (side === 'Bottom' && row === m.range.endRow) return (anchorStyle?.borderBottomWidth as number) || 0;
      if (side === 'Left' && col === m.range.startCol) return (anchorStyle?.borderLeftWidth as number) || 0;
      if (side === 'Right' && col === m.range.endCol) return (anchorStyle?.borderRightWidth as number) || 0;
      return 0;
    }
    const st = s.resolveStyle(s.cells[s.cellKey(col, row)]);
    return (st?.[`border${side}Width`] as number) || 0;
  }

  // ============ 合并单元格 ============
  const mergeMenuOpen = ref(false);

  function onMergeMenuToggle(v: boolean) {
    mergeMenuOpen.value = v;
    if (v) {
      us.textColorMenuOpen.value = false;
      us.fillColorMenuOpen.value = false;
      borderMenuOpen.value = false;
      us.fontSizeMenuOpen.value = false;
    }
  }

  function removeOverlappingMerges(sC: number, sR: number, eC: number, eR: number) {
    const toRemove: string[] = [];
    for (const key in s.merges) {
      const m = s.merges[key];
      if (!m) continue;
      if (m.startCol <= eC && m.endCol >= sC && m.startRow <= eR && m.endRow >= sR) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) Reflect.deleteProperty(s.merges, key);
  }

  function mergeAndCenter() {
    const sel = s.selection.value;
    if (!sel || (sel.startCol === sel.endCol && sel.startRow === sel.endRow)) return;
    us.saveUndo();
    removeOverlappingMerges(sel.startCol, sel.startRow, sel.endCol, sel.endRow);
    const anchorKey = s.cellKey(sel.startCol, sel.startRow);
    const anchorVal = s.cells[anchorKey]?.value ?? '';
    for (let c = sel.startCol; c <= sel.endCol; c++) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        if (c === sel.startCol && r === sel.startRow) continue;
        s.clearCellsInRange(c, c, r, r);
      }
    }
    const anchorSt = s.resolveStyle(s.cells[anchorKey]) ? { ...s.resolveStyle(s.cells[anchorKey])! } : {};
    anchorSt.textAlign = 'center';
    const anchorStyleId = s.registerStyle(anchorSt);
    s.cells[anchorKey] = { value: anchorVal, styleId: anchorStyleId || undefined };
    s.merges[anchorKey] = { startCol: sel.startCol, startRow: sel.startRow, endCol: sel.endCol, endRow: sel.endRow };
    s.selectCell(sel.startCol, sel.startRow);
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  function mergeAcross() {
    const sel = s.selection.value;
    if (!sel || sel.startCol === sel.endCol) return;
    us.saveUndo();
    for (let r = sel.startRow; r <= sel.endRow; r++) {
      removeOverlappingMerges(sel.startCol, r, sel.endCol, r);
      const anchorKey = s.cellKey(sel.startCol, r);
      const _anchorVal = s.cells[anchorKey]?.value ?? '';
      for (let c = sel.startCol + 1; c <= sel.endCol; c++) {
        s.clearCellsInRange(c, c, r, r);
      }
      s.merges[anchorKey] = { startCol: sel.startCol, startRow: r, endCol: sel.endCol, endRow: r };
    }
    s.selectRange(sel.startCol, sel.startRow, sel.endCol, sel.endRow);
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  function mergeCells() {
    const sel = s.selection.value;
    if (!sel || (sel.startCol === sel.endCol && sel.startRow === sel.endRow)) return;
    us.saveUndo();
    removeOverlappingMerges(sel.startCol, sel.startRow, sel.endCol, sel.endRow);
    const anchorKey = s.cellKey(sel.startCol, sel.startRow);
    const _anchorVal = s.cells[anchorKey]?.value ?? '';
    for (let c = sel.startCol; c <= sel.endCol; c++) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        if (c === sel.startCol && r === sel.startRow) continue;
        s.clearCellsInRange(c, c, r, r);
      }
    }
    s.merges[anchorKey] = { startCol: sel.startCol, startRow: sel.startRow, endCol: sel.endCol, endRow: sel.endRow };
    s.selectCell(sel.startCol, sel.startRow);
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  function unmergeCells() {
    const sel = s.selection.value;
    if (!sel) return;
    us.saveUndo();
    removeOverlappingMerges(sel.startCol, sel.startRow, sel.endCol, sel.endRow);
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  function onApplyMerge() {
    const sel = s.selection.value;
    if (!sel) return;
    const m = s.findMerge(sel.startCol, sel.startRow);
    if (m && sel.startCol === m.range.startCol && sel.startRow === m.range.startRow
      && sel.endCol === m.range.endCol && sel.endRow === m.range.endRow) {
      unmergeCells();
    } else {
      mergeAndCenter();
    }
  }

  function onMergeChange(v: MergeType) {
    switch (v) {
      case 'mergeCenter':
        mergeAndCenter();
        break;
      case 'mergeAcross':
        mergeAcross();
        break;
      case 'mergeCells':
        mergeCells();
        break;
      case 'unmergeCells':
        unmergeCells();
        break;
    }
  }

  // ============ 剪贴板 ============
  let copySourceRange: SelectionRange | null = null;
  let copySourceStyles: number[][] = [];

  function captureStyles(cS: number, cE: number, rS: number, rE: number) {
    copySourceStyles = [];
    for (let r = rS; r <= rE; r++) {
      const row: number[] = [];
      for (let c = cS; c <= cE; c++) {
        const cell = s.cells[s.cellKey(c, r)];
        row.push(cell?.styleId ?? 0);
      }
      copySourceStyles.push(row);
    }
  }

  function setCellWithStyle(c: number, r: number, val: string, styleId: number | null) {
    const k = s.cellKey(c, r);
    clearEvalCache();
    if (val === '' || val == null) {
      s.formulaDeps.clear(k);
      if (styleId && styleId > 0) {
        s.cells[k] = { value: '', styleId };
      } else {
        s.delCell(k);
      }
      s.formulaDeps.markDirty(k);
      return;
    }
    s.cells[k] = { value: val, styleId: styleId && styleId > 0 ? styleId : undefined };
    if (val.startsWith('=')) {
      s.formulaDeps.set(k, parseFormulaRefs(val.slice(1), s.colCount, s.rowCount));
    } else {
      s.formulaDeps.clear(k);
    }
    s.formulaDeps.markDirty(k);
  }

  function copyToClipboard() {
    const sel = s.selection.value;
    if (!sel) return;
    copySourceRange = { ...sel };
    captureStyles(sel.startCol, sel.endCol, sel.startRow, sel.endRow);
    const ls: string[] = [];
    for (let r = sel.startRow; r <= sel.endRow; r++) {
      const row: string[] = [];
      for (let c = sel.startCol; c <= sel.endCol; c++) row.push(s.getCellRaw(c, r));
      ls.push(row.join('\t'));
    }
    writeClipboardText(ls.join('\n'));
  }

  function copyRowCol() {
    const sel = s.selection.value;
    if (!sel) return;
    if (sel.startCol === 0 && sel.endCol === s.colCount - 1) {
      copySourceRange = { ...sel };
      captureStyles(0, s.colCount - 1, sel.startRow, sel.endRow);
      const ls: string[] = [];
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        const row: string[] = [];
        for (let c = 0; c < s.colCount; c++) row.push(s.getCellRaw(c, r));
        ls.push(row.join('\t'));
      }
      writeClipboardText(ls.join('\n'));
    } else if (sel.startRow === 0 && sel.endRow === s.rowCount - 1) {
      copySourceRange = { ...sel };
      captureStyles(sel.startCol, sel.endCol, 0, s.rowCount - 1);
      const ls: string[] = [];
      for (let r = 0; r < s.rowCount; r++) {
        const row: string[] = [];
        for (let c = sel.startCol; c <= sel.endCol; c++) row.push(s.getCellRaw(c, r));
        ls.push(row.join('\t'));
      }
      writeClipboardText(ls.join('\n'));
    }
  }

  async function pasteFromClipboard() {
    let txt: string;
    try {
      txt = await navigator.clipboard.readText();
    } catch {
      return;
    }
    if (!txt && txt !== '') return;
    const lines = txt.split(/\r?\n/);
    const ac = s.activeCell.value;
    const src = copySourceRange;
    const hasSrcStyles = src && copySourceStyles.length > 0;
    for (let r = 0; r < lines.length; r++) {
      const cols = lines[r]!.split('\t');
      for (let c = 0; c < cols.length; c++) {
        const tc = ac.col + c;
        const tr = ac.row + r;
        if (tc < s.colCount && tr < s.rowCount) {
          let val = cols[c]!;
          if (val.startsWith('=') && src) {
            val = shiftFormulaRefs(
              val,
              tc - (src.startCol + c),
              tr - (src.startRow + r),
              s.colCount, s.rowCount, colToLabel,
            );
          }
          if (hasSrcStyles && r < copySourceStyles.length && c < (copySourceStyles[r]?.length ?? 0)) {
            const srcStyle = copySourceStyles[r]![c] ?? null;
            setCellWithStyle(tc, tr, val, srcStyle);
            syncCellBorders(tc, tr);
          } else {
            s.setCellValue(tc, tr, val);
          }
        }
      }
    }
  }

  function cutSelected() {
    us.saveUndo();
    copyToClipboard();
    if (s.selection.value) {
      const sel = s.selection.value;
      s.clearCellsInRange(sel.startCol, sel.endCol, sel.startRow, sel.endRow);
      s.scheduleRender?.();
    }
  }

  function clearSelected() {
    if (s.selection.value) {
      const sel = s.selection.value;
      s.clearCellsInRange(sel.startCol, sel.endCol, sel.startRow, sel.endRow);
      s.scheduleRender?.();
    }
  }

  // ============ 求和 ============
  function sumSelected() {
    const sel = s.selection.value;
    if (!sel) return;
    us.saveUndo();
    const sc = sel.startCol, sr = sel.startRow, ec = sel.endCol, er = sel.endRow;
    if (sr === er) {
      if (ec + 1 < s.colCount) {
        const rangeRef = `${colToLabel(sc)}${sr + 1}:${colToLabel(ec)}${sr + 1}`;
        s.setCellValue(ec + 1, sr, `=SUM(${rangeRef})`);
      } else {
        const rangeRef = `${colToLabel(sc)}${sr + 1}:${colToLabel(ec - 1)}${sr + 1}`;
        s.setCellValue(ec, sr, `=SUM(${rangeRef})`);
      }
    } else {
      for (let c = sc; c <= ec; c++) {
        if (er + 1 < s.rowCount) {
          const rangeRef = `${colToLabel(c)}${sr + 1}:${colToLabel(c)}${er + 1}`;
          s.setCellValue(c, er + 1, `=SUM(${rangeRef})`);
        } else {
          const rangeRef = `${colToLabel(c)}${sr + 1}:${colToLabel(c)}${er}`;
          s.setCellValue(c, er, `=SUM(${rangeRef})`);
        }
      }
    }
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  // ============ 平均值 ============
  function avgSelected() {
    const sel = s.selection.value;
    if (!sel) return;
    us.saveUndo();
    const sc = sel.startCol, sr = sel.startRow, ec = sel.endCol, er = sel.endRow;
    if (sr === er) {
      if (ec + 1 < s.colCount) {
        const rangeRef = `${colToLabel(sc)}${sr + 1}:${colToLabel(ec)}${sr + 1}`;
        s.setCellValue(ec + 1, sr, `=AVERAGE(${rangeRef})`);
      } else {
        const rangeRef = `${colToLabel(sc)}${sr + 1}:${colToLabel(ec - 1)}${sr + 1}`;
        s.setCellValue(ec, sr, `=AVERAGE(${rangeRef})`);
      }
    } else {
      for (let c = sc; c <= ec; c++) {
        if (er + 1 < s.rowCount) {
          const rangeRef = `${colToLabel(c)}${sr + 1}:${colToLabel(c)}${er + 1}`;
          s.setCellValue(c, er + 1, `=AVERAGE(${rangeRef})`);
        } else {
          const rangeRef = `${colToLabel(c)}${sr + 1}:${colToLabel(c)}${er}`;
          s.setCellValue(c, er, `=AVERAGE(${rangeRef})`);
        }
      }
    }
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  // ============ 计数 ============
  function countSelected() {
    const sel = s.selection.value;
    if (!sel) return;
    us.saveUndo();
    const sc = sel.startCol, sr = sel.startRow, ec = sel.endCol, er = sel.endRow;
    if (sr === er) {
      if (ec + 1 < s.colCount) {
        const rangeRef = `${colToLabel(sc)}${sr + 1}:${colToLabel(ec)}${sr + 1}`;
        s.setCellValue(ec + 1, sr, `=COUNT(${rangeRef})`);
      } else {
        const rangeRef = `${colToLabel(sc)}${sr + 1}:${colToLabel(ec - 1)}${sr + 1}`;
        s.setCellValue(ec, sr, `=COUNT(${rangeRef})`);
      }
    } else {
      for (let c = sc; c <= ec; c++) {
        if (er + 1 < s.rowCount) {
          const rangeRef = `${colToLabel(c)}${sr + 1}:${colToLabel(c)}${er + 1}`;
          s.setCellValue(c, er + 1, `=COUNT(${rangeRef})`);
        } else {
          const rangeRef = `${colToLabel(c)}${sr + 1}:${colToLabel(c)}${er}`;
          s.setCellValue(c, er, `=COUNT(${rangeRef})`);
        }
      }
    }
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  // ============ 计算下拉框 ============
  const calcMenuOpen = ref(false);
  function onCalcMenuToggle(v: boolean) {
    calcMenuOpen.value = v;
    if (v) {
      us.textColorMenuOpen.value = false;
      us.fillColorMenuOpen.value = false;
      borderMenuOpen.value = false;
      us.fontSizeMenuOpen.value = false;
      mergeMenuOpen.value = false;
    }
  }
  function onCalcSum() {
    sumSelected();
    calcMenuOpen.value = false;
  }
  function onCalcAvg() {
    avgSelected();
    calcMenuOpen.value = false;
  }
  function onCalcCount() {
    countSelected();
    calcMenuOpen.value = false;
  }

  return {
    cachedBorder,
    borderMenuOpen,
    BORDER_COLOR,
    borderTypeToWidths,
    onBorderChange,
    setCellBorderSide,
    syncCellBorders,
    applyBorderToCell,
    applyCachedBorder,
    cellBorderWidth,

    mergeMenuOpen,
    onMergeMenuToggle,
    removeOverlappingMerges,
    mergeAndCenter,
    mergeAcross,
    mergeCells,
    unmergeCells,
    onApplyMerge,
    onMergeChange,

    copySourceRange: null as SelectionRange | null,
    copySourceStyles: [] as number[][],
    captureStyles,
    setCellWithStyle,
    copyToClipboard,
    copyRowCol,
    pasteFromClipboard,
    cutSelected,
    clearSelected,

    sumSelected,
    avgSelected,
    countSelected,

    calcMenuOpen,
    onCalcMenuToggle,
    onCalcSum,
    onCalcAvg,
    onCalcCount,
  };
}
