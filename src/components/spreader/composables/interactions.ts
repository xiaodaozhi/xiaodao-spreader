import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, type Ref, type ComputedRef } from 'vue';
import { HEADER_HEIGHT, HEADER_WIDTH, SB_SIZE, DEFAULT_COL_WIDTH, MIN_COL_WIDTH, MIN_ROW_HEIGHT, MAX_COL_WIDTH, MAX_ROW_HEIGHT, DEFAULT_FONT_FAMILY, FILL_HANDLE_SIZE, FILL_HANDLE_HIT_PADDING, t } from '../core/constants';
import { colToLabel, resolveSize, getCanvasXY } from '../core/utils';
import type { CoreState } from './core-state';
import type { UndoStylesState } from './undo-styles';
import { formatNumber, shouldAlignRightByDefault, NF_INVALID_VALUE, isFormatOverflowsToHashes, isInvalidDisplayValue } from '../core/number-format';
import { migrateCells } from '../core/style-pool';
import { migrateBordersInStyles } from '../core/border-pool';
import type { BordersMergeState } from './borders-merge';
import type { SheetsOpsState } from './sheets-ops';
import type { ContextMenuItem, BorderSide, ThemeColors, SelectionRange, FilterColumn, SheetFilter, CellData, DataValidationRule } from '../core/types';
import { resolveSharedBorder } from '../core/border-resolve';
import { computeTargetRange, validateMergeCompatibility } from '../core/autofill';
import { isColumnFiltered } from '../core/filter-core';
import type { OutlineValidationResult } from '../core/outline-core';

/** 兼容旧版筛选数据：确保加载后的 AutoFilter 具备合法的 range。
 *  - 已有 range → 防御性扩展到覆盖所有 columns 列键；
 *  - 仅有 columns（旧 per-column 模型）→ 根据列键 + 数据最大行推断 range；
 *  - 完全无 filter → 返回 null（不创建无效 AutoFilter）。 */
function normalizeLoadedFilter(raw: unknown, cells: Record<string, CellData>): SheetFilter | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { range?: SelectionRange; columns?: Record<number, FilterColumn> };
  const columns: Record<number, FilterColumn> = r.columns ?? {};
  const colKeys = Object.keys(columns).map((k) => Number(k)).filter((n) => !Number.isNaN(n));
  if (!r.range || typeof r.range.startRow !== 'number') {
    const minC = colKeys.length ? Math.min(...colKeys) : 0;
    const maxC = colKeys.length ? Math.max(...colKeys) : 0;
    let maxR = 0;
    for (const key in cells) {
      const comma = key.indexOf(',');
      if (comma < 0) continue;
      const rr = parseInt(key.substring(comma + 1), 10);
      if (rr > maxR) maxR = rr;
    }
    return { range: { startCol: minC, startRow: 0, endCol: maxC, endRow: Math.max(0, maxR) }, columns };
  }
  const range = { ...r.range };
  for (const c of colKeys) {
    if (c < range.startCol) range.startCol = c;
    if (c > range.endCol) range.endCol = c;
  }
  return { range, columns };
}

/** 数据验证下拉弹窗状态：anchor 为单元格在视口中的位置（client 坐标） */
export interface ValidationDropdownState {
  col: number;
  row: number;
  rule: DataValidationRule;
  items: string[];
  /** 当前单元格原始值（用于标记选中项） */
  current: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InteractionsState {
  // 渲染器
  scheduleRender: () => void;
  render: () => void;
  renderFrozenOverlay: () => void;

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
  insertFunctionIntoCell: (text: string) => void; // 插入函数对话框「插入」：将公式直接写入目标单元格（落盘）

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

  // 筛选弹窗
  filterPopup: Ref<{ col: number; x: number; y: number } | null>;
  isFilterButtonHit: (x: number, y: number) => number;
  openFilterPopup: (col: number) => void;
  closeFilterPopup: () => void;

  // 数据验证下拉列表（List Validation）
  validationDropdown: Ref<ValidationDropdownState | null>;
  /** 屏幕坐标（client）是否命中某单元格的下拉箭头；命中返回该单元格坐标（合并格返回左上角） */
  isValidationDropdownHit: (x: number, y: number) => { col: number; row: number } | null;
  openValidationDropdown: (col: number, row: number) => boolean;
  closeValidationDropdown: () => void;
  onValidationDropdownSelect: (value: string) => void;

  // 行高/列宽浮动设置栏
  dimInputRef: Ref<HTMLInputElement | null>;
  dimPanel: Ref<{ type: 'row' | 'col'; x: number; y: number; value: string; error: string } | null>;
  openDimPanel: (type: 'row' | 'col', x: number, y: number) => void;
  onDimInput: (e: Event) => void;
  onDimKeydown: (e: KeyboardEvent) => void;
  onDimBlur: () => void;
  applyDimPanel: () => void;
  closeDimPanel: () => void;

  // 行列分组（Outline）：供工具栏触发的动作
  outlineGroupRows: () => boolean;
  outlineGroupCols: () => boolean;
  outlineUngroupRows: () => boolean;
  outlineUngroupCols: () => boolean;
  outlineExpandRows: () => void;
  outlineCollapseRows: () => void;
  outlineExpandCols: () => void;
  outlineCollapseCols: () => void;
  /** 分组校验提示：由宿主注入的应用内对话框；未注入时回退 window.alert */
  showOutlineAlert?: (message: string) => void;

  // 编辑输入框 CSS
  editInputStyle: ComputedRef<Record<string, string | number | undefined>>;

  // 滚动条
  hScrollbarW: ComputedRef<number>;
  vScrollbarH: ComputedRef<number>;
  hScrollbarLeft: ComputedRef<number>;
  vScrollbarTop: ComputedRef<number>;
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
  /** 分组校验应用内对话框（由 host 通过 state.showOutlineAlert 注入） */
  let outlineAlertApi: ((message: string) => void) | undefined;
  let drawCells: (rCtx: CanvasRenderingContext2D, sC2: number, eC2: number, sR2: number, eR2: number, rHs: number[]) => void = () => {};
  let drawBorders: (rCtx: CanvasRenderingContext2D, sC2: number, eC2: number, sR2: number, eR2: number, rHs: number[]) => void = () => {};
  let drawMergedCells: (ctx: CanvasRenderingContext2D, vx: number, vy: number, vw: number, vh: number) => void = () => {};

  function scheduleRender() {
    if (!rp) {
      rp = true;
      requestAnimationFrame(() => {
        rp = false;
        render();
        renderFrozenOverlay();
      });
    }
  }
  // 反向注入到 core-state
  s.scheduleRender = scheduleRender;

  // 屏幕坐标 → 列/行（冻结感知：落在冻结列/行区时不减 scrollX/scrollY）
  function screenXToCol(x: number): number {
    const { frozenColumnsWidth } = s.getFrozenMetrics();
    const logicalX = (frozenColumnsWidth > 0 && x < hwOff() + frozenColumnsWidth)
      ? (x - hwOff())
      : (x - hwOff() + s.scrollX.value);
    return s.hitCol(logicalX);
  }
  function screenYToRow(y: number): number {
    const { frozenRowsHeight } = s.getFrozenMetrics();
    const logicalY = (frozenRowsHeight > 0 && y < hhOff() + frozenRowsHeight)
      ? (y - hhOff())
      : (y - hhOff() + s.scrollY.value);
    return s.hitRow(logicalY);
  }

  const BORDER_COLOR = '#444';
  /** 单元格内下拉箭头的命中/绘制宽度 */
  const DV_DROPDOWN_W = 14;
  // ---- 行列分组（Outline）绘制常量 ----
  const OUTLINE_STEP = 9;      // 浮动显示时每个分组层级在行头/列头内占用的像素步长
  const OUTLINE_PANEL = 16;    // 行分组 ± 按钮的起始左内边距（左上 Level 控件条已移除，仅一层分组）
  const OUTLINE_BTN = Math.min(OUTLINE_STEP - 1, 9); // ± 折叠按钮边长（浮动于表头内）
  /** 行/列 gutter 总尺寸：浮动显示于行头/列头内，不再预留独立分区 → 恒为 0 */
  function outlineGutterSize(_axis: 'row' | 'column'): number {
    return 0;
  }
  /** 行分组 gutter 宽（整体网格/表头向右平移量）：浮动显示 → 0 */
  const outlineGapX = () => outlineGutterSize('row');
  /** 列分组 gutter 高（整体网格/表头向下平移量）：浮动显示 → 0 */
  const outlineGapY = () => outlineGutterSize('column');
  /** 含 Outline gutter 偏移后的表头左边界（网格起点 x） */
  const hwOff = () => HEADER_WIDTH + outlineGapX();
  /** 含 Outline gutter 偏移后的表头上边界（网格起点 y） */
  const hhOff = () => HEADER_HEIGHT + outlineGapY();
  /** 行分组 ± 折叠按钮的浮动锚点 x（行头带内，分组区间用背景色区分）。 */
  function rowOutlineAnchorX(o: { level: number }, maxRowL: number): number {
    return OUTLINE_PANEL + 2 + (maxRowL - o.level) * OUTLINE_STEP;
  }
  /** 列分组 ± 折叠按钮的浮动锚点 y（列头带内，分组区间用背景色区分）。 */
  function colOutlineAnchorY(o: { level: number }, maxColL: number): number {
    return 3 + (maxColL - o.level) * OUTLINE_STEP;
  }
  /**
   * 为被分组覆盖的序号位分配交替背景色索引（0/1），相邻分组取不同色。
   * 返回长度为 count 的数组，未分组位置为 -1。
   * 规则：按 start 升序给分组排号并交替取色；某序号被多个分组覆盖时取 start 最小的外层分组色。
   */
  function buildOutlineColorMap(
    outlines: Array<{ id: string; start: number; end: number }>,
    count: number,
  ): Int8Array {
    const map = new Int8Array(count).fill(-1);
    if (!outlines.length) return map;
    const sorted = [...outlines].sort((a, b) => a.start - b.start);
    const colorBy = new Map<string, number>();
    sorted.forEach((o, i) => colorBy.set(o.id, i % 2));
    for (const o of sorted) {
      const c = colorBy.get(o.id)!;
      const end = Math.min(o.end, count - 1);
      for (let d = Math.max(0, o.start); d <= end; d++) {
        if (map[d] === -1) map[d] = c;
      }
    }
    return map;
  }

  function render() {
    const wrapper = so.wrapperRef.value;
    const cvs = so.canvasRef.value;
    if (!wrapper || !cvs) return;
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
    const gX = outlineGapX();
    const gY = outlineGapY();
    const hw = HW + gX;
    const hh = HH + gY;
    const cs = so.themeColors.value;
    const f = s.getFilter();
    const cP = s.colPositions.value;
    const rP = s.rowPositions.value;
    // 分组交替背景色索引（-1 未分组；0/1 对应 outlineGroupBg1/2）
    const rowGroupColor = buildOutlineColorMap(s.getRowOutlines(), s.rowCount);
    const colGroupColor = buildOutlineColorMap(s.getColumnOutlines(), s.colCount);

    // ---- 冻结区域尺寸 & body 视口 ----
    const { frozenRowsHeight, frozenColumnsWidth } = s.getFrozenMetrics();
    const bodyLeft = hw + frozenColumnsWidth;
    const bodyTop = hh + frozenRowsHeight;
    const bodyWidth = Math.max(0, W - hw - SB_SIZE - frozenColumnsWidth);
    const bodyHeight = Math.max(0, H - hh - SB_SIZE - frozenRowsHeight);
    const frozenEC = Math.max(0, s.freeze.cols - 1);
    const frozenER = Math.max(0, s.freeze.rows - 1);

    // body 可见区间（逻辑位置 = 冻结尺寸 + body 相对滚动）
    const bodySC = Math.max(s.freeze.cols, s.hitCol(frozenColumnsWidth + sx));
    let bodyEC = bodySC;
    for (let c = bodySC; c < s.colCount; c++) {
      if (hw + cP[c]! - sx >= W) break;
      bodyEC = c;
    }
    const bodySR = Math.max(s.freeze.rows, s.hitRow(frozenRowsHeight + sy));
    let bodyER = bodySR;
    for (let r = bodySR; r < s.rowCount; r++) {
      if (hh + rP[r]! - sy >= H) break;
      bodyER = r;
    }
    // 并集区间（含冻结区域），供 drawCells/drawBorders 迭代后按区域裁剪
    let sC = bodySC, eC = bodyEC, sR = bodySR, eR = bodyER;
    if (frozenColumnsWidth > 0) {
      sC = 0;
      eC = Math.max(eC, frozenEC);
    }
    if (frozenRowsHeight > 0) {
      sR = 0;
      eR = Math.max(eR, frozenER);
    }

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

    // 仅构建可见区间的行高信息，避免遍历全部行
    const rH: number[] = new Array(iterR);
    for (let i = iterR; i <= eR; i++) {
      rH[i] = rP[i + 1]! - rP[i]!;
    }

    rCtx.fillStyle = cs.bg;
    rCtx.fillRect(0, 0, W, H);
    rCtx.fillStyle = cs.gridBg;
    rCtx.fillRect(hw, hh, W - hw, H - hh);
    const sel = s.selection.value;
    const ed = s.editingCell.value;

    // 第一步：绘制背景色、选中状态、文本内容（抽取为局部函数 drawCells，坐标改用 cellToScreenRect 以兼容冻结）
    drawCells = (rCtx: CanvasRenderingContext2D, sC2: number, eC2: number, sR2: number, eR2: number, rHs: number[]): void => {
      // 无任何数据验证规则时跳过全部判定（零开销快路径）
      const dvHasAny = s.dataValidations.length > 0;
      for (let row = sR2; row <= eR2; row++) {
        if (s.isRowCollapsed(row)) continue; // 折叠行不绘制内容（避免 0 高度负 clip 的窄条残影）
        for (let col = sC2; col <= eC2; col++) {
          if (s.isColumnCollapsed(col)) continue; // 折叠列不绘制内容（避免 0 宽度负 clip 的窄条残影）
          const mergeInfo = s.findMerge(col, row);
          // 合并单元格统一交由 drawMergedCells 按各 pane 视口相交绘制（支持跨冻结线拆分）
          if (mergeInfo) continue;
          const rect2 = s.cellToScreenRect(row, col);
          const x = rect2.x, y = rect2.y, cw = rect2.width, rh = rect2.height;
          if (x + cw < hw || y + rh < hh || x > W || y > H) continue;

          // 查找高亮：整体填充（在背景色之后、选区/文本之前绘制）
          const hl = s.findHighlight ? s.findHighlight(col, row) : null;

          const resolvedBg = s.resolveStyle(s.cells[s.cellKey(col, row)]);
          const bgColor = typeof resolvedBg?.backgroundColor === 'string' ? resolvedBg.backgroundColor : '';
          if (bgColor) {
            rCtx.fillStyle = bgColor;
            rCtx.fillRect(x, y, cw, rh);
          }
          // 条件格式：临时合成 Render Style（Base + CF），不写回 cell.style
          const cf = s.resolveConditionalFormat(col, row);
          if (cf?.backgroundColor) {
            rCtx.fillStyle = cf.backgroundColor;
            rCtx.fillRect(x, y, cw, rh);
          }
          if (hl) {
            rCtx.fillStyle = hl === 'active' ? cs.findActiveBg : cs.findMatchBg;
            rCtx.fillRect(x, y, cw, rh);
          }
          if (s.isSelected(col, row)) {
            rCtx.fillStyle = cs.selectionBg;
            // row/col 选择模式下按单个 cell 大小填色（Excel 风格「穿透合并单元格」）：
            // 即便 anchor 当前 cw/rh 是合并后的大小，也只填当前 cell(col,row) 对应的 cW[col]/rH[row]。
            if (s.selectionMode.value === 'row' || s.selectionMode.value === 'col') {
              rCtx.fillRect(x, y, (cP[col + 1] ?? 0) - cP[col]!, rHs[row]!);
            } else {
              rCtx.fillRect(x, y, cw, rh);
            }
          }
          if (s.activeCell.value.col === col && s.activeCell.value.row === row) {
            rCtx.strokeStyle = cs.activeCellBorder;
            rCtx.lineWidth = 2;
            rCtx.strokeRect(x + 1, y + 1, cw - 2, rh - 2);
          }
          if (hl === 'active') {
          // 当前匹配项：额外描边强化视觉效果（覆盖在选区之上）
            rCtx.strokeStyle = cs.findActiveBg;
            rCtx.lineWidth = 2;
            rCtx.strokeRect(x + 1, y + 1, cw - 2, rh - 2);
          }
          rCtx.strokeStyle = cs.gridLine;
          rCtx.lineWidth = 0.5;
          rCtx.strokeRect(x + 0.25, y + 0.25, cw - 0.5, rh - 0.5);
          if (!(ed && ed.col === col && ed.row === row)) {
            const st = s.resolveStyle(s.cells[s.cellKey(col, row)]);
            const rawV = s.getCellValue(col, row);
            const nf = typeof st?.numberFormat === 'string' ? st.numberFormat : '';
            const v = rawV ? formatNumber(rawV, nf, s.locale.value) : '';
            if (v) {
              const fsz = s.cellFontSize(col, row);
              const ffa = typeof st?.fontFamily === 'string' && st.fontFamily ? st.fontFamily : DEFAULT_FONT_FAMILY;
              const fw = st?.fontWeight === 'bold' || cf?.fontWeight === 'bold' ? 'bold' : 'normal';
              const fstyle = st?.fontStyle === 'italic' || cf?.fontStyle === 'italic' ? 'italic' : 'normal';
              const hasU = st?.underline === 'underline' || cf?.underline === 'underline';
              const hasS = st?.strikethrough === 'line-through' || cf?.strikethrough === 'line-through';
              const txtColor = cf?.color || (typeof st?.color === 'string' ? st.color : '');
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
              let availW = cw - 10;
              // Filter Range 表头行的文字右侧为筛选按钮预留宽度，避免被按钮背景遮挡
              if (f && row === f.range.startRow && col >= f.range.startCol && col <= f.range.endCol) {
                availW = cw - 10 - FILTER_BTN_W;
              }
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
          // ---- AutoFilter 箭头：仅绘制在 Filter Range 的 Header 行、且列落在范围内 ----
          if (f && row === f.range.startRow && col >= f.range.startCol && col <= f.range.endCol) {
            drawFilterButton(rCtx, x, y, cw, rh, isColumnFiltered(f.columns[col]), cs);
          }
          // ---- 数据验证下拉箭头：list 验证 + showDropdown !== false ----
          if (dvHasAny && s.getListValidation(row, col)) {
            const isActive = s.activeCell.value.col === col && s.activeCell.value.row === row;
            drawValidationDropdownIndicator(rCtx, x, y, cw, rh, isActive || s.isSelected(col, row), cs);
          }
        }
      }
    };

    // 第二步 + 第三步：绘制边框 + 角方块（基于 resolveSharedBorder 统一冲突解析）
    // 辅助：获取某位置的边框侧（考虑 merge，从 anchor 读取）
    const getBorderSideAt = (col: number, row: number, side: 'top' | 'right' | 'bottom' | 'left'): BorderSide | undefined => {
      const m = s.findMerge(col, row);
      if (m) {
        return s.getCellBorderSide(s.cells[m.anchor], side);
      }
      return s.getCellBorderSide(s.cells[s.cellKey(col, row)], side);
    };
    drawBorders = (rCtx: CanvasRenderingContext2D, sC2: number, eC2: number, sR2: number, eR2: number, _rHs: number[]): void => {
      rCtx.fillStyle = BORDER_COLOR;
      for (let row = sR2; row <= eR2; row++) {
        if (s.isRowCollapsed(row)) continue; // 折叠行不绘制边框（避免 0 高度负宽残影）
        for (let col = sC2; col <= eC2; col++) {
          if (s.isColumnCollapsed(col)) continue; // 折叠列不绘制边框（避免 0 宽度负宽残影）
          const mergeInfo = s.findMerge(col, row);
          // 合并单元格（含 anchor）统一交由 drawMergedCells / drawMergeBorder 绘制，
          // 避免旧坐标（anchor 不叠加 scrollX）导致 right 边/角方块钉在原位
          if (mergeInfo) continue;

          const rect2 = s.cellToScreenRect(row, col);
          const x = rect2.x, y = rect2.y, cw = rect2.width, rh = rect2.height;
          if (x + cw < hw || y + rh < hh || x > W || y > H) continue;

          const cell = s.cells[s.cellKey(col, row)];
          const ownBorder: Record<string, BorderSide | undefined> = {
            top: s.getCellBorderSide(cell, 'top'),
            right: s.getCellBorderSide(cell, 'right'),
            bottom: s.getCellBorderSide(cell, 'bottom'),
            left: s.getCellBorderSide(cell, 'left'),
          };

          // 普通单格：4 条边各自用 resolveSharedBorder 解析
          const neighbors = {
            top: getBorderSideAt(col, row - 1, 'bottom'),
            left: getBorderSideAt(col - 1, row, 'right'),
            bottom: getBorderSideAt(col, row + 1, 'top'),
            right: getBorderSideAt(col + 1, row, 'left'),
          };
          const rT = resolveSharedBorder(neighbors.top, ownBorder.top);
          const rL = resolveSharedBorder(neighbors.left, ownBorder.left);
          const rB = resolveSharedBorder(ownBorder.bottom, neighbors.bottom);
          const rR = resolveSharedBorder(ownBorder.right, neighbors.right);
          const wT = rT?.width ?? 0;
          const wL = rL?.width ?? 0;
          const wB = rB?.width ?? 0;
          const wR = rR?.width ?? 0;
          if (wT > 0) {
            rCtx.fillStyle = rT?.color || BORDER_COLOR;
            rCtx.fillRect(x, y, cw, wT);
          }
          if (wB > 0) {
            rCtx.fillStyle = rB?.color || BORDER_COLOR;
            rCtx.fillRect(x, y + rh - wB, cw, wB);
          }
          if (wL > 0) {
            rCtx.fillStyle = rL?.color || BORDER_COLOR;
            rCtx.fillRect(x, y, wL, rh);
          }
          if (wR > 0) {
            rCtx.fillStyle = rR?.color || BORDER_COLOR;
            rCtx.fillRect(x + cw - wR, y, wR, rh);
          }
          // 角方块
          if (wT > 0 && wL > 0) {
            rCtx.fillStyle = rT?.color || rL?.color || BORDER_COLOR;
            rCtx.fillRect(x - wL, y - wT, wL, wT);
          }
          if (wT > 0 && wR > 0) {
            rCtx.fillStyle = rT?.color || rR?.color || BORDER_COLOR;
            rCtx.fillRect(x + cw, y - wT, wR, wT);
          }
          if (wB > 0 && wL > 0) {
            rCtx.fillStyle = rB?.color || rL?.color || BORDER_COLOR;
            rCtx.fillRect(x - wL, y + rh, wL, wB);
          }
          if (wB > 0 && wR > 0) {
            rCtx.fillStyle = rB?.color || rR?.color || BORDER_COLOR;
            rCtx.fillRect(x + cw, y + rh, wR, wB);
          }
        }
      }
    };

    // ---- 合并单元格：按各 pane 视口相交分段绘制 ----
    // 每个 pane 调用时只绘制与自身视口 [vx,vy,vw,vh] 相交的那一段：
    // 背景/网格/文本锚定在合并左上角（anchor），因此文本只会在包含 anchor 的 pane 中可见，
    // 其余 pane 仅显示该段的背景与边框——实现「冻结部分冻结、非冻结部分随 body 滚动」。
    // 合并文本：布局始终基于「逻辑宽高」(logicW/logicH)——即合并未滚动时的完整尺寸，
    // 不随 scrollX/Y 变化；绘制起点 (drawX/drawY) 按 pane 平移：冻结 pane 用 anchor 原位置（不叠加滚动），
    // body pane 用 anchor - scroll，靠两层 clip 拼出「冻结段固定显示开头 + body 段随滚动移动」。
    const drawMergeText = (ctx: CanvasRenderingContext2D, col: number, row: number, logicW: number, logicH: number, drawX: number, drawY: number): void => {
      const st = s.resolveStyle(s.cells[s.cellKey(col, row)]);
      const rawV = s.getCellValue(col, row);
      const nf = typeof st?.numberFormat === 'string' ? st.numberFormat : '';
      const v = rawV ? formatNumber(rawV, nf, s.locale.value) : '';
      if (!v) return;
      // 合并格落到折叠(0 尺寸)区域：无可绘制宽度/高度时直接返回，
      // 避免 rect 负宽/负高产生的 ~10px 窄条残影
      const availW0 = logicW - 10;
      if (availW0 <= 0 || logicH - 2 <= 0) return;
      const fsz = s.cellFontSize(col, row);
      const ffa = typeof st?.fontFamily === 'string' && st.fontFamily ? st.fontFamily : DEFAULT_FONT_FAMILY;
      const cfMt = s.resolveConditionalFormat(col, row);
      const fw = st?.fontWeight === 'bold' || cfMt?.fontWeight === 'bold' ? 'bold' : 'normal';
      const fstyle = st?.fontStyle === 'italic' || cfMt?.fontStyle === 'italic' ? 'italic' : 'normal';
      const hasU = st?.underline === 'underline' || cfMt?.underline === 'underline';
      const hasS = st?.strikethrough === 'line-through' || cfMt?.strikethrough === 'line-through';
      const txtColor = cfMt?.color || (typeof st?.color === 'string' ? st.color : '');
      const hAlign = typeof st?.textAlign === 'string' ? st.textAlign : (shouldAlignRightByDefault(rawV, nf) ? 'right' : 'left');
      const vAlign = typeof st?.verticalAlign === 'string' ? st.verticalAlign : 'top';
      ctx.fillStyle = txtColor || cs.cellText;
      ctx.font = `${fstyle} ${fw} ${fsz}px ${ffa}`;
      ctx.textBaseline = 'alphabetic';
      ctx.save();
      ctx.beginPath();
      ctx.rect(drawX + 5, drawY + 1, logicW - 10, logicH - 2);
      ctx.clip();
      const stWrap = st?.wrap === 'wrap';
      const availW = logicW - 10;
      let displayV = v;
      const needOverflowHashes = !stWrap && isFormatOverflowsToHashes(nf);
      const invalidValue = v === NF_INVALID_VALUE || isInvalidDisplayValue(rawV, nf);
      if (invalidValue || needOverflowHashes) {
        if (invalidValue) {
          const hashW = Math.max(1, ctx.measureText('#').width);
          const count = Math.max(1, Math.floor(availW / hashW));
          displayV = '#'.repeat(count);
        } else {
          const preLines = s.getWrappedLines(ctx, v, 1e9, false);
          const anyOverflow = preLines.some((line) => line && ctx.measureText(line).width > availW);
          if (anyOverflow) {
            const hashW = Math.max(1, ctx.measureText('#').width);
            const count = Math.max(1, Math.floor(availW / hashW));
            displayV = '#'.repeat(count);
          }
        }
      }
      const textLines = s.getWrappedLines(ctx, displayV, availW, stWrap);
      const { ascent: maxAsc, descent: maxDesc } = s.measureFontMetrics(ffa, fsz, fw, fstyle);
      const lineH = maxAsc + maxDesc;
      const totalH = textLines.length * lineH;
      let ty: number;
      if (vAlign === 'middle') ty = drawY + (logicH - totalH) / 2 + maxAsc;
      else if (vAlign === 'bottom') ty = drawY + logicH - s.BASE_CELL_VPAD - maxDesc - (textLines.length - 1) * lineH;
      else ty = drawY + s.BASE_CELL_VPAD + maxAsc;
      for (let li = 0; li < textLines.length; li++) {
        const line = textLines[li]!;
        const lineTy = ty + li * lineH;
        const lm = ctx.measureText(line);
        let tx: number;
        if (hAlign === 'center') tx = drawX + logicW / 2 - lm.width / 2;
        else if (hAlign === 'right') tx = drawX + logicW - 5 - lm.width;
        else tx = drawX + 5;
        ctx.fillText(line, tx, lineTy);
        if (hasU) {
          ctx.strokeStyle = txtColor || cs.cellText;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(tx, lineTy + maxDesc + 1);
          ctx.lineTo(tx + lm.width, lineTy + maxDesc + 1);
          ctx.stroke();
        }
        if (hasS) {
          ctx.strokeStyle = txtColor || cs.cellText;
          ctx.lineWidth = 1;
          const strikeY = lineTy - maxAsc + lineH * 0.42;
          ctx.beginPath();
          ctx.moveTo(tx, strikeY);
          ctx.lineTo(tx + lm.width, strikeY);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    // 合并单元格边框（基于 resolveSharedBorder），仅绘制与视口相交的部分（依赖外层 clip）。
    // ax/ay/aw/ah 为合并整体屏幕矩形（已由 drawMergedCells 按 anchor+endCell 合成，
    // 正确处理跨冻结线时 body 端叠加 scrollX）。
    // hFrozenPane/vFrozenPane：当前 pane 在水平/垂直方向是否为冻结区（vx<bodyLeft / vy<bodyTop）。
    // 冻结 pane 只绘制属于自己的「冻结段」边框：跨冻结线时 right 边与右上/右下角归属 body pane，
    // bottom 边与左下/右下角归属 body pane；否则滚动后这些边会错误地画进冻结段内部。
    const drawMergeBorder = (ctx: CanvasRenderingContext2D, m: { startCol: number; startRow: number; endCol: number; endRow: number }, ax: number, ay: number, aw: number, ah: number, hFrozenPane: boolean, vFrozenPane: boolean): void => {
      const sC = m.startCol, eCm = m.endCol, sR = m.startRow, eRm = m.endRow;
      const y = ay, rh = ah;
      const skipRightAll = hFrozenPane && eCm >= s.freeze.cols;
      const skipBottomAll = vFrozenPane && eRm >= s.freeze.rows;
      const cell = s.cells[s.cellKey(sC, sR)];
      const ownBorder: Record<string, BorderSide | undefined> = {
        top: s.getCellBorderSide(cell, 'top'),
        right: s.getCellBorderSide(cell, 'right'),
        bottom: s.getCellBorderSide(cell, 'bottom'),
        left: s.getCellBorderSide(cell, 'left'),
      };
      ctx.fillStyle = BORDER_COLOR;
      for (let cc = sC; cc <= eCm; cc++) {
        if (hFrozenPane && cc >= s.freeze.cols) continue;
        if (s.isSameMergeInternal(cc, sR - 1, cc, sR)) continue;
        const neighborBottom = getBorderSideAt(cc, sR - 1, 'bottom');
        const resolved = resolveSharedBorder(neighborBottom, ownBorder.top, 'cell', 'merge');
        if (resolved && resolved.width && resolved.width > 0) {
          const sxSeg = cc < s.freeze.cols ? (HW + cP[cc]!) : (HW + cP[cc]! - sx);
          ctx.fillStyle = resolved.color || BORDER_COLOR;
          ctx.fillRect(sxSeg, y, (cP[cc + 1] ?? 0) - cP[cc]!, resolved.width);
        }
      }
      if (!skipBottomAll) {
        for (let cc = sC; cc <= eCm; cc++) {
          if (hFrozenPane && cc >= s.freeze.cols) continue;
          if (s.isSameMergeInternal(cc, eRm, cc, eRm + 1)) continue;
          const neighborTop = getBorderSideAt(cc, eRm + 1, 'top');
          const resolved = resolveSharedBorder(ownBorder.bottom, neighborTop, 'merge', 'cell');
          if (resolved && resolved.width && resolved.width > 0) {
            const sxSeg = cc < s.freeze.cols ? (HW + cP[cc]!) : (HW + cP[cc]! - sx);
            ctx.fillStyle = resolved.color || BORDER_COLOR;
            ctx.fillRect(sxSeg, y + rh - resolved.width, (cP[cc + 1] ?? 0) - cP[cc]!, resolved.width);
          }
        }
      }
      for (let rr = sR; rr <= eRm; rr++) {
        if (vFrozenPane && rr >= s.freeze.rows) continue;
        if (s.isSameMergeInternal(sC - 1, rr, sC, rr)) continue;
        const neighborRight = getBorderSideAt(sC - 1, rr, 'right');
        const resolved = resolveSharedBorder(neighborRight, ownBorder.left, 'cell', 'merge');
        if (resolved && resolved.width && resolved.width > 0) {
          const sySeg = rr < s.freeze.rows ? (HH + rP[rr]!) : (HH + rP[rr]! - sy);
          const rhSeg = rP[rr + 1]! - rP[rr]!;
          ctx.fillStyle = resolved.color || BORDER_COLOR;
          ctx.fillRect(ax, sySeg, resolved.width, rhSeg);
        }
      }
      if (!skipRightAll) {
        for (let rr = sR; rr <= eRm; rr++) {
          if (vFrozenPane && rr >= s.freeze.rows) continue;
          if (s.isSameMergeInternal(eCm, rr, eCm + 1, rr)) continue;
          const neighborLeft = getBorderSideAt(eCm + 1, rr, 'left');
          const resolved = resolveSharedBorder(ownBorder.right, neighborLeft, 'merge', 'cell');
          if (resolved && resolved.width && resolved.width > 0) {
            const sySeg = rr < s.freeze.rows ? (HH + rP[rr]!) : (HH + rP[rr]! - sy);
            const rhSeg = rP[rr + 1]! - rP[rr]!;
            ctx.fillStyle = resolved.color || BORDER_COLOR;
            ctx.fillRect(ax + aw - resolved.width, sySeg, resolved.width, rhSeg);
          }
        }
      }

      // ── 合并格四角方块（合并矩形外侧转角，坐标用合成矩形 ax/ay/aw/ah，随 scrollX/Y 平移）──
      // 左上角 (sC, sR)
      {
        const topSeg = !s.isSameMergeInternal(sC, sR - 1, sC, sR)
          ? resolveSharedBorder(getBorderSideAt(sC, sR - 1, 'bottom'), ownBorder.top, 'cell', 'merge')
          : ownBorder.top;
        const leftSeg = !s.isSameMergeInternal(sC - 1, sR, sC, sR)
          ? resolveSharedBorder(getBorderSideAt(sC - 1, sR, 'right'), ownBorder.left, 'cell', 'merge')
          : ownBorder.left;
        const wT = topSeg?.width ?? 0;
        const wL = leftSeg?.width ?? 0;
        if (wT > 0 && wL > 0) {
          ctx.fillStyle = topSeg?.color || leftSeg?.color || BORDER_COLOR;
          ctx.fillRect(ax - wL, ay - wT, wL, wT);
        }
      }
      // 右上角 (eC, sR)：属 body 段边界，冻结 pane 不画
      if (!skipRightAll) {
        const topSeg = !s.isSameMergeInternal(eCm, sR - 1, eCm, sR)
          ? resolveSharedBorder(getBorderSideAt(eCm, sR - 1, 'bottom'), ownBorder.top, 'cell', 'merge')
          : ownBorder.top;
        const rightSeg = !s.isSameMergeInternal(eCm, sR, eCm + 1, sR)
          ? resolveSharedBorder(ownBorder.right, getBorderSideAt(eCm + 1, sR, 'left'), 'merge', 'cell')
          : ownBorder.right;
        const wT = topSeg?.width ?? 0;
        const wR = rightSeg?.width ?? 0;
        if (wT > 0 && wR > 0) {
          ctx.fillStyle = topSeg?.color || rightSeg?.color || BORDER_COLOR;
          ctx.fillRect(ax + aw, ay - wT, wR, wT);
        }
      }
      // 左下角 (sC, eR)：属 body 段边界，冻结 pane 不画
      if (!skipBottomAll) {
        const bottomSeg = !s.isSameMergeInternal(sC, eRm, sC, eRm + 1)
          ? resolveSharedBorder(ownBorder.bottom, getBorderSideAt(sC, eRm + 1, 'top'), 'merge', 'cell')
          : ownBorder.bottom;
        const leftSeg = !s.isSameMergeInternal(sC - 1, eRm, sC, eRm)
          ? resolveSharedBorder(getBorderSideAt(sC - 1, eRm, 'right'), ownBorder.left, 'cell', 'merge')
          : ownBorder.left;
        const wB = bottomSeg?.width ?? 0;
        const wL = leftSeg?.width ?? 0;
        if (wB > 0 && wL > 0) {
          ctx.fillStyle = bottomSeg?.color || leftSeg?.color || BORDER_COLOR;
          ctx.fillRect(ax - wL, ay + ah, wL, wB);
        }
      }
      // 右下角 (eC, eR)：同时属 body 段右/下边界
      if (!skipRightAll && !skipBottomAll) {
        const bottomSeg = !s.isSameMergeInternal(eCm, eRm, eCm, eRm + 1)
          ? resolveSharedBorder(ownBorder.bottom, getBorderSideAt(eCm, eRm + 1, 'top'), 'merge', 'cell')
          : ownBorder.bottom;
        const rightSeg = !s.isSameMergeInternal(eCm, eRm, eCm + 1, eRm)
          ? resolveSharedBorder(ownBorder.right, getBorderSideAt(eCm + 1, eRm, 'left'), 'merge', 'cell')
          : ownBorder.right;
        const wB = bottomSeg?.width ?? 0;
        const wR = rightSeg?.width ?? 0;
        if (wB > 0 && wR > 0) {
          ctx.fillStyle = bottomSeg?.color || rightSeg?.color || BORDER_COLOR;
          ctx.fillRect(ax + aw, ay + ah, wR, wB);
        }
      }
    };

    // 按视口相交绘制合并单元格：背景 + 网格框 + 合并边框 + 文本。
    // 跨冻结线的合并单元格在此被「拆段」渲染：
    //  - 冻结段（anchor 至冻结分隔线）在冻结 pane 中背景/网格右边界固定为 bodyLeft/bodyTop，不随滚动；
    //  - body 段随 scrollX/Y 平移，在 body pane 中由视口相交裁剪；
    //  - 文本布局基于逻辑尺寸（不随滚动），绘制起点按 pane 平移，靠两层 clip 拼出完整标题。
    drawMergedCells = (ctx: CanvasRenderingContext2D, vx: number, vy: number, vw: number, vh: number): void => {
      const vx2 = vx + vw;
      const vy2 = vy + vh;
      const hFrozenPane = vx < bodyLeft;
      const vFrozenPane = vy < bodyTop;
      for (const key in s.merges) {
        const m = s.merges[key];
        if (!m) continue;
        const aC = m.startCol;
        const aR = m.startRow;
        const eC = m.endCol;
        const eR = m.endRow;
        // 关键：合并的屏幕矩形不能直接套 anchor 的 cellToScreenRect——
        // anchor 在冻结列时不叠加 sx，但 endCol 跨到 body 列会叠加 sx，
        // 所以宽度必须用 (eCell.right - aCell.left) 算出，而非 anchor 自身的 width。
        const aRect = s.cellToScreenRect(aR, aC);
        const eRect = s.cellToScreenRect(eR, eC);
        const ax = aRect.x, ay = aRect.y;
        const aw = (eRect.x + eRect.width) - ax;
        const ah = (eRect.y + eRect.height) - ay;
        // 冻结段右/下边界：跨冻结线的合并，其冻结段边界固定为冻结分隔线（不随滚动）；
        // 未跨线或非冻结 pane 用真实合并边界（被 pane 视口截断）。
        const segRight = (hFrozenPane && eC >= s.freeze.cols)
          ? Math.min(vx2, bodyLeft)
          : Math.min(ax + aw, vx2);
        const segBottom = (vFrozenPane && eR >= s.freeze.rows)
          ? Math.min(vy2, bodyTop)
          : Math.min(ay + ah, vy2);
        const ix = Math.max(ax, vx);
        const iy = Math.max(ay, vy);
        if (segRight <= ix || segBottom <= iy) continue;
        const baseBg = s.resolveStyle(s.cells[s.cellKey(aC, aR)])?.backgroundColor;
        const cfBg = s.resolveConditionalFormat(aC, aR)?.backgroundColor;
        const bg = cfBg || baseBg;
        if (bg) {
          ctx.fillStyle = bg;
          ctx.fillRect(ix, iy, segRight - ix, segBottom - iy);
        }
        // 合并格选中态：anchor 命中选中区时整块填充浅蓝背景（Excel 样式），与普通单元格一致
        if (s.isSelected(aC, aR)) {
          ctx.fillStyle = cs.selectionBg;
          ctx.fillRect(ix, iy, segRight - ix, segBottom - iy);
        }
        ctx.strokeStyle = cs.gridLine;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(ax + 0.25, ay + 0.25, (segRight - ax) - 0.5, (segBottom - ay) - 0.5);
        drawMergeBorder(ctx, m, ax, ay, aw, ah, hFrozenPane, vFrozenPane);
        // 合并格选中边框：merge 为当前 activeCell 时在整个合并矩形外围描蓝色粗边框
        if (s.activeCell.value.col === aC && s.activeCell.value.row === aR) {
          ctx.strokeStyle = cs.activeCellBorder;
          ctx.lineWidth = 2;
          ctx.strokeRect(ax + 1, ay + 1, aw - 2, ah - 2);
        }
        // 数据验证下拉箭头：合并单元格统一在锚点处绘制（不重复绘制）
        if (s.getListValidation(aR, aC)) {
          const isActive = s.activeCell.value.col === aC && s.activeCell.value.row === aR;
          drawValidationDropdownIndicator(ctx, ax, ay, aw, ah, isActive, cs);
        }
        if (!(s.editingCell.value && s.editingCell.value.col === aC && s.editingCell.value.row === aR)) {
          // 文本布局宽/高用逻辑尺寸（不随滚动）；绘制起点按 pane 与是否跨冻结线决定：
          //  - 冻结 pane：直接用 anchor 屏幕坐标 ax/ay（cellToScreenRect 对冻结列/行已不含滚动偏移）；
          //  - body pane 且不跨冻结线（anchor 在 body 区）：ax/ay 已含滚动偏移，直接用即可；
          //  - body pane 且跨冻结线（anchor 落在冻结区）：ax/ay 不含滚动偏移，需补回 -sx/-sy
          //    让文本随 body 滚动，否则会被钉在冻结分隔线不动。本次只修「不跨冻结线」的双倍滚动，
          //    跨冻结线行为保持原状，避免回退。
          const logicW = cP[eC + 1]! - cP[aC]!;
          const logicH = rP[eR + 1]! - rP[aR]!;
          const aColFrozen = aC < s.freeze.cols;
          const aRowFrozen = aR < s.freeze.rows;
          const drawX = hFrozenPane ? ax : (aColFrozen ? ax - sx : ax);
          const drawY = vFrozenPane ? ay : (aRowFrozen ? ay - sy : ay);
          drawMergeText(ctx, aC, aR, logicW, logicH, drawX, drawY);
        }
      }
    };

    // PASS 1：body 区域裁剪
    rCtx.save();
    rCtx.beginPath();
    rCtx.rect(bodyLeft, bodyTop, bodyWidth, bodyHeight);
    rCtx.clip();
    drawCells(rCtx, iterC, eC, iterR, eR, rH);
    drawBorders(rCtx, iterC, eC, iterR, eR, rH);
    drawMergedCells(rCtx, bodyLeft, bodyTop, bodyWidth, bodyHeight);
    rCtx.restore();

    // 冻结分隔线（直接绘制，不属于 border pool）
    if (frozenColumnsWidth > 0) {
      rCtx.strokeStyle = cs.headerSep;
      rCtx.lineWidth = 1;
      rCtx.beginPath();
      rCtx.moveTo(bodyLeft + 0.5, HH);
      rCtx.lineTo(bodyLeft + 0.5, H);
      rCtx.stroke();
    }
    if (frozenRowsHeight > 0) {
      rCtx.strokeStyle = cs.headerSep;
      rCtx.lineWidth = 1;
      rCtx.beginPath();
      rCtx.moveTo(HW, bodyTop + 0.5);
      rCtx.lineTo(W, bodyTop + 0.5);
      rCtx.stroke();
    }

    // 列标题
    rCtx.fillStyle = cs.headerBg;
    rCtx.fillRect(hw, gY, W - hw, HH);
    for (let col = bodySC; col <= bodyEC; col++) {
      const x = hw + cP[col]! - sx;
      if (s.isColumnCollapsed(col)) continue; // 折叠列不绘制表头字母，避免内容重叠
      const cw = (cP[col + 1] ?? 0) - cP[col]!;
      if (x + cw < hw || x > W) continue;
      const gci = colGroupColor[col];
      if (gci === 0) {
        rCtx.fillStyle = cs.outlineGroupBg1;
        rCtx.fillRect(x, gY, cw, HH);
      } else if (gci === 1) {
        rCtx.fillStyle = cs.outlineGroupBg2;
        rCtx.fillRect(x, gY, cw, HH);
      }
      if (sel && col >= sel.startCol && col <= sel.endCol) {
        rCtx.fillStyle = cs.selectionBg;
        rCtx.fillRect(x, gY, cw, HH);
      }
      rCtx.strokeStyle = cs.headerBorder;
      rCtx.lineWidth = 0.5;
      rCtx.strokeRect(x + 0.25, gY + 0.25, cw - 0.5, HH - 0.5);
      if (sel && col >= sel.startCol && col <= sel.endCol) {
        rCtx.strokeStyle = cs.activeCellBorder;
        rCtx.lineWidth = 2;
        rCtx.beginPath();
        rCtx.moveTo(x, gY + HH - 1);
        rCtx.lineTo(x + cw, gY + HH - 1);
        rCtx.stroke();
      }
      rCtx.fillStyle = cs.headerText;
      rCtx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      rCtx.textAlign = 'center';
      rCtx.textBaseline = 'middle';
      rCtx.fillText(colToLabel(col), x + cw / 2, gY + HH / 2);
    }
    // 冻结列标题（不滚动，覆盖在 body 之上，防止 body 标题透过）
    if (frozenColumnsWidth > 0) {
      rCtx.fillStyle = cs.headerBg;
      rCtx.fillRect(hw, gY, frozenColumnsWidth, HH);
      for (let col = 0; col <= frozenEC; col++) {
        const x = hw + cP[col]!;
        if (s.isColumnCollapsed(col)) continue; // 折叠列不绘制表头字母
        const cw = (cP[col + 1] ?? 0) - cP[col]!;
        if (x + cw < hw || x > W) continue;
        if (sel && col >= sel.startCol && col <= sel.endCol) {
          rCtx.fillStyle = cs.selectionBg;
          rCtx.fillRect(x, gY, cw, HH);
        }
        rCtx.strokeStyle = cs.headerBorder;
        rCtx.lineWidth = 0.5;
        rCtx.strokeRect(x + 0.25, gY + 0.25, cw - 0.5, HH - 0.5);
        if (sel && col >= sel.startCol && col <= sel.endCol) {
          rCtx.strokeStyle = cs.activeCellBorder;
          rCtx.lineWidth = 2;
          rCtx.beginPath();
          rCtx.moveTo(x, gY + HH - 1);
          rCtx.lineTo(x + cw, gY + HH - 1);
          rCtx.stroke();
        }
        rCtx.fillStyle = cs.headerText;
        rCtx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        rCtx.textAlign = 'center';
        rCtx.textBaseline = 'middle';
        rCtx.fillText(colToLabel(col), x + cw / 2, gY + HH / 2);
      }
    }
    rCtx.strokeStyle = cs.headerSep;
    rCtx.lineWidth = 1;
    rCtx.beginPath();
    rCtx.moveTo(hw, hh + 0.5);
    rCtx.lineTo(W, hh + 0.5);
    rCtx.stroke();

    // 行标题（背景含 Outline gutter，覆盖 [0, hw] 以与右移后的行号带对齐）
    rCtx.fillStyle = cs.headerBg;
    rCtx.fillRect(0, hh, hw, H - hh);
    for (let row = bodySR; row <= bodyER; row++) {
      if (s.isRowHidden(row)) continue;
      const y = hh + rP[row]! - sy, rh = rH[row]!;
      if (y + rh < hh || y > H) continue;
      const gci = rowGroupColor[row];
      if (gci === 0) {
        rCtx.fillStyle = cs.outlineGroupBg1;
        rCtx.fillRect(gX, y, HW, rh);
      } else if (gci === 1) {
        rCtx.fillStyle = cs.outlineGroupBg2;
        rCtx.fillRect(gX, y, HW, rh);
      }
      if (sel && row >= sel.startRow && row <= sel.endRow) {
        rCtx.fillStyle = cs.selectionBg;
        rCtx.fillRect(gX, y, HW, rh);
      }
      rCtx.strokeStyle = cs.headerBorder;
      rCtx.lineWidth = 0.5;
      rCtx.strokeRect(gX + 0.25, y + 0.25, HW - 0.5, rh - 0.5);
      if (sel && row >= sel.startRow && row <= sel.endRow) {
        rCtx.strokeStyle = cs.activeCellBorder;
        rCtx.lineWidth = 2;
        rCtx.beginPath();
        rCtx.moveTo(gX + HW - 1, y);
        rCtx.lineTo(gX + HW - 1, y + rh);
        rCtx.stroke();
      }
      rCtx.fillStyle = cs.headerText;
      rCtx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      rCtx.textAlign = 'center';
      rCtx.textBaseline = 'middle';
      rCtx.fillText(String(row + 1), gX + HW / 2, y + rh / 2 + 0.5);
    }
    // 冻结行标题（不滚动，覆盖在 body 之上）
    if (frozenRowsHeight > 0) {
      rCtx.fillStyle = cs.headerBg;
      rCtx.fillRect(0, hh, hw, frozenRowsHeight);
      for (let row = 0; row <= frozenER; row++) {
        if (s.isRowHidden(row)) continue;
        const y = hh + rP[row]!, rh = rH[row]!;
        if (y + rh < hh || y > H) continue;
        if (sel && row >= sel.startRow && row <= sel.endRow) {
          rCtx.fillStyle = cs.selectionBg;
          rCtx.fillRect(gX, y, HW, rh);
        }
        rCtx.strokeStyle = cs.headerBorder;
        rCtx.lineWidth = 0.5;
        rCtx.strokeRect(gX + 0.25, y + 0.25, HW - 0.5, rh - 0.5);
        if (sel && row >= sel.startRow && row <= sel.endRow) {
          rCtx.strokeStyle = cs.activeCellBorder;
          rCtx.lineWidth = 2;
          rCtx.beginPath();
          rCtx.moveTo(gX + HW - 1, y);
          rCtx.lineTo(gX + HW - 1, y + rh);
          rCtx.stroke();
        }
        rCtx.fillStyle = cs.headerText;
        rCtx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        rCtx.textAlign = 'center';
        rCtx.textBaseline = 'middle';
        rCtx.fillText(String(row + 1), gX + HW / 2, y + rh / 2 + 0.5);
      }
    }
    rCtx.strokeStyle = cs.headerSep;
    rCtx.lineWidth = 1;
    rCtx.beginPath();
    rCtx.moveTo(hw + 0.5, hh);
    rCtx.lineTo(hw + 0.5, H);
    rCtx.stroke();

    // 左上角全选按钮区（行头 × 列头交汇）：用 headerBg 填充与表头统一，并绘制指向左上的全选三角。
    // 否则该区域仅被整屏清屏填充为 cs.bg，与列头/行头颜色不一致、且无按钮视觉，显得被遮盖。
    rCtx.fillStyle = cs.headerBg;
    rCtx.fillRect(gX, gY, HW, HH);
    rCtx.strokeStyle = cs.headerSep;
    rCtx.lineWidth = 1;
    rCtx.strokeRect(gX + 0.5, gY + 0.5, HW - 1, HH - 1);
    const tSize = Math.min(HW, HH) * 0.32;
    rCtx.fillStyle = cs.activeCellBorder;
    rCtx.beginPath();
    rCtx.moveTo(gX + HW - 1, gY + HH - 1 - tSize);
    rCtx.lineTo(gX + HW - 1 - tSize, gY + HH - 1);
    rCtx.lineTo(gX + HW - 1, gY + HH - 1);
    rCtx.closePath();
    rCtx.fill();

    // ---- 行列分组 Outline 控件：浮动于列头/行头带内的 ± 折叠按钮（分组区间用背景色区分） ----
    const maxRowL = s.getOutlineLevel('row');
    const maxColL = s.getOutlineLevel('column');
    // 行分组：± 折叠按钮，浮动于行号带内（x∈[OUTLINE_PANEL, HW]），分组区间用背景色区分
    if (s.getRowOutlines().length) {
      for (const o of s.getRowOutlines()) {
        const xc = rowOutlineAnchorX(o, maxRowL);
        const gyT = hh + rP[o.start]! - sy;
        const bx = xc - OUTLINE_BTN / 2;
        const by = gyT - OUTLINE_BTN / 2;
        rCtx.fillStyle = cs.headerBg;
        rCtx.strokeStyle = cs.headerText;
        rCtx.lineWidth = 1;
        roundRectPath(rCtx, Math.round(bx), Math.round(by), OUTLINE_BTN, OUTLINE_BTN, 2);
        rCtx.fill();
        rCtx.stroke();
        rCtx.strokeStyle = cs.headerText;
        rCtx.lineWidth = 1.4;
        rCtx.beginPath();
        rCtx.moveTo(xc - 2, gyT);
        rCtx.lineTo(xc + 2, gyT);
        rCtx.stroke();
        if (o.collapsed) {
          rCtx.beginPath();
          rCtx.moveTo(xc, gyT - 2);
          rCtx.lineTo(xc, gyT + 2);
          rCtx.stroke();
        }
      }
    }
    // 列分组：± 折叠按钮，浮动于列号带内（y∈[0, HH]），分组区间用背景色区分
    if (s.getColumnOutlines().length) {
      for (const o of s.getColumnOutlines()) {
        const yc = colOutlineAnchorY(o, maxColL);
        const gxL = hw + cP[o.start]! - sx;
        const bx = gxL - OUTLINE_BTN / 2;
        const by = yc - OUTLINE_BTN / 2;
        rCtx.fillStyle = cs.headerBg;
        rCtx.strokeStyle = cs.headerText;
        rCtx.lineWidth = 1;
        roundRectPath(rCtx, Math.round(bx), Math.round(by), OUTLINE_BTN, OUTLINE_BTN, 2);
        rCtx.fill();
        rCtx.stroke();
        rCtx.strokeStyle = cs.headerText;
        rCtx.lineWidth = 1.4;
        rCtx.beginPath();
        rCtx.moveTo(gxL - 2, yc);
        rCtx.lineTo(gxL + 2, yc);
        rCtx.stroke();
        if (o.collapsed) {
          rCtx.beginPath();
          rCtx.moveTo(gxL, yc - 2);
          rCtx.lineTo(gxL, yc + 2);
          rCtx.stroke();
        }
      }
    }

    // 填充柄 + AutoFill 预览（绘制在 selection / active cell 之后、editor 之前）
    drawFillHandle(rCtx, cs);
    drawAutoFillPreview(rCtx, cs);
  }

  function renderFrozenOverlay() {
    const cvs = so.freezeCanvasRef.value;
    const wrapper = so.wrapperRef.value;
    if (!cvs || !wrapper) return;
    const frozenCtx = cvs.getContext('2d');
    if (!frozenCtx) return;
    const rect = wrapper.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const HW = HEADER_WIDTH;
    const HH = HEADER_HEIGHT;
    const gX = outlineGapX();
    const gY = outlineGapY();
    const hw = HW + gX;
    const hh = HH + gY;
    const cs = so.themeColors.value;
    const cP = s.colPositions.value;
    const rP = s.rowPositions.value;
    const sx = s.scrollX.value;
    const sy = s.scrollY.value;

    cvs.width = W * rDpr;
    cvs.height = H * rDpr;
    cvs.style.width = W + 'px';
    cvs.style.height = H + 'px';
    frozenCtx.setTransform(rDpr, 0, 0, rDpr, 0, 0);
    frozenCtx.clearRect(0, 0, W, H);

    const { frozenRowsHeight, frozenColumnsWidth } = s.getFrozenMetrics();
    if (frozenRowsHeight <= 0 && frozenColumnsWidth <= 0) return;
    const bodyLeft = hw + frozenColumnsWidth;
    const bodyTop = hh + frozenRowsHeight;
    const bodyWidth = Math.max(0, W - hw - SB_SIZE - frozenColumnsWidth);
    const bodyHeight = Math.max(0, H - hh - SB_SIZE - frozenRowsHeight);
    const frozenEC = Math.max(0, s.freeze.cols - 1);
    const frozenER = Math.max(0, s.freeze.rows - 1);
    const bodySC = Math.max(s.freeze.cols, s.hitCol(frozenColumnsWidth + sx));
    let bodyEC = bodySC;
    for (let c = bodySC; c < s.colCount; c++) {
      if (hw + cP[c]! - sx >= W) break;
      bodyEC = c;
    }
    const bodySR = Math.max(s.freeze.rows, s.hitRow(frozenRowsHeight + sy));
    let bodyER = bodySR;
    for (let r = bodySR; r < s.rowCount; r++) {
      if (hh + rP[r]! - sy >= H) break;
      bodyER = r;
    }
    let sC = bodySC, eC = bodyEC, sR = bodySR, eR = bodyER;
    if (frozenColumnsWidth > 0) {
      sC = 0;
      eC = Math.max(eC, frozenEC);
    }
    if (frozenRowsHeight > 0) {
      sR = 0;
      eR = Math.max(eR, frozenER);
    }
    let iterC = sC;
    let iterR = sR;
    for (const key in s.merges) {
      const m = s.merges[key];
      if (!m) continue;
      if (m.startRow > eR || m.endRow < sR || m.startCol > eC || m.endCol < sC) continue;
      if (m.startCol < iterC) iterC = m.startCol;
      if (m.startRow < iterR) iterR = m.startRow;
    }
    const rH: number[] = new Array(iterR);
    for (let i = iterR; i <= eR; i++) rH[i] = rP[i + 1]! - rP[i]!;

    const getBorderSideAt = (col: number, row: number, side: 'top' | 'right' | 'bottom' | 'left'): BorderSide | undefined => {
      const m = s.findMerge(col, row);
      if (m) return s.getCellBorderSide(s.cells[m.anchor], side);
      return s.getCellBorderSide(s.cells[s.cellKey(col, row)], side);
    };
    const drawBorders = (ctx: CanvasRenderingContext2D, sC2: number, eC2: number, sR2: number, eR2: number): void => {
      ctx.fillStyle = '#444';
      for (let row = sR2; row <= eR2; row++) {
        for (let col = sC2; col <= eC2; col++) {
          const mergeInfo = s.findMerge(col, row);
          if (mergeInfo && !(col === mergeInfo.range.startCol && row === mergeInfo.range.startRow)) continue;
          const rect2 = s.cellToScreenRect(row, col);
          const x = rect2.x, y = rect2.y, cw = rect2.width, rh = rect2.height;
          if (x + cw < hw || y + rh < hh || x > W || y > H) continue;
          const cell = s.cells[s.cellKey(col, row)];
          const ownBorder: Record<string, BorderSide | undefined> = {
            top: s.getCellBorderSide(cell, 'top'),
            right: s.getCellBorderSide(cell, 'right'),
            bottom: s.getCellBorderSide(cell, 'bottom'),
            left: s.getCellBorderSide(cell, 'left'),
          };
          if (mergeInfo) continue;
          const neighbors = {
            top: getBorderSideAt(col, row - 1, 'bottom'),
            left: getBorderSideAt(col - 1, row, 'right'),
            bottom: getBorderSideAt(col, row + 1, 'top'),
            right: getBorderSideAt(col + 1, row, 'left'),
          };
          const rT = resolveSharedBorder(neighbors.top, ownBorder.top);
          const rL = resolveSharedBorder(neighbors.left, ownBorder.left);
          const rB = resolveSharedBorder(ownBorder.bottom, neighbors.bottom);
          const rR = resolveSharedBorder(ownBorder.right, neighbors.right);
          const wT = rT?.width ?? 0;
          const wL = rL?.width ?? 0;
          const wB = rB?.width ?? 0;
          const wR = rR?.width ?? 0;
          if (wT > 0) {
            ctx.fillStyle = rT?.color || '#444';
            ctx.fillRect(x, y, cw, wT);
          }
          if (wB > 0) {
            ctx.fillStyle = rB?.color || '#444';
            ctx.fillRect(x, y + rh - wB, cw, wB);
          }
          if (wL > 0) {
            ctx.fillStyle = rL?.color || '#444';
            ctx.fillRect(x, y, wL, rh);
          }
          if (wR > 0) {
            ctx.fillStyle = rR?.color || '#444';
            ctx.fillRect(x + cw - wR, y, wR, rh);
          }
        }
      }
    };
    const drawFrozenPane = (x: number, y: number, w: number, h: number, cS: number, cE: number, rS: number, rE: number) => {
      if (w <= 0 || h <= 0) return;
      frozenCtx.save();
      frozenCtx.beginPath();
      frozenCtx.rect(x, y, w, h);
      frozenCtx.clip();
      frozenCtx.fillStyle = cs.gridBg;
      frozenCtx.fillRect(x, y, w, h);
      drawCells(frozenCtx, cS, cE, rS, rE, rH);
      drawBorders(frozenCtx, cS, cE, rS, rE);
      drawMergedCells(frozenCtx, x, y, w, h);
      frozenCtx.restore();
    };
    // 每个 pane 只绘制自己负责的区域：
    // - 左上角：冻结列 × 冻结行
    // - 顶部冻结行：列可滚动（iterC..eC 包含可能跨边界的合并 anchor），行固定为冻结行
    // - 左侧冻结列：列固定为冻结列，行可滚动（iterR..eR 包含可能跨边界的合并 anchor）
    if (frozenColumnsWidth > 0 && frozenRowsHeight > 0) {
      drawFrozenPane(HW, HH, frozenColumnsWidth, frozenRowsHeight, 0, frozenEC, 0, frozenER);
    }
    if (frozenRowsHeight > 0) {
      drawFrozenPane(bodyLeft, HH, bodyWidth, frozenRowsHeight, iterC, eC, 0, frozenER);
    }
    if (frozenColumnsWidth > 0) {
      drawFrozenPane(HW, bodyTop, frozenColumnsWidth, bodyHeight, 0, frozenEC, iterR, eR);
    }
    frozenCtx.strokeStyle = cs.headerSep;
    frozenCtx.lineWidth = 1;
    if (frozenColumnsWidth > 0) {
      frozenCtx.beginPath();
      frozenCtx.moveTo(bodyLeft + 0.5, HH);
      frozenCtx.lineTo(bodyLeft + 0.5, H);
      frozenCtx.stroke();
    }
    if (frozenRowsHeight > 0) {
      frozenCtx.beginPath();
      frozenCtx.moveTo(HW, bodyTop + 0.5);
      frozenCtx.lineTo(W, bodyTop + 0.5);
      frozenCtx.stroke();
    }
    frozenCtx.fillStyle = cs.headerBg;
    frozenCtx.fillRect(0, 0, HW, HH);
    frozenCtx.strokeStyle = cs.headerSep;
    frozenCtx.lineWidth = 1;
    frozenCtx.strokeRect(0.5, 0.5, HW - 0.5, HH - 0.5);
    // 冻结层填充柄 + AutoFill 预览（确保冻结区域内的填充柄不被 Body 覆盖）
    drawFillHandle(frozenCtx, cs);
    drawAutoFillPreview(frozenCtx, cs);
  }

  // ============ 填充柄绘制 ============
  /** 绘制填充柄：selection 右下角单元格的右下角小方块 */
  function drawFillHandle(ctx: CanvasRenderingContext2D, cs: ThemeColors) {
    const sel = s.selection.value;
    if (!sel || s.editingCell.value) return;
    const rect = s.cellToScreenRect(sel.endRow, sel.endCol);
    const hx = rect.x + rect.width - FILL_HANDLE_SIZE / 2;
    const hy = rect.y + rect.height - FILL_HANDLE_SIZE / 2;
    // 滚动后选中单元格可能被推出可视区：若填充柄进入表头（列头/行头）区域则不绘制，避免叠加错位
    if (hx < hwOff() || hy < hhOff()) return;
    // Merge 兼容：源区域与 merge 部分相交时填充柄变灰，不可拖拽
    const mergeOk = validateMergeCompatibility(sel, sel, s.merges).ok;
    ctx.fillStyle = mergeOk ? cs.activeCellBorder : cs.scrollTrack;
    ctx.fillRect(hx, hy, FILL_HANDLE_SIZE, FILL_HANDLE_SIZE);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(hx + 0.5, hy + 0.5, FILL_HANDLE_SIZE - 1, FILL_HANDLE_SIZE - 1);
  }

  /** 绘制 AutoFill 拖拽预览：半透明填充 + 虚线边框 */
  function drawAutoFillPreview(ctx: CanvasRenderingContext2D, cs: ThemeColors) {
    const st = s.autoFillState.value;
    if (!st.active || !st.preview || !st.targetRange) return;
    const tr = st.targetRange;
    const r0 = s.cellToScreenRect(tr.startRow, tr.startCol);
    const r1 = s.cellToScreenRect(tr.endRow, tr.endCol);
    const x = r0.x, y = r0.y;
    const w = r1.x + r1.width - x;
    const h = r1.y + r1.height - y;
    // 预览区域进入表头（列头/行头）时不再绘制，避免叠加错位
    if (y < hhOff() || x < hwOff()) return;
    ctx.fillStyle = cs.selectionBg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = cs.activeCellBorder;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.setLineDash([]);
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
    if (!s.editingCell.value) {
      // 首次输入即进入编辑态：必须把已输入内容作为 startEdit 初值，
      // 否则 startEdit() 无参时编辑缓冲 = 单元格原值，随后 editingCell watcher
      // 会用「原值」覆盖 formulaBarDraft，把用户刚敲入的字符瞬间抹掉（首键丢失 BUG）。
      s.startEdit(v);
    } else {
      // 已处于编辑态（如首键已进入）：行内编辑器 textarea 的 :value = s.editValue，
      // 单元格实时显示靠它。必须同步 editValue，否则后续输入只更新草稿、画布单元格停在首字符。
      // 注意：落盘仍由 acceptFormulaBarEdit 按 fbDirty 走 formulaBarDraft，这里只影响实时显示，不破坏数据源判定。
      s.editValue.value = v;
    }
    // 兜底：无论何种路径，草稿都必须是用户输入的当前文本（防止被 watcher 用原值覆盖）。
    formulaBarDraft.value = v;
    fbDirty = true; // 用户在公式栏输入了，即使输入为空（删除全部）也算用户意图
  }

  /**
   * 插入函数对话框「插入」入口：将对话框中编辑好的公式直接写入目标单元格（立即落盘）。
   *  - 编辑态：写入 s.editValue 后 commitEdit（与行内编辑器「接受」一致）
   *  - 非编辑态：saveUndo + setCellValue（与公式栏「接受」落盘一致）
   *  - 不依赖公式栏草稿流程，插入后单元格即为最终结果
   */
  function insertFunctionIntoCell(text: string) {
    const ac = { ...s.activeCell.value };
    if (s.editingCell.value) {
      s.editValue.value = text;
      void s.commitEdit();
    } else {
      s.saveUndo?.();
      s.setCellValue(ac.col, ac.row, text);
    }
    formulaBarDraft.value = '';
    fbDirty = false;
    scheduleRender();
    so.emitModelData?.();
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
      // 数据验证：commitEdit 可能因非法值被拦截（保持编辑态），此时不移动活动单元格
      void s.commitEdit().then((ok) => {
        if (ok) {
          s.moveActive(0, 1);
          s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        }
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
      });
    } else if (focusOnFormulaBar) {
      // 2) 仅 focus 了公式栏（fbDirty=false，用户没在公式栏输入，只是"点一下看看"）：
      //    —— 必须以行内编辑器已写入的 s.editValue.value 为准（用户可能在行内编辑器里已经改过内容；之前这里错误地直接用旧 draft.value 覆盖 s.editValue，
      //       当 A1 原值为空/初始值且 onMouseDown e.preventDefault() 让 textarea 保持为 activeElement 时，就会把行内已编辑内容覆盖为空/原值 —— 导致"清空单元格"严重 BUG）。
      //    —— 先把 draft 反向同步为最新 editValue（保持显示一致性），然后直接 commit s.editValue。
      formulaBarDraft.value = s.editValue.value;
      void s.commitEdit().then((ok) => {
        if (ok) {
          s.moveActive(0, 1);
          s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        }
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
      });
    } else {
      // 3) 行内编辑器来源 / 画布点击失焦 / 非公式栏焦点：直接 s.commitEdit()（s.editValue 已被 onEditInput 填充为最新输入）
      void s.commitEdit().then(() => {
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
  // 菜单被任意路径关闭（含菜单项点击经 setCtxMenuNull 直接置空）时清理点外部关闭监听
  watch(ctxMenu, (v) => {
    if (v === null) rdl();
  });

  // ============ 筛选弹窗 ============
  /** 当前打开的筛选弹窗：关联的列与屏幕锚点；null 表示未打开 */
  const filterPopup = ref<{ col: number; x: number; y: number } | null>(null);
  /** 数据验证下拉列表弹窗（list 验证）；null 表示未打开 */
  const validationDropdown = ref<ValidationDropdownState | null>(null);

  /** 列头筛选按钮宽度 */
  const FILTER_BTN_W = 18;
  /** 筛选按钮外边距 / 圆角 */
  const FILTER_BTN_M = 2;
  const FILTER_BTN_R = 2;
  /** toolbar 下拉框同款下箭头 caret（viewBox 0 0 1024 1024），复用为筛选箭头图标 */
  const CARET_PATH = new Path2D(
    'M180.053333 361.386667a32 32 0 0 1 45.226667 0L512 648.106667l286.72-286.72a32 32 0 1 1 45.226667 45.226666l-309.333334 309.333334a32 32 0 0 1-45.226666 0L180.053333 406.613333a32 32 0 0 1 0-45.226666z',
  );

  /** 圆角矩形路径（兼容降级，避免依赖 ctx.roundRect） */
  function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /** 在 Header 单元格右侧绘制筛选按钮：带背景色块（2px 圆角、2px 外边距）+ toolbar 同款下箭头 caret。
   *  active=true（该列已应用筛选）→ 蓝色背景 + 白色箭头；否则浅灰背景 + 深灰箭头。
   *  (cellX, cellY, cellW, cellH) 为 Header 单元格的屏幕矩形。 */
  /**
   * 绘制数据验证「单元格内下拉箭头」。
   * 该指示器是纯 UI 层装饰：不写入 cell style / styleId，也不进入 StylePool。
   * 仅在单元格存在 list 验证且 showDropdown !== false 时绘制（普通单元格不绘制）。
   */
  function drawValidationDropdownIndicator(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    cw: number,
    rh: number,
    emphasized: boolean,
    cs: ThemeColors,
  ): void {
    if (cw < DV_DROPDOWN_W + 4 || rh < 10) return;
    const bx = x + cw - DV_DROPDOWN_W;
    const by = y + 1;
    const bh = rh - 2;
    ctx.save();
    if (emphasized) {
      ctx.fillStyle = cs.selectionBg;
      ctx.fillRect(bx, by, DV_DROPDOWN_W, bh);
    }
    ctx.fillStyle = cs.activeCellBorder;
    const tw = 6;
    const th = 4;
    const cx = bx + DV_DROPDOWN_W / 2;
    const cy = by + bh / 2;
    ctx.beginPath();
    ctx.moveTo(cx - tw / 2, cy - th / 2 + 0.5);
    ctx.lineTo(cx + tw / 2, cy - th / 2 + 0.5);
    ctx.lineTo(cx, cy + th / 2 + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * 命中测试：是否点在某单元格的下拉箭头上。
   * 坐标一律通过 cellToScreenRect 推导，自动兼容冻结窗格与合并单元格。
   */
  function isValidationDropdownHit(x: number, y: number): { col: number; row: number } | null {
    if (s.dataValidations.length === 0) return null;
    const hit = s.screenToCell(x, y);
    if (!hit) return null;
    // 合并单元格：下拉只归属左上角锚点，避免重复绘制 / 重复命中
    const m = s.findMerge(hit.col, hit.row);
    const ac = m ? m.range.startCol : hit.col;
    const ar = m ? m.range.startRow : hit.row;
    if (!s.getListValidation(ar, ac)) return null;
    const rect = s.cellToScreenRect(ar, ac);
    if (rect.width < DV_DROPDOWN_W + 4) return null;
    const bx = rect.x + rect.width - DV_DROPDOWN_W;
    if (x < bx || x > rect.x + rect.width) return null;
    if (y < rect.y || y > rect.y + rect.height) return null;
    return { col: ac, row: ar };
  }

  /** 打开某单元格的下拉列表；不存在可显示下拉的 list 规则时返回 false */
  function openValidationDropdown(col: number, row: number): boolean {
    const dd = s.getValidationDropdown(row, col);
    if (!dd) return false;
    const cvs = so.canvasRef.value;
    if (!cvs) return false;
    // 先选中并滚动到该单元格，保证 anchor 位置与视觉一致
    if (!(s.activeCell.value.col === col && s.activeCell.value.row === row)) s.selectCell(col, row);
    s.ensureVisible(col, row);
    scheduleRender();
    const rect = s.cellToScreenRect(row, col);
    const cr = cvs.getBoundingClientRect();
    validationDropdown.value = {
      col,
      row,
      rule: dd.rule,
      items: dd.items,
      current: s.getCellRaw(col, row),
      x: cr.left + rect.x,
      y: cr.top + rect.y,
      width: rect.width,
      height: rect.height,
    };
    return true;
  }

  function closeValidationDropdown(): void {
    if (validationDropdown.value) {
      validationDropdown.value = null;
      scheduleRender();
    }
  }

  /** 下拉选中一项：值来自规则候选，通常必然通过 list 规则；仍走一遍验证以兼容多规则叠加 */
  async function onValidationDropdownSelect(value: string): Promise<void> {
    const dd = validationDropdown.value;
    if (!dd) return;
    const { col, row } = dd;
    validationDropdown.value = null;
    const res = s.validateCell(row, col, value);
    if (!res.valid) {
      const action = await s.confirmInvalidValue(res, col, row);
      if (action !== 'continue') {
        scheduleRender();
        so.focusEditInput();
        return;
      }
    }
    us.saveUndo();
    s.setCellValue(col, row, value);
    s.emitModelData?.();
    scheduleRender();
    so.focusEditInput();
  }

  function drawFilterButton(ctx: CanvasRenderingContext2D, cellX: number, cellY: number, cellW: number, cellH: number, active: boolean, cs: ThemeColors) {
    const btnW = Math.min(cellW, FILTER_BTN_W) - FILTER_BTN_M;
    const bx = cellX + cellW - btnW - FILTER_BTN_M;
    const by = cellY + FILTER_BTN_M;
    const bh = cellH - 2 * FILTER_BTN_M;
    ctx.save();
    // 背景（2px 圆角）
    ctx.fillStyle = active ? cs.activeCellBorder : '#ececec';
    roundRectPath(ctx, bx, by, btnW, bh, FILTER_BTN_R);
    ctx.fill();
    // 下箭头 caret（toolbar 下拉框同款 svg 图标），居中绘制
    const sz = Math.min(btnW, bh) * 0.72;
    ctx.translate(bx + btnW / 2, by + bh / 2);
    ctx.scale(sz / 1024, sz / 1024);
    ctx.translate(-512, -512);
    ctx.fillStyle = active ? '#ffffff' : '#5a5a5a';
    ctx.fill(CARET_PATH);
    ctx.restore();
  }

  /** 命中测试：返回被点击的筛选按钮所在列（未命中返回 -1）。
   *  筛选按钮位于 Filter Range 的 Header 行单元格右侧；优先级最高（高于单元格/行列头选择、resize）。
   *  优先判断 Filter Button 再判断 Header / Cell。 */
  function isFilterButtonHit(x: number, y: number): number {
    const f = s.getFilter();
    if (!f) return -1;
    const hit = s.screenToCell(x, y);
    if (!hit) return -1;
    const { col, row } = hit;
    if (row !== f.range.startRow) return -1;
    if (col < f.range.startCol || col > f.range.endCol) return -1;
    const rect = s.cellToScreenRect(row, col);
    const arrowW = Math.min(rect.width, FILTER_BTN_W) - FILTER_BTN_M;
    const btnLeft = rect.x + rect.width - arrowW - FILTER_BTN_M;
    const btnRight = rect.x + rect.width - FILTER_BTN_M;
    if (x >= btnLeft && x <= btnRight && y >= rect.y + FILTER_BTN_M && y <= rect.y + rect.height - FILTER_BTN_M) return col;
    return -1;
  }

  /** 打开某列的筛选弹窗（锚定到 Header 单元格右侧箭头，固定定位） */
  function openFilterPopup(col: number) {
    const f = s.getFilter();
    if (!f) return;
    const cvs = so.canvasRef.value;
    if (!cvs) return;
    const cr = cvs.getBoundingClientRect();
    const rect = s.cellToScreenRect(f.range.startRow, col);
    // 锚点 = Header 单元格右侧箭头左上角（屏幕坐标）
    filterPopup.value = {
      col,
      x: cr.left + rect.x + rect.width - FILTER_BTN_W, // 按钮右侧（贴右边框外缘）
      y: cr.top + rect.y + 2,
    };
  }

  function closeFilterPopup() {
    filterPopup.value = null;
  }

  let cdcHandler: ((e: Event) => void) | null = null;
  let ctcHandler: ((ev: Event) => void) | null = null;
  function rdl() {
    if (cdcHandler) {
      document.removeEventListener('click', cdcHandler);
      cdcHandler = null;
    }
    if (ctcHandler) {
      document.removeEventListener('touchstart', ctcHandler as EventListener, { capture: true } as AddEventListenerOptions);
      ctcHandler = null;
    }
  }

  // ---- 行列分组（Outline）交互：命中测试 / 分组 / 取消分组 / 展开折叠 / Level ----
  type OutlineHit = { kind: 'toggle'; outlineId: string };
  /** 命中测试：返回命中的 ± 按钮或左上 Level 按钮；否则 null。坐标 = getCanvasXY 内的画板坐标。 */
  function hitTestOutlineControl(x: number, y: number): OutlineHit | null {
    const maxRowL = s.getOutlineLevel('row');
    const maxColL = s.getOutlineLevel('column');
    const rP = s.rowPositions.value;
    const cP = s.colPositions.value;
    const sx = s.scrollX.value;
    const sy = s.scrollY.value;
    const tol = OUTLINE_BTN / 2 + 1;
    // 行 ±：浮动于行号带内（y>=hh），按钮中心 = (rowOutlineAnchorX, 分组起始行顶边)
    if (y >= hhOff()) {
      for (const o of s.getRowOutlines()) {
        const xc = rowOutlineAnchorX(o, maxRowL);
        const gyT = hhOff() + rP[o.start]! - sy;
        if (Math.abs(x - xc) <= tol && Math.abs(y - gyT) <= tol) {
          return { kind: 'toggle', outlineId: o.id };
        }
      }
    }
    // 列 ±：浮动于列号带内（x>=hw），按钮中心 = (分组起始列左边, colOutlineAnchorY)
    if (x >= hwOff()) {
      for (const o of s.getColumnOutlines()) {
        const yc = colOutlineAnchorY(o, maxColL);
        const gxL = hwOff() + cP[o.start]! - sx;
        if (Math.abs(y - yc) <= tol && Math.abs(x - gxL) <= tol) {
          return { kind: 'toggle', outlineId: o.id };
        }
      }
    }
    return null;
  }
  /** 取消分组：删除被选区完整覆盖的分组（每个分组由 removeOutline 内部保存一次 undo） */
  function removeOutlinesBulk(ids: string[]) {
    for (const id of ids) s.removeOutline(id);
    so.emitModelData();
    scheduleRender();
  }
  /** 根据当前选区按 axis 分组；返回 true 表示已创建 */
  function groupSelection(axis: 'row' | 'column'): boolean {
    const sel = s.selection.value;
    if (!sel) {
      alertOutline('outlineNeedRowsOrColumns');
      return false;
    }
    let r: OutlineValidationResult;
    if (axis === 'row') {
      if (sel.startCol !== 0 || sel.endCol !== s.colCount - 1) {
        alertOutline('outlineNeedRowsOrColumns');
        return false;
      }
      if (sel.startRow === sel.endRow) {
        alertOutline('outlineInvalidRange');
        return false;
      }
      r = s.addRowGroup(sel.startRow, sel.endRow);
    } else {
      if (sel.startRow !== 0 || sel.endRow !== s.rowCount - 1) {
        alertOutline('outlineNeedRowsOrColumns');
        return false;
      }
      if (sel.startCol === sel.endCol) {
        alertOutline('outlineInvalidRange');
        return false;
      }
      r = s.addColumnGroup(sel.startCol, sel.endCol);
    }
    if (!r.ok) {
      alertOutline(r.code === 'outlineCrossing' ? 'outlineCrossing' : r.code === 'outlineTooDeep' ? 'outlineTooDeep' : 'outlineInvalidRange');
      return false;
    }
    // addRowGroup/addColumnGroup 内部已 saveUndo + render + emit
    return true;
  }
  /** 取消分组：仅删除被选区完整覆盖的分组；否则提示 */
  function ungroupSelection(axis: 'row' | 'column'): boolean {
    const sel = s.selection.value;
    if (!sel) {
      alertOutline('outlineNeedRowsOrColumns');
      return false;
    }
    if (axis === 'row' && (sel.startCol !== 0 || sel.endCol !== s.colCount - 1)) {
      alertOutline('outlineNeedRowsOrColumns');
      return false;
    }
    if (axis === 'column' && (sel.startRow !== 0 || sel.endRow !== s.rowCount - 1)) {
      alertOutline('outlineNeedRowsOrColumns');
      return false;
    }
    const outlines = axis === 'row' ? s.getRowOutlines() : s.getColumnOutlines();
    const rs = axis === 'row' ? sel.startRow : sel.startCol;
    const re = axis === 'row' ? sel.endRow : sel.endCol;
    const toRemove = outlines.filter((o) => rs <= o.start && o.end <= re);
    if (!toRemove.length) {
      alertOutline('outlineUngroupPartial');
      return false;
    }
    removeOutlinesBulk(toRemove.map((o) => o.id));
    return true;
  }
  /** 将某方向全部分组折叠或展开（一次撤消） */
  function setAxisCollapsed(axis: 'row' | 'column', collapsed: boolean) {
    const os = axis === 'row' ? s.getRowOutlines() : s.getColumnOutlines();
    if (!os.length) return;
    if (os.every((o) => o.collapsed === collapsed)) return;
    us.saveUndo();
    for (const o of os) s.setOutlineCollapsed(o.id, collapsed, true);
    so.emitModelData();
    scheduleRender();
  }
  /** 分组校验失败提示：优先使用宿主注入的应用内对话框；未注入时回退 window.alert */
  function alertOutline(key: string) {
    const message = t(s.locale.value, key);
    if (outlineAlertApi) {
      outlineAlertApi(message);
      return;
    }
    window.alert(message);
  }

  function showCtx(x: number, y: number, items: ContextMenuItem[]) {
    rdl();
    const mw = 140;
    const mh = items.length * 28 + 8;
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    if (x + mw > sw) x -= mw;
    if (y + mh > sh) y -= mh;
    // 初始方向先置右（多数情况下右侧有空间）；菜单渲染后由 predictCtxSubmenuDir()
    // 按「真实子菜单宽度」测量并修正为正确方向，与 onCtxItemEnter 判据一致，避免纠正帧闪动。
    ctxSubmenuLeft.value = false;
    ctxMenu.value = { x, y, items };
    // 菜单渲染后测量真实子菜单宽度，首帧即确定正确弹出方向（消除闪动）
    nextTick(() => predictCtxSubmenuDir());
    cdcHandler = () => {
      ctxMenu.value = null;
      rdl();
    };
    // 触屏关闭：监听常驻（不用 once），点菜单内（含子菜单）不关、点外部才关并清理；
    // 否则点菜单内打开子菜单那次 touchstart 会把 once 监听消费掉，导致之后点外部关不掉主菜单。
    ctcHandler = (ev: Event) => {
      const tgt = ev.target as HTMLElement | null;
      if (tgt && tgt.closest('.context-menu')) return;
      ctxMenu.value = null;
      rdl();
    };
    setTimeout(() => {
      document.addEventListener('click', cdcHandler!, { once: true });
      document.addEventListener('touchstart', ctcHandler as EventListener, { capture: true } as AddEventListenerOptions);
    }, 0);
  }
  const ctxSubmenuLeft = ref(false);
  function onCtxItemEnter(_e: MouseEvent, _item: ContextMenuItem) {
    // 子菜单弹出方向已在 showCtx 时由 predictCtxSubmenuDir() 按真实几何一次性确定并锁定，
    // 此处不再重算。否则 hover/触屏点中父项时方向被纠正，必然产生一帧陈旧值 → 闪动。
  }
  // 菜单渲染后，按真实几何一次性确定子菜单弹出方向：
  //   - 水平：右/左（所有子菜单共享菜单右缘 → 取最大子菜单宽度判定 → 写入 ctxSubmenuLeft）
  //   - 垂直：上/下（每个父项位置不同 → 逐项判定 → inline 写 top/bottom 到对应 .context-submenu）
  // 关键：方向只在此处算一次，onCtxItemEnter 不再改动，因此子菜单首帧绘制即正确，无任何纠正帧，
  // 彻底消除「先右后左 / 先下后上」闪动。
  function predictCtxSubmenuDir() {
    // 子菜单贴视口边缘时预留的间距：右弹时右缘距视口右边界不足该值即翻到左侧弹，避免贴边裁切
    const SUBMENU_EDGE_MARGIN = 8;
    const menuEl = document.querySelector('.context-menu') as HTMLElement | null;
    const cm = ctxMenu.value;
    if (!menuEl || !cm) {
      ctxSubmenuLeft.value = false;
      return;
    }
    // 菜单右缘必须用「逻辑坐标」(showCtx 传入并经修正的 x + 固定菜单宽 140)，不能用
    // getBoundingClientRect()：菜单套在 <Transition name="menu-pop"> 里，进入动画是
    // transform: scale(.9)，nextTick 测量时整棵菜单处于缩放态，getBoundingClientRect 会
    // 拿到被缩小的右缘 → 误判「右侧放得下」→ 选右弹 → 动画结束回到 scale(1) 时子菜单溢出。
    const menuRight = cm.x + 140;
    // 边缘基准 = 「视口」而非表格容器 wrapper：菜单经 Teleport + position:fixed 挂载在视口坐标系，
    // 视口才是「再往外就看不见」的硬边界；按容器判定会在容器小于视口时过早翻向，白丢可用空间。
    // 与项目其他浮层（dropdown / 各 picker / conditional-format-menu 子菜单）的判据保持一致。
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    // 子菜单宽度也用 getBoundingClientRect 实测，但测量前临时去掉菜单 transform，
    // 否则同样会吃到缩放态宽度（偏小约 10%），导致判定右弹后实溢出。
    const prevTransform = menuEl.style.transform;
    menuEl.style.transform = 'none';
    let maxSubW = 0;
    menuEl.querySelectorAll<HTMLElement>('.context-menu__item').forEach((it) => {
      const sub = it.querySelector<HTMLElement>(':scope > .context-submenu');
      if (!sub) return;
      const prev = sub.style.display;
      sub.style.display = 'block';
      const subRect = sub.getBoundingClientRect();
      const w = subRect.width;
      const subH = subRect.height;
      sub.style.display = prev;
      if (w > maxSubW) maxSubW = w;
      // 垂直方向：父项 top + 子菜单高度（即 top:-4 对齐时的子菜单下缘）超过视口下边界 - 余量，
      // 则改为向上弹出（bottom 对齐父项底部），避免子菜单向下溢出。inline style 覆盖 CSS 默认 top:-4px。
      const itemRect = it.getBoundingClientRect();
      if (itemRect.top + subH > vpH - SUBMENU_EDGE_MARGIN) {
        sub.style.top = 'auto';
        sub.style.bottom = '-4px';
      } else {
        // 不溢出时清掉 inline，让 CSS 默认 top:-4px 生效，避免上次菜单残留方向
        sub.style.top = '';
        sub.style.bottom = '';
      }
    });
    menuEl.style.transform = prevTransform;
    // 测不到（字体/布局未稳）时默认左弹，宁左勿右（左弹不会裁切，右弹溢出才裁切）
    if (maxSubW === 0) {
      ctxSubmenuLeft.value = true;
      return;
    }
    // 右弹所需空间 = 视口右边界 - 菜单右缘；不足（含 8px 余量）则翻左弹。
    // 左弹同样放不下时仍选左弹（宁左勿右兜底，左弹至多贴视口左缘、不会裁到不可见）。
    const rightSpace = vpW - menuRight;
    ctxSubmenuLeft.value = rightSpace < maxSubW + SUBMENU_EDGE_MARGIN;
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
      } },
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
      { label: t(s.locale.value, 'freezeToRow'), action: () => {
        s.setFreeze(row + 1, s.freeze.cols);
        scheduleRender();
      } },
      { label: t(s.locale.value, 'outlineGroup'), children: [
        { label: t(s.locale.value, 'outlineAddRowGroup'), action: () => groupSelection('row') },
        { label: t(s.locale.value, 'outlineUngroupRows'), action: () => ungroupSelection('row') },
        { label: t(s.locale.value, 'outlineClear'), action: () => s.clearRowGroups() },
        { label: t(s.locale.value, 'outlineExpandAll'), action: () => setAxisCollapsed('row', false) },
        { label: t(s.locale.value, 'outlineCollapseAll'), action: () => setAxisCollapsed('row', true) },
      ] },
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
    const sortDisabled = !so.canSortColumns(s2.startCol, s2.endCol);
    showCtx(e.clientX, e.clientY, [
      { label: t(s.locale.value, 'insert'), action: () => {
        us.saveUndo();
        so.insertCols(s2.startCol, s2.endCol);
        scheduleRender();
        so.emitModelData();
      } },
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
      { label: t(s.locale.value, 'sort'), disabled: sortDisabled, children: [
        { label: t(s.locale.value, 'sortAsc'), action: () => {
          if (so.prepareSortConfirmation('asc')) return;
          so.sortSelectedColumns('asc');
        }, disabled: sortDisabled },
        { label: t(s.locale.value, 'sortDesc'), action: () => {
          if (so.prepareSortConfirmation('desc')) return;
          so.sortSelectedColumns('desc');
        }, disabled: sortDisabled },
      ] },
      { label: `${t(s.locale.value, 'colWidth')}...`, action: () => openDimPanel('col', mx, my) },
      { label: t(s.locale.value, 'defaultColWidth'), action: () => so.resetColWidth() },
      { label: t(s.locale.value, 'freezeToCol'), action: () => {
        s.setFreeze(s.freeze.rows, col + 1);
        scheduleRender();
      } },
      { label: t(s.locale.value, 'outlineGroup'), children: [
        { label: t(s.locale.value, 'outlineAddColumnGroup'), action: () => groupSelection('column') },
        { label: t(s.locale.value, 'outlineUngroupColumns'), action: () => ungroupSelection('column') },
        { label: t(s.locale.value, 'outlineClear'), action: () => s.clearColumnGroups() },
        { label: t(s.locale.value, 'outlineExpandAll'), action: () => setAxisCollapsed('column', false) },
        { label: t(s.locale.value, 'outlineCollapseAll'), action: () => setAxisCollapsed('column', true) },
      ] },
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
      { label: `${t(s.locale.value, 'dv')}...`, action: () => s.requestDataValidationDialog?.() },
      { label: t(s.locale.value, 'dvClearValidation'), action: () => {
        us.saveUndo();
        s.clearDataValidation(s.selection.value);
        scheduleRender();
        so.emitModelData();
      } },
    ]);
  }

  // ============ 行高/列宽浮动设置栏 ============
  const dimInputRef = ref<HTMLInputElement | null>(null);
  const dimPanel = ref<{ type: 'row' | 'col'; x: number; y: number; value: string; error: string } | null>(null);
  let dimCloseHandler: (() => void) | null = null;
  let dimCloseTouchHandler: (() => void) | null = null;
  function rdlDim() {
    if (dimCloseHandler) {
      document.removeEventListener('mousedown', dimCloseHandler);
      dimCloseHandler = null;
    }
    if (dimCloseTouchHandler) {
      document.removeEventListener('touchstart', dimCloseTouchHandler);
      dimCloseTouchHandler = null;
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
    dimCloseTouchHandler = () => {
      dimPanel.value = null;
    };
    setTimeout(() => {
      document.addEventListener('mousedown', dimCloseHandler!, { once: true });
      // 触屏：onTouchStart 调了 preventDefault 会阻止合成的 mousedown，故补 touchstart 监听
      document.addEventListener('touchstart', dimCloseTouchHandler!, { once: true });
    }, 0);
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
    const st = s.resolveStyle(s.cells[s.cellKey(c, r)]);
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
    const rect = s.cellToScreenRect(r, c);
    return {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
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
    return Math.max(0, so.viewSize.w - hwOff() - SB_SIZE);
  }
  function gridVH() {
    return Math.max(0, so.viewSize.h - hhOff() - SB_SIZE);
  }
  const hScrollbarW = computed(() => Math.max(0, gridVW() - s.getFrozenMetrics().frozenColumnsWidth));
  const vScrollbarH = computed(() => Math.max(0, gridVH() - s.getFrozenMetrics().frozenRowsHeight));
  // 滚动条容器偏移：水平条左端、垂直条顶端需避开冻结区域
  const hScrollbarLeft = computed(() => hwOff() + s.getFrozenMetrics().frozenColumnsWidth);
  const vScrollbarTop = computed(() => hhOff() + s.getFrozenMetrics().frozenRowsHeight);
  const hTrackW = computed(() => Math.max(0, hScrollbarW.value - 11 * 2));
  const vTrackH = computed(() => Math.max(0, vScrollbarH.value - 11 * 2));
  const hThumbW = computed(() => {
    if (so.maxScrollX.value <= 0) return hTrackW.value;
    return Math.max(24, (hScrollbarW.value / s.totalWidth.value) * hTrackW.value);
  });
  const hThumbL = computed(() => {
    if (so.maxScrollX.value <= 0) return 0;
    return (s.scrollX.value / so.maxScrollX.value) * (hTrackW.value - hThumbW.value);
  });
  const vThumbH = computed(() => {
    if (so.maxScrollY.value <= 0) return vTrackH.value;
    return Math.max(24, (vScrollbarH.value / s.totalHeight.value) * vTrackH.value);
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
  // 触屏框选（长按进入）：长按单元格锚定起点，拖动扩展矩形选区；未进入前拖动为滚动
  let tLongTimer: number | null = null;
  let tSelecting = false;
  let tSelAnchorC = 0, tSelAnchorR = 0;
  // 长按在选区内弹出的右键菜单：抬手时切勿改写选区（否则多选会被缩成单选）
  let tCtxMenuOpened = false;

  // ============ AutoFill 状态 ============
  let autoScrollRAF: number | null = null;
  let autoScrollDir: { x: number; y: number } | null = null;
  let autoFillMouseX = 0;
  let autoFillMouseY = 0;

  /** 填充柄命中测试：命中区域为填充柄视觉矩形 + FILL_HANDLE_HIT_PADDING */
  function isFillHandleHit(x: number, y: number): boolean {
    const sel = s.selection.value;
    if (!sel || s.editingCell.value) return false;
    // Merge 部分相交时禁用填充柄
    if (!validateMergeCompatibility(sel, sel, s.merges).ok) return false;
    const rect = s.cellToScreenRect(sel.endRow, sel.endCol);
    const hx = rect.x + rect.width - FILL_HANDLE_SIZE;
    const hy = rect.y + rect.height - FILL_HANDLE_SIZE;
    const pad = FILL_HANDLE_HIT_PADDING;
    return x >= hx - pad && x <= hx + FILL_HANDLE_SIZE + pad
      && y >= hy - pad && y <= hy + FILL_HANDLE_SIZE + pad;
  }

  /** 启动边缘自动滚动 rAF 循环（单一实例） */
  function startAutoScroll() {
    autoScrollRAF = requestAnimationFrame(autoScrollStep);
  }

  /** AutoFill 自动滚动单帧：clampScroll + 重新计算 targetRange + scheduleRender */
  function autoScrollStep() {
    if (!s.autoFillState.value.active || !autoScrollDir) {
      autoScrollRAF = null;
      return;
    }
    const speed = 8;
    so.clampScroll(
      s.scrollX.value + autoScrollDir.x * speed * 0.1,
      s.scrollY.value + autoScrollDir.y * speed * 0.1,
    );
    const hit = s.screenToCell(autoFillMouseX, autoFillMouseY);
    const src = s.autoFillState.value.sourceRange;
    if (hit && src) {
      const result = computeTargetRange(src, { col: hit.col, row: hit.row });
      if (result) {
        s.autoFillState.value = { ...s.autoFillState.value, targetRange: result.targetRange, direction: result.direction };
      } else {
        s.autoFillState.value = { ...s.autoFillState.value, targetRange: null, direction: null };
      }
    }
    scheduleRender();
    autoScrollRAF = requestAnimationFrame(autoScrollStep);
  }

  /** 取消边缘自动滚动 */
  function cancelAutoScroll() {
    if (autoScrollRAF !== null) {
      cancelAnimationFrame(autoScrollRAF);
      autoScrollRAF = null;
    }
    autoScrollDir = null;
  }

  /** 更新 AutoFill 预览：根据当前鼠标位置计算 targetRange / direction，必要时启动边缘自动滚动 */
  function updateAutoFillPreview(x: number, y: number) {
    autoFillMouseX = x;
    autoFillMouseY = y;
    const hit = s.screenToCell(x, y);
    const src = s.autoFillState.value.sourceRange;
    if (hit && src) {
      const result = computeTargetRange(src, { col: hit.col, row: hit.row });
      if (result) {
        s.autoFillState.value = { ...s.autoFillState.value, targetRange: result.targetRange, direction: result.direction };
      } else {
        s.autoFillState.value = { ...s.autoFillState.value, targetRange: null, direction: null };
      }
    }
    // 边缘自动滚动：鼠标接近视口边缘 30px 内时启动
    const EDGE = 30;
    const vw = so.viewSize.w, vh = so.viewSize.h;
    let dx = 0, dy = 0;
    if (x < hwOff() + EDGE) dx = -(hwOff() + EDGE - x);
    else if (x > vw - SB_SIZE - EDGE) dx = x - (vw - SB_SIZE - EDGE);
    if (y < hhOff() + EDGE) dy = -(hhOff() + EDGE - y);
    else if (y > vh - SB_SIZE - EDGE) dy = y - (vh - SB_SIZE - EDGE);
    if (dx !== 0 || dy !== 0) {
      autoScrollDir = { x: dx, y: dy };
      if (autoScrollRAF === null) startAutoScroll();
    } else {
      autoScrollDir = null;
      if (autoScrollRAF !== null) {
        cancelAnimationFrame(autoScrollRAF);
        autoScrollRAF = null;
      }
    }
    scheduleRender();
  }

  /** 提交 AutoFill：调用 applyAutoFill 写入并重置状态 */
  function commitAutoFill() {
    cancelAutoScroll();
    const st = s.autoFillState.value;
    if (st.targetRange && st.direction && st.sourceRange) {
      s.applyAutoFill(st.sourceRange, st.targetRange, st.direction);
    }
    s.autoFillState.value = { active: false, sourceRange: null, targetRange: null, direction: null, preview: false };
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    ctxMenu.value = null;
    const p = getCanvasXY(e, so.canvasRef.value);
    // 数据验证下拉箭头命中（最高优先级：高于筛选按钮 / resize / 选择）
    const hitDv = isValidationDropdownHit(p.x, p.y);
    if (hitDv) {
      // 编辑中点击下拉箭头：先提交（丢弃未决输入会让用户丢失内容，直接 cancelEdit 更糟），
      // 提交被数据验证拦截时不打开下拉，交给出错警告引导用户修正。
      if (s.editingCell.value) {
        void s.commitEdit().then((ok) => {
          if (ok) openValidationDropdown(hitDv.col, hitDv.row);
        });
        return;
      }
      openValidationDropdown(hitDv.col, hitDv.row);
      return;
    }
    // 筛选按钮命中（最高优先级：高于 resize / 选择 / 行列头选择）
    const hitFilter = isFilterButtonHit(p.x, p.y);
    if (hitFilter >= 0) {
      openFilterPopup(hitFilter);
      return;
    }
    // 行列分组 Outline 控件命中（± 展开折叠）
    const hitOl = hitTestOutlineControl(p.x, p.y);
    if (hitOl) {
      if (hitOl.kind === 'toggle') {
        s.toggleOutline(hitOl.outlineId);
        scheduleRender();
        so.emitModelData();
      }
      return;
    }
    if (p.y < hhOff() && p.x >= hwOff()) {
      const gx = p.x - hwOff() + s.scrollX.value;
      const c = screenXToCol(p.x);
      const cRight = c >= 0 ? (s.cellToScreenRect(0, c).x + s.colWidths.value[c]!) : -1;
      if (c >= 0 && Math.abs(p.x - cRight) <= 4) {
        us.saveUndo();
        isResizingC = true;
        rszTC = c;
        rszSS = s.colWidths.value[c]!;
        rszSG = gx;
        scheduleRender();
        return;
      }
    }
    if (p.x < hwOff() && p.y >= hhOff()) {
      const gy = p.y - hhOff() + s.scrollY.value;
      const r = screenYToRow(p.y);
      const rBottom = r >= 0 ? (s.cellToScreenRect(r, 0).y + s.getRowHeight(r)) : -1;
      if (r >= 0 && Math.abs(p.y - rBottom) <= 4) {
        us.saveUndo();
        isResizingR = true;
        rszTR = r;
        rszSS = s.getRowHeight(r);
        rszSG = gy;
        scheduleRender();
        return;
      }
    }
    // 填充柄命中：进入 autofilling 状态（在 resize handle 之后、cell click 之前）
    if (isFillHandleHit(p.x, p.y)) {
      const sel = s.selection.value;
      if (sel) {
        s.autoFillState.value = {
          active: true,
          sourceRange: { ...sel },
          targetRange: null,
          direction: null,
          preview: true,
        };
        scheduleRender();
      }
      return;
    }
    if (p.x < hwOff() || p.y < hhOff()) {
      // 点击行列头/全选区：只有"在编辑中 / 公式栏正在 focus / 用户改过公式栏"才先提交，否则纯选区切换跳过（避免误清空原 activeCell）
      {
        const fbRef = so.formulaBarRef.value;
        const focusOnFb = !!(fbRef && typeof document !== 'undefined' && document.activeElement === fbRef);
        if (s.editingCell.value || focusOnFb || fbDirty) acceptFormulaBarEdit();
      }
      if (p.y < hhOff() && p.x >= hwOff()) {
        const c = screenXToCol(p.x);
        if (c >= 0) {
          s.selectRange(c, 0, c, s.rowCount - 1, 'col');
          isDragging = true;
          drgSC = c;
          drgSR = 0;
        }
      } else if (p.x < hwOff() && p.y >= hhOff()) {
        const r = screenYToRow(p.y);
        if (r >= 0) {
          s.selectRange(0, r, s.colCount - 1, r, 'row');
          isDragging = true;
          drgSC = 0;
          drgSR = r;
        }
      } else if (p.x < hwOff() && p.y < hhOff()) {
        s.selectAll();
      }
      scheduleRender();
      return;
    }
    const hit = s.screenToCell(p.x, p.y);
    if (!hit) return;
    const c = hit.col, r = hit.row;
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
      const d = (x - hwOff() + s.scrollX.value) - rszSG;
      const newW = rszSS + d;
      if (newW >= MIN_COL_WIDTH && newW <= MAX_COL_WIDTH) s.colWidths.value[rszTC] = newW;
      else if (newW < MIN_COL_WIDTH) s.colWidths.value[rszTC] = MIN_COL_WIDTH;
      else s.colWidths.value[rszTC] = MAX_COL_WIDTH;
      scheduleRender();
      return;
    }
    if (isResizingR) {
      const y = getCanvasXY(e, so.canvasRef.value).y;
      const d = (y - hhOff() + s.scrollY.value) - rszSG;
      const newH = rszSS + d;
      if (newH >= MIN_ROW_HEIGHT && newH <= MAX_ROW_HEIGHT) s.rowHeights.value[rszTR] = newH;
      else if (newH < MIN_ROW_HEIGHT) s.rowHeights.value[rszTR] = MIN_ROW_HEIGHT;
      else s.rowHeights.value[rszTR] = MAX_ROW_HEIGHT;
      scheduleRender();
      return;
    }
    // autofilling 状态：更新预览 + 边缘自动滚动
    if (s.autoFillState.value.active) {
      const afp = getCanvasXY(e, so.canvasRef.value);
      updateAutoFillPreview(afp.x, afp.y);
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
      if (hitTestOutlineControl(p.x, p.y)) {
        cvs.style.cursor = 'pointer';
        return;
      }
      if (isFilterButtonHit(p.x, p.y) >= 0) {
        cvs.style.cursor = 'pointer';
        return;
      }
      if (isValidationDropdownHit(p.x, p.y)) {
        cvs.style.cursor = 'pointer';
        return;
      }
      if (p.y < hhOff() && p.x >= hwOff()) {
        const c = screenXToCol(p.x);
        const cRight = c >= 0 ? (s.cellToScreenRect(0, c).x + s.colWidths.value[c]!) : -1;
        if (c >= 0 && Math.abs(p.x - cRight) <= 4) {
          cvs.style.cursor = 'col-resize';
          return;
        }
      }
      if (p.x < hwOff() && p.y >= hhOff()) {
        const r = screenYToRow(p.y);
        const rBottom = r >= 0 ? (s.cellToScreenRect(r, 0).y + s.getRowHeight(r)) : -1;
        if (r >= 0 && Math.abs(p.y - rBottom) <= 4) {
          cvs.style.cursor = 'row-resize';
          return;
        }
      }
      // hover 命中填充柄时切换为 crosshair
      if (isFillHandleHit(p.x, p.y)) {
        cvs.style.cursor = 'crosshair';
        return;
      }
      cvs.style.cursor = 'cell';
      return;
    }
    const p = getCanvasXY(e, so.canvasRef.value);
    if (drgSC < 0 || drgSR < 0) return;
    if (p.x < hwOff() || p.y < hhOff()) {
      if (p.y < hhOff() && p.x >= hwOff()) {
        const c = screenXToCol(p.x);
        if (c >= 0) s.selectRange(Math.min(drgSC, c), 0, Math.max(drgSC, c), s.rowCount - 1, 'col');
      } else if (p.x < hwOff() && p.y >= hhOff()) {
        const r = screenYToRow(p.y);
        if (r >= 0) s.selectRange(0, Math.min(drgSR, r), s.colCount - 1, Math.max(drgSR, r), 'row');
      }
      scheduleRender();
      return;
    }
    const hit = s.screenToCell(p.x, p.y);
    if (!hit) return;
    const c = hit.col, r = hit.row;
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
    // autofilling 提交（在 resize/drag 重置之后、paintFormat 之前）
    if (s.autoFillState.value.active) {
      commitAutoFill();
      return;
    }
    if (us.paintFmt.value) {
      us.applyPaintFormat();
    }
  }
  function onMouseLeave() {
    cancelAutoScroll();
    const w = isResizingC || isResizingR;
    isDragging = false;
    isResizingC = false;
    isResizingR = false;
    if (w) so.scheduleOptEmit();
  }
  function onCanvasCtx(e: MouseEvent) {
    e.preventDefault();
    const p = getCanvasXY(e, so.canvasRef.value);
    if (p.x < hwOff() && p.y < hhOff()) {
      onCornerCtx(e);
      return;
    }
    if (p.y < hhOff() && p.x >= hwOff()) {
      const c = screenXToCol(p.x);
      if (c >= 0) onColHdrCtx(e, c);
      return;
    }
    if (p.x < hwOff() && p.y >= hhOff()) {
      const r = screenYToRow(p.y);
      if (r >= 0) onRowHdrCtx(e, r);
      return;
    }
    if (p.x >= hwOff() && p.y >= hhOff()) {
      const hit = s.screenToCell(p.x, p.y);
      if (hit) onCellCtx(e, hit.col, hit.row);
    }
  }
  function onDblClick(e: MouseEvent) {
    const p = getCanvasXY(e, so.canvasRef.value);
    if (p.x < hwOff() || p.y < hhOff()) return;
    const hit = s.screenToCell(p.x, p.y);
    if (!hit) return;
    const c = hit.col, r = hit.row;
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
    const newX = s.scrollX.value + e.deltaX;
    const newY = s.scrollY.value + e.deltaY;
    // 接近右/下边界时按缓冲扩展逻辑范围，扩展后 clampScroll 自然钳制到新范围
    const nearMargin = 40;
    const mx = so.maxScrollX.value;
    const my = so.maxScrollY.value;
    if ((newX >= mx - nearMargin && e.deltaX > 0) || (newY >= my - nearMargin && e.deltaY > 0)) {
      // 估算当前可见最后一列/行，确保扩展后能覆盖滚动目标（不截断，允许超出当前范围）
      const gw = Math.max(0, so.viewSize.w - 28 - 11);
      const gh = Math.max(0, so.viewSize.h - 28 - 11);
      const approxCol = Math.max(0, Math.ceil((newX + gw) / 100) + 2);
      const approxRow = Math.max(0, Math.ceil((newY + gh) / 24) + 2);
      s.ensureCapacity(approxCol, approxRow);
    }
    so.clampScroll(newX, newY);
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
    const tcX = t.clientX, tcY = t.clientY;
    // 触屏构造最小 MouseEvent（仅用 clientX/clientY 定位右键菜单）
    const makeTouchEv = (cx: number, cy: number): MouseEvent =>
      ({ clientX: cx, clientY: cy, preventDefault() {} } as unknown as MouseEvent);
    // 编辑中/公式栏聚焦/改过：先提交编辑（与鼠标 onMouseDown 一致）
    {
      const fbRef = so.formulaBarRef.value;
      const focusOnFb = !!(fbRef && typeof document !== 'undefined' && document.activeElement === fbRef);
      if (s.editingCell.value || focusOnFb || fbDirty) acceptFormulaBarEdit();
    }
    // 填充柄命中：进入 autofilling（与 mouse 共用 autoFillState），不启动滚动
    if (isFillHandleHit(x, y)) {
      e.preventDefault();
      const sel = s.selection.value;
      if (sel) {
        s.autoFillState.value = {
          active: true,
          sourceRange: { ...sel },
          targetRange: null,
          direction: null,
          preview: true,
        };
        isTouch = true;
        tMoved = false;
        tZone = 'cell';
        tSX = x;
        tSY = y;
        tSSX = s.scrollX.value;
        tSSY = s.scrollY.value;
      }
      return;
    }
    // 筛选按钮命中（最高优先级，与 mouse 一致）：直接打开弹窗，不进入滚动/选择
    const hitFilter = isFilterButtonHit(x, y);
    if (hitFilter >= 0) {
      e.preventDefault();
      openFilterPopup(hitFilter);
      return;
    }
    // 列宽 resize 热区（列头右缘）：与鼠标一致，命中即进入 resize 而非滚动（触屏放宽到 8px 易命中）
    if (y < hhOff() && x >= hwOff()) {
      const c = screenXToCol(x);
      if (c >= 0) {
        const cRight = s.cellToScreenRect(0, c).x + s.colWidths.value[c]!;
        if (Math.abs(x - cRight) <= 8) {
          e.preventDefault();
          us.saveUndo();
          isResizingC = true;
          rszTC = c;
          rszSS = s.colWidths.value[c]!;
          rszSG = (x - hwOff()) + s.scrollX.value;
          isTouch = true;
          tMoved = false;
          return;
        }
      }
    }
    // 行高 resize 热区（行头下缘）
    if (x < hwOff() && y >= hhOff()) {
      const r = screenYToRow(y);
      if (r >= 0) {
        const rBottom = s.cellToScreenRect(r, 0).y + s.getRowHeight(r);
        if (Math.abs(y - rBottom) <= 8) {
          e.preventDefault();
          us.saveUndo();
          isResizingR = true;
          rszTR = r;
          rszSS = s.getRowHeight(r);
          rszSG = (y - hhOff()) + s.scrollY.value;
          isTouch = true;
          tMoved = false;
          return;
        }
      }
    }
    if (x >= hwOff() && y >= hhOff()) {
      // 单元格区域：记录起点；默认拖动为滚动，长按进入框选模式（锚定起点后拖动扩展矩形选区）
      e.preventDefault();
      isTouch = true;
      tMoved = false;
      tSelecting = false;
      tCtxMenuOpened = false;
      tZone = 'cell';
      tSX = x;
      tSY = y;
      tSSX = s.scrollX.value;
      tSSY = s.scrollY.value;
      tSC = screenXToCol(x);
      tSR = screenYToRow(y);
      if (tLongTimer !== null) clearTimeout(tLongTimer);
      tLongTimer = window.setTimeout(() => {
        const sel = s.selection.value;
        const inSel = !!sel && tSC >= sel.startCol && tSC <= sel.endCol && tSR >= sel.startRow && tSR <= sel.endRow;
        // 选区内长按 → 弹右键上下文菜单（与桌面右键等价）；选区外长按 → 框选
        if (inSel) {
          tCtxMenuOpened = true;
          onCellCtx(makeTouchEv(tcX, tcY), tSC, tSR);
          return;
        }
        tSelecting = true;
        tSelAnchorC = tSC;
        tSelAnchorR = tSR;
        if (tSC >= 0 && tSR >= 0) {
          s.selectCell(tSC, tSR);
          scheduleRender();
        }
      }, 450);
    } else if (x >= 0 && y >= 0 && (x < hwOff() || y < hhOff())) {
      // 列表头 / 行表头 / 左上角全选按钮：同样支持平移滚动与点按选择
      e.preventDefault();
      isTouch = true;
      tMoved = false;
      tSelecting = false;
      tSX = x;
      tSY = y;
      tSSX = s.scrollX.value;
      tSSY = s.scrollY.value;
      if (y < hhOff() && x >= hwOff()) {
        tZone = 'col';
        tSC = screenXToCol(x);
        tSR = -1;
      } else if (x < hwOff() && y >= hhOff()) {
        tZone = 'row';
        tSR = screenYToRow(y);
        tSC = -1;
      } else {
        tZone = 'all';
        tSC = -1;
        tSR = -1;
      }
      // 列头/行头/全选角：长按手势——选区内长按弹右键菜单，选区外长按拖拽多选
      if (tZone === 'col' || tZone === 'row' || tZone === 'all') {
        if (tLongTimer !== null) clearTimeout(tLongTimer);
        tLongTimer = window.setTimeout(() => {
          const sel = s.selection.value;
          if (tZone === 'all') {
            tCtxMenuOpened = true;
            onCornerCtx(makeTouchEv(tcX, tcY));
            return;
          }
          if (tZone === 'col') {
            const inSel = !!sel && sel.startRow === 0 && sel.endRow === s.rowCount - 1 && tSC >= sel.startCol && tSC <= sel.endCol;
            if (inSel) {
              tCtxMenuOpened = true;
              onColHdrCtx(makeTouchEv(tcX, tcY), tSC);
              return;
            }
            tSelecting = true;
            tSelAnchorC = tSC;
            tSelAnchorR = -1;
            if (tSC >= 0) {
              s.selectRange(tSC, 0, tSC, s.rowCount - 1, 'col');
              scheduleRender();
            }
          } else {
            const inSel = !!sel && sel.startCol === 0 && sel.endCol === s.colCount - 1 && tSR >= sel.startRow && tSR <= sel.endRow;
            if (inSel) {
              tCtxMenuOpened = true;
              onRowHdrCtx(makeTouchEv(tcX, tcY), tSR);
              return;
            }
            tSelecting = true;
            tSelAnchorC = -1;
            tSelAnchorR = tSR;
            if (tSR >= 0) {
              s.selectRange(0, tSR, s.colCount - 1, tSR, 'row');
              scheduleRender();
            }
          }
        }, 450);
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
    // autofilling：更新预览 + 边缘自动滚动（优先于滚动）
    if (s.autoFillState.value.active) {
      e.preventDefault();
      updateAutoFillPreview(x, y);
      return;
    }
    // 列宽 / 行高 resize 拖拽（与鼠标一致）
    if (isResizingC) {
      const d = ((x - hwOff()) + s.scrollX.value) - rszSG;
      let newW = rszSS + d;
      newW = newW < MIN_COL_WIDTH ? MIN_COL_WIDTH : (newW > MAX_COL_WIDTH ? MAX_COL_WIDTH : newW);
      s.colWidths.value[rszTC] = newW;
      e.preventDefault();
      scheduleRender();
      return;
    }
    if (isResizingR) {
      const d = ((y - hhOff()) + s.scrollY.value) - rszSG;
      let newH = rszSS + d;
      newH = newH < MIN_ROW_HEIGHT ? MIN_ROW_HEIGHT : (newH > MAX_ROW_HEIGHT ? MAX_ROW_HEIGHT : newH);
      s.rowHeights.value[rszTR] = newH;
      e.preventDefault();
      scheduleRender();
      return;
    }
    // 长按进入的选择模式：拖动扩展选区（不滚动）
    if (tSelecting) {
      e.preventDefault();
      if (tSelAnchorC >= 0 && tSelAnchorR >= 0) {
        // 单元格矩形框选
        const c = screenXToCol(x), r = screenYToRow(y);
        if (c >= 0 && r >= 0) {
          s.selectRange(tSelAnchorC, tSelAnchorR, c, r);
          scheduleRender();
        }
      } else if (tSelAnchorR === -1 && tSelAnchorC >= 0) {
        // 列头拖拽多选：锚定整列，沿列方向扩展（行区间恒为全表）
        const c = screenXToCol(x);
        if (c >= 0) {
          s.selectRange(Math.min(tSelAnchorC, c), 0, Math.max(tSelAnchorC, c), s.rowCount - 1, 'col');
          scheduleRender();
        }
      } else if (tSelAnchorC === -1 && tSelAnchorR >= 0) {
        // 行头拖拽多选：锚定整行，沿行方向扩展（列区间恒为全表）
        const r = screenYToRow(y);
        if (r >= 0) {
          s.selectRange(0, Math.min(tSelAnchorR, r), s.colCount - 1, Math.max(tSelAnchorR, r), 'row');
          scheduleRender();
        }
      }
      return;
    }
    // 开始明显拖动 → 取消可能 pending 的长按计时（转滚动而非框选）
    if (tLongTimer !== null) {
      clearTimeout(tLongTimer);
      tLongTimer = null;
    }
    if (Math.abs(x - tSX) > 8 || Math.abs(y - tSY) > 8) {
      tMoved = true;
      e.preventDefault();
      so.clampScroll(tSSX + (tSX - x), tSSY + (tSY - y));
      scheduleRender();
    }
  }
  function onTouchEnd() {
    if (!isTouch) return;
    if (tLongTimer !== null) {
      clearTimeout(tLongTimer);
      tLongTimer = null;
    }
    // 长按在选区内弹出的右键菜单：菜单仍开着的这一抬手不应改写选区（否则多选被缩成单选）
    if (tCtxMenuOpened) {
      tCtxMenuOpened = false;
      isTouch = false;
      return;
    }
    // autofilling 提交
    if (s.autoFillState.value.active) {
      commitAutoFill();
      isTouch = false;
      return;
    }
    // 列宽 / 行高 resize 提交（与鼠标 onMouseUp 一致）
    if (isResizingC || isResizingR) {
      isResizingC = false;
      isResizingR = false;
      so.scheduleOptEmit();
      if (us.paintFmt.value) us.applyPaintFormat();
      isTouch = false;
      return;
    }
    // 框选结束（长按进入的选择模式）
    if (tSelecting) {
      tSelecting = false;
      if (us.paintFmt.value) us.applyPaintFormat();
      isTouch = false;
      return;
    }
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
    // 格式刷：轻点选择后应用（与鼠标 onMouseUp 一致；编辑态不应用）
    if (us.paintFmt.value && !s.editingCell.value) us.applyPaintFormat();
  }

  // ============ 键盘 ============
  function isImeKeydown(e: KeyboardEvent) {
    return e.isComposing || e.key === 'Process' || e.keyCode === 229;
  }
  function isPlainPrintableKey(e: KeyboardEvent) {
    return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  }
  function onKeydown(e: KeyboardEvent) {
    // autofilling 期间：ESC 取消并重置状态，其他键忽略
    if (s.autoFillState.value.active) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelAutoScroll();
        s.autoFillState.value = { active: false, sourceRange: null, targetRange: null, direction: null, preview: false };
        scheduleRender();
      }
      return;
    }
    if (s.editingCell.value) return;
    const ctl = e.ctrlKey || e.metaKey, sh = e.shiftKey;
    switch (true) {
      case e.altKey && e.key === 'ArrowDown':
        // Alt+↓：打开当前活动单元格的下拉列表（Excel 快捷键，仅 list 验证有效）
        e.preventDefault();
        openValidationDropdown(s.activeCell.value.col, s.activeCell.value.row);
        return;
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
      case ctl && sh && (e.key === 'l' || e.key === 'L'):
        // Ctrl+Shift+L：切换整个 Sheet 的 AutoFilter（非对当前列筛选）。
        // 快捷键始终为纯移除/创建：已启用则整体移除，未启用则按选区创建。
        e.preventDefault();
        s.toggleAutoFilter();
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
      // 数据验证：校验发生在写入之前；非法且未被放行时保持编辑态，不移动活动单元格
      void s.commitEdit().then((ok) => {
        if (!ok) {
          scheduleRender();
          so.focusEditInput();
          return;
        }
        s.moveActive(0, 1);
        s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        scheduleRender();
        so.focusEditInput();
      });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      void s.commitEdit().then((ok) => {
        if (!ok) {
          scheduleRender();
          so.focusEditInput();
          return;
        }
        s.moveActive(e.shiftKey ? -1 : 1, 0);
        s.ensureVisible(s.activeCell.value.col, s.activeCell.value.row);
        scheduleRender();
        so.focusEditInput();
      });
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
      // 出错警告弹窗打开期间：编辑框失焦不应再次触发提交（避免与弹窗决策重入）
      if (s.isValidationAlertOpen()) return;
      if (s.editingCell.value) {
        void s.commitEdit().then(() => scheduleRender());
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
          const sh = so.mkSheet(smd.name, { colCount: smd.colCount, rowCount: smd.rowCount });
          const { cells: migratedCells, styles: migratedStyles } = migrateCells(smd.cells);
          Object.assign(sh.cells, migratedCells);
          sh.styles = smd.styles ?? migratedStyles;
          // 边框迁移：将旧版内联边框属性迁移到 BorderPool 机制
          if (smd.borders) {
            sh.borders = smd.borders;
          } else {
            const migrated = migrateBordersInStyles(sh.styles);
            sh.styles = migrated.styles;
            sh.borders = migrated.borders;
          }
          if (smd.colWidths) {
            for (const [c, w] of Object.entries(smd.colWidths)) {
              const ci = Number(c);
              if (ci >= 0 && ci < (sh.colCount ?? s.colCount) && w >= 30) sh.colWidths[ci] = w;
            }
          }
          if (smd.rowHeights) {
            for (const [r, h] of Object.entries(smd.rowHeights)) {
              const ri = Number(r);
              if (ri >= 0 && ri < (sh.rowCount ?? s.rowCount) && h >= 24) sh.rowHeights[ri] = h;
            }
          }
          if (smd.merges) {
            for (const [k, mr] of Object.entries(smd.merges)) {
              sh.merges![k] = { ...mr };
            }
          }
          // 恢复冻结窗格：loadSheet(0) 会再做一次 clamp
          sh.freeze = smd.freeze ? { rows: smd.freeze.rows, cols: smd.freeze.cols } : { rows: 0, cols: 0 };
          // 恢复筛选状态（兼容旧版数据，深拷贝避免与外部数据共享引用）
          sh.filter = normalizeLoadedFilter(smd.filter, sh.cells);
          // 恢复数据验证规则（旧数据无该字段视为无验证）
          sh.dataValidations = Array.isArray(smd.dataValidations) ? [...smd.dataValidations] : [];
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
        const { cells: migratedCells, styles: migratedStyles } = migrateCells(smd.cells);
        Object.assign(sh.cells, migratedCells);
        sh.styles = smd.styles ?? migratedStyles;
        // 边框迁移：将旧版内联边框属性迁移到 BorderPool 机制
        if (smd.borders) {
          sh.borders = smd.borders;
        } else {
          const migrated = migrateBordersInStyles(sh.styles);
          sh.styles = migrated.styles;
          sh.borders = migrated.borders;
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
        // 恢复冻结窗格：loadSheet(0) 会再做一次 clamp
        sh.freeze = smd.freeze ? { rows: smd.freeze.rows, cols: smd.freeze.cols } : { rows: 0, cols: 0 };
        // 恢复筛选状态（兼容旧版数据，深拷贝避免与外部数据共享引用）
        sh.filter = normalizeLoadedFilter(smd.filter, sh.cells);
        // 恢复数据验证规则（旧数据无该字段视为无验证）
        sh.dataValidations = Array.isArray(smd.dataValidations) ? [...smd.dataValidations] : [];
        // 恢复行列分组（旧数据无该字段视为无分组）
        sh.rowOutlines = Array.isArray(smd.rowOutlines) ? smd.rowOutlines.map((o) => ({ ...o })) : [];
        sh.columnOutlines = Array.isArray(smd.columnOutlines) ? smd.columnOutlines.map((o) => ({ ...o })) : [];
        return sh;
      });
      if (so.sheets.value.length > 0) so.loadSheet(0);
      if (savedSel) s.selection.value = savedSel;
      s.activeCell.value = savedActive;
      // 若活跃单元格是合并锚点且选区仍为 1×1，自动扩展到合并范围
      const acW = s.activeCell.value;
      const selW = s.selection.value;
      const mergeW = s.findMerge(acW.col, acW.row);
      if (mergeW && mergeW.anchor === s.cellKey(acW.col, acW.row)
        && (!selW || (selW.startCol === acW.col && selW.startRow === acW.row && selW.endCol === acW.col && selW.endRow === acW.row))) {
        s.selectCell(acW.col, acW.row);
      }
      scheduleRender();
    }, { deep: true });

    onBeforeUnmount(() => {
      resizeObs?.disconnect();
    });
  }

  return {
    scheduleRender,
    render,
    renderFrozenOverlay,

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
    insertFunctionIntoCell,

    renTab,
    renTabVal,
    onTabClick,
    onTabDblClick,
    commitTabRename,
    cclTabRename,
    onTabRenameKd,

    ctxMenu,
    ctxSubmenuLeft,
    filterPopup,
    isFilterButtonHit,
    openFilterPopup,
    closeFilterPopup,

    validationDropdown,
    isValidationDropdownHit,
    openValidationDropdown,
    closeValidationDropdown,
    onValidationDropdownSelect,
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

    outlineGroupRows: () => groupSelection('row'),
    outlineGroupCols: () => groupSelection('column'),
    outlineUngroupRows: () => ungroupSelection('row'),
    outlineUngroupCols: () => ungroupSelection('column'),
    outlineExpandRows: () => setAxisCollapsed('row', false),
    outlineCollapseRows: () => setAxisCollapsed('row', true),
    outlineExpandCols: () => setAxisCollapsed('column', false),
    outlineCollapseCols: () => setAxisCollapsed('column', true),

    // 由宿主注入的应用内分组校验对话框（见 spreader.vue）
    get showOutlineAlert() {
      return outlineAlertApi;
    },
    set showOutlineAlert(fn) {
      outlineAlertApi = fn;
    },

    editInputStyle,

    hScrollbarW,
    vScrollbarH,
    hScrollbarLeft,
    vScrollbarTop,
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
