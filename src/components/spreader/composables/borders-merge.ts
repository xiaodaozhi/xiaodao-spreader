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
  copySourceStyles: (Record<string, unknown> | null)[][];
  captureStyles: (cS: number, cE: number, rS: number, rE: number) => void;
  setCellWithStyle: (c: number, r: number, val: string, style: Record<string, unknown> | null) => void;
  copyToClipboard: () => void;
  copyRowCol: () => void;
  pasteFromClipboard: () => Promise<void>;
  cutSelected: () => void;
  clearSelected: () => void;

  // 求和
  sumSelected: () => void;
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
      if (side === 'Top' && row !== m.range.startRow) return;
      if (side === 'Bottom' && row !== m.range.endRow) return;
      if (side === 'Left' && col !== m.range.startCol) return;
      if (side === 'Right' && col !== m.range.endCol) return;
    }
    const k = m ? m.anchor : s.cellKey(col, row);
    const val = s.cells[k]?.value ?? '';
    const st = s.cells[k]?.style ? { ...s.cells[k]!.style } : {};
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
    const style = Object.keys(st).length ? st : null;
    if (val === '' && style === null) s.delCell(k);
    else s.cells[k] = { value: val, style };
  }

  function syncCellBorders(col: number, row: number) {
    const m = s.findMerge(col, row);
    const k = m ? m.anchor : s.cellKey(col, row);
    const st = s.cells[k]?.style;
    const wT = (st?.borderTopWidth as number) || 0;
    const wB = (st?.borderBottomWidth as number) || 0;
    const wL = (st?.borderLeftWidth as number) || 0;
    const wR = (st?.borderRightWidth as number) || 0;
    setCellBorderSide(col, row - 1, 'Bottom', wT, true);
    setCellBorderSide(col, row + 1, 'Top', wB, true);
    setCellBorderSide(col - 1, row, 'Right', wL, true);
    setCellBorderSide(col + 1, row, 'Left', wR, true);
  }
  // 反向注入到 core-state
  s.syncCellBorders = syncCellBorders;

  function applyBorderToCell(col: number, row: number, w: { top: number; bottom: number; left: number; right: number }, clearZero: boolean = true) {
    const k = s.cellKey(col, row);
    const val = s.cells[k]?.value ?? '';
    const st = s.cells[k]?.style ? { ...s.cells[k]!.style } : {};
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
    const style = Object.keys(st).length ? st : null;
    if (val === '' && style === null) s.delCell(k);
    else s.cells[k] = { value: val, style };
    syncCellBorders(col, row);
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
      const anchorStyle = s.cells[m.anchor]?.style;
      if (side === 'Top' && row === m.range.startRow) return (anchorStyle?.borderTopWidth as number) || 0;
      if (side === 'Bottom' && row === m.range.endRow) return (anchorStyle?.borderBottomWidth as number) || 0;
      if (side === 'Left' && col === m.range.startCol) return (anchorStyle?.borderLeftWidth as number) || 0;
      if (side === 'Right' && col === m.range.endCol) return (anchorStyle?.borderRightWidth as number) || 0;
      return 0;
    }
    const st = s.cells[s.cellKey(col, row)]?.style;
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
    const st = s.cells[anchorKey]?.style ? { ...s.cells[anchorKey]!.style } : {};
    st.textAlign = 'center';
    s.cells[anchorKey] = { value: anchorVal, style: st };
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
  let copySourceStyles: (Record<string, unknown> | null)[][] = [];

  function captureStyles(cS: number, cE: number, rS: number, rE: number) {
    copySourceStyles = [];
    for (let r = rS; r <= rE; r++) {
      const row: (Record<string, unknown> | null)[] = [];
      for (let c = cS; c <= cE; c++) {
        const st = s.cells[s.cellKey(c, r)]?.style;
        row.push(st ? { ...st } : null);
      }
      copySourceStyles.push(row);
    }
  }

  function setCellWithStyle(c: number, r: number, val: string, style: Record<string, unknown> | null) {
    const k = s.cellKey(c, r);
    clearEvalCache();
    if (val === '' || val == null) {
      s.formulaDeps.clear(k);
      if (style) {
        s.cells[k] = { value: '', style: { ...style } };
      } else {
        s.delCell(k);
      }
      s.formulaDeps.markDirty(k);
      return;
    }
    s.cells[k] = { value: val, style: style ? { ...style } : null };
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
    copySourceStyles: [] as (Record<string, unknown> | null)[][],
    captureStyles,
    setCellWithStyle,
    copyToClipboard,
    copyRowCol,
    pasteFromClipboard,
    cutSelected,
    clearSelected,

    sumSelected,
  };
}
