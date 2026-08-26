import { ref, type Ref } from 'vue';
import { colToLabel, writeClipboardText } from '../core/utils';
import { clearEvalCache, parseFormulaRefs, shiftFormulaRefs } from '../core/formula';
import type { CoreState } from './core-state';
import type { UndoStylesState } from './undo-styles';
import type { BorderType } from '../components/pickers/borderPicker.vue';
import type { MergeType } from '../core/constants';
import type { SelectionRange, BorderStyle, BorderSide } from '../core/types';
import { setCellBorderSide as _setCellBorderSidePool } from '../core/border-pool';

// ============ 共享 BordersMerge 接口 ============
export interface BordersMergeState {
  // 边框
  cachedBorder: Ref<BorderType>;
  borderMenuOpen: Ref<boolean>;
  BORDER_COLOR: string;
  onBorderChange: (bt: BorderType) => void;
  setCellBorderSide: (col: number, row: number, side: 'top' | 'right' | 'bottom' | 'left', borderSide: BorderSide | undefined) => void;
  applyBorderToCell: (col: number, row: number, border: BorderStyle) => void;
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

  function setCellBorderSideNew(col: number, row: number, side: 'top' | 'right' | 'bottom' | 'left', borderSide: BorderSide | undefined) {
    if (col < 0 || row < 0 || col >= s.colCount || row >= s.rowCount) return;
    // 如果目标 cell 在 merge 内部，重定向到 merge anchor
    const m = s.findMerge(col, row);
    const targetKey = m ? m.anchor : s.cellKey(col, row);
    const cell = s.cells[targetKey];
    if (!cell) {
      if (!borderSide) return;
      s.cells[targetKey] = { value: '' };
    }
    _setCellBorderSidePool(s.cells[targetKey]!, side, borderSide, s.styles, {
      get: (id) => s.resolveBorder(id),
      getId: (b) => s.registerBorder(b),
    }, s.registerStyle);
  }

  function applyBorderToCell(col: number, row: number, border: BorderStyle) {
    const m = s.findMerge(col, row);
    const k = m ? m.anchor : s.cellKey(col, row);
    const val = s.cells[k]?.value ?? '';
    const st = s.resolveStyle(s.cells[k]) ? { ...s.resolveStyle(s.cells[k])! } : {};
    const borderId = s.registerBorder(border);
    if (borderId > 0) {
      st.borderId = borderId;
    } else {
      delete st.borderId;
    }
    // 清理旧版边框属性
    delete st.borderTopWidth;
    delete st.borderBottomWidth;
    delete st.borderLeftWidth;
    delete st.borderRightWidth;
    delete st.borderColor;
    if (val === '' && !Object.keys(st).length) s.delCell(k);
    else {
      const styleId = s.registerStyle(st);
      s.cells[k] = { value: val, styleId: styleId || undefined };
    }
  }

  function onBorderChange(bt: BorderType) {
    cachedBorder.value = bt;
    const sel = s.selection.value;
    if (!sel) return;
    us.saveUndo();

    const { startCol: sC, startRow: sR, endCol: eC, endRow: eR } = sel;
    const borderSide: BorderSide = { width: 1, color: BORDER_COLOR };
    const thickBorderSide: BorderSide = { width: 2, color: BORDER_COLOR };

    if (bt === 'none') {
      // 清除：每个 cell 独立清除四边
      for (let c = sC; c <= eC; c++) {
        for (let r = sR; r <= eR; r++) {
          const m = s.findMerge(c, r);
          if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
          applyBorderToCell(c, r, {});
        }
      }
    } else if (bt === 'all') {
      // 全部边框：每个 cell 独立设置四边
      for (let c = sC; c <= eC; c++) {
        for (let r = sR; r <= eR; r++) {
          const m = s.findMerge(c, r);
          if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
          applyBorderToCell(c, r, { top: borderSide, right: borderSide, bottom: borderSide, left: borderSide });
        }
      }
    } else if (bt === 'outer' || bt === 'thickOuter') {
      const bs = bt === 'thickOuter' ? thickBorderSide : borderSide;
      // 外框：只修改选区真正边界上的 cell side
      // Top row
      for (let c = sC; c <= eC; c++) setCellBorderSideNew(c, sR, 'top', bs);
      // Bottom row
      for (let c = sC; c <= eC; c++) setCellBorderSideNew(c, eR, 'bottom', bs);
      // Left col
      for (let r = sR; r <= eR; r++) setCellBorderSideNew(sC, r, 'left', bs);
      // Right col
      for (let r = sR; r <= eR; r++) setCellBorderSideNew(eC, r, 'right', bs);
    } else {
      // 单边：top/bottom/left/right
      const sideMap: Record<string, { side: 'top' | 'right' | 'bottom' | 'left'; edgeCheck: (c: number, r: number) => boolean }> = {
        top: { side: 'top', edgeCheck: (_c, r) => r === sR },
        bottom: { side: 'bottom', edgeCheck: (_c, r) => r === eR },
        left: { side: 'left', edgeCheck: (c, _r) => c === sC },
        right: { side: 'right', edgeCheck: (c, _r) => c === eC },
      };
      const info = sideMap[bt];
      if (info) {
        for (let c = sC; c <= eC; c++) {
          for (let r = sR; r <= eR; r++) {
            if (info.edgeCheck(c, r)) {
              setCellBorderSideNew(c, r, info.side, borderSide);
            }
          }
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
    const sideLower = side.toLowerCase() as 'top' | 'bottom' | 'left' | 'right';
    const m = s.findMerge(col, row);
    if (m) {
      // 只有处于 merge 边界时才返回 anchor 的对应边
      if (sideLower === 'top' && row !== m.range.startRow) return 0;
      if (sideLower === 'bottom' && row !== m.range.endRow) return 0;
      if (sideLower === 'left' && col !== m.range.startCol) return 0;
      if (sideLower === 'right' && col !== m.range.endCol) return 0;
      const bs = s.getCellBorderSide(s.cells[m.anchor], sideLower);
      return bs?.width ?? 0;
    }
    const bs = s.getCellBorderSide(s.cells[s.cellKey(col, row)], sideLower);
    return bs?.width ?? 0;
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
    // 先按粘贴目标右下角扩展逻辑范围，避免被固定边界截断
    const cols = lines.map((l) => l.split('\t').length);
    const maxCols = cols.length ? Math.max(...cols) : 0;
    const targetCol = ac.col + maxCols - 1;
    const targetRow = ac.row + lines.length - 1;
    if (targetCol >= 0 && targetRow >= 0) s.ensureCapacity(targetCol, targetRow);
    for (let r = 0; r < lines.length; r++) {
      const cs = lines[r]!.split('\t');
      for (let c = 0; c < cs.length; c++) {
        const tc = ac.col + c;
        const tr = ac.row + r;
        let val = cs[c]!;
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
        } else {
          s.setCellValue(tc, tr, val);
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
    onBorderChange,
    setCellBorderSide: setCellBorderSideNew,
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
