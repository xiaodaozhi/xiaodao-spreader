import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, type Ref, type ComputedRef } from 'vue';
import { HEADER_HEIGHT, HEADER_WIDTH, SB_SIZE, DEFAULT_COL_WIDTH, MIN_COL_WIDTH, MIN_ROW_HEIGHT, MAX_COL_WIDTH, MAX_ROW_HEIGHT, DEFAULT_FONT_FAMILY, t } from '../core/constants';
import { colToLabel, resolveSize, getCanvasXY } from '../core/utils';
import type { CoreState } from './core-state';
import type { UndoStylesState } from './undo-styles';
import type { BordersMergeState } from './borders-merge';
import type { SheetsOpsState } from './sheets-ops';
import type { ContextMenuItem } from '../core/types';

export interface InteractionsState {
  // 渲染器
  scheduleRender: () => void;
  render: () => void;

  // 编辑栏
  activeCellLabel: ComputedRef<string>;
  formulaBarDisplay: ComputedRef<string>;
  onFormulaBarFocus: () => void;
  onFormulaBarInput: (e: Event) => void;
  onFormulaBarKeydown: (e: KeyboardEvent) => void;
  onFormulaBarBlur: () => void;

  // Tab 栏
  renTab: Ref<number | null>;
  renTabVal: Ref<string>;
  onTabClick: (i: number) => void;
  onTabDblClick: (i: number) => void;
  commitTabRename: () => void;
  cclTabRename: () => void;
  onTabRenameKd: (e: KeyboardEvent) => void;

  // 右键菜单
  ctxMenu: Ref<{ x: number; y: number; items: ContextMenuItem[] } | null>;
  ctxSubmenuLeft: Ref<boolean>;
  onCtxItemEnter: (e: MouseEvent, item: ContextMenuItem) => void;
  onTabCtxMenu: (e: MouseEvent, i: number) => void;
  onTabBarCtx: (e: MouseEvent) => void;
  onCornerCtx: (e: MouseEvent) => void;
  onRowHdrCtx: (e: MouseEvent, row: number) => void;
  onColHdrCtx: (e: MouseEvent, col: number) => void;
  onCellCtx: (e: MouseEvent, c: number, r: number) => void;

  // 行高/列宽浮动设置栏
  dimInputRef: Ref<HTMLInputElement | null>;
  dimPanel: Ref<{ type: 'row' | 'col'; x: number; y: number; value: string; error: string } | null>;
  openDimPanel: (type: 'row' | 'col', x: number, y: number) => void;
  onDimInput: (e: Event) => void;
  onDimKeydown: (e: KeyboardEvent) => void;
  onDimBlur: () => void;
  applyDimPanel: () => void;
  closeDimPanel: () => void;

  // 编辑输入框 CSS
  editInputStyle: ComputedRef<Record<string, string | number | undefined>>;

  // 滚动条
  hScrollbarW: ComputedRef<number>;
  vScrollbarH: ComputedRef<number>;
  hTrackW: ComputedRef<number>;
  vTrackH: ComputedRef<number>;
  hThumbW: ComputedRef<number>;
  hThumbL: ComputedRef<number>;
  vThumbH: ComputedRef<number>;
  vThumbT: ComputedRef<number>;
  onVStart: (e: MouseEvent) => void;
  onHStart: (e: MouseEvent) => void;
  onSbMove: (e: MouseEvent) => void;
  onSbUp: () => void;
  onVTrk: (e: MouseEvent) => void;
  onHTrk: (e: MouseEvent) => void;

  // 鼠标/触屏 状态变量
  onMouseDown: (e: MouseEvent) => void;
  onMouseMove: (e: MouseEvent) => void;
  onMouseUp: (e: MouseEvent) => void;
  onMouseLeave: () => void;
  onCanvasCtx: (e: MouseEvent) => void;
  onDblClick: (e: MouseEvent) => void;
  onWheel: (e: WheelEvent) => void;
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: () => void;

  // 键盘
  onKeydown: (e: KeyboardEvent) => void;

  // 编辑框
  onEditInput: (e: Event) => void;
  onEditCompositionStart: () => void;
  onEditCompositionEnd: (e: CompositionEvent) => void;
  onEditKd: (e: KeyboardEvent) => void;
  onEditPaste: (e: ClipboardEvent) => void;
  onEditBlur: () => void;

  // 尺寸 / 生命周期
  applySize: () => void;
  setupLifecycle: () => void;
}

export function createInteractions(
  s: CoreState,
  us: UndoStylesState,
  bm: BordersMergeState,
  so: SheetsOpsState,
  lastEmittedDataRef: { value: string },
): InteractionsState {
  // ============ 渲染器 ============
  let rp = false;
  let rCtx: CanvasRenderingContext2D | null = null;
  let rDpr = 1;

  function scheduleRender() {
    if (!rp) {
      rp = true;
      requestAnimationFrame(() => {
        rp = false;
        render();
      });
    }
  }
  // 反向注入到 core-state
  s.scheduleRender = scheduleRender;

  const BORDER_COLOR = '#444';

  function render() {
    const cvs = so.canvasRef.value;
    if (!cvs) return;
    const wrapper = so.wrapperRef.value;
    if (!wrapper) return;
    rCtx = cvs.getContext('2d');
    if (!rCtx) return;
    rDpr = window.devicePixelRatio || 1;
    const rect = wrapper.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    so.viewSize.w = W;
    so.viewSize.h = H;
    cvs.width = W * rDpr;
    cvs.height = H * rDpr;
    cvs.style.width = W + 'px';
    cvs.style.height = H + 'px';
    rCtx.setTransform(rDpr, 0, 0, rDpr, 0, 0);
    const sx = s.scrollX.value;
    const sy = s.scrollY.value;
    const HW = HEADER_WIDTH;
    const HH = HEADER_HEIGHT;
    const cs = so.themeColors.value;
    const cP = s.colPositions.value;
    const rP = s.rowPositions.value;
    const cW = s.colWidths.value;
    const rH: number[] = [];
    for (let i = 0; i < s.rowCount; i++) {
      rH[i] = rP[i + 1]! - rP[i]!;
    }

    const sC = Math.max(0, s.hitCol(sx));
    let eC2 = sC;
    for (let c = sC; c < s.colCount; c++) {
      if (HW + cP[c]! - sx >= W) break;
      eC2 = c;
    }
    const eC = eC2;
    const sR = Math.max(0, s.hitRow(sy));
    let eR2 = sR;
    for (let r = sR; r < s.rowCount; r++) {
      if (HH + rP[r]! - sy >= H) break;
      eR2 = r;
    }
    const eR = eR2;

    // 合并单元格的内容只在锚点处绘制；若锚点被滚出可视区域而合并区域仍与可视区相交，
    // 需要把循环起点回退到锚点位置，否则该合并区域会整体消失（Bug 修复）
    let iterC = sC;
    let iterR = sR;
    for (const key in s.merges) {
      const m = s.merges[key];
      if (!m) continue;
      // 仅处理与可视区域相交、且锚点位于可视起点之前的合并区域
      if (m.startRow > eR || m.endRow < sR || m.startCol > eC || m.endCol < sC) continue;
      if (m.startCol < iterC) iterC = m.startCol;
      if (m.startRow < iterR) iterR = m.startRow;
    }

    rCtx.fillStyle = cs.bg;
    rCtx.fillRect(0, 0, W, H);
    rCtx.fillStyle = cs.gridBg;
    rCtx.fillRect(HW, HH, W - HW, H - HH);

    rCtx.save();
    rCtx.beginPath();
    rCtx.rect(HW, HH, W - HW, H - HH);
    rCtx.clip();
    const sel = s.selection.value;
    const ed = s.editingCell.value;

    // 第一步：绘制背景色、选中状态、文本内容
    for (let row = iterR; row <= eR; row++) {
      for (let col = iterC; col <= eC; col++) {
        const mergeInfo = s.findMerge(col, row);
        if (mergeInfo && !(col === mergeInfo.range.startCol && row === mergeInfo.range.startRow)) {
          continue;
        }
        const x = HW + cP[col]! - sx;
        const y = HH + rP[row]! - sy;
        let cw = cW[col]!;
        let rh = rH[row]!;
        if (mergeInfo) {
          cw = cP[mergeInfo.range.endCol + 1]! - cP[col]!;
          rh = rP[mergeInfo.range.endRow + 1]! - rP[row]!;
        }
        if (x + cw < HW || y + rh < HH || x > W || y > H) continue;

        const stBg = s.cells[s.cellKey(col, row)]?.style;
        const bgColor = typeof stBg?.backgroundColor === 'string' ? stBg.backgroundColor : '';
        if (bgColor) {
          rCtx.fillStyle = bgColor;
          rCtx.fillRect(x, y, cw, rh);
        }
        if (s.isSelected(col, row)) {
          rCtx.fillStyle = cs.selectionBg;
          rCtx.fillRect(x, y, cw, rh);
        }
        if (s.activeCell.value.col === col && s.activeCell.value.row === row) {
          rCtx.strokeStyle = cs.activeCellBorder;
          rCtx.lineWidth = 2;
          rCtx.strokeRect(x + 1, y + 1, cw - 2, rh - 2);
        }
        rCtx.strokeStyle = cs.gridLine;
        rCtx.lineWidth = 0.5;
        rCtx.strokeRect(x + 0.25, y + 0.25, cw - 0.5, rh - 0.5);
        if (!(ed && ed.col === col && ed.row === row)) {
          const v = s.getCellValue(col, row);
          if (v) {
            const st = s.cells[s.cellKey(col, row)]?.style;
            const fsz = s.cellFontSize(col, row);
            const ffa = typeof st?.fontFamily === 'string' && st.fontFamily ? st.fontFamily : DEFAULT_FONT_FAMILY;
            const fw = st?.fontWeight === 'bold' ? 'bold' : 'normal';
            const fstyle = st?.fontStyle === 'italic' ? 'italic' : 'normal';
            const hasU = st?.underline === 'underline';
            const hasS = st?.strikethrough === 'line-through';
            const txtColor = typeof st?.color === 'string' ? st.color : '';
            const hAlign = typeof st?.textAlign === 'string' ? st.textAlign : 'left';
            const vAlign = typeof st?.verticalAlign === 'string' ? st.verticalAlign : 'top';
            rCtx.fillStyle = txtColor || cs.cellText;
            rCtx.font = `${fstyle} ${fw} ${fsz}px ${ffa}`;
            rCtx.textBaseline = 'alphabetic';
            rCtx.save();
            rCtx.beginPath();
            rCtx.rect(x + 5, y + 1, cw - 10, rh - 2);
            rCtx.clip();
            const stWrap = st?.wrap === 'wrap';
            const textLines = s.getWrappedLines(rCtx, v, cw - 10, stWrap);
            let maxAsc = 0;
            let maxDesc = 0;
            for (const line of textLines) {
              const m = rCtx.measureText(line);
              const rawAsc = m.actualBoundingBoxAscent;
              const rawDesc = m.actualBoundingBoxDescent;
              const a = rawAsc || fsz * 0.8;
              const d = rawDesc || fsz * 0.2;
              maxAsc = Math.max(maxAsc, a);
              maxDesc = Math.max(maxDesc, d);
            }
            maxAsc = Math.max(maxAsc, fsz * 0.5);
            maxDesc = Math.max(maxDesc, fsz * 0.15);
            const lineH = fsz;
            const totalH = textLines.length * lineH;
            let ty: number;
            if (vAlign === 'middle') ty = y + (rh - totalH) / 2 + maxAsc;
            else if (vAlign === 'bottom') ty = y + rh - s.BASE_CELL_VPAD - maxDesc - (textLines.length - 1) * lineH;
            else ty = y + s.BASE_CELL_VPAD + maxAsc;
            for (let li = 0; li < textLines.length; li++) {
              const line = textLines[li]!;
              const lineTy = ty + li * lineH;
              const m = rCtx.measureText(line);
              let tx: number;
              if (hAlign === 'center') tx = x + cw / 2 - m.width / 2;
              else if (hAlign === 'right') tx = x + cw - 5 - m.width;
              else tx = x + 5;
              rCtx.fillText(line, tx, lineTy);
              if (hasU) {
                rCtx.strokeStyle = txtColor || cs.cellText;
                rCtx.lineWidth = 1;
                rCtx.beginPath();
                rCtx.moveTo(tx, lineTy + maxDesc + 1);
                rCtx.lineTo(tx + m.width, lineTy + maxDesc + 1);
                rCtx.stroke();
              }
              if (hasS) {
                rCtx.strokeStyle = txtColor || cs.cellText;
                rCtx.lineWidth = 1;
                const midY = lineTy - lineH * 0.25;
                rCtx.beginPath();
                rCtx.moveTo(tx, midY);
                rCtx.lineTo(tx + m.width, midY);
                rCtx.stroke();
              }
            }
            rCtx.restore();
          }
        }
      }
    }

    // 第二步：绘制边框
    for (let row = iterR; row <= eR; row++) {
      for (let col = iterC; col <= eC; col++) {
        const mergeInfo = s.findMerge(col, row);
        if (mergeInfo && !(col === mergeInfo.range.startCol && row === mergeInfo.range.startRow)) continue;
        const x = HW + cP[col]! - sx;
        const y = HH + rP[row]! - sy;
        let cw = cW[col]!;
        let rh = rH[row]!;
        if (mergeInfo) {
          cw = cP[mergeInfo.range.endCol + 1]! - cP[col]!;
          rh = rP[mergeInfo.range.endRow + 1]! - rP[row]!;
        }
        if (x + cw < HW || y + rh < HH || x > W || y > H) continue;

        const cst = s.cells[s.cellKey(col, row)]?.style;
        const ownT = (cst?.borderTopWidth as number) || 0;
        const ownL = (cst?.borderLeftWidth as number) || 0;
        const ownB = (cst?.borderBottomWidth as number) || 0;
        const ownR = (cst?.borderRightWidth as number) || 0;
        const wT = Math.max(ownT, bm.cellBorderWidth(col, row - 1, 'Bottom'));
        const wL = Math.max(ownL, bm.cellBorderWidth(col - 1, row, 'Right'));
        const wB = Math.max(ownB, bm.cellBorderWidth(col, row + 1, 'Top'));
        const wR = Math.max(ownR, bm.cellBorderWidth(col + 1, row, 'Left'));

        if (wT > 0 || wL > 0 || wB > 0 || wR > 0) {
          rCtx.fillStyle = BORDER_COLOR;
          if (wT > 0) rCtx.fillRect(x, y, cw, wT);
          if (wB > 0) rCtx.fillRect(x, y + rh - wB, cw, wB);
          if (wL > 0) rCtx.fillRect(x, y, wL, rh);
          if (wR > 0) rCtx.fillRect(x + cw - wR, y, wR, rh);
        }
      }
    }

    // 第三步：绘制角方块
    for (let row = iterR; row <= eR; row++) {
      for (let col = iterC; col <= eC; col++) {
        const mergeInfo = s.findMerge(col, row);
        if (mergeInfo && !(col === mergeInfo.range.startCol && row === mergeInfo.range.startRow)) continue;
        const x = HW + cP[col]! - sx;
        const y = HH + rP[row]! - sy;
        let cw = cW[col]!;
        let rh = rH[row]!;
        if (mergeInfo) {
          cw = cP[mergeInfo.range.endCol + 1]! - cP[col]!;
          rh = rP[mergeInfo.range.endRow + 1]! - rP[row]!;
        }
        if (x + cw < HW || y + rh < HH || x > W || y > H) continue;

        const ownT = (s.cells[s.cellKey(col, row)]?.style?.borderTopWidth as number) || 0;
        const ownL = (s.cells[s.cellKey(col, row)]?.style?.borderLeftWidth as number) || 0;
        const ownB = (s.cells[s.cellKey(col, row)]?.style?.borderBottomWidth as number) || 0;
        const ownR = (s.cells[s.cellKey(col, row)]?.style?.borderRightWidth as number) || 0;
        const wT = Math.max(ownT, bm.cellBorderWidth(col, row - 1, 'Bottom'));
        const wL = Math.max(ownL, bm.cellBorderWidth(col - 1, row, 'Right'));
        const wB = Math.max(ownB, bm.cellBorderWidth(col, row + 1, 'Top'));
        const wR = Math.max(ownR, bm.cellBorderWidth(col + 1, row, 'Left'));

        rCtx.fillStyle = BORDER_COLOR;
        if (wT > 0 && wL > 0) rCtx.fillRect(x - wL, y - wT, wL, wT);
        if (wT > 0 && wR > 0) rCtx.fillRect(x + cw, y - wT, wR, wT);
        if (wB > 0 && wL > 0) rCtx.fillRect(x - wL, y + rh, wL, wB);
        if (wB > 0 && wR > 0) rCtx.fillRect(x + cw, y + rh, wR, wB);
      }
    }
    rCtx.restore();

    // 列标题
    rCtx.fillStyle = cs.headerBg;
    rCtx.fillRect(HW, 0, W - HW, HH);
    for (let col = sC; col <= eC; col++) {
      const x = HW + cP[col]! - sx, cw = cW[col]!;
      if (x + cw < HW || x > W) continue;
      if (sel && col >= sel.startCol && col <= sel.endCol) {
        rCtx.fillStyle = cs.selectionBg;
        rCtx.fillRect(x, 0, cw, HH);
      }
      rCtx.strokeStyle = cs.headerBorder;
      rCtx.lineWidth = 0.5;
      rCtx.strokeRect(x + 0.25, 0.25, cw - 0.5, HH - 0.5);
      if (sel && col >= sel.startCol && col <= sel.endCol) {
        rCtx.strokeStyle = cs.activeCellBorder;
        rCtx.lineWidth = 2;
        rCtx.beginPath();
        rCtx.moveTo(x, HH - 1);
        rCtx.lineTo(x + cw, HH - 1);
        rCtx.stroke();
      }
      rCtx.fillStyle = cs.headerText;
      rCtx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      rCtx.textAlign = 'center';
      rCtx.textBaseline = 'middle';
      rCtx.fillText(colToLabel(col), x + cw / 2, HH / 2);
    }
    rCtx.strokeStyle = cs.headerSep;
    rCtx.lineWidth = 1;
    rCtx.beginPath();
    rCtx.moveTo(HW, HH + 0.5);
    rCtx.lineTo(W, HH + 0.5);
    rCtx.stroke();

    // 行标题
    rCtx.fillStyle = cs.headerBg;
    rCtx.fillRect(0, HH, HW, H - HH);
    for (let row = sR; row <= eR; row++) {
      const y = HH + rP[row]! - sy, rh = rH[row]!;
      if (y + rh < HH || y > H) continue;
      if (sel && row >= sel.startRow && row <= sel.endRow) {
        rCtx.fillStyle = cs.selectionBg;
        rCtx.fillRect(0, y, HW, rh);
      }
      rCtx.strokeStyle = cs.headerBorder;
      rCtx.lineWidth = 0.5;
      rCtx.strokeRect(0.25, y + 0.25, HW - 0.5, rh - 0.5);
      if (sel && row >= sel.startRow && row <= sel.endRow) {
        rCtx.strokeStyle = cs.activeCellBorder;
        rCtx.lineWidth = 2;
        rCtx.beginPath();
        rCtx.moveTo(HW - 1, y);
        rCtx.lineTo(HW - 1, y + rh);
        rCtx.stroke();
      }
      rCtx.fillStyle = cs.headerText;
      rCtx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      rCtx.textAlign = 'center';
      rCtx.textBaseline = 'middle';
      rCtx.fillText(String(row + 1), HW / 2, y + rh / 2 + 0.5);
    }
    rCtx.strokeStyle = cs.headerSep;
    rCtx.lineWidth = 1;
    rCtx.beginPath();
    rCtx.moveTo(HW + 0.5, HH);
    rCtx.lineTo(HW + 0.5, H);
    rCtx.stroke();

    // 角格
    rCtx.fillStyle = cs.headerBg;
    rCtx.fillRect(0, 0, HW, HH);
    rCtx.strokeStyle = cs.headerSep;
    rCtx.lineWidth = 1;
    rCtx.strokeRect(0.5, 0.5, HW - 0.5, HH - 0.5);
  }

  // ============ 编辑栏 ============
  const activeCellLabel = computed(() => colToLabel(s.activeCell.value.col) + String(s.activeCell.value.row + 1));
  const formulaBarDisplay = computed(() => s.editingCell.value ? s.editValue.value : s.getCellRaw(s.activeCell.value.col, s.activeCell.value.row));

  function onFormulaBarFocus() {
    if (!s.editingCell.value) {
      s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
      s.editValue.value = s.getCellRaw(s.activeCell.value.col, s.activeCell.value.row);
      s.startEdit();
      scheduleRender();
    }
  }
  function onFormulaBarInput(e: Event) {
    s.editValue.value = (e.target as HTMLTextAreaElement).value;
  }
  function onFormulaBarKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      s.commitEdit();
      s.moveActive(0, 1);
      s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
      so.formulaBarRef.value?.blur();
      scheduleRender();
      so.focusEditInput();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      s.cancelEdit();
      so.formulaBarRef.value?.blur();
      scheduleRender();
      so.focusEditInput();
    }
  }
  function onFormulaBarBlur() {
    setTimeout(() => {
      if (s.editingCell.value) {
        s.commitEdit();
        scheduleRender();
      }
    }, 0);
  }

  // ============ Tab 栏 ============
  const renTab = ref<number | null>(null);
  const renTabVal = ref('');
  function onTabClick(i: number) {
    if (renTab.value !== null) return;
    so.switchSheet(i);
    scheduleRender();
  }
  function onTabDblClick(i: number) {
    if (i !== so.activeSheetIndex.value) {
      so.saveSheet();
      so.loadSheet(i);
      scheduleRender();
    }
    renTab.value = i;
    renTabVal.value = so.sheets.value[i]!.name;
    nextTick(() => {
      const inp = document.querySelector('.tab-rename-input') as HTMLInputElement;
      inp?.focus();
      inp?.select();
    });
  }
  function commitTabRename() {
    if (renTab.value !== null) {
      so.renameSheet(renTab.value, renTabVal.value);
      nextTick(() => so.emitModelData());
    }
    renTab.value = null;
    renTabVal.value = '';
  }
  function cclTabRename() {
    renTab.value = null;
    renTabVal.value = '';
  }
  function onTabRenameKd(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTabRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cclTabRename();
    }
  }

  // ============ 右键菜单 ============
  const ctxMenu = ref<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  let cdcHandler: (() => void) | null = null;
  function rdl() {
    if (cdcHandler) {
      document.removeEventListener('click', cdcHandler);
      cdcHandler = null;
    }
  }
  function showCtx(x: number, y: number, items: ContextMenuItem[]) {
    rdl();
    const mw = 140;
    const mh = items.length * 28 + 8;
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    if (x + mw > sw) x -= mw;
    if (y + mh > sh) y -= mh;
    ctxMenu.value = { x, y, items };
    cdcHandler = () => {
      ctxMenu.value = null;
      rdl();
    };
    setTimeout(() => document.addEventListener('click', cdcHandler!, { once: true }), 0);
  }
  const ctxSubmenuLeft = ref(false);
  function onCtxItemEnter(e: MouseEvent, item: ContextMenuItem) {
    if (!item.children) {
      ctxSubmenuLeft.value = false;
      return;
    }
    const el = e.currentTarget as HTMLElement;
    const sub = el.querySelector('.context-submenu') as HTMLElement | null;
    if (!sub) {
      ctxSubmenuLeft.value = false;
      return;
    }
    const subRect = sub.getBoundingClientRect();
    ctxSubmenuLeft.value = subRect.right > window.innerWidth;
  }

  function onTabCtxMenu(e: MouseEvent, i: number) {
    e.preventDefault();
    e.stopPropagation();
    showCtx(e.clientX, e.clientY, [
      { label: t(s.locale.value, 'insert'), action: () => {
        so.addSheet();
        scheduleRender();
      } },
      { label: t(s.locale.value, 'copy'), action: () => { so.dupSheet(i); } },
      { label: t(s.locale.value, 'rename'), action: () => { onTabDblClick(i); } },
      { label: t(s.locale.value, 'delete'), action: () => {
        so.removeSheet(i);
        scheduleRender();
      }, disabled: so.sheetCount.value <= 1 },
      { label: t(s.locale.value, 'moveSheetLeft'), action: () => { so.moveSheet(i, -1); }, disabled: i === 0 },
      { label: t(s.locale.value, 'moveSheetRight'), action: () => { so.moveSheet(i, 1); }, disabled: i === so.sheets.value.length - 1 },
    ]);
  }
  function onTabBarCtx(e: MouseEvent) {
    e.preventDefault();
    if ((e.target as HTMLElement).closest('.tab-item') || (e.target as HTMLElement).closest('.tab-bar__add-btn')) return;
    showCtx(e.clientX, e.clientY, [
      { label: t(s.locale.value, 'insert'), action: () => {
        so.addSheet();
        scheduleRender();
      } },
    ]);
  }
  function onCornerCtx(e: MouseEvent) {
    e.preventDefault();
    s.selectAll();
    scheduleRender();
    showCtx(e.clientX, e.clientY, [
      { label: t(s.locale.value, 'cut'), action: () => {
        bm.cutSelected();
        so.emitModelData();
      } },
      { label: t(s.locale.value, 'copy'), action: () => bm.copyToClipboard() },
      { label: t(s.locale.value, 'paste'), action: () => {
        us.saveUndo();
        bm.pasteFromClipboard().then(() => {
          scheduleRender();
          nextTick(() => so.emitModelData());
        });
      } },
      { label: t(s.locale.value, 'delete'), action: () => {
        us.saveUndo();
        bm.clearSelected();
        for (let c = 0; c < s.colCount; c++) {
          s.colWidths.value[c] = DEFAULT_COL_WIDTH;
        }
        for (let r = 0; r < s.rowCount; r++) {
          s.rowHeights.value[r] = undefined;
        }
        scheduleRender();
        so.emitModelData();
      } },
    ]);
  }
  function onRowHdrCtx(e: MouseEvent, row: number) {
    e.preventDefault();
    const mx = e.clientX, my = e.clientY;
    const sel = s.selection.value;
    if (!(sel && sel.startCol === 0 && sel.endCol === s.colCount - 1 && row >= sel.startRow && row <= sel.endRow)) {
      s.selectRange(0, row, s.colCount - 1, row);
      scheduleRender();
    }
    const s2 = s.selection.value!;
    showCtx(e.clientX, e.clientY, [
      { label: t(s.locale.value, 'insert'), action: () => {
        us.saveUndo();
        so.insertRows(s2.startRow, s2.endRow);
        scheduleRender();
        so.emitModelData();
      }, disabled: s2.endRow >= s.rowCount - 1 },
      { label: t(s.locale.value, 'cut'), action: () => {
        us.saveUndo();
        bm.copyRowCol();
        for (let r = s2.startRow; r <= s2.endRow; r++) {
          for (let c = 0; c < s.colCount; c++) {
            s.delCell(s.cellKey(c, r));
          }
        }
        scheduleRender();
        so.emitModelData();
      } },
      { label: t(s.locale.value, 'copy'), action: () => bm.copyRowCol() },
      { label: t(s.locale.value, 'paste'), action: () => {
        us.saveUndo();
        bm.pasteFromClipboard().then(() => {
          scheduleRender();
          nextTick(() => so.emitModelData());
        });
      } },
      { label: t(s.locale.value, 'delete'), action: () => {
        us.saveUndo();
        so.deleteRows(s2.startRow, s2.endRow);
        scheduleRender();
        so.emitModelData();
      } },
      { label: `${t(s.locale.value, 'rowHeight')}...`, action: () => openDimPanel('row', mx, my) },
      { label: t(s.locale.value, 'autoRowHeight'), action: () => so.resetRowHeight() },
    ]);
  }
  function onColHdrCtx(e: MouseEvent, col: number) {
    e.preventDefault();
    const mx = e.clientX, my = e.clientY;
    const sel = s.selection.value;
    if (!(sel && sel.startRow === 0 && sel.endRow === s.rowCount - 1 && col >= sel.startCol && col <= sel.endCol)) {
      s.selectRange(col, 0, col, s.rowCount - 1);
      scheduleRender();
    }
    const s2 = s.selection.value!;
    showCtx(e.clientX, e.clientY, [
      { label: t(s.locale.value, 'insert'), action: () => {
        us.saveUndo();
        so.insertCols(s2.startCol, s2.endCol);
        scheduleRender();
        so.emitModelData();
      }, disabled: s2.endCol >= s.colCount - 1 },
      { label: t(s.locale.value, 'cut'), action: () => {
        us.saveUndo();
        bm.copyRowCol();
        for (let c = s2.startCol; c <= s2.endCol; c++) {
          for (let r = 0; r < s.rowCount; r++) {
            s.delCell(s.cellKey(c, r));
          }
        }
        scheduleRender();
        so.emitModelData();
      } },
      { label: t(s.locale.value, 'copy'), action: () => bm.copyRowCol() },
      { label: t(s.locale.value, 'paste'), action: () => {
        us.saveUndo();
        bm.pasteFromClipboard().then(() => {
          scheduleRender();
          nextTick(() => so.emitModelData());
        });
      } },
      { label: t(s.locale.value, 'delete'), action: () => {
        us.saveUndo();
        so.deleteCols(s2.startCol, s2.endCol);
        scheduleRender();
        so.emitModelData();
      } },
      { label: `${t(s.locale.value, 'colWidth')}...`, action: () => openDimPanel('col', mx, my) },
      { label: t(s.locale.value, 'defaultColWidth'), action: () => so.resetColWidth() },
    ]);
  }
  function onCellCtx(e: MouseEvent, c: number, r: number) {
    e.preventDefault();
    if (!s.isSelected(c, r)) {
      s.selectCell(c, r);
      scheduleRender();
    }
    const sel = s.selection.value;
    const isSingleCell = !!(sel && sel.startCol === sel.endCol && sel.startRow === sel.endRow);
    showCtx(e.clientX, e.clientY, [
      { label: t(s.locale.value, 'cut'), action: () => {
        bm.cutSelected();
        so.emitModelData();
      } },
      { label: t(s.locale.value, 'copy'), action: () => bm.copyToClipboard() },
      { label: t(s.locale.value, 'paste'), action: () => {
        us.saveUndo();
        bm.pasteFromClipboard().then(() => {
          scheduleRender();
          nextTick(() => so.emitModelData());
        });
      } },
      { label: t(s.locale.value, 'delete'), action: () => {
        us.saveUndo();
        bm.clearSelected();
        scheduleRender();
        so.emitModelData();
      } },
      { label: t(s.locale.value, 'calculate'), children: [
        { label: t(s.locale.value, 'sum'), action: bm.sumSelected, disabled: isSingleCell },
      ] },
    ]);
  }

  // ============ 行高/列宽浮动设置栏 ============
  const dimInputRef = ref<HTMLInputElement | null>(null);
  const dimPanel = ref<{ type: 'row' | 'col'; x: number; y: number; value: string; error: string } | null>(null);
  let dimCloseHandler: (() => void) | null = null;
  function rdlDim() {
    if (dimCloseHandler) {
      document.removeEventListener('mousedown', dimCloseHandler);
      dimCloseHandler = null;
    }
  }
  function openDimPanel(type: 'row' | 'col', x: number, y: number) {
    rdlDim();
    const sel = s.selection.value;
    let cur = '';
    if (sel) {
      const v = type === 'row' ? s.getRowHeight(sel.startRow) : s.colWidths.value[sel.startCol];
      cur = v != null && v > 0 ? String(Math.round(v)) : '';
    }
    const pw = 220;
    const ph = 118;
    let px = x;
    let py = y;
    if (px + pw > window.innerWidth) px = window.innerWidth - pw - 8;
    if (py + ph > window.innerHeight) py = window.innerHeight - ph - 8;
    if (px < 8) px = 8;
    if (py < 8) py = 8;
    dimPanel.value = { type, x: px, y: py, value: cur, error: '' };
    dimCloseHandler = () => {
      dimPanel.value = null;
    };
    setTimeout(() => document.addEventListener('mousedown', dimCloseHandler!, { once: true }), 0);
    nextTick(() => {
      const inp = dimInputRef.value;
      if (inp) {
        inp.focus();
        inp.select();
      }
    });
  }
  function onDimInput(e: Event) {
    const p = dimPanel.value;
    if (!p) return;
    const input = e.target as HTMLInputElement;
    const raw = input.value;
    const cleaned = raw.replace(/[^\d]/g, '');
    p.value = cleaned;
    if (raw !== cleaned) input.value = cleaned;
    p.error = '';
  }
  function onDimKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyDimPanel();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDimPanel();
    }
  }
  function onDimBlur() {
    const p = dimPanel.value;
    if (!p) return;
    const raw = p.value.trim();
    const num = Number(raw);
    const isRow = p.type === 'row';
    const min = isRow ? MIN_ROW_HEIGHT : MIN_COL_WIDTH;
    const max = isRow ? MAX_ROW_HEIGHT : MAX_COL_WIDTH;
    if (raw === '' || !Number.isFinite(num)) {
      closeDimPanel();
      return;
    }
    const clamped = Math.max(min, Math.min(max, Math.round(num)));
    p.value = String(clamped);
    p.error = '';
  }
  function applyDimPanel() {
    const p = dimPanel.value;
    const sel = s.selection.value;
    if (!p || !sel) return;
    const raw = p.value.trim();
    const num = Number(raw);
    const isRow = p.type === 'row';
    const min = isRow ? MIN_ROW_HEIGHT : MIN_COL_WIDTH;
    const max = isRow ? MAX_ROW_HEIGHT : MAX_COL_WIDTH;
    if (raw === '' || !Number.isFinite(num)) {
      p.error = t(s.locale.value, 'dimNumberError');
      return;
    }
    if (num < min || num > max) {
      p.error = t(s.locale.value, 'dimRangeError').replace('{min}', String(min)).replace('{max}', String(max));
      return;
    }
    const v = num;
    us.saveUndo();
    if (isRow) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        s.rowHeights.value[r] = v;
      }
    } else {
      for (let c = sel.startCol; c <= sel.endCol; c++) {
        s.colWidths.value[c] = v;
      }
    }
    scheduleRender();
    so.emitModelData();
    closeDimPanel();
  }
  function closeDimPanel() {
    rdlDim();
    dimPanel.value = null;
  }

  // ============ 编辑输入框 CSS ============
  const editInputStyle = computed(() => {
    const hidden = !s.editingCell.value;
    const pos = s.editingCell.value ?? s.activeCell.value;
    const c = pos.col, r = pos.row;
    const st = s.cells[s.cellKey(c, r)]?.style;
    const fsz = s.cellFontSize(c, r);
    const ffa = typeof st?.fontFamily === 'string' && st.fontFamily ? st.fontFamily : DEFAULT_FONT_FAMILY;
    const fw = st?.fontWeight === 'bold' ? 'bold' : 'normal';
    const fstyle = st?.fontStyle === 'italic' ? 'italic' : 'normal';
    const td = st?.underline === 'underline' ? 'underline' : st?.strikethrough === 'line-through' ? 'line-through' : 'none';
    const tdBoth = st?.underline === 'underline' && st?.strikethrough === 'line-through' ? 'underline line-through' : td;
    const tc = typeof st?.color === 'string' ? st.color : undefined;
    const bg = typeof st?.backgroundColor === 'string' ? st.backgroundColor : undefined;
    const hAlign = typeof st?.textAlign === 'string' ? st.textAlign : 'left';
    const vAlign = typeof st?.verticalAlign === 'string' ? st.verticalAlign : 'top';
    const m = s.findMerge(c, r);
    const cwVal = m ? s.colPositions.value[m.range.endCol + 1]! - s.colPositions.value[c]! : s.colWidths.value[c]!;
    const rhVal = m ? s.rowPositions.value[m.range.endRow + 1]! - s.rowPositions.value[r]! : s.getRowHeight(r);
    const BORDER = 2;
    const { ascent: asc, descent: desc } = s.measureFontMetrics(ffa, fsz, fw, fstyle);
    const textH = asc + desc;
    const numLines = s.editValue.value ? s.editValue.value.split('\n').length : 1;
    const totalTextH = numLines * textH;
    const pv = s.BASE_CELL_VPAD - BORDER;
    const _availH = Math.max(0, rhVal - BORDER * 2 - totalTextH);
    let padTop = 0;
    let padBottom = 0;
    if (vAlign === 'middle') {
      padTop = Math.floor((rhVal - totalTextH) / 2);
      padBottom = Math.max(0, rhVal - totalTextH - padTop);
    } else if (vAlign === 'top') {
      padTop = pv;
      padBottom = Math.max(0, rhVal - totalTextH - padTop);
    } else if (vAlign === 'bottom') {
      padBottom = pv;
      padTop = Math.max(0, rhVal - totalTextH - padBottom);
    }
    return {
      left: `${HEADER_WIDTH + s.colPositions.value[c]! - s.scrollX.value}px`,
      top: `${HEADER_HEIGHT + s.rowPositions.value[r]! - s.scrollY.value}px`,
      width: `${cwVal}px`,
      height: `${rhVal}px`,
      fontFamily: ffa,
      fontSize: `${fsz}px`,
      lineHeight: 1 as const,
      fontWeight: fw,
      fontStyle: fstyle,
      textDecoration: tdBoth,
      textAlign: hAlign as 'left' | 'center' | 'right',
      paddingTop: `${padTop}px`,
      paddingRight: '3px',
      paddingBottom: `${padBottom}px`,
      paddingLeft: '3px',
      opacity: hidden ? 0 : 1,
      pointerEvents: (hidden ? 'none' : 'auto') as 'none' | 'auto',
      color: hidden ? 'transparent' : tc,
      caretColor: hidden ? 'transparent' : undefined,
      borderColor: hidden ? 'transparent' : undefined,
      background: hidden ? 'transparent' : bg,
      boxShadow: hidden ? 'none' : undefined,
    };
  });

  // ============ 滚动条 ============
  function gridVW() {
    return Math.max(0, so.viewSize.w - HEADER_WIDTH - SB_SIZE);
  }
  function gridVH() {
    return Math.max(0, so.viewSize.h - HEADER_HEIGHT - SB_SIZE);
  }
  const hScrollbarW = computed(() => gridVW());
  const vScrollbarH = computed(() => gridVH());
  const hTrackW = computed(() => Math.max(0, hScrollbarW.value - 11 * 2));
  const vTrackH = computed(() => Math.max(0, vScrollbarH.value - 11 * 2));
  const hThumbW = computed(() => {
    if (so.maxScrollX.value <= 0) return hTrackW.value;
    return Math.max(24, (gridVW() / s.totalWidth.value) * hTrackW.value);
  });
  const hThumbL = computed(() => {
    if (so.maxScrollX.value <= 0) return 0;
    return (s.scrollX.value / so.maxScrollX.value) * (hTrackW.value - hThumbW.value);
  });
  const vThumbH = computed(() => {
    if (so.maxScrollY.value <= 0) return vTrackH.value;
    return Math.max(24, (gridVH() / s.totalHeight.value) * vTrackH.value);
  });
  const vThumbT = computed(() => {
    if (so.maxScrollY.value <= 0) return 0;
    return (s.scrollY.value / so.maxScrollY.value) * (vTrackH.value - vThumbH.value);
  });
  let sbDrg: 'h' | 'v' | null = null;
  let sbMs: number = 0;
  let sbSc: number = 0;
  function onVStart(e: MouseEvent) {
    e.preventDefault();
    sbDrg = 'v';
    sbMs = e.clientY;
    sbSc = s.scrollY.value;
    document.addEventListener('mousemove', onSbMove);
    document.addEventListener('mouseup', onSbUp);
  }
  function onHStart(e: MouseEvent) {
    e.preventDefault();
    sbDrg = 'h';
    sbMs = e.clientX;
    sbSc = s.scrollX.value;
    document.addEventListener('mousemove', onSbMove);
    document.addEventListener('mouseup', onSbUp);
  }
  function onSbMove(e: MouseEvent) {
    if (sbDrg === 'v') {
      const d = e.clientY - sbMs;
      const r = d / (vTrackH.value - vThumbH.value);
      so.clampScroll(null, sbSc + r * so.maxScrollY.value);
      scheduleRender();
    } else if (sbDrg === 'h') {
      const d = e.clientX - sbMs;
      const r = d / (hTrackW.value - hThumbW.value);
      so.clampScroll(sbSc + r * so.maxScrollX.value, null);
      scheduleRender();
    }
  }
  function onSbUp() {
    sbDrg = null;
    document.removeEventListener('mousemove', onSbMove);
    document.removeEventListener('mouseup', onSbUp);
  }
  function onVTrk(e: MouseEvent) {
    if (sbDrg) return;
    const cr = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - cr.top;
    if (y < vThumbT.value) so.clampScroll(null, s.scrollY.value - gridVH());
    else if (y > vThumbT.value + vThumbH.value) so.clampScroll(null, s.scrollY.value + gridVH());
    scheduleRender();
  }
  function onHTrk(e: MouseEvent) {
    if (sbDrg) return;
    const cr = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - cr.left;
    if (x < hThumbL.value) so.clampScroll(s.scrollX.value - gridVW(), null);
    else if (x > hThumbL.value + hThumbW.value) so.clampScroll(s.scrollX.value + gridVW(), null);
    scheduleRender();
  }

  // ============ 鼠标/触屏 状态 ============
  let isDragging = false;
  let drgSC = 0;
  let drgSR = 0;
  let isResizingC = false;
  let isResizingR = false;
  let rszTC = 0;
  let rszTR = 0;
  let rszSS = 0;
  let rszSG = 0;
  let tSX = 0, tSY = 0, tSSX = 0, tSSY = 0;
  let isTouch = false, tMoved = false;
  let tSC = 0, tSR = 0;
  // 触摸起点所在区域：cell 单元格 / col 列表头 / row 行表头 / all 左上角全选按钮
  let tZone: 'cell' | 'col' | 'row' | 'all' = 'cell';
  let ltT = 0, ltC = -1, ltR = -1;

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    ctxMenu.value = null;
    const p = getCanvasXY(e, so.canvasRef.value);
    if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
      const gx = p.x - HEADER_WIDTH + s.scrollX.value;
      const c = s.hitCol(gx);
      if (c >= 0 && Math.abs(p.x - (HEADER_WIDTH + s.colPositions.value[c + 1]! - s.scrollX.value)) <= 4) {
        us.saveUndo();
        isResizingC = true;
        rszTC = c;
        rszSS = s.colWidths.value[c]!;
        rszSG = gx;
        scheduleRender();
        return;
      }
    }
    if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
      const gy = p.y - HEADER_HEIGHT + s.scrollY.value;
      const r = s.hitRow(gy);
      if (r >= 0 && Math.abs(p.y - (HEADER_HEIGHT + s.rowPositions.value[r + 1]! - s.scrollY.value)) <= 4) {
        us.saveUndo();
        isResizingR = true;
        rszTR = r;
        rszSS = s.getRowHeight(r);
        rszSG = gy;
        scheduleRender();
        return;
      }
    }
    if (p.x < HEADER_WIDTH || p.y < HEADER_HEIGHT) {
      s.commitEdit();
      if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
        const c = s.hitCol(p.x - HEADER_WIDTH + s.scrollX.value);
        if (c >= 0) {
          s.selectRange(c, 0, c, s.rowCount - 1);
          isDragging = true;
          drgSC = c;
          drgSR = 0;
        }
      } else if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
        const r = s.hitRow(p.y - HEADER_HEIGHT + s.scrollY.value);
        if (r >= 0) {
          s.selectRange(0, r, s.colCount - 1, r);
          isDragging = true;
          drgSC = 0;
          drgSR = r;
        }
      } else if (p.x < HEADER_WIDTH && p.y < HEADER_HEIGHT) {
        s.selectAll();
      }
      scheduleRender();
      return;
    }
    const c = s.hitCol(p.x - HEADER_WIDTH + s.scrollX.value), r = s.hitRow(p.y - HEADER_HEIGHT + s.scrollY.value);
    if (c < 0 || r < 0) return;
    s.commitEdit();
    if (e.shiftKey && s.selection.value) {
      const sel = s.selection.value;
      s.selectRange(sel.startCol, sel.startRow, c, r);
    } else {
      s.selectCell(c, r);
    }
    isDragging = true;
    drgSC = c;
    drgSR = r;
    so.focusEditInput();
    scheduleRender();
  }

  function onMouseMove(e: MouseEvent) {
    if (isResizingC) {
      const x = getCanvasXY(e, so.canvasRef.value).x;
      const d = (x - HEADER_WIDTH + s.scrollX.value) - rszSG;
      const newW = rszSS + d;
      if (newW >= MIN_COL_WIDTH && newW <= MAX_COL_WIDTH) s.colWidths.value[rszTC] = newW;
      else if (newW < MIN_COL_WIDTH) s.colWidths.value[rszTC] = MIN_COL_WIDTH;
      else s.colWidths.value[rszTC] = MAX_COL_WIDTH;
      scheduleRender();
      return;
    }
    if (isResizingR) {
      const y = getCanvasXY(e, so.canvasRef.value).y;
      const d = (y - HEADER_HEIGHT + s.scrollY.value) - rszSG;
      const newH = rszSS + d;
      if (newH >= MIN_ROW_HEIGHT && newH <= MAX_ROW_HEIGHT) s.rowHeights.value[rszTR] = newH;
      else if (newH < MIN_ROW_HEIGHT) s.rowHeights.value[rszTR] = MIN_ROW_HEIGHT;
      else s.rowHeights.value[rszTR] = MAX_ROW_HEIGHT;
      scheduleRender();
      return;
    }
    if (!isDragging) {
      const cvs = so.canvasRef.value;
      if (!cvs) return;
      if (us.paintFmt.value) {
        cvs.style.cursor = 'copy';
        return;
      }
      const p = getCanvasXY(e, cvs);
      if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
        const c = s.hitCol(p.x - HEADER_WIDTH + s.scrollX.value);
        if (c >= 0 && Math.abs(p.x - (HEADER_WIDTH + s.colPositions.value[c + 1]! - s.scrollX.value)) <= 4) {
          cvs.style.cursor = 'col-resize';
          return;
        }
      }
      if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
        const r = s.hitRow(p.y - HEADER_HEIGHT + s.scrollY.value);
        if (r >= 0 && Math.abs(p.y - (HEADER_HEIGHT + s.rowPositions.value[r + 1]! - s.scrollY.value)) <= 4) {
          cvs.style.cursor = 'row-resize';
          return;
        }
      }
      cvs.style.cursor = 'cell';
      return;
    }
    const p = getCanvasXY(e, so.canvasRef.value);
    if (drgSC < 0 || drgSR < 0) return;
    if (p.x < HEADER_WIDTH || p.y < HEADER_HEIGHT) {
      if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
        const c = s.hitCol(p.x - HEADER_WIDTH + s.scrollX.value);
        if (c >= 0) s.selectRange(Math.min(drgSC, c), 0, Math.max(drgSC, c), s.rowCount - 1);
      } else if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
        const r = s.hitRow(p.y - HEADER_HEIGHT + s.scrollY.value);
        if (r >= 0) s.selectRange(0, Math.min(drgSR, r), s.colCount - 1, Math.max(drgSR, r));
      }
      scheduleRender();
      return;
    }
    const c = s.hitCol(p.x - HEADER_WIDTH + s.scrollX.value), r = s.hitRow(p.y - HEADER_HEIGHT + s.scrollY.value);
    if (c < 0 || r < 0) return;
    if (drgSR === 0 && drgSC >= 0 && s.selection.value && s.selection.value.startRow === 0 && s.selection.value.endRow === s.rowCount - 1) {
      s.selectRange(Math.min(drgSC, c), 0, Math.max(drgSC, c), s.rowCount - 1);
    } else if (drgSC === 0 && drgSR >= 0 && s.selection.value && s.selection.value.startCol === 0 && s.selection.value.endCol === s.colCount - 1) {
      s.selectRange(0, Math.min(drgSR, r), s.colCount - 1, Math.max(drgSR, r));
    } else {
      s.selectRange(drgSC, drgSR, c, r);
    }
    scheduleRender();
  }

  function onMouseUp(_e: MouseEvent) {
    const w = isResizingC || isResizingR;
    isDragging = false;
    isResizingC = false;
    isResizingR = false;
    if (w) so.scheduleOptEmit();
    if (us.paintFmt.value) {
      us.applyPaintFormat();
    }
  }
  function onMouseLeave() {
    const w = isResizingC || isResizingR;
    isDragging = false;
    isResizingC = false;
    isResizingR = false;
    if (w) so.scheduleOptEmit();
  }
  function onCanvasCtx(e: MouseEvent) {
    e.preventDefault();
    const p = getCanvasXY(e, so.canvasRef.value);
    if (p.x < HEADER_WIDTH && p.y < HEADER_HEIGHT) {
      onCornerCtx(e);
      return;
    }
    if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
      const c = s.hitCol(p.x - HEADER_WIDTH + s.scrollX.value);
      if (c >= 0) onColHdrCtx(e, c);
      return;
    }
    if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
      const r = s.hitRow(p.y - HEADER_HEIGHT + s.scrollY.value);
      if (r >= 0) onRowHdrCtx(e, r);
      return;
    }
    if (p.x >= HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
      const c = s.hitCol(p.x - HEADER_WIDTH + s.scrollX.value), r = s.hitRow(p.y - HEADER_HEIGHT + s.scrollY.value);
      if (c >= 0 && r >= 0) onCellCtx(e, c, r);
    }
  }
  function onDblClick(e: MouseEvent) {
    const p = getCanvasXY(e, so.canvasRef.value);
    if (p.x < HEADER_WIDTH || p.y < HEADER_HEIGHT) return;
    const c = s.hitCol(p.x - HEADER_WIDTH + s.scrollX.value), r = s.hitRow(p.y - HEADER_HEIGHT + s.scrollY.value);
    if (c < 0 || r < 0) return;
    s.selectCell(c, r);
    s.ensureVisible(c, r);
    s.startEdit();
    scheduleRender();
    so.focusEditInput();
  }
  function onWheel(e: WheelEvent) {
    so.clampScroll(s.scrollX.value + e.deltaX, s.scrollY.value + e.deltaY);
    scheduleRender();
  }

  // 触屏
  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) {
      isTouch = false;
      return;
    }
    const t = e.touches[0]!;
    const cvs = so.canvasRef.value;
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const x = t.clientX - rect.left, y = t.clientY - rect.top;
    if (x >= HEADER_WIDTH && y >= HEADER_HEIGHT) {
      // 单元格区域：记录起点，移动时平移滚动，抬手时选中单元格
      e.preventDefault();
      isTouch = true;
      tMoved = false;
      tZone = 'cell';
      tSX = x;
      tSY = y;
      tSSX = s.scrollX.value;
      tSSY = s.scrollY.value;
      tSC = s.hitCol(x - HEADER_WIDTH + s.scrollX.value);
      tSR = s.hitRow(y - HEADER_HEIGHT + s.scrollY.value);
    } else if (x >= 0 && y >= 0 && (x < HEADER_WIDTH || y < HEADER_HEIGHT)) {
      // 列表头 / 行表头 / 左上角全选按钮：同样支持平移滚动与点按选择
      e.preventDefault();
      isTouch = true;
      tMoved = false;
      tSX = x;
      tSY = y;
      tSSX = s.scrollX.value;
      tSSY = s.scrollY.value;
      if (y < HEADER_HEIGHT && x >= HEADER_WIDTH) {
        tZone = 'col';
        tSC = s.hitCol(x - HEADER_WIDTH + s.scrollX.value);
        tSR = -1;
      } else if (x < HEADER_WIDTH && y >= HEADER_HEIGHT) {
        tZone = 'row';
        tSR = s.hitRow(y - HEADER_HEIGHT + s.scrollY.value);
        tSC = -1;
      } else {
        tZone = 'all';
        tSC = -1;
        tSR = -1;
      }
    }
  }
  function onTouchMove(e: TouchEvent) {
    if (!isTouch || e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const cvs = so.canvasRef.value;
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const x = t.clientX - rect.left, y = t.clientY - rect.top;
    if (Math.abs(x - tSX) > 8 || Math.abs(y - tSY) > 8) {
      tMoved = true;
      e.preventDefault();
      so.clampScroll(tSSX + (tSX - x), tSSY + (tSY - y));
      scheduleRender();
    }
  }
  function onTouchEnd() {
    if (!isTouch) return;
    isTouch = false;
    if (tMoved) return;
    if (tZone === 'cell' && tSC >= 0 && tSR >= 0) {
      const n = Date.now();
      if (tSC === ltC && tSR === ltR && n - ltT < 300) {
        s.selectCell(tSC, tSR);
        s.startEdit();
        scheduleRender();
        so.focusEditInput();
        ltT = 0;
      } else {
        s.commitEdit();
        s.selectCell(tSC, tSR);
        scheduleRender();
        ltT = n;
      }
      ltC = tSC;
      ltR = tSR;
      so.focusEditInput();
    } else if (tZone === 'col' && tSC >= 0) {
      s.commitEdit();
      s.selectRange(tSC, 0, tSC, s.rowCount - 1);
      scheduleRender();
    } else if (tZone === 'row' && tSR >= 0) {
      s.commitEdit();
      s.selectRange(0, tSR, s.colCount - 1, tSR);
      scheduleRender();
    } else if (tZone === 'all') {
      s.commitEdit();
      s.selectAll();
      scheduleRender();
    }
  }

  // ============ 键盘 ============
  function isImeKeydown(e: KeyboardEvent) {
    return e.isComposing || e.key === 'Process' || e.keyCode === 229;
  }
  function isPlainPrintableKey(e: KeyboardEvent) {
    return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  }
  function onKeydown(e: KeyboardEvent) {
    if (s.editingCell.value) return;
    const ctl = e.ctrlKey || e.metaKey, sh = e.shiftKey;
    switch (true) {
      case ctl && (e.key === 'c' || e.key === 'C'):
        e.preventDefault();
        bm.copyToClipboard();
        return;
      case ctl && (e.key === 'x' || e.key === 'X'):
        e.preventDefault();
        bm.cutSelected();
        return;
      case ctl && (e.key === 'z' || e.key === 'Z'):
        e.preventDefault();
        us.undo();
        return;
      case ctl && (e.key === 'y' || e.key === 'Y'):
        e.preventDefault();
        us.redo();
        return;
      case ctl && (e.key === 'v' || e.key === 'V'):
        e.preventDefault();
        us.saveUndo();
        bm.pasteFromClipboard().then(() => {
          scheduleRender();
          nextTick(() => so.emitModelData());
        });
        return;
      case ctl && (e.key === 'a' || e.key === 'A'):
        e.preventDefault();
        s.selectAll();
        scheduleRender();
        return;
      case ctl && e.key === 'Home':
        e.preventDefault();
        s.selectCell(0, 0);
        s.ensureVisible(0, 0);
        scheduleRender();
        return;
      case ctl && e.key === 'End':
        e.preventDefault();
        s.selectCell(s.colCount - 1, s.rowCount - 1);
        s.ensureVisible(s.colCount - 1, s.rowCount - 1);
        scheduleRender();
        return;
      case e.key === 'Home':
        e.preventDefault();
        s.selectCell(0, s.activeCell.value.row);
        s.ensureVisible(0, s.activeCell.value.row);
        scheduleRender();
        return;
      case e.key === 'End':
        e.preventDefault();
        s.selectCell(s.colCount - 1, s.activeCell.value.row);
        s.ensureVisible(s.colCount - 1, s.activeCell.value.row);
        scheduleRender();
        return;
      case e.key === 'ArrowUp':
        e.preventDefault();
        s.moveActive(0, -1);
        s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        scheduleRender();
        return;
      case e.key === 'ArrowDown':
        e.preventDefault();
        s.moveActive(0, 1);
        s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        scheduleRender();
        return;
      case e.key === 'ArrowLeft':
        e.preventDefault();
        s.moveActive(-1, 0);
        s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        scheduleRender();
        return;
      case e.key === 'ArrowRight':
        e.preventDefault();
        s.moveActive(1, 0);
        s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        scheduleRender();
        return;
      case e.key === 'Tab':
        e.preventDefault();
        s.moveActive(sh ? -1 : 1, 0);
        s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        scheduleRender();
        return;
      case e.key === 'Enter':
        e.preventDefault();
        s.moveActive(0, sh ? -1 : 1);
        s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        scheduleRender();
        return;
      case e.key === 'F2':
        e.preventDefault();
        s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        s.startEdit();
        scheduleRender();
        so.focusEditInput();
        return;
      case e.key === 'Delete':
      case e.key === 'Backspace':
        e.preventDefault();
        us.saveUndo();
        bm.clearSelected();
        scheduleRender();
        return;
      case e.key === 'Escape':
        e.preventDefault();
        s.cancelEdit();
        us.paintFmt.value = null;
        scheduleRender();
        return;
      case isPlainPrintableKey(e):
        if (isImeKeydown(e)) {
          s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
          s.startEdit('');
          scheduleRender();
          so.focusEditInput();
          return;
        }
        e.preventDefault();
        s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        s.startEdit(e.key);
        scheduleRender();
        nextTick(() => {
          const inp = so.editInputRef.value;
          if (inp) {
            inp.focus();
            inp.setSelectionRange(1, 1);
          }
        });
        return;
    }
  }

  // ============ 编辑框 ============
  let isEditComposing = false;
  let compositionJustEnded = false;
  function onEditInput(e: Event) {
    const val = (e.target as HTMLTextAreaElement).value;
    if (!s.editingCell.value) {
      s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
      s.startEdit(val);
      scheduleRender();
      return;
    }
    s.editValue.value = val;
  }
  function onEditCompositionStart() {
    isEditComposing = true;
    if (!s.editingCell.value) {
      s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
      s.startEdit('');
      scheduleRender();
    }
  }
  function onEditCompositionEnd(e: CompositionEvent) {
    isEditComposing = false;
    compositionJustEnded = true;
    setTimeout(() => {
      compositionJustEnded = false;
    }, 0);
    s.editValue.value = (e.target as HTMLTextAreaElement).value;
  }
  function onEditKd(e: KeyboardEvent) {
    if (!s.editingCell.value) {
      if (isPlainPrintableKey(e) || isImeKeydown(e)) return;
      onKeydown(e);
      return;
    }
    if (isEditComposing || isImeKeydown(e)) return;
    if (compositionJustEnded && (e.key === 'Enter' || e.key === 'Escape')) return;
    if (e.key === 'Enter' && (e.altKey || e.metaKey)) {
      e.preventDefault();
      const inp = so.editInputRef.value;
      if (!inp) return;
      const start = inp.selectionStart ?? inp.value.length;
      const end = inp.selectionEnd ?? inp.value.length;
      const val = inp.value;
      const newVal = val.slice(0, start) + '\n' + val.slice(end);
      s.editValue.value = newVal;
      inp.value = newVal;
      inp.selectionStart = inp.selectionEnd = start + 1;
      scheduleRender();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      s.commitEdit();
      s.moveActive(0, 1);
      s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
      scheduleRender();
      so.focusEditInput();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      s.commitEdit();
      s.moveActive(e.shiftKey ? -1 : 1, 0);
      s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
      scheduleRender();
      so.focusEditInput();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      s.cancelEdit();
      scheduleRender();
      so.focusEditInput();
    }
  }
  function onEditPaste(_e: ClipboardEvent) {
    if (!s.editingCell.value) return;
  }
  function onEditBlur() {
    setTimeout(() => {
      if (s.editingCell.value) {
        s.commitEdit();
        scheduleRender();
      }
    }, 0);
  }

  // ============ 尺寸 / 生命周期 ============
  let resizeObs: ResizeObserver | null = null;

  function applySize() {
    const wr = so.wrapperRef.value?.getBoundingClientRect();
    if (wr) {
      const pw = resolveSize(s.props.width);
      const ph = resolveSize(s.props.height);
      if (pw != null) so.viewSize.w = pw;
      else so.viewSize.w = wr.width;
      if (ph != null) so.viewSize.h = ph;
      else so.viewSize.h = wr.height;
    }
    so.clampScroll(null, null);
    scheduleRender();
  }

  function setupLifecycle() {
    onMounted(() => {
      const pw = resolveSize(s.props.width);
      const ph = resolveSize(s.props.height);
      if (pw == null || ph == null) {
        resizeObs = new ResizeObserver(() => applySize());
        if (so.wrapperRef.value) resizeObs.observe(so.wrapperRef.value);
      }
      nextTick(() => {
        applySize();
        so.focusEditInput();
      });
      s.selectCell(0, 0);
      if (so.modelData.value && so.modelData.value.length > 0) {
        lastEmittedDataRef.value = JSON.stringify(so.modelData.value);
        so.sheets.value = so.modelData.value.map((smd) => {
          const sh = so.mkSheet(smd.name);
          for (const [k, v] of Object.entries(smd.cells)) {
            sh.cells[k] = { value: v.value, style: v.style ?? null };
          }
          if (smd.colWidths) {
            for (const [c, w] of Object.entries(smd.colWidths)) {
              const ci = Number(c);
              if (ci >= 0 && ci < s.colCount && w >= 30) sh.colWidths[ci] = w;
            }
          }
          if (smd.rowHeights) {
            for (const [r, h] of Object.entries(smd.rowHeights)) {
              const ri = Number(r);
              if (ri >= 0 && ri < s.rowCount && h >= 24) sh.rowHeights[ri] = h;
            }
          }
          if (smd.merges) {
            for (const [k, mr] of Object.entries(smd.merges)) {
              sh.merges![k] = { ...mr };
            }
          }
          return sh;
        });
        if (so.sheets.value.length > 0) so.loadSheet(0);
      }
    });

    watch(() => [s.props.width, s.props.height], () => {
      const pw = resolveSize(s.props.width);
      const ph = resolveSize(s.props.height);
      if (pw != null && ph != null) {
        resizeObs?.disconnect();
        resizeObs = null;
      } else if (!resizeObs && so.wrapperRef.value) {
        resizeObs = new ResizeObserver(() => applySize());
        resizeObs.observe(so.wrapperRef.value);
      }
      nextTick(() => applySize());
    });

    watch(() => s.props.theme, () => scheduleRender());
    watch(() => ({ ...s.cells }), () => nextTick(() => so.emitModelData()), { deep: false });
    watch(() => ({ ...s.merges }), () => {
      nextTick(() => so.emitModelData());
      scheduleRender();
    }, { deep: false });
    watch(so.activeSheetIndex, () => nextTick(() => so.emitModelData()));

    watch(() => so.modelData.value, (v) => {
      if (!v || v.length === 0) return;
      const nd = JSON.stringify(v);
      if (nd === lastEmittedDataRef.value) return;
      lastEmittedDataRef.value = nd;
      const savedSel = s.selection.value ? { ...s.selection.value } : null;
      const savedActive = { ...s.activeCell.value };
      so.sheets.value = v.map((smd) => {
        const sh = so.mkSheet(smd.name);
        for (const [k, it] of Object.entries(smd.cells)) {
          sh.cells[k] = { value: it.value, style: it.style ?? null };
        }
        if (smd.colWidths) {
          for (const [c, w] of Object.entries(smd.colWidths)) {
            const ci = Number(c);
            if (ci >= 0 && ci < s.colCount && w >= 30) sh.colWidths[ci] = w;
          }
        }
        if (smd.rowHeights) {
          for (const [r, h] of Object.entries(smd.rowHeights)) {
            const ri = Number(r);
            if (ri >= 0 && ri < s.rowCount && h >= 24) sh.rowHeights[ri] = h;
          }
        }
        if (smd.merges) {
          for (const [k, mr] of Object.entries(smd.merges)) {
            sh.merges![k] = { ...mr };
          }
        }
        return sh;
      });
      if (so.sheets.value.length > 0) so.loadSheet(0);
      if (savedSel) s.selection.value = savedSel;
      s.activeCell.value = savedActive;
      scheduleRender();
    }, { deep: true });

    onBeforeUnmount(() => {
      resizeObs?.disconnect();
    });
  }

  return {
    scheduleRender,
    render,

    activeCellLabel,
    formulaBarDisplay,
    onFormulaBarFocus,
    onFormulaBarInput,
    onFormulaBarKeydown,
    onFormulaBarBlur,

    renTab,
    renTabVal,
    onTabClick,
    onTabDblClick,
    commitTabRename,
    cclTabRename,
    onTabRenameKd,

    ctxMenu,
    ctxSubmenuLeft,
    onCtxItemEnter,
    onTabCtxMenu,
    onTabBarCtx,
    onCornerCtx,
    onRowHdrCtx,
    onColHdrCtx,
    onCellCtx,

    dimInputRef,
    dimPanel,
    openDimPanel,
    onDimInput,
    onDimKeydown,
    onDimBlur,
    applyDimPanel,
    closeDimPanel,

    editInputStyle,

    hScrollbarW,
    vScrollbarH,
    hTrackW,
    vTrackH,
    hThumbW,
    hThumbL,
    vThumbH,
    vThumbT,
    onVStart,
    onHStart,
    onSbMove,
    onSbUp,
    onVTrk,
    onHTrk,

    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
    onCanvasCtx,
    onDblClick,
    onWheel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,

    onKeydown,

    onEditInput,
    onEditCompositionStart,
    onEditCompositionEnd,
    onEditKd,
    onEditPaste,
    onEditBlur,

    applySize,
    setupLifecycle,
  };
}
