import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, type Ref, type ComputedRef } from 'vue';
import { HEADER_HEIGHT, HEADER_WIDTH, SB_SIZE, DEFAULT_COL_WIDTH, MIN_COL_WIDTH, MIN_ROW_HEIGHT, MAX_COL_WIDTH, MAX_ROW_HEIGHT, DEFAULT_FONT_FAMILY, t } from '../core/constants';
import { colToLabel, resolveSize, getCanvasXY } from '../core/utils';
import type { CoreState } from './core-state';
import type { UndoStylesState } from './undo-styles';
import { formatNumber, shouldAlignRightByDefault, NF_INVALID_VALUE, isFormatOverflowsToHashes, isInvalidDisplayValue } from '../core/number-format';
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
  formulaBarDraft: Ref<string>;          // 公式栏暂存草稿（输入实时写这里，不写 Cell.value 也不写 s.editValue）
  formulaBarExpanded: Ref<boolean>;      // 公式栏 1 行 / 3 行切换（由 spreader.vue 同步）
  onFormulaBarFocus: () => void;
  onFormulaBarInput: (e: Event) => void;
  onFormulaBarKeydown: (e: KeyboardEvent) => void;
  onFormulaBarBlur: () => void;
  acceptFormulaBarEdit: () => void;      // 接受（✔/Enter/blur）：将 draft → s.editValue → commit → Cell.value
  cancelFormulaBarEdit: () => void;      // 取消（✖/Esc）：丢弃 draft，回到进入编辑前的单元格值

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
          // row/col 选择模式下按单个 cell 大小填色（Excel 风格「穿透合并单元格」）：
          // 即便 anchor 当前 cw/rh 是合并后的大小，也只填当前 cell(col,row) 对应的 cW[col]/rH[row]。
          if (s.selectionMode.value === 'row' || s.selectionMode.value === 'col') {
            rCtx.fillRect(x, y, cW[col]!, rH[row]!);
          } else {
            rCtx.fillRect(x, y, cw, rh);
          }
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
          const st = s.cells[s.cellKey(col, row)]?.style;
          const rawV = s.getCellValue(col, row);
          const nf = typeof st?.numberFormat === 'string' ? st.numberFormat : '';
          const v = rawV ? formatNumber(rawV, nf, s.locale.value) : '';
          if (v) {
            const fsz = s.cellFontSize(col, row);
            const ffa = typeof st?.fontFamily === 'string' && st.fontFamily ? st.fontFamily : DEFAULT_FONT_FAMILY;
            const fw = st?.fontWeight === 'bold' ? 'bold' : 'normal';
            const fstyle = st?.fontStyle === 'italic' ? 'italic' : 'normal';
            const hasU = st?.underline === 'underline';
            const hasS = st?.strikethrough === 'line-through';
            const txtColor = typeof st?.color === 'string' ? st.color : '';
            // 默认水平对齐：仅显示时生效（不落 style）— 数值类格式/常规数字 右对齐，其他左对齐
            const hAlign = typeof st?.textAlign === 'string' ? st.textAlign : (shouldAlignRightByDefault(rawV, nf) ? 'right' : 'left');
            const vAlign = typeof st?.verticalAlign === 'string' ? st.verticalAlign : 'top';
            rCtx.fillStyle = txtColor || cs.cellText;
            rCtx.font = `${fstyle} ${fw} ${fsz}px ${ffa}`;
            rCtx.textBaseline = 'alphabetic';
            rCtx.save();
            rCtx.beginPath();
            rCtx.rect(x + 5, y + 1, cw - 10, rh - 2);
            rCtx.clip();
            const stWrap = st?.wrap === 'wrap';
            // ---- Excel 风格 '#####' 填充处理（仅显示，不改 value / style） ----
            // 1) 非法值 sentinel（date 越界 / duration 负数）：不论列宽直接整格填 #
            // 2) 指定格式（非 General、非 @、非纯文本）+ 非 wrap + 任一非空行测量宽度 > cw-10 → 填 #
            const availW = cw - 10;
            let displayV = v;
            const needOverflowHashes = !stWrap && isFormatOverflowsToHashes(nf);
            const invalidValue = v === NF_INVALID_VALUE || isInvalidDisplayValue(rawV, nf);
            if (invalidValue || needOverflowHashes) {
              if (invalidValue) {
                // 填充：按可用宽度与当前字体的 '#' 像素宽度，算可放多少个 '#'（至少 1 个，Excel 视觉就是整格密密麻麻）
                const hashW = Math.max(1, rCtx!.measureText('#').width);
                const count = Math.max(1, Math.floor(availW / hashW));
                displayV = '#'.repeat(count);
              } else {
                // needOverflowHashes：先量原始 v 单行/按 wrap 切行后每一行是否超宽
                // split text lines before overflow check (no auto-wrap)
                const preLines = s.getWrappedLines(rCtx!, v, 1e9, false);
                const anyOverflow = preLines.some((line) => line && rCtx!.measureText(line).width > availW);
                if (anyOverflow) {
                  const hashW = Math.max(1, rCtx!.measureText('#').width);
                  const count = Math.max(1, Math.floor(availW / hashW));
                  displayV = '#'.repeat(count);
                }
              }
            }
            const textLines = s.getWrappedLines(rCtx!, displayV, availW, stWrap);
            // 使用统一字体度量（优先 fontBoundingBoxAscent/Descent，浏览器字体级内容无关度量），
            // 确保纯英文、含中文、含重音等任意内容使用完全相同的 ascent/descent，基线对齐一致。
            const { ascent: maxAsc, descent: maxDesc } = s.measureFontMetrics(ffa, fsz, fw, fstyle);
            // 行距与自动行高公式（BASE_CELL_VPAD*2 + n*(asc+desc)）保持一致
            const lineH = maxAsc + maxDesc;
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
                // 删除线位置：字形中部（从字形顶部往下 42%），与统一度量一致
                const strikeY = lineTy - maxAsc + lineH * 0.42;
                rCtx.beginPath();
                rCtx.moveTo(tx, strikeY);
                rCtx.lineTo(tx + m.width, strikeY);
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

        rCtx.fillStyle = BORDER_COLOR;
        if (mergeInfo) {
          // =======================================================【双 BUG 修复 · 渲染端合并格边绘制】========================================================
          // 背景：之前做法是「对合并格 4 条边分别取全局 max(ownSide, max(邻居列/行各边)) 得到 wT/wL/wB/wR，然后用 1 个 fillRect(合并总宽/总高) 画整条边」，
          //       但这会造成 BUG 1 等价复发：B2.Top=2 只应该让 B 列对应的合并底变粗，结果整条 A1:C1 底都变成 2 粗，和写入端直接污染 anchor.borderBottomWidth 视觉无差别。
          //
          // 修复：参考 Excel，合并格横边（Top/Bottom）按列分段绘制，竖边（Left/Right）按行分段绘制。
          //       对每一列 cc ∈ [sC..eC]，独立计算 wTseg/wBseg = max(ownX（anchor 全局边宽）, 该列上方/下方邻居单元格的对侧边宽)，然后只在这一列的 cW[cc] 像素带绘制。
          //       竖边同理：每一行 rr ∈ [sR..eR] 独立计算 wLseg/wRseg = max(ownX, 该行左/右邻居的对侧边宽)，只在这一行的 rH[rr] 像素带绘制。
          //
          // BUG 1 保证：由于每列/行独立取 max，B2.Top=2 只提升第 cc=1（B 列）的 wBseg = 2，第 0/2 列段仍保持 ownB=0 → A/C 列段不变粗 ✅
          // BUG 2 保证：B2 自己是普通单元格，走 else 分支用原方法绘制 Top=2；而合并底 B 列段恰好也是 wBseg=2 → 两条同宽度 2 像素线在 B 列几何上紧邻（合并底最末像素行 == B2.Top 起始像素行-1），
          //            用户视觉上看到是一条无缝连续的 2 像素分界线，不再产生「A1:C1 底 1 像素细线看起来像 B2 的细上边」的错觉 ✅
          // ========================================================================================================================================================
          const sR = mergeInfo.range.startRow, eR = mergeInfo.range.endRow;
          const sC = mergeInfo.range.startCol, eC = mergeInfo.range.endCol;

          // 横边 · Top：沿合并上沿逐列分段绘制
          //   cc          = 当前段的列号（sC..eC）
          //   sxSeg/swSeg = 该列段在视口裁剪坐标系下的 x 起点和段宽度
          //   wTseg       = max(anchor.borderTopWidth（整条合并顶全局宽度，0/1/2）,
          //                    bm.cellBorderWidth(cc, sR-1, 'Bottom') → 该列正上方单元格的 Bottom 宽度（跨合并顶那条线））
          //   绘制位置：y = 合并 rect 顶部 y；高度 = wTseg；覆盖该列段顶部的 wTseg 像素带
          for (let cc = sC; cc <= eC; cc++) {
            const sxSeg = HW + cP[cc]! - sx;                 // 本列段视口 x
            const swSeg = cW[cc]!;                           // 本列段宽度（逐列独立，cW[cc]）
            const wTseg = Math.max(ownT, bm.cellBorderWidth(cc, sR - 1, 'Bottom'));
            if (wTseg > 0) rCtx.fillRect(sxSeg, y, swSeg, wTseg);
          }

          // 横边 · Bottom：沿合并下沿逐列分段绘制
          //   wBseg = max(anchor.borderBottomWidth（全局）, cellBorderWidth(cc, eR+1, 'Top') → 该列正下方单元格的 Top 宽度）
          //   绘制位置：合并底 y+rh 之上，从 y+rh-wBseg 往下画 wBseg 像素
          for (let cc = sC; cc <= eC; cc++) {
            const sxSeg = HW + cP[cc]! - sx;
            const swSeg = cW[cc]!;
            const wBseg = Math.max(ownB, bm.cellBorderWidth(cc, eR + 1, 'Top'));
            if (wBseg > 0) rCtx.fillRect(sxSeg, y + rh - wBseg, swSeg, wBseg);
          }

          // 竖边 · Left：沿合并左沿逐行分段绘制
          //   rr          = 当前段的行号（sR..eR）
          //   sySeg/shSeg = 该行段在视口裁剪坐标系下的 y 起点和段高度
          //   wLseg       = max(anchor.borderLeftWidth（全局）, cellBorderWidth(sC-1, rr, 'Right') → 该行正左方单元格的 Right 宽度）
          //   绘制位置：合并左 x，宽度 wLseg，覆盖该行段高度 shSeg
          for (let rr = sR; rr <= eR; rr++) {
            const sySeg = HH + rP[rr]! - sy;                 // 本行段视口 y
            const shSeg = rH[rr]!;                           // 本行段高度（逐行独立，rH[rr]）
            const wLseg = Math.max(ownL, bm.cellBorderWidth(sC - 1, rr, 'Right'));
            if (wLseg > 0) rCtx.fillRect(x, sySeg, wLseg, shSeg);
          }

          // 竖边 · Right：沿合并右沿逐行分段绘制
          //   wRseg = max(anchor.borderRightWidth（全局）, cellBorderWidth(eC+1, rr, 'Left') → 该行正右方单元格的 Left 宽度）
          //   绘制位置：x+cw 之左、从 x+cw-wRseg 开始画 wRseg 宽竖段
          for (let rr = sR; rr <= eR; rr++) {
            const sySeg = HH + rP[rr]! - sy;
            const shSeg = rH[rr]!;
            const wRseg = Math.max(ownR, bm.cellBorderWidth(eC + 1, rr, 'Left'));
            if (wRseg > 0) rCtx.fillRect(x + cw - wRseg, sySeg, wRseg, shSeg);
          }
        } else {
          // 普通单格：4 条边各自对相邻单元格取 Math.max（上面单元格.Bottom / 左边单元格.Right / 下面单元格.Top / 右边单元格.Left），
          // 然后 1 个 fillRect 画整段。这是经典的电子表格边框叠加画法（Excel 同），无需改动。
          const wT = Math.max(ownT, bm.cellBorderWidth(col, row - 1, 'Bottom'));
          const wL = Math.max(ownL, bm.cellBorderWidth(col - 1, row, 'Right'));
          const wB = Math.max(ownB, bm.cellBorderWidth(col, row + 1, 'Top'));
          const wR = Math.max(ownR, bm.cellBorderWidth(col + 1, row, 'Left'));
          if (wT > 0 || wL > 0 || wB > 0 || wR > 0) {
            if (wT > 0) rCtx.fillRect(x, y, cw, wT);
            if (wB > 0) rCtx.fillRect(x, y + rh - wB, cw, wB);
            if (wL > 0) rCtx.fillRect(x, y, wL, rh);
            if (wR > 0) rCtx.fillRect(x + cw - wR, y, wR, rh);
          }
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

        rCtx.fillStyle = BORDER_COLOR;
        if (mergeInfo) {
          // ================================================【双 BUG 修复 · 合并格四角方块绘制】================================================
          // 背景：如果沿用「统一 wT/wL/wB/wR + 一个尺寸画 4 个角方块」，会导致：
          //       例：B2.Top=2 → 旧方案中 wT=max over sC..eC 的 nbT=2（来自 B1.上方邻居？不，nbT 是上沿邻居），
          //       即使只有某个角落实际有粗边叠加，所有 4 个角都画 2x2 粗方块，出现"右上角也画粗方块但右边和上边都没粗"的视觉污点。
          //
          // 修复：合并格 4 个角**独立计算**各自角点周围的「局部段宽度」，与第二步 4 条边的分段绘制严格对应。
          //       变量命名 w<角落 2 字母>_<边>：角落 = TL/TR/BL/BR；边 = T(Top) / L(Left) / R(Right) / B(Bottom)。
          //       例如 wTL_T = "左上角方块的 Top 段宽" = max(ownT（全局）, cellBorderWidth(sC, sR-1, 'Bottom') → 左上顶点 (sC,sR) 正上方邻居的 Bottom 宽度）。
          //
          // 每个角的 fillRect 覆盖范围（按第二步的段宽/段高坐标系）：
          //   左上角 TL：在 (x, y) 的左上象限外，宽 = wTL_L（Left 段在 sR 行的宽度），高 = wTL_T（Top 段在 sC 列的高度）
          //   右上角 TR：在 (x+cw, y) 的右上象限外，宽 = wTR_R（Right 段在 sR 行的宽度），高 = wTR_T（Top 段在 eC 列的高度）
          //   左下角 BL：在 (x, y+rh) 的左下象限外，宽 = wBL_L（Left 段在 eR 行的宽度），高 = wBL_B（Bottom 段在 sC 列的高度）
          //   右下角 BR：在 (x+cw, y+rh) 的右下象限外，宽 = wBR_R（Right 段在 eR 行的宽度），高 = wBR_B（Bottom 段在 eC 列的高度）
          // ======================================================================================================================================
          const sR = mergeInfo.range.startRow, eR = mergeInfo.range.endRow;
          const sC = mergeInfo.range.startCol, eC = mergeInfo.range.endCol;

          // ┌─ 左上角 (sC,sR)：合并且左顶点
          // │  Top 段取"最左列 sC"的上邻居 Bottom 叠加值；Left 段取"最上行 sR"的左邻居 Right 叠加值。
          // │  x-wTL_L : 方块左边界（向左越过 Left 段宽）；y-wTL_T : 方块上边界（向上越过 Top 段高）
          const wTL_T = Math.max(ownT, bm.cellBorderWidth(sC, sR - 1, 'Bottom'));  // 左上角 Top 方向段高
          const wTL_L = Math.max(ownL, bm.cellBorderWidth(sC - 1, sR, 'Right'));    // 左上角 Left 方向段宽
          if (wTL_T > 0 && wTL_L > 0) rCtx.fillRect(x - wTL_L, y - wTL_T, wTL_L, wTL_T);

          // ─ 右上角 (eC,sR)：合并矩形右顶点
          //   Top 段取"最右列 eC"的上邻居 Bottom 叠加值；Right 段取"最上行 sR"的右邻居 Left 叠加值。
          //   x+cw : 合并矩形右边；方块的水平起点 = x+cw（向右延伸 Right 段宽 wTR_R）
          const wTR_T = Math.max(ownT, bm.cellBorderWidth(eC, sR - 1, 'Bottom'));   // 右上角 Top 方向段高
          const wTR_R = Math.max(ownR, bm.cellBorderWidth(eC + 1, sR, 'Left'));     // 右上角 Right 方向段宽
          if (wTR_T > 0 && wTR_R > 0) rCtx.fillRect(x + cw, y - wTR_T, wTR_R, wTR_T);

          // └─ 左下角 (sC,eR)：合并矩形左下顶点
          //    Bottom 段取"最左列 sC"的下邻居 Top 叠加值；Left 段取"最下行 eR"的左邻居 Right 叠加值。
          //    y+rh : 合并矩形底边；方块的垂直起点 = y+rh（向下延伸 Bottom 段高 wBL_B）
          const wBL_B = Math.max(ownB, bm.cellBorderWidth(sC, eR + 1, 'Top'));     // 左下角 Bottom 方向段高
          const wBL_L = Math.max(ownL, bm.cellBorderWidth(sC - 1, eR, 'Right'));   // 左下角 Left 方向段宽
          if (wBL_B > 0 && wBL_L > 0) rCtx.fillRect(x - wBL_L, y + rh, wBL_L, wBL_B);

          // ┘- 右下角 (eC,eR)：合并矩形右下顶点
          //    Bottom 段取"最右列 eC"的下邻居 Top 叠加值；Right 段取"最下行 eR"的右邻居 Left 叠加值。
          const wBR_B = Math.max(ownB, bm.cellBorderWidth(eC, eR + 1, 'Top'));     // 右下角 Bottom 方向段高
          const wBR_R = Math.max(ownR, bm.cellBorderWidth(eC + 1, eR, 'Left'));    // 右下角 Right 方向段宽
          if (wBR_B > 0 && wBR_R > 0) rCtx.fillRect(x + cw, y + rh, wBR_R, wBR_B);
        } else {
          const wT = Math.max(ownT, bm.cellBorderWidth(col, row - 1, 'Bottom'));
          const wL = Math.max(ownL, bm.cellBorderWidth(col - 1, row, 'Right'));
          const wB = Math.max(ownB, bm.cellBorderWidth(col, row + 1, 'Top'));
          const wR = Math.max(ownR, bm.cellBorderWidth(col + 1, row, 'Left'));
          if (wT > 0 && wL > 0) rCtx.fillRect(x - wL, y - wT, wL, wT);
          if (wT > 0 && wR > 0) rCtx.fillRect(x + cw, y - wT, wR, wT);
          if (wB > 0 && wL > 0) rCtx.fillRect(x - wL, y + rh, wL, wB);
          if (wB > 0 && wR > 0) rCtx.fillRect(x + cw, y + rh, wR, wB);
        }
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
  /**
   * 公式栏暂存草稿：
   *  - 用户在公式栏 textarea 中输入时，实时写入本 ref
   *  - 不会写入 s.editValue 或 Cell.value（即不落盘、不影响 Undo）
   *  - 只有用户触发「接受」（✔/Enter/blur/Alt+Enter 不算）时，才 copy draft → s.editValue → commitEdit → Cell.value
   */
  const formulaBarDraft = ref('');
  /** 公式栏展开状态：false=1 行 / true=3 行。spreader.vue 通过 v-model-like 同步。 */
  const formulaBarExpanded = ref(false);

  /**
   * 公式栏显示字符串（驱动 textarea 的 :value）：
   *  - 编辑中：显示草稿（用户输入实时预览）
   *  - 非编辑：显示当前 activeCell 的原始值（只读预览）
   */
  const formulaBarDisplay = computed(() => {
    if (s.editingCell.value) return formulaBarDraft.value;
    return s.getCellRaw(s.activeCell.value.col, s.activeCell.value.row);
  });

  /** 进入编辑态时初始化草稿、退出时清空草稿 + 自动折叠回 1 行。 */
  watch(
    () => s.editingCell.value,
    (cur, prev) => {
      if (cur && !prev) {
        // 刚进入编辑：草稿 = 当前 s.editValue（若 startEdit 已填入），否则取 activeCell 原始值
        const initial = s.editValue.value || s.getCellRaw(cur.col, cur.row) || '';
        formulaBarDraft.value = initial;
        fbDirty = false;
      } else if (!cur && prev) {
        // 刚退出编辑：清草稿 + 收起为 1 行
        formulaBarDraft.value = '';
        formulaBarExpanded.value = false;
        fbDirty = false;
      }
    },
    { immediate: true },
  );

  /** 未进入编辑态、activeCell 切换时也要让公式栏显示新的 activeCell 原始值。 */
  watch(
    () => [s.activeCell.value.col, s.activeCell.value.row] as const,
    () => {
      if (!s.editingCell.value) {
        formulaBarDraft.value = '';
        fbDirty = false;
      }
    },
  );

  function onFormulaBarFocus() {
    if (!s.editingCell.value) {
      s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
      s.startEdit();
      scheduleRender();
    }
  }

  /**
   * 公式栏输入事件：仅写暂存草稿，不落盘（不写 s.editValue、不写 Cell.value、不写 undo）。
   * 若尚未进入编辑态，自动调用 startEdit（让后续 Enter/Esc/blur 能走统一的接受/取消流程）。
   */
  function onFormulaBarInput(e: Event) {
    const v = (e.target as HTMLTextAreaElement).value;
    formulaBarDraft.value = v;
    fbDirty = true; // 用户在公式栏输入了，即使输入为空（删除全部）也算用户意图
    if (!s.editingCell.value) {
      s.startEdit();
    }
  }

  // 幂等保护：blur → accept → blur → cancel 这种链式异步重入时，只允许结束一次
  let fbGate_committing = false;
  /**
   * 公式栏是否被用户主动修改过（onFormulaBarInput 置 true；其余初始化/重置路径置 false）。
   * —— 关键作用：防止"用户仅点击 A1→再点 B2 就把 A1 清空"：
   *   !editingCell 场景下，watch(activeCell 切换) 会把 draft 重置为 ''；如果没有 fbDirty，acceptFormulaBarEdit
   *   会比较 '' !== curRaw 然后 setCellValue('',curCell) 把原 activeCell 写空。只有 fbDirty=true 时才代表用户真改了。
   */
  let fbDirty = false;

  /**
   * 接受编辑（✔/Enter/blur）：
   *  1. draft → s.editValue
   *  2. commitEdit → 写入 Cell.value（触发 Undo/Redo 栈）
   *  3. 按 Excel 风格：接受后 active 下移一行
   */
  /**
   * 接受公式栏草稿 → 写入 active/editing 单元格。唯一的落盘入口。
   * 调用者：✔ 按钮 / Enter 键 / blur 失焦 / onMouseDown / onDblClick。
   * —— 双重兜底：
   *   (a) 如果 editingCell 不为空 → draft → s.editValue → commitEdit → Cell.value；
   *   (b) 如果 editingCell 已空（比如 onMouseDown 之前已经被 s.commitEdit 清掉了），
   *       仍然比较草稿和当前 activeCell 的原始值，若有差异就 saveUndo + setCellValue 再写一次，
   *       绝对不允许用户在公式栏输入的内容丢失。
   */
  /**
   * 接受编辑 → 写入数据模型。可能的编辑来源：
   *   1) 公式栏 textarea（实时写 formulaBarDraft.value）；
   *   2) 单元格双击进入的行内编辑器（实时写 s.editValue.value）。
   * ⚠️ 数据源选择必须按"焦点 / 是否实际修改了草稿"来判断 —— 绝对不能统一 draft → s.editValue 覆盖，
   *    否则行内编辑器的输入会被初始值 draft 覆盖，导致"点其他单元格原编辑内容丢失 / 清空单元格"严重 BUG。
   */
  /**
   * 接受编辑 → 写入数据模型。
   * ⚠️ 最关键的反误清空防护：
   *  1) 当 !editingCell.value 且 公式栏没 focus(focusOnFormulaBar=false) 且 用户也没改过公式栏(!fbDirty) → 纯选区切换，立即 return，绝不操作数据模型；
   *  2) 编辑态下 focusOnFormulaBar || fbDirty → 公式栏来源 → 用 draft.value 写；
   *     否则 → 行内编辑器来源 → 直接 s.commitEdit()，绝不覆盖 s.editValue。
   */
  function acceptFormulaBarEdit() {
    if (fbGate_committing) return;
    const fbRef = so.formulaBarRef.value;
    const focusOnFormulaBar = !!(fbRef && typeof document !== 'undefined' && document.activeElement === fbRef);
    // —— 纯选区切换：既没进入编辑、公式栏也没焦点、用户也没改过公式栏 → 直接 return（核心修复：避免 watch 重置的空 draft ==='' 被当成用户输入清 activeCell）
    if (!s.editingCell.value && !focusOnFormulaBar && !fbDirty) return;

    const ac = { ...s.activeCell.value };
    const editingCol = s.editingCell.value ? s.editingCell.value.col : ac.col;
    const editingRow = s.editingCell.value ? s.editingCell.value.row : ac.row;

    if (!s.editingCell.value) {
      const curRaw = s.getCellRaw(editingCol, editingRow);
      const draftChanged = formulaBarDraft.value !== curRaw;
      // 关键修复：唯一允许落盘的判据是「用户真的在公式栏输入过」（fbDirty）。
      // 即便此刻公式栏仍持有焦点（例如点击画布时 mousedown 早于 blur，document.activeElement 仍是
      // formulaBarRef），只要 fbDirty=false 就说明 draft 只是被 editingCell watch 重置后的空值/旧值，
      // 绝不能拿它覆盖单元格 —— 否则会把行内编辑器已提交（commitEdit）的原始数据清空。
      if (!fbDirty) {
        return; // 没改过公式栏：直接退出，原单元格内容保持稳定
      }
      fbGate_committing = true;
      if (draftChanged) {
        s.saveUndo?.();
        s.setCellValue(editingCol, editingRow, formulaBarDraft.value);
        scheduleRender();
        so.emitModelData?.();
      }
      so.formulaBarRef.value?.blur();
      formulaBarDraft.value = '';
      formulaBarExpanded.value = false;
      fbDirty = false;
      nextTick(() => {
        fbGate_committing = false;
      });
      return;
    }

    // editingCell 存在：分来源提交（数据源优先级：fbDirty > 行内 editValue > 默认 draft 同步）
    fbGate_committing = true;
    if (fbDirty) {
      // 1) 用户在公式栏修改过（fbDirty=true，onFormulaBarInput 置）：优先生效，draft.value → s.editValue → commitEdit
      s.editValue.value = formulaBarDraft.value;
      s.commitEdit();
      s.moveActive(0, 1);
      s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
      so.formulaBarRef.value?.blur();
      formulaBarDraft.value = '';
      formulaBarExpanded.value = false;
      fbDirty = false;
      scheduleRender();
      so.focusEditInput();
      so.emitModelData?.();
      nextTick(() => {
        fbGate_committing = false;
      });
    } else if (focusOnFormulaBar) {
      // 2) 仅 focus 了公式栏（fbDirty=false，用户没在公式栏输入，只是"点一下看看"）：
      //    —— 必须以行内编辑器已写入的 s.editValue.value 为准（用户可能在行内编辑器里已经改过内容；之前这里错误地直接用旧 draft.value 覆盖 s.editValue，
      //       当 A1 原值为空/初始值且 onMouseDown e.preventDefault() 让 textarea 保持为 activeElement 时，就会把行内已编辑内容覆盖为空/原值 —— 导致"清空单元格"严重 BUG）。
      //    —— 先把 draft 反向同步为最新 editValue（保持显示一致性），然后直接 commit s.editValue。
      formulaBarDraft.value = s.editValue.value;
      s.commitEdit();
      s.moveActive(0, 1);
      s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
      so.formulaBarRef.value?.blur();
      formulaBarDraft.value = '';
      formulaBarExpanded.value = false;
      fbDirty = false;
      scheduleRender();
      so.focusEditInput();
      so.emitModelData?.();
      nextTick(() => {
        fbGate_committing = false;
      });
    } else {
      // 3) 行内编辑器来源 / 画布点击失焦 / 非公式栏焦点：直接 s.commitEdit()（s.editValue 已被 onEditInput 填充为最新输入）
      s.commitEdit();
      so.formulaBarRef.value?.blur();
      formulaBarDraft.value = '';
      formulaBarExpanded.value = false;
      fbDirty = false;
      scheduleRender();
      so.focusEditInput();
      so.emitModelData?.();
      nextTick(() => {
        fbGate_committing = false;
      });
    }
  }

  /**
   * 取消公式栏编辑：丢弃草稿，回到进入编辑前的单元格值（✖ 按钮 / Esc 键）。
   */
  function cancelFormulaBarEdit() {
    if (fbGate_committing) return;
    fbGate_committing = true;
    if (s.editingCell.value) {
      s.cancelEdit();
    }
    // 取消编辑：清 draft/展开/dirty（除了 watch 还要手动清，防止 editingCell 之前就已空的路径）
    so.formulaBarRef.value?.blur();
    formulaBarDraft.value = '';
    formulaBarExpanded.value = false;
    fbDirty = false;
    scheduleRender();
    so.focusEditInput();
    nextTick(() => {
      fbGate_committing = false;
    });
  }
  function onFormulaBarKeydown(e: KeyboardEvent) {
    // IME 正在合成过程中的按键不处理（交给输入法/合成器决定），避免 Windows 下微软拼音/搜狗 Alt+Enter 第一下被合成起始事件吞掉。
    if (e.isComposing) return;

    // Excel 风格换行：Alt+Enter（Win）/ Option+Enter（Mac，对应 metaKey）在公式栏 textarea 光标位置插入 '\n'
    // 注：Ctrl+Alt+Enter 不视为换行（避免某些 AltGr 场景），必须 !e.ctrlKey
    if (e.key === 'Enter' && (e.altKey || e.metaKey) && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      const ta = e.target as HTMLTextAreaElement | null;
      if (!ta) return;
      // 如果还没进入编辑态，立即 startEdit 进入，保证 formulaBarDisplay 走编辑态分支（显示 draft.value，否则 draft 改了也看不到换行）
      if (!s.editingCell.value) s.startEdit();
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const value = ta.value;
      const newValue = value.substring(0, start) + '\n' + value.substring(end);
      const caret = start + 1;
      // 只写响应式草稿；DOM value 的同步完全交给 Vue 的 :value = formulaBarDisplay（computed 返回 draft.value），避免和 Vue 异步回写赛跑。
      formulaBarDraft.value = newValue;
      // 收起态立即展开，保证用户能看到新插入的那一行（单行 + overflow:hidden 否则看不到）
      if (!formulaBarExpanded.value) formulaBarExpanded.value = true;
      // 光标 & 滚动 & 焦点放到 nextTick：
      //   1) 等 Vue 用 draft.value 重写 textarea.value 后再 setSelectionRange，避免覆盖导致光标丢到末尾；
      //   2) 等 Alt 键激活 OS 菜单栏那 1 帧焦点劫持过去又回来的窗口，try/catch 避免非焦点态抛 DOMException。
      nextTick(() => {
        try {
          ta.setSelectionRange(caret, caret);
        } catch {
          // ignore
        }
        if (formulaBarExpanded.value) {
          try {
            ta.scrollTop = ta.scrollHeight;
          } catch {
            // ignore
          }
        }
        // 强制夺回焦点：Windows/Chrome Alt 会短暂激活系统菜单栏，输入焦点实际脱离 textarea。
        try {
          ta.focus({ preventScroll: true });
        } catch {
          // ignore
        }
      });
      return;
    }
    if (e.key === 'Enter') {
      // Enter = 接受编辑（✔）
      e.preventDefault();
      acceptFormulaBarEdit();
    } else if (e.key === 'Escape') {
      // Escape = 取消编辑（✖）
      e.preventDefault();
      cancelFormulaBarEdit();
    }
  }

  /**
   * 公式栏失焦 = 按用户要求等同于接受（✔）。
   * - 不检查 nextTick activeElement（存在很多浏览器/Vue 异步导致误判，会出现用户点了画布/按钮后本该接受却没接受）。
   * - ✔/✖ 按钮本身在 spreader.vue 里已用 @mousedown.prevent 阻止 textarea 失焦，不会重复触发。
   * - 再叠加 acceptFormulaBarEdit 内部幂等锁 fbGate_committing 保证只提交一次。
   */
  function onFormulaBarBlur() {
    acceptFormulaBarEdit();
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
      s.selectRange(0, row, s.colCount - 1, row, 'row');
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
        s.clearCellsInRange(0, s.colCount - 1, s2.startRow, s2.endRow);
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
      s.selectRange(col, 0, col, s.rowCount - 1, 'col');
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
        s.clearCellsInRange(s2.startCol, s2.endCol, 0, s.rowCount - 1);
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
        { label: t(s.locale.value, 'avg'), action: bm.avgSelected, disabled: isSingleCell },
        { label: t(s.locale.value, 'count'), action: bm.countSelected, disabled: isSingleCell },
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
    const nfForEdit = typeof st?.numberFormat === 'string' ? st.numberFormat : '';
    const rawVForEdit = s.editValue.value ?? s.getCellValue(c, r);
    // 编辑态默认对齐：与 Canvas 渲染保持一致，仅在未显式设置 textAlign 时计算，不落盘
    const hAlign = typeof st?.textAlign === 'string' ? st.textAlign : (shouldAlignRightByDefault(rawVForEdit, nfForEdit) ? 'right' : 'left');
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
      // 点击行列头/全选区：只有"在编辑中 / 公式栏正在 focus / 用户改过公式栏"才先提交，否则纯选区切换跳过（避免误清空原 activeCell）
      {
        const fbRef = so.formulaBarRef.value;
        const focusOnFb = !!(fbRef && typeof document !== 'undefined' && document.activeElement === fbRef);
        if (s.editingCell.value || focusOnFb || fbDirty) acceptFormulaBarEdit();
      }
      if (p.y < HEADER_HEIGHT && p.x >= HEADER_WIDTH) {
        const c = s.hitCol(p.x - HEADER_WIDTH + s.scrollX.value);
        if (c >= 0) {
          s.selectRange(c, 0, c, s.rowCount - 1, 'col');
          isDragging = true;
          drgSC = c;
          drgSR = 0;
        }
      } else if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
        const r = s.hitRow(p.y - HEADER_HEIGHT + s.scrollY.value);
        if (r >= 0) {
          s.selectRange(0, r, s.colCount - 1, r, 'row');
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
    // 点击单元格：只有编辑中/公式栏 focus/改过 才先 accept，纯选区切换跳过（防止误清空）
    {
      const fbRef = so.formulaBarRef.value;
      const focusOnFb = !!(fbRef && typeof document !== 'undefined' && document.activeElement === fbRef);
      if (s.editingCell.value || focusOnFb || fbDirty) acceptFormulaBarEdit();
    }
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
        if (c >= 0) s.selectRange(Math.min(drgSC, c), 0, Math.max(drgSC, c), s.rowCount - 1, 'col');
      } else if (p.x < HEADER_WIDTH && p.y >= HEADER_HEIGHT) {
        const r = s.hitRow(p.y - HEADER_HEIGHT + s.scrollY.value);
        if (r >= 0) s.selectRange(0, Math.min(drgSR, r), s.colCount - 1, Math.max(drgSR, r), 'row');
      }
      scheduleRender();
      return;
    }
    const c = s.hitCol(p.x - HEADER_WIDTH + s.scrollX.value), r = s.hitRow(p.y - HEADER_HEIGHT + s.scrollY.value);
    if (c < 0 || r < 0) return;
    if (drgSR === 0 && drgSC >= 0 && s.selection.value && s.selection.value.startRow === 0 && s.selection.value.endRow === s.rowCount - 1) {
      s.selectRange(Math.min(drgSC, c), 0, Math.max(drgSC, c), s.rowCount - 1, 'col');
    } else if (drgSC === 0 && drgSR >= 0 && s.selection.value && s.selection.value.startCol === 0 && s.selection.value.endCol === s.colCount - 1) {
      s.selectRange(0, Math.min(drgSR, r), s.colCount - 1, Math.max(drgSR, r), 'row');
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
    // 双击进入单元格编辑：只有编辑中/公式栏 focus/改过 才先 accept，纯切换跳过
    {
      const fbRef = so.formulaBarRef.value;
      const focusOnFb = !!(fbRef && typeof document !== 'undefined' && document.activeElement === fbRef);
      if (s.editingCell.value || focusOnFb || fbDirty) acceptFormulaBarEdit();
    }
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
      s.selectRange(tSC, 0, tSC, s.rowCount - 1, 'col');
      scheduleRender();
    } else if (tZone === 'row' && tSR >= 0) {
      s.commitEdit();
      s.selectRange(0, tSR, s.colCount - 1, tSR, 'row');
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
      // 行内首次输入进入编辑：同步草稿，保证公式栏立即显示与行内输入一致
      formulaBarDraft.value = val;
      scheduleRender();
      return;
    }
    s.editValue.value = val;
    // ⚠️ 关键同步：行内编辑器的输入要即时更新到公式栏草稿 formulaBarDraft。
    //    否则 formulaBarDisplay（editingCell=true 时取 draft.value）仍停留在"进入编辑态时的初值"，
    //    当用户再点击公式栏 textarea，Vue 的 :value 绑定会用旧 draft 瞬间把 textarea 内容重置为初值/空，
    //    用户看到公式栏内容"突然变成空/旧值"后只要按任意键（方向键/退格/空格）就会触发 onFormulaBarInput
    //    → draft 被写入当前显示值（空/旧）且 fbDirty=true → acceptFormulaBarEdit 的 fbDirty 分支
    //    把行内已输入的最新 s.editValue.value 覆盖回 draft 的空/旧值 → 单元格内容丢失/被清空。
    formulaBarDraft.value = val;
  }
  function onEditCompositionStart() {
    isEditComposing = true;
    if (!s.editingCell.value) {
      s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
      s.startEdit('');
      formulaBarDraft.value = ''; // 合成开始时同步：startEdit 写了 '' 草稿也要同步
      scheduleRender();
    }
  }
  function onEditCompositionEnd(e: CompositionEvent) {
    isEditComposing = false;
    compositionJustEnded = true;
    setTimeout(() => {
      compositionJustEnded = false;
    }, 0);
    const val = (e.target as HTMLTextAreaElement).value;
    s.editValue.value = val;
    // IME 合成结束后同样同步草稿（微软拼音/搜狗等合成结束事件候选提交也要保持公式栏一致）
    formulaBarDraft.value = val;
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
    formulaBarDraft,
    formulaBarExpanded,
    onFormulaBarFocus,
    onFormulaBarInput,
    onFormulaBarKeydown,
    onFormulaBarBlur,
    acceptFormulaBarEdit,
    cancelFormulaBarEdit,

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
