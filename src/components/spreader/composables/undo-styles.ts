import { ref, computed, watch, nextTick, type ComputedRef, type Ref } from 'vue';
import { UNDO_MAX, FONT_FAMILIES, FONT_SIZES, H_ALIGN_OPTIONS, V_ALIGN_OPTIONS, DEFAULT_FONT_SIZE, t } from '../core/constants';
import type { FontOption } from '../core/constants';
import type { CoreState } from './core-state';
import type { CellData, CellStyle, SheetState } from '../core/types';
import { cloneCells as _cloneCellsFromPool } from '../core/style-pool';
import { buildNumberFormatPresets, NF_CUSTOM, NF_MIXED, NF_GENERAL, NF_MAX_DECIMALS, NF_MIN_DECIMALS, isGeneralFormat, isDecimalsAdjustable, getEffectiveDecimals, adjustNumberFormatDecimals, normalizeNumberFormatForDisplay, type NFOption } from '../core/number-format';
import { computeCellValue } from '../core/formula';

// ============ 共享 UndoStyles 接口 ============
export interface UndoStylesState {
  // 撤销/重做
  undoStack: Ref<UndoSnap[]>;
  redoStack: Ref<UndoSnap[]>;
  cloneCells: (src: Record<string, CellData>) => Record<string, CellData>;
  takeSnap: () => UndoSnap;
  restoreSnap: (s: UndoSnap) => void;
  saveUndo: () => void;
  undo: () => void;
  redo: () => void;

  // 格式刷 / 清除格式
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;
  hasSelection: ComputedRef<boolean>;
  paintFmt: Ref<{ styles: Record<string, number> } | null>; // styleId 映射：相对坐标 → styleId
  onPaintFormat: () => void;
  applyPaintFormat: () => void;
  clearFormat: () => void;

  // 字体 / 字号
  fontFamilyOptions: ComputedRef<FontOption[]>;
  fontSizeOptions: ComputedRef<FontOption[]>;
  FONT_FAMILY_MIXED: string;
  selFontFamily: ComputedRef<string>;
  selFontSize: ComputedRef<number>;
  applyStyleToSelection: (prop: string, value: unknown) => void;
  onFontFamilyChange: (v: string | number) => void;
  onFontSizeChange: (v: string | number) => void;

  // 对齐
  hAlignOptions: ComputedRef<FontOption[]>;
  vAlignOptions: ComputedRef<FontOption[]>;
  selHAlign: ComputedRef<string>;
  selVAlign: ComputedRef<string>;
  selWrap: ComputedRef<boolean>;
  onHAlignChange: (v: string | number) => void;
  onVAlignChange: (v: string | number) => void;
  onWrapToggle: () => void;

  // 字号输入/菜单
  fontSizeInput: Ref<string>;
  fontSizeMenuOpen: Ref<boolean>;
  onFontSizeInput: (raw: string) => void;
  onFontSizeBlur: () => void;
  onFontSizeKeydown: (e: KeyboardEvent) => void;
  toggleFontSizeMenu: (e?: MouseEvent) => void;
  onFontSizeStepUp: () => void;
  onFontSizeStepDown: () => void;

  // 字体样式：粗体 / 斜体 / 下划线 / 删除线
  selFontWeight: ComputedRef<boolean>;
  selFontStyle: ComputedRef<boolean>;
  selUnderline: ComputedRef<boolean>;
  selStrikethrough: ComputedRef<boolean>;
  toggleFontWeight: () => void;
  toggleFontStyle: () => void;
  toggleUnderline: () => void;
  toggleStrikethrough: () => void;

  // 文字颜色 / 填充颜色
  cachedTextColor: Ref<string>;
  cachedFillColor: Ref<string>;
  textColorMenuOpen: Ref<boolean>;
  fillColorMenuOpen: Ref<boolean>;
  _toggleTextColorMenu: () => void;
  _toggleFillColorMenu: () => void;
  onBorderMenuToggle: (v: boolean) => void;
  onTextColorChange: (v: string) => void;
  onFillColorChange: (v: string) => void;
  applyCachedTextColor: () => void;
  applyCachedFillColor: () => void;
  selTextColor: ComputedRef<string>;
  selFillColor: ComputedRef<string>;

  // 边框/合并菜单开关（互斥）占位
  borderMenuOpen?: Ref<boolean>;
  mergeMenuOpen?: Ref<boolean>;

  // 数字格式（Number Format）
  nfOptions: ComputedRef<NFOption[]>;
  selNumberFormat: ComputedRef<string>;
  /** 仅供工具栏下拉回显：非预设代码归类到对应预设，避免回显为空 */
  selNumberFormatDisplay: ComputedRef<string>;
  NF_NUMBER_FORMAT_MIXED: string;
  nfDialogOpen: Ref<boolean>;
  onNumberFormatChange: (v: string) => void;
  openNumberFormatDialog: () => void;
  applyNumberFormatCode: (code: string) => void;
  // 小数位数步进（增加/减少小数位按钮）
  canIncreaseDecimals: ComputedRef<boolean>;
  canDecreaseDecimals: ComputedRef<boolean>;
  onIncreaseDecimals: () => void;
  onDecreaseDecimals: () => void;
}

interface UndoSnap {
  sheets: SheetState[];
  styles: CellStyle[];
  activeSheetIndex: number;
}

export function createUndoStyles(
  s: CoreState,
  sheetsCtx: {
    sheets: Ref<SheetState[]>;
    activeSheetIndex: Ref<number>;
    saveSheet: () => void;
    loadSheet: (i: number) => void;
    mkSheet: (name: string) => SheetState;
  },
): UndoStylesState {
  // ============ 撤销/重做 ============
  const undoStack = ref<UndoSnap[]>([]);
  const redoStack = ref<UndoSnap[]>([]);

  function cloneCells(src: Record<string, CellData>): Record<string, CellData> {
    return _cloneCellsFromPool(src);
  }

  function takeSnap(): UndoSnap {
    sheetsCtx.saveSheet();
    return {
      sheets: sheetsCtx.sheets.value.map((sh) => ({
        id: sh.id, name: sh.name,
        cells: cloneCells(sh.cells),
        styles: [...sh.styles],
        borders: sh.borders ? [...sh.borders] : [{}],
        merges: sh.merges ? { ...sh.merges } : {},
        selection: sh.selection ? { ...sh.selection } : null,
        activeCell: sh.activeCell ? { ...sh.activeCell } : { col: 0, row: 0 },
        scrollX: sh.scrollX, scrollY: sh.scrollY,
        colWidths: [...sh.colWidths], rowHeights: [...sh.rowHeights],
      })),
      styles: [...s.styles],
      activeSheetIndex: sheetsCtx.activeSheetIndex.value,
    };
  }

  function restoreSnap(snap: UndoSnap) {
    sheetsCtx.sheets.value = snap.sheets.map((x) => ({
      ...x,
      cells: cloneCells(x.cells),
      styles: [...x.styles],
      borders: x.borders ? [...x.borders] : [{}],
    }));
    sheetsCtx.loadSheet(Math.max(0, Math.min(snap.activeSheetIndex, sheetsCtx.sheets.value.length - 1)));
    s.formulaDeps.rebuild(s.cells, s.colCount, s.rowCount);
  }

  function saveUndo() {
    const snap = takeSnap();
    const last = undoStack.value[undoStack.value.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(snap)) return;
    undoStack.value.push(snap);
    redoStack.value = [];
    if (undoStack.value.length > UNDO_MAX) undoStack.value.shift();
  }
  // 反向注入到 core-state
  s.saveUndo = saveUndo;

  function undo() {
    if (!undoStack.value.length) return;
    redoStack.value.push(takeSnap());
    restoreSnap(undoStack.value.pop()!);
    s.scheduleRender?.();
    nextTick(() => s.emitModelData?.());
  }

  function redo() {
    if (!redoStack.value.length) return;
    undoStack.value.push(takeSnap());
    restoreSnap(redoStack.value.pop()!);
    s.scheduleRender?.();
    nextTick(() => s.emitModelData?.());
  }

  // ============ 格式刷 / 清除格式 ============
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);
  const hasSelection = computed(() => !!s.selection.value);

  const paintFmt = ref<{ styles: Record<string, number> } | null>(null);

  function onPaintFormat() {
    const sel = s.selection.value;
    if (!sel) return;
    const styleIds: Record<string, number> = {};
    for (let c = sel.startCol; c <= sel.endCol; c++) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        styleIds[`${c - sel.startCol},${r - sel.startRow}`] = s.cells[s.cellKey(c, r)]?.styleId ?? 0;
      }
    }
    paintFmt.value = { styles: styleIds };
  }

  function applyPaintFormat() {
    const pf = paintFmt.value;
    const sel = s.selection.value;
    if (!pf || !sel) return;
    saveUndo();
    for (let c = sel.startCol; c <= sel.endCol; c++) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const sid = pf.styles[`${c - sel.startCol},${r - sel.startRow}`] ?? 0;
        const k = s.cellKey(c, r);
        const val = s.cells[k]?.value ?? '';
        if (val === '' && sid === 0) s.delCell(k);
        else {
          const cell: CellData = { value: val };
          if (sid > 0) cell.styleId = sid;
          s.cells[k] = cell;
        }
      }
    }
    paintFmt.value = null;
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  function clearFormat() {
    const sel = s.selection.value;
    if (!sel) return;
    saveUndo();
    for (let c = sel.startCol; c <= sel.endCol; c++) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const k = s.cellKey(c, r);
        const val = s.cells[k]?.value ?? '';
        if (val === '') s.delCell(k);
        else s.cells[k] = { value: val }; // styleId 省略 = 默认样式
      }
    }
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  // ============ 字体 / 字号 ============
  const fontFamilyOptions = computed(() =>
    FONT_FAMILIES.map((f) => ({ ...f, label: f.value === '' ? t(s.locale.value, 'fontDefault') : f.label })),
  );
  const fontSizeOptions = computed(() =>
    FONT_SIZES.map((f) => ({ ...f, label: String(f.value) })),
  );
  const FONT_FAMILY_MIXED = '\u0000';

  const selFontFamily = computed(() => {
    const sel = s.selection.value;
    if (!sel) return '';
    let first: string | undefined;
    let mixed = false;
    for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
      for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const st = s.resolveStyle(s.cells[s.cellKey(c, r)]);
        const ff = typeof st?.fontFamily === 'string' ? st.fontFamily : '';
        if (first === undefined) first = ff;
        else if (ff !== first) mixed = true;
      }
    }
    return mixed ? FONT_FAMILY_MIXED : (first ?? '');
  });

  const selFontSize = computed(() => {
    const sel = s.selection.value;
    if (!sel) return DEFAULT_FONT_SIZE;
    let first: number | undefined;
    let mixed = false;
    for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
      for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const fsz = s.cellFontSize(c, r);
        if (first === undefined) first = fsz;
        else if (fsz !== first) mixed = true;
      }
    }
    return mixed ? 0 : (first ?? DEFAULT_FONT_SIZE);
  });

  function applyStyleToSelection(prop: string, value: unknown) {
    const sel = s.selection.value;
    if (!sel) return;
    saveUndo();
    for (let c = sel.startCol; c <= sel.endCol; c++) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const k = s.cellKey(c, r);
        const val = s.cells[k]?.value ?? '';
        // 读取旧样式副本 → 应用修改 → 注册到 StylePool → 更新 styleId
        const oldStyle = s.resolveStyle(s.cells[k]) ?? {};
        let newStyle: Record<string, unknown> = { ...oldStyle };
        if (value === '' || value === null || value === undefined || value === 0) {
          // 用解构 omit 代替动态 delete，避免修改共享对象
          const { [prop]: _omitted, ...rest } = newStyle;
          newStyle = rest;
        } else {
          newStyle[prop] = value;
        }
        const styleId = Object.keys(newStyle).length ? s.registerStyle(newStyle as CellStyle) : 0;
        if (val === '' && styleId === 0) s.delCell(k);
        else {
          const cell: CellData = { value: val };
          if (styleId > 0) cell.styleId = styleId;
          s.cells[k] = cell;
        }
      }
    }
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  function onFontFamilyChange(v: string | number) {
    applyStyleToSelection('fontFamily', v === '' ? '' : v);
  }

  // 占位引用，后面赋值
  const fontSizeMenuOpenRef = ref(false);
  const borderMenuOpenRef = ref(false);
  const mergeMenuOpenRef = ref(false);
  const textColorMenuOpenRef = ref(false);
  const fillColorMenuOpenRef = ref(false);

  function onFontSizeChange(v: string | number) {
    applyStyleToSelection('fontSize', v);
    fontSizeMenuOpenRef.value = false;
  }

  // ============ 对齐 ============
  const hAlignOptions = computed(() =>
    H_ALIGN_OPTIONS.map((o) => ({ label: t(s.locale.value, o.labelKey), value: o.value, icon: o.icon })),
  );
  const vAlignOptions = computed(() =>
    V_ALIGN_OPTIONS.map((o) => ({ label: t(s.locale.value, o.labelKey), value: o.value, icon: o.icon })),
  );
  const selHAlign = computed(() => {
    const sel = s.selection.value;
    if (!sel) return 'left';
    const st = s.resolveStyle(s.cells[s.cellKey(sel.startCol, sel.startRow)]);
    const a = typeof st?.textAlign === 'string' ? st.textAlign : '';
    return a === 'center' || a === 'right' ? a : 'left';
  });
  const selVAlign = computed(() => {
    const sel = s.selection.value;
    if (!sel) return 'top';
    const st = s.resolveStyle(s.cells[s.cellKey(sel.startCol, sel.startRow)]);
    const a = typeof st?.verticalAlign === 'string' ? st.verticalAlign : '';
    return a === 'middle' || a === 'bottom' ? a : 'top';
  });
  const selWrap = computed(() => {
    const sel = s.selection.value;
    if (!sel) return false;
    const st = s.resolveStyle(s.cells[s.cellKey(sel.startCol, sel.startRow)]);
    return st?.wrap === 'wrap';
  });
  function onHAlignChange(v: string | number) {
    applyStyleToSelection('textAlign', v);
  }
  function onVAlignChange(v: string | number) {
    applyStyleToSelection('verticalAlign', v);
  }
  function onWrapToggle() {
    const sel = s.selection.value;
    if (!sel) return;
    const cur = selWrap.value;
    applyStyleToSelection('wrap', cur ? undefined : 'wrap');
  }

  // ============ 字号输入 ============
  const fontSizeInput = ref('');
  const fontSizeMenuOpen = fontSizeMenuOpenRef;

  watch(selFontSize, (v) => {
    fontSizeInput.value = v === 0 ? '' : String(v);
  }, { immediate: true });

  function onFontSizeInput(raw: string) {
    const filtered = raw.replace(/[^\d]/g, '');
    fontSizeInput.value = filtered;
    const num = parseInt(filtered, 10);
    if (!isNaN(num) && num >= 5 && num <= 72) {
      if (num !== selFontSize.value) {
        applyStyleToSelection('fontSize', num);
      }
    }
  }

  function onFontSizeBlur() {
    const raw = fontSizeInput.value.trim();
    if (!raw) {
      fontSizeInput.value = selFontSize.value === 0 ? '' : String(selFontSize.value);
      return;
    }
    let v = parseInt(raw, 10);
    if (isNaN(v)) {
      v = selFontSize.value === 0 ? DEFAULT_FONT_SIZE : selFontSize.value;
    } else {
      v = Math.max(5, Math.min(72, v));
    }
    fontSizeInput.value = String(v);
    if (v !== selFontSize.value) {
      applyStyleToSelection('fontSize', v);
    }
  }

  function onFontSizeKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  }

  function toggleFontSizeMenu(e?: MouseEvent) {
    if (e) e.preventDefault();
    fontSizeMenuOpen.value = !fontSizeMenuOpen.value;
    if (fontSizeMenuOpen.value) {
      if (mergeMenuOpenRef) mergeMenuOpenRef.value = false;
      if (borderMenuOpenRef) borderMenuOpenRef.value = false;
      textColorMenuOpenRef.value = false;
      fillColorMenuOpenRef.value = false;
    }
  }

  function onFontSizeStepUp() {
    const cur = selFontSize.value === 0 ? DEFAULT_FONT_SIZE : selFontSize.value;
    const next = Math.min(72, cur + 1);
    applyStyleToSelection('fontSize', next);
    fontSizeInput.value = String(next);
    fontSizeMenuOpen.value = false;
  }

  function onFontSizeStepDown() {
    const cur = selFontSize.value === 0 ? DEFAULT_FONT_SIZE : selFontSize.value;
    const next = Math.max(5, cur - 1);
    applyStyleToSelection('fontSize', next);
    fontSizeInput.value = String(next);
    fontSizeMenuOpen.value = false;
  }

  // ============ 字体样式 ============
  function selStyleActive(prop: string): boolean {
    const sel = s.selection.value;
    if (!sel) return false;
    let first: boolean | undefined;
    let mixed = false;
    for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
      for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const st = s.resolveStyle(s.cells[s.cellKey(c, r)]);
        const v = Boolean(st?.[prop]);
        if (first === undefined) first = v;
        else if (v !== first) mixed = true;
      }
    }
    return !mixed && first === true;
  }

  const selFontWeight = computed(() => selStyleActive('fontWeight'));
  const selFontStyle = computed(() => selStyleActive('fontStyle'));
  const selUnderline = computed(() => selStyleActive('underline'));
  const selStrikethrough = computed(() => selStyleActive('strikethrough'));

  function toggleFontWeight() {
    applyStyleToSelection('fontWeight', selFontWeight.value ? '' : 'bold');
  }
  function toggleFontStyle() {
    applyStyleToSelection('fontStyle', selFontStyle.value ? '' : 'italic');
  }
  function toggleUnderline() {
    applyStyleToSelection('underline', selUnderline.value ? '' : 'underline');
  }
  function toggleStrikethrough() {
    applyStyleToSelection('strikethrough', selStrikethrough.value ? '' : 'line-through');
  }

  // ============ 文字颜色 / 填充颜色 ============
  const cachedTextColor = ref('');
  const cachedFillColor = ref('');
  const textColorMenuOpen = textColorMenuOpenRef;
  const fillColorMenuOpen = fillColorMenuOpenRef;

  function _toggleTextColorMenu() {
    textColorMenuOpen.value = !textColorMenuOpen.value;
    fillColorMenuOpen.value = false;
    if (borderMenuOpenRef) borderMenuOpenRef.value = false;
    if (mergeMenuOpenRef) mergeMenuOpenRef.value = false;
  }
  function _toggleFillColorMenu() {
    fillColorMenuOpen.value = !fillColorMenuOpen.value;
    textColorMenuOpen.value = false;
    if (borderMenuOpenRef) borderMenuOpenRef.value = false;
    if (mergeMenuOpenRef) mergeMenuOpenRef.value = false;
  }
  function onBorderMenuToggle(v: boolean) {
    if (borderMenuOpenRef) borderMenuOpenRef.value = v;
    if (v) {
      textColorMenuOpen.value = false;
      fillColorMenuOpen.value = false;
      if (mergeMenuOpenRef) mergeMenuOpenRef.value = false;
    }
  }
  function onTextColorChange(v: string) {
    cachedTextColor.value = v;
    applyStyleToSelection('color', v === '' ? '' : v);
  }
  function onFillColorChange(v: string) {
    cachedFillColor.value = v;
    applyStyleToSelection('backgroundColor', v === '' ? '' : v);
  }
  function applyCachedTextColor() {
    applyStyleToSelection('color', cachedTextColor.value === '' ? '' : cachedTextColor.value);
  }
  function applyCachedFillColor() {
    applyStyleToSelection('backgroundColor', cachedFillColor.value === '' ? '' : cachedFillColor.value);
  }

  const selTextColor = computed(() => {
    const sel = s.selection.value;
    if (!sel) return '';
    let first: string | undefined;
    let mixed = false;
    for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
      for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const st = s.resolveStyle(s.cells[s.cellKey(c, r)]);
        const v = typeof st?.color === 'string' ? st.color : '';
        if (first === undefined) first = v;
        else if (v !== first) mixed = true;
      }
    }
    return mixed ? '' : (first ?? '');
  });

  const selFillColor = computed(() => {
    const sel = s.selection.value;
    if (!sel) return '';
    let first: string | undefined;
    let mixed = false;
    for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
      for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const st = s.resolveStyle(s.cells[s.cellKey(c, r)]);
        const v = typeof st?.backgroundColor === 'string' ? st.backgroundColor : '';
        if (first === undefined) first = v;
        else if (v !== first) mixed = true;
      }
    }
    return mixed ? '' : (first ?? '');
  });

  // ============ 数字格式（Number Format）============
  const nfOptions = computed(() => buildNumberFormatPresets(s.locale.value));
  const nfDialogOpen = ref(false);

  // 选区 numberFormat 一致性检测：不一致时返回 NF_MIXED（与 fontFamily 的 mixed 语义一致）
  // 没有属性/空串 = 常规，"主动选常规"和"从未设置"天然一致，无需区分。
  // 带 numberFormatCategory='custom' 标记（常规单元格经小数位按钮生成）的格式 → 回显为 NF_CUSTOM（自定义）
  const selNumberFormat = computed(() => {
    const sel = s.selection.value;
    if (!sel) return NF_GENERAL;
    let first: string | undefined;
    let mixed = false;
    for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
      for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const st = s.resolveStyle(s.cells[s.cellKey(c, r)]);
        const nf = st?.numberFormatCategory === 'custom'
          ? NF_CUSTOM
          : (typeof st?.numberFormat === 'string' ? st.numberFormat : '');
        if (first === undefined) first = nf;
        else if (nf !== first) mixed = true;
      }
    }
    return mixed ? NF_MIXED : (first ?? NF_GENERAL);
  });

  // 仅供显示的归一化回显值：增减小数位、对话框改符号/日期/自定义代码等产生的代码
  // 不在预设列表中，按分类归到对应预设显示（原始代码语义仍由 selNumberFormat 保留，
  // 供对话框初始值等使用）
  function cellDisplayNF(st: CellStyle | null | undefined): string {
    if (st?.numberFormatCategory === 'custom') return NF_CUSTOM;
    const nf = typeof st?.numberFormat === 'string' ? st.numberFormat : '';
    return normalizeNumberFormatForDisplay(nf, s.locale.value);
  }

  const selNumberFormatDisplay = computed(() => {
    const raw = selNumberFormat.value;
    if (raw !== NF_MIXED) {
      return raw === NF_CUSTOM ? NF_CUSTOM : normalizeNumberFormatForDisplay(raw, s.locale.value);
    }
    // 原始代码不一致，但归类后可能同属一类（如 '#,##0.00' 与 '0.000'）→ 归一化后重判一致性
    const sel = s.selection.value;
    if (!sel) return NF_GENERAL;
    let first: string | undefined;
    let mixed = false;
    for (let c = sel.startCol; c <= sel.endCol && !mixed; c++) {
      for (let r = sel.startRow; r <= sel.endRow && !mixed; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const nf = cellDisplayNF(s.resolveStyle(s.cells[s.cellKey(c, r)]));
        if (first === undefined) first = nf;
        else if (nf !== first) mixed = true;
      }
    }
    return mixed ? NF_MIXED : (first ?? NF_GENERAL);
  });

  // 将格式代码应用到当前选区；General（空串）会删除 numberFormat 属性。
  // 用户显式选择格式 → 同时清除自动生成的自定义标记（由后续代码反推分类）
  function applyNumberFormatCode(code: string) {
    applyStyleToSelection('numberFormat', code);
    clearSelectionNumberFormatCategory();
  }

  // 移除选区样式的 numberFormatCategory 标记
  function clearSelectionNumberFormatCategory() {
    const sel = s.selection.value;
    if (!sel) return;
    for (let c = sel.startCol; c <= sel.endCol; c++) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const k = s.cellKey(c, r);
        const cell = s.cells[k];
        const oldStyle = s.resolveStyle(cell);
        if (oldStyle?.numberFormatCategory !== 'custom') continue;
        const { numberFormatCategory: _omitted, ...rest } = oldStyle;
        const styleId = Object.keys(rest).length ? s.registerStyle(rest) : 0;
        const val = cell?.value ?? '';
        if (val === '' && styleId === 0) s.delCell(k);
        else {
          const nc: CellData = { value: val };
          if (styleId > 0) nc.styleId = styleId;
          s.cells[k] = nc;
        }
      }
    }
  }

  function onNumberFormatChange(v: string) {
    if (v === NF_CUSTOM) {
      nfDialogOpen.value = true;
      return;
    }
    applyNumberFormatCode(v);
  }

  function openNumberFormatDialog() {
    nfDialogOpen.value = true;
  }

  // ============ 小数位数步进（增加/减少小数位） ============
  // 收集选区内"可调整小数位"的单元格：数值类格式（数字/百分比/货币等）恒适用；
  // 常规格式仅当值为数字时适用；文本/日期/时间/持续时间跳过。
  // 合并单元格只在锚点处理一次。
  function collectAdjustableCells(): { key: string; nf: string; decimals: number }[] {
    const sel = s.selection.value;
    if (!sel) return [];
    const out: { key: string; nf: string; decimals: number }[] = [];
    for (let c = sel.startCol; c <= sel.endCol; c++) {
      for (let r = sel.startRow; r <= sel.endRow; r++) {
        const m = s.findMerge(c, r);
        if (m && (c !== m.range.startCol || r !== m.range.startRow)) continue;
        const k = s.cellKey(c, r);
        const cell = s.cells[k];
        const st = s.resolveStyle(cell);
        const nf = typeof st?.numberFormat === 'string' ? st.numberFormat : NF_GENERAL;
        const value = cell?.value ?? '';
        // 公式单元格：用计算结果判定是否为数值（与单元格显示/对齐一致）；
        // 否则 raw 是公式串，isNumericValue 判为 false 会被误判为不可调整。
        const effectiveValue = value.startsWith('=')
          ? computeCellValue(c, r, s.cells, s.colCount, s.rowCount)
          : value;
        if (!isDecimalsAdjustable(nf, effectiveValue)) continue;
        out.push({ key: k, nf, decimals: getEffectiveDecimals(nf, effectiveValue) });
      }
    }
    return out;
  }

  // 存在可调整单元格且未全部达到上限 → 增加按钮可用
  const canIncreaseDecimals = computed(() =>
    collectAdjustableCells().some((c) => c.decimals < NF_MAX_DECIMALS));
  // 存在可调整单元格且至少一个未达下限（0）→ 减少按钮可用
  const canDecreaseDecimals = computed(() =>
    collectAdjustableCells().some((c) => c.decimals > NF_MIN_DECIMALS));

  // 按 key 单独设置 numberFormat（空串 = 删除属性回常规）；
  // category='custom' 表示格式由常规单元格经小数位按钮自动生成，需写入分类标记；
  // 目标归零（'0'/'0.00' → 非常规）仍保留标记，只有回到常规才清除
  function setCellNumberFormat(k: string, code: string, category?: 'custom') {
    const val = s.cells[k]?.value ?? '';
    const oldStyle = s.resolveStyle(s.cells[k]) ?? {};
    const newStyle: CellStyle = { ...oldStyle };
    if (code === '') {
      delete newStyle.numberFormat;
      delete newStyle.numberFormatCategory;
    } else {
      newStyle.numberFormat = code;
      if (category === 'custom') newStyle.numberFormatCategory = 'custom';
    }
    const styleId = Object.keys(newStyle).length ? s.registerStyle(newStyle) : 0;
    if (val === '' && styleId === 0) {
      s.delCell(k);
    } else {
      const cell: CellData = { value: val };
      if (styleId > 0) cell.styleId = styleId;
      s.cells[k] = cell;
    }
  }

  // 逐格基于自身当前格式步进 ±1 小数位；越界/不支持的单元格跳过；一次操作一个撤销点。
  // 常规单元格（识别为数字）步进后，数字格式属性自动标记为自定义分类。
  function stepSelectionDecimals(delta: 1 | -1) {
    const items = collectAdjustableCells();
    const changes: { key: string; code: string; category?: 'custom' }[] = [];
    for (const it of items) {
      const target = it.decimals + delta;
      if (target < NF_MIN_DECIMALS || target > NF_MAX_DECIMALS) continue;
      const code = adjustNumberFormatDecimals(it.nf, target);
      if (code == null || code === it.nf) continue;
      changes.push({ key: it.key, code, category: isGeneralFormat(it.nf) ? 'custom' : undefined });
    }
    if (!changes.length) return;
    saveUndo();
    for (const ch of changes) setCellNumberFormat(ch.key, ch.code, ch.category);
    s.scheduleRender?.();
    s.emitModelData?.();
  }

  function onIncreaseDecimals() {
    stepSelectionDecimals(1);
  }

  function onDecreaseDecimals() {
    stepSelectionDecimals(-1);
  }

  const ret: UndoStylesState = {
    undoStack,
    redoStack,
    cloneCells,
    takeSnap,
    restoreSnap,
    saveUndo,
    undo,
    redo,

    canUndo,
    canRedo,
    hasSelection,
    paintFmt,
    onPaintFormat,
    applyPaintFormat,
    clearFormat,

    fontFamilyOptions,
    fontSizeOptions,
    FONT_FAMILY_MIXED,
    selFontFamily,
    selFontSize,
    applyStyleToSelection,
    onFontFamilyChange,
    onFontSizeChange,

    hAlignOptions,
    vAlignOptions,
    selHAlign,
    selVAlign,
    selWrap,
    onHAlignChange,
    onVAlignChange,
    onWrapToggle,

    fontSizeInput,
    fontSizeMenuOpen,
    onFontSizeInput,
    onFontSizeBlur,
    onFontSizeKeydown,
    toggleFontSizeMenu,
    onFontSizeStepUp,
    onFontSizeStepDown,

    selFontWeight,
    selFontStyle,
    selUnderline,
    selStrikethrough,
    toggleFontWeight,
    toggleFontStyle,
    toggleUnderline,
    toggleStrikethrough,

    cachedTextColor,
    cachedFillColor,
    textColorMenuOpen,
    fillColorMenuOpen,
    _toggleTextColorMenu,
    _toggleFillColorMenu,
    onBorderMenuToggle,
    onTextColorChange,
    onFillColorChange,
    applyCachedTextColor,
    applyCachedFillColor,
    selTextColor,
    selFillColor,

    nfOptions,
    selNumberFormat,
    selNumberFormatDisplay,
    NF_NUMBER_FORMAT_MIXED: NF_MIXED,
    nfDialogOpen,
    onNumberFormatChange,
    openNumberFormatDialog,
    applyNumberFormatCode,
    canIncreaseDecimals,
    canDecreaseDecimals,
    onIncreaseDecimals,
    onDecreaseDecimals,
  };

  return ret;
}

// 绑定边框/合并菜单引用（在 borders-merge 中创建后注入）
export function bindMenuRefs(
  us: UndoStylesState,
  refs: { borderMenuOpen?: Ref<boolean>; mergeMenuOpen?: Ref<boolean> },
) {
  if (refs.borderMenuOpen) (us as unknown as { borderMenuOpen: Ref<boolean> }).borderMenuOpen = refs.borderMenuOpen;
  if (refs.mergeMenuOpen) (us as unknown as { mergeMenuOpen: Ref<boolean> }).mergeMenuOpen = refs.mergeMenuOpen;
  // 同时反向注入到各个 toggle 函数内部的局部变量引用
  // 通过动态访问 us.borderMenuOpen / us.mergeMenuOpen 来实现
  // 替换 onBorderMenuToggle 以使用绑定后的引用
  const bindToggle = () => {
    const bmo = (us as unknown as { borderMenuOpen?: Ref<boolean> }).borderMenuOpen;
    const mmo = (us as unknown as { mergeMenuOpen?: Ref<boolean> }).mergeMenuOpen;
    us.onBorderMenuToggle = (v: boolean) => {
      if (bmo) bmo.value = v;
      if (v) {
        us.textColorMenuOpen.value = false;
        us.fillColorMenuOpen.value = false;
        if (mmo) mmo.value = false;
      }
    };
    us.toggleFontSizeMenu = (e?: MouseEvent) => {
      if (e) e.preventDefault();
      us.fontSizeMenuOpen.value = !us.fontSizeMenuOpen.value;
      if (us.fontSizeMenuOpen.value) {
        if (mmo) mmo.value = false;
        if (bmo) bmo.value = false;
        us.textColorMenuOpen.value = false;
        us.fillColorMenuOpen.value = false;
      }
    };
    us._toggleTextColorMenu = () => {
      us.textColorMenuOpen.value = !us.textColorMenuOpen.value;
      us.fillColorMenuOpen.value = false;
      if (bmo) bmo.value = false;
      if (mmo) mmo.value = false;
    };
    us._toggleFillColorMenu = () => {
      us.fillColorMenuOpen.value = !us.fillColorMenuOpen.value;
      us.textColorMenuOpen.value = false;
      if (bmo) bmo.value = false;
      if (mmo) mmo.value = false;
    };
  };
  bindToggle();
}
