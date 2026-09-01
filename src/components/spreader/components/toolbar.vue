<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { t } from '../core/constants';
import type { FontOption, MergeType } from '../core/constants';
import { getFloatBounds, cssRightFromX } from '../core/utils';
import { NF_MIXED, type NFOption } from '../core/number-format';
import SpDropdown from './dropdown.vue';
import ColorPicker from './pickers/color-picker.vue';
import BorderPicker, { type BorderType } from './pickers/border-picker.vue';
import SortPicker from './pickers/sort-picker.vue';
import OutlinePicker from './pickers/outline-picker.vue';
import MergePicker from './pickers/merge-picker.vue';
import ConditionalFormatMenu from './pickers/conditional-format-menu.vue';
import CalcPicker from './pickers/calc-picker.vue';
import type { SortOrder } from '../core/sort-core';

// 田字型边框按钮图标：4 个外边 + 1 条竖中线 + 1 条横中线（与 border-picker.vue 保持一致）
interface BorderSeg { name: string; x1: number; y1: number; x2: number; y2: number }
const BORDER_SEGS: BorderSeg[] = [
  { name: 'top', x1: 4, y1: 4, x2: 26, y2: 4 },
  { name: 'bottom', x1: 4, y1: 26, x2: 26, y2: 26 },
  { name: 'left', x1: 4, y1: 4, x2: 4, y2: 26 },
  { name: 'right', x1: 26, y1: 4, x2: 26, y2: 26 },
  { name: 'vMid', x1: 15, y1: 4, x2: 15, y2: 26 },
  { name: 'hMid', x1: 4, y1: 15, x2: 26, y2: 15 },
];
const SOLID_SEGS: Record<BorderType, string[]> = {
  bottom: ['bottom'],
  top: ['top'],
  left: ['left'],
  right: ['right'],
  none: [],
  all: ['top', 'bottom', 'left', 'right', 'vMid', 'hMid'],
  outer: ['top', 'bottom', 'left', 'right'],
  thickOuter: ['top', 'bottom', 'left', 'right'],
};
const THICK_SEGS: Record<BorderType, string[]> = {
  bottom: [],
  top: [],
  left: [],
  right: [],
  none: [],
  all: [],
  outer: [],
  thickOuter: ['top', 'bottom', 'left', 'right'],
};
function segRole(bt: BorderType, name: string): 'solid' | 'dashed' | 'thick' {
  if (THICK_SEGS[bt].includes(name)) return 'thick';
  if (SOLID_SEGS[bt].includes(name)) return 'solid';
  return 'dashed';
}
const BORDER_LABEL_KEY: Record<BorderType, string> = {
  none: 'borderNone',
  bottom: 'borderBottom',
  top: 'borderTop',
  left: 'borderLeft',
  right: 'borderRight',
  all: 'borderAll',
  outer: 'borderOuter',
  thickOuter: 'borderThickOuter',
};

// 排序按钮图标：左侧三条渐宽横线 + 右侧方向箭头（与 sort-picker.vue 保持一致）
interface SortBar { name: string; x1: number; y1: number; x2: number; y2: number }
const SORT_BARS: SortBar[] = [
  { name: 'bar1', x1: 96, y1: 224, x2: 352, y2: 224 },
  { name: 'bar2', x1: 96, y1: 512, x2: 512, y2: 512 },
  { name: 'bar3', x1: 96, y1: 800, x2: 672, y2: 800 },
];
const SORT_ARROW_PATHS: Record<SortOrder, string> = {
  asc: 'M832 800V288M672 448l160-160 160 160',
  desc: 'M832 224v512M672 576l160 160 160-160',
};

// 冻结窗格图标：田字格 + 左上角实心，表示冻结的 corner 区域
// 外框 + 横/竖分界线（描边）+ 左上角实心块（fill）
const FREEZE_ICON = '<svg viewBox="0 0 1024 1024" fill="currentColor"><path fill="none" stroke="currentColor" stroke-width="64" stroke-linejoin="round" stroke-linecap="round" d="M160 160 H864 V864 H160 Z" /><path fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" d="M160 448 H864" /><path fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" d="M448 160 V864" /><path d="M192 192 H416 V416 H192 Z" /></svg>';
// 冻结首行图标：田字格外框 + 行分界线 + 顶部整行实心
const FREEZE_FIRST_ROW_ICON = '<svg viewBox="0 0 1024 1024" fill="currentColor"><path fill="none" stroke="currentColor" stroke-width="64" stroke-linejoin="round" stroke-linecap="round" d="M160 160 H864 V864 H160 Z" /><path fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" d="M160 448 H864" /><path d="M192 192 H832 V416 H192 Z" /></svg>';
// 冻结首列图标：田字格外框 + 列分界线 + 左侧整列实心
const FREEZE_FIRST_COL_ICON = '<svg viewBox="0 0 1024 1024" fill="currentColor"><path fill="none" stroke="currentColor" stroke-width="64" stroke-linejoin="round" stroke-linecap="round" d="M160 160 H864 V864 H160 Z" /><path fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" d="M448 160 V864" /><path d="M192 192 H416 V832 H192 Z" /></svg>';
// 取消冻结图标：田字格外框 + 分界线（无实心块）+ 左上角 X（表示已取消冻结）
const UNFREEZE_ICON = '<svg viewBox="0 0 1024 1024" fill="currentColor"><path fill="none" stroke="currentColor" stroke-width="64" stroke-linejoin="round" stroke-linecap="round" d="M160 160 H864 V864 H160 Z" /><path fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" d="M160 448 H864" /><path fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" d="M448 160 V864" /><path fill="none" stroke="currentColor" stroke-width="48" stroke-linecap="round" d="M224 224 L416 416" /><path fill="none" stroke="currentColor" stroke-width="48" stroke-linecap="round" d="M416 224 L224 416" /></svg>';

// ============ 工具栏溢出 → 「更多」菜单 ============
// 工具项顺序与 data-key 一一对应
const TOOL_KEYS = [
  'undo', 'redo', 'paint', 'clear', 'sep1', 'font', 'fontSize', 'sep2',
  'bold', 'italic', 'underline', 'strike', 'sep3', 'textColor', 'fillColor', 'border',
  'sep4', 'hAlign', 'vAlign', 'wrap', 'merge', 'sep6', 'numFmt', 'sep7', 'calc', 'sort', 'filter', 'outline', 'freeze', 'cf', 'dv', 'find',
] as const;

const rootEl = ref<HTMLElement | null>(null);
const overflowMenuEl = ref<HTMLElement | null>(null);
const moreBtnEl = ref<HTMLElement | null>(null);
const textColorArrowRef = ref<HTMLElement | null>(null);
const fillColorArrowRef = ref<HTMLElement | null>(null);
const borderArrowRef = ref<HTMLElement | null>(null);
const sortArrowRef = ref<HTMLElement | null>(null);
const mergeArrowRef = ref<HTMLElement | null>(null);
const calcArrowRef = ref<HTMLElement | null>(null);
const outlineArrowRef = ref<HTMLElement | null>(null);
const fontSizeArrowRef = ref<HTMLElement | null>(null);
const overflowKeys = ref<Set<string>>(new Set());
const overflowOpen = ref(false);
const skipCloseAnim = ref(false);
const overflowKeyVersion = ref(0);
const overflowCanUp = ref(false);
const overflowCanDown = ref(false);

const GAP = 2;     // .toolbar 的列间距
const PAD = 6;     // .toolbar 左右内边距
const MORE_W = 34; // 「更多」按钮预留宽度
const naturalWidths = new Map<string, number>();

const hasOverflow = computed(() => overflowKeys.value.size > 0);
function isOverflow(key: string): boolean {
  return overflowKeys.value.has(key);
}

/** 安全的溢出菜单目标：只有当 overflowMenuEl 存在且已渲染时才返回，否则返回 undefined。
 *  配合 :disabled 避免 Vue 警告 "Invalid Teleport target: undefined"。 */
const overflowMenuTarget = computed<HTMLElement | undefined>(() => {
  const el = overflowMenuEl.value;
  return el instanceof HTMLElement ? el : undefined;
});
/** 只有当 overflowMenuEl 已就绪时才允许 Teleport，避免 Vue 在 ref 为 null 时仍然检查 to 属性 */
function teleportDisabled(key: string): boolean {
  if (!overflowMenuTarget.value) return true;
  return !isOverflow(key);
}

function hasZeroWidth(): boolean {
  for (const k of TOOL_KEYS) {
    const w = naturalWidths.get(k);
    if (w === undefined || w === 0) return true;
  }
  return false;
}

function measureNaturalWidths() {
  if (!rootEl.value) return;
  const els = rootEl.value.querySelectorAll<HTMLElement>('.tb-item');
  els.forEach((el) => {
    const key = el.dataset.key;
    if (!key) return;
    const w = el.offsetWidth;
    // 已溢出的项被 Teleport 到 display:none 的菜单里，offsetWidth 为 0，
    // 不能用 0 覆盖之前测到的真实宽度，否则会误判
    if (w > 0) naturalWidths.set(key, w);
    else if (!naturalWidths.has(key)) naturalWidths.set(key, 0);
  });
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

let recomputeRaf = 0;
let recomputeTries = 0;
let recomputeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRecompute() {
  if (recomputeRaf) cancelAnimationFrame(recomputeRaf);
  // 兜底：取消 60 次硬退出。少数环境（独立项目生产构建首屏 + 字体交换/JS 加载竞争）下 layout 长期
  // 未就绪导致 clientWidth 持续为 0；超阈值后转长间隔 setTimeout 继续重试，配合 ResizeObserver /
  // window.load / orientationchange 重新触发，理论上总能等到布局就绪（内容可见性已改用纯 CSS
  // animation，不会因测量延迟而变透明，这里只影响溢出菜单的判定时机）
  if (recomputeTries > 60) {
    if (recomputeFallbackTimer) clearTimeout(recomputeFallbackTimer);
    recomputeFallbackTimer = setTimeout(() => {
      recomputeTries = 0;
      scheduleRecompute();
    }, 500);
    return;
  }
  recomputeTries++;
  // 双 rAF：等浏览器完成布局后再测量，规避移动端初始化时宽度未就绪导致的误判
  recomputeRaf = requestAnimationFrame(() => requestAnimationFrame(recompute));
}

function recompute() {
  if (!rootEl.value) return;
  const contentW = rootEl.value.clientWidth - PAD * 2;
  // 布局尚未就绪（clientWidth 为 0）→ 下一帧重试，避免误把全部工具项判为溢出
  if (contentW <= 0) {
    scheduleRecompute();
    return;
  }
  recomputeTries = 0;
  if (naturalWidths.size === 0 || hasZeroWidth()) measureNaturalWidths();

  let total = 0;
  for (const k of TOOL_KEYS) total += (naturalWidths.get(k) ?? 0) + GAP;

  const next = new Set<string>();
  if (total > contentW) {
    const avail = contentW - MORE_W - GAP;
    let used = 0;
    for (let i = 0; i < TOOL_KEYS.length; i++) {
      const k = TOOL_KEYS[i]!;
      const w = (naturalWidths.get(k) ?? 0) + GAP;
      if (used + w > avail) {
        for (let j = i; j < TOOL_KEYS.length; j++) next.add(TOOL_KEYS[j]!);
        break;
      }
      used += w;
    }
  }

  if (!sameSet(next, overflowKeys.value)) {
    overflowKeys.value = next;
    overflowKeyVersion.value++;
    if (next.size === 0) overflowOpen.value = false;
  }
}

let ro: ResizeObserver | null = null;

const menuPosVersion = ref(0);

const menuStyle = computed(() => {
  const btn = moreBtnEl.value;
  const base: Record<string, string> = { position: 'fixed', top: '0px', right: '0px' };
  if (!btn) {
    return { ...props.themeVars, ...base };
  }
  void menuPosVersion.value;
  const rect = btn.getBoundingClientRect();
  const b = getFloatBounds(props.boundaryEl);
  return {
    ...props.themeVars,
    position: 'fixed' as const,
    top: `${rect.bottom + 4}px`,
    right: `${cssRightFromX(Math.min(rect.right, b.right))}px`,
  };
});

function onWindowResize() {
  if (overflowOpen.value) {
    menuPosVersion.value++;
    nextTick(() => recompute());
  }
}

function onDocPointerdown(e: PointerEvent) {
  if (!overflowOpen.value) return;
  const target = e.target as Node;
  if ((target as HTMLElement).closest?.('.overflow-menu-wrap')) return;
  if (moreBtnEl.value?.contains(target)) return;
  // CF 弹层（condition format Teleport 到 body 的菜单）、ColorPicker 弹层、SpDropdown 弹层都可能在 body 上，
  // 只要点在弹层内部就不关闭溢出菜单——否则点击子菜单选色/选条件时会把溢出菜单先关掉
  if ((target as HTMLElement).closest?.('.cf-menu, .sp-dropdown__menu, .color-picker__menu, .outline-picker__menu, .border-picker__menu, .calc-picker__menu, .merge-picker__menu, .sort-picker__menu')) return;
  skipCloseAnim.value = true;
  overflowOpen.value = false;
  nextTick(() => {
    skipCloseAnim.value = false;
  });
}

function toggleOverflow() {
  overflowOpen.value = !overflowOpen.value;
  if (overflowOpen.value) nextTick(onOverflowScroll);
}

// 点击溢出菜单中的「查找」项：触发查找后自动关闭溢出菜单
// （其它菜单项多因状态变更触发 recompute 间接关闭，查找仅打开子面板不改动布局，需显式关闭）
function onDataValidationClick() {
  overflowOpen.value = false;
  emit('open-data-validation');
}

function onFindClick() {
  overflowOpen.value = false;
  emit('find');
}

// 点击溢出菜单中的「筛选」项：触发切换后自动关闭溢出菜单
function onFilterClick() {
  overflowOpen.value = false;
  emit('toggle-filter');
}

function closeOverflow() {
  overflowOpen.value = false;
}
function onOverflowScroll() {
  const el = overflowMenuEl.value;
  if (!el) return;
  overflowCanUp.value = el.scrollTop > 1;
  overflowCanDown.value = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  // 溢出菜单内滚动时收起已弹出的 picker 下拉，避免其悬在溢出菜单之上错位
  closeAllToolbarMenus();
}
function scrollOverflowBy(d: number) {
  const el = overflowMenuEl.value;
  if (!el) return;
  el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + d * 40));
}
defineExpose({ closeOverflow });

onMounted(() => {
  scheduleRecompute();
  if (rootEl.value) {
    ro = new ResizeObserver(() => {
      if (overflowOpen.value) {
        return;
      }
      scheduleRecompute();
    });
    ro.observe(rootEl.value);
  }
  // 用 pointerdown 而非 mousedown：触屏时 canvas 的 touchstart.prevent 会抑制合成鼠标事件，
  // mousedown 收不到；pointerdown 先于 touchstart 触发且不受其 preventDefault 影响，鼠标/触摸通吃
  document.addEventListener('pointerdown', onDocPointerdown, true);
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('load', scheduleRecompute);
  window.addEventListener('orientationchange', scheduleRecompute);
});

onBeforeUnmount(() => {
  if (recomputeRaf) cancelAnimationFrame(recomputeRaf);
  if (recomputeFallbackTimer) clearTimeout(recomputeFallbackTimer);
  ro?.disconnect();
  document.removeEventListener('pointerdown', onDocPointerdown, true);
  window.removeEventListener('resize', onWindowResize);
  window.removeEventListener('load', scheduleRecompute);
  window.removeEventListener('orientationchange', scheduleRecompute);
});

const props = defineProps<{
  locale: string;
  canUndo: boolean;
  canRedo: boolean;
  paintFmtActive: boolean;
  hasSelection: boolean;
  fontFamilyOptions: FontOption[];
  fontSizeOptions: FontOption[];
  selFontFamily: string | number;
  selFontSize: number;
  fontSizeInput: string;
  fontSizeMenuOpen: boolean;
  selFontWeight: boolean;
  selFontStyle: boolean;
  selUnderline: boolean;
  selStrikethrough: boolean;
  selTextColor: string;
  textColorMenuOpen: boolean;
  selFillColor: string;
  fillColorMenuOpen: boolean;
  cachedTextColor: string;
  cachedFillColor: string;
  borderMenuOpen: boolean;
  cachedBorder: BorderType;
  sortMenuOpen: boolean;
  cachedSortOrder: SortOrder;
  canSort: boolean;
  outlineMenuOpen: boolean;
  /** 当前选区轴：'rows'=选中整行，'cols'=选中整列，null=未选中行/列。决定「分组」按钮是否可用（置灰提示先选行/列） */
  outlineAxis?: 'rows' | 'cols' | null;
  /** 工具栏「筛选」按钮是否可用（单选合并单元格且无筛选态时禁用） */
  canFilter: boolean;
  /** 当前 worksheet 是否已启用筛选 */
  filterActive: boolean;
  selHAlign: string;
  selVAlign: string;
  selWrap: boolean;
  hAlignOptions: FontOption[];
  vAlignOptions: FontOption[];
  mergeMenuOpen: boolean;
  calcMenuOpen: boolean;
  cfMenuOpen: boolean;
  freezeMenuOpen: boolean;
  fontMenuOpen: boolean;
  hAlignMenuOpen: boolean;
  vAlignMenuOpen: boolean;
  numFmtMenuOpen: boolean;
  isSingleCell: boolean;
  /** 当前 worksheet 是否已有冻结行或列 */
  hasFreeze: boolean;
  /** 冻结窗格的冻结点是否位于 A1（无上方/左侧可冻结），此时禁用「冻结窗格」项 */
  freezePanesDisabled: boolean;
  themeVars?: Record<string, string>;
  // 数字格式
  selNumberFormat: string;
  nfOptions: NFOption[];
  canIncreaseDecimals: boolean;
  canDecreaseDecimals: boolean;
  /** 边界基准元素（通常是表格容器 wrapper）：弹出菜单不得越出其可视区。
   *  组件嵌入宿主 Vue 页面时必需——否则菜单会越界盖住宿主内容。缺省时退化为纯视口判定。 */
  boundaryEl?: HTMLElement | null;
}>();

const emit = defineEmits<{
  (e: 'undo' | 'redo' | 'paint-format' | 'clear-format' | 'font-size-blur' | 'font-size-toggle' | 'font-size-step-up' | 'font-size-step-down' | 'bold-toggle' | 'italic-toggle' | 'underline-toggle' | 'strikethrough-toggle' | 'apply-text-color' | 'apply-fill-color' | 'apply-border' | 'apply-sort' | 'wrap-toggle' | 'apply-merge' | 'calc-sum' | 'calc-avg' | 'calc-count' | 'find' | 'increase-decimals' | 'decrease-decimals' | 'toggle-filter' | 'cf-new-rule' | 'cf-manage' | 'open-data-validation'): void;
  (e: 'font-family-change' | 'font-size-change' | 'h-align-change' | 'v-align-change', v: string | number): void;
  (e: 'font-size-input' | 'text-color-change' | 'fill-color-change' | 'number-format-change' | 'freeze-change' | 'cf-preset' | 'outline-action', v: string): void;
  (e: 'font-size-keydown', ev: KeyboardEvent): void;
  (e: 'update:font-size-menu-open' | 'update:text-color-menu-open' | 'update:fill-color-menu-open' | 'update:border-menu-open' | 'update:sort-menu-open' | 'update:outline-menu-open' | 'update:merge-menu-open' | 'update:calc-menu-open' | 'update:cf-menu-open' | 'update:freeze-menu-open' | 'update:font-menu-open' | 'update:h-align-menu-open' | 'update:v-align-menu-open' | 'update:num-fmt-menu-open', v: boolean): void;
  (e: 'border-change', v: BorderType): void;
  (e: 'sort-change', v: SortOrder): void;
  (e: 'merge-change', v: MergeType): void;
  (e: 'cf-clear', scope: 'selection' | 'sheet'): void;
}>();

// 同一时刻仅允许一个工具栏下拉菜单打开：任一 picker 下拉打开时，关闭其余 picker 下拉。
// 覆盖主栏与溢出菜单（二者同源 tb-item + 同一套状态），修复「溢出菜单里点不同下拉框、前一个不关闭」的问题。
const TOOLBAR_MENU_KEYS = ['fontSize', 'textColor', 'fillColor', 'border', 'merge', 'calc', 'sort', 'outline', 'cf', 'freeze', 'font', 'hAlign', 'vAlign', 'numFmt'] as const;
type ToolbarMenuKey = typeof TOOLBAR_MENU_KEYS[number];
const MENU_EMIT: Record<ToolbarMenuKey, 'update:font-size-menu-open' | 'update:text-color-menu-open' | 'update:fill-color-menu-open' | 'update:border-menu-open' | 'update:merge-menu-open' | 'update:calc-menu-open' | 'update:sort-menu-open' | 'update:outline-menu-open' | 'update:cf-menu-open' | 'update:freeze-menu-open' | 'update:font-menu-open' | 'update:h-align-menu-open' | 'update:v-align-menu-open' | 'update:num-fmt-menu-open'> = {
  fontSize: 'update:font-size-menu-open',
  textColor: 'update:text-color-menu-open',
  fillColor: 'update:fill-color-menu-open',
  border: 'update:border-menu-open',
  merge: 'update:merge-menu-open',
  calc: 'update:calc-menu-open',
  sort: 'update:sort-menu-open',
  outline: 'update:outline-menu-open',
  cf: 'update:cf-menu-open',
  freeze: 'update:freeze-menu-open',
  font: 'update:font-menu-open',
  hAlign: 'update:h-align-menu-open',
  vAlign: 'update:v-align-menu-open',
  numFmt: 'update:num-fmt-menu-open',
};
function coordToolbarMenu(key: ToolbarMenuKey, v: boolean) {
  if (v) {
    for (const k of TOOLBAR_MENU_KEYS) {
      if (k !== key) emit(MENU_EMIT[k], false);
    }
  }
  emit(MENU_EMIT[key], v);
}

/** 关闭所有工具栏 picker 下拉（fontSize/textColor/fillColor/border/merge/calc/sort/outline）。
 *  用于溢出菜单中滚动或点击普通按钮时，收起已弹出的下拉，避免其悬在溢出菜单之上。 */
function closeAllToolbarMenus() {
  for (const k of TOOLBAR_MENU_KEYS) emit(MENU_EMIT[k], false);
}

// 溢出菜单内点击按钮：除「负责开关 picker 的箭头/触发器」自身外，一律收起已弹出的 picker 下拉。
// （箭头/触发器由 coordToolbarMenu 处理互斥与开关，这里不能重复关闭，否则刚点开的会被立刻收起。）
function onOverflowMenuClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest?.('.toolbar-split__arrow, .outline-trigger, .toolbar-font-size__btn, .cf-menu-trigger, .sp-dropdown__trigger')) return;
  closeAllToolbarMenus();
}

// 数字格式：选区格式不一致时触发器显示「混合」
const nfFallbackLabel = computed(() =>
  props.selNumberFormat === NF_MIXED ? t(props.locale, 'nfMixed') : '',
);

// 冻结窗格选项：
// - 未冻结：显示 [冻结窗格, 冻结首行, 冻结首列]（不显示「取消冻结」）
// - 已冻结：不显示「冻结窗格」，在其位置显示「取消冻结」→ [取消冻结, 冻结首行, 冻结首列]
const freezeOptions = computed<FontOption[]>(() => {
  const opts: FontOption[] = [
    { label: t(props.locale, 'freezeFirstRow'), value: 'firstRow', icon: FREEZE_FIRST_ROW_ICON },
    { label: t(props.locale, 'freezeFirstCol'), value: 'firstCol', icon: FREEZE_FIRST_COL_ICON },
  ];
  if (props.hasFreeze) {
    opts.unshift({ label: t(props.locale, 'unfreezePanes'), value: 'unfreeze', icon: UNFREEZE_ICON });
  } else {
    opts.unshift({ label: t(props.locale, 'freezePanes'), value: 'panes', icon: FREEZE_ICON, disabled: props.freezePanesDisabled });
  }
  return opts;
});
</script>

<template>
  <div
    ref="rootEl"
    class="toolbar"
    @mousedown.prevent
  >
    <Teleport
      :disabled="teleportDisabled('undo')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="undo"
      >
        <button
          class="toolbar-btn"
          :class="{ 'toolbar-btn--disabled': !canUndo }"
          :title="t(locale, 'undo')"
          :disabled="!canUndo"
          @click="emit('undo')"
        >
          <svg
            class="toolbar-btn__icon"
            viewBox="0 0 1024 1024"
            fill="currentColor"
          >
            <path d="M596.16 284.064H258.56l101.376-101.44a31.968 31.968 0 1 0-45.248-45.216L178.56 273.504c-11.904 11.872-18.496 27.84-18.56 44.8a63.04 63.04 0 0 0 18.56 45.28l136.128 136.16a31.904 31.904 0 0 0 45.248 0 31.968 31.968 0 0 0 0-45.248l-106.752-106.496H596.16c114.88 0 208.32 93.312 208.32 208s-93.44 208-208.32 208h-223.36a32 32 0 0 0 0 64h223.36c150.144 0 272.32-122.016 272.32-272 0-149.984-122.176-272-272.32-272" />
          </svg>
          <span class="toolbar-btn__label">{{ t(locale, 'undo') }}</span>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('redo')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="redo"
      >
        <button
          class="toolbar-btn"
          :class="{ 'toolbar-btn--disabled': !canRedo }"
          :title="t(locale, 'redo')"
          :disabled="!canRedo"
          @click="emit('redo')"
        >
          <svg
            class="toolbar-btn__icon"
            viewBox="0 0 1024 1024"
            fill="currentColor"
          >
            <path
              transform="translate(1024, 0) scale(-1, 1)"
              d="M596.16 284.064H258.56l101.376-101.44a31.968 31.968 0 1 0-45.248-45.216L178.56 273.504c-11.904 11.872-18.496 27.84-18.56 44.8a63.04 63.04 0 0 0 18.56 45.28l136.128 136.16a31.904 31.904 0 0 0 45.248 0 31.968 31.968 0 0 0 0-45.248l-106.752-106.496H596.16c114.88 0 208.32 93.312 208.32 208s-93.44 208-208.32 208h-223.36a32 32 0 0 0 0 64h223.36c150.144 0 272.32-122.016 272.32-272 0-149.984-122.176-272-272.32-272"
            />
          </svg>
          <span class="toolbar-btn__label">{{ t(locale, 'redo') }}</span>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('paint')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="paint"
      >
        <button
          class="toolbar-btn"
          :class="{ 'toolbar-btn--active': paintFmtActive }"
          :title="t(locale, 'paintFormat')"
          :disabled="!hasSelection"
          @click="emit('paint-format')"
        >
          <svg
            class="toolbar-btn__icon"
            viewBox="0 0 1024 1024"
            fill="currentColor"
          >
            <path d="M722.285714 438.857143a36.571429 36.571429 0 0 1-36.571428 36.571428h-512a36.571429 36.571429 0 0 1-36.571429-36.571428V164.571429a36.571429 36.571429 0 0 1 36.571429-36.571429h512a36.571429 36.571429 0 0 1 36.571428 36.571429V256h128a36.571429 36.571429 0 0 1 36.571429 36.571429v294.4a36.571429 36.571429 0 0 1-31.890286 36.278857L448 675.766857V859.428571a36.571429 36.571429 0 0 1-32.292571 36.315429l-4.278858 0.256a36.571429 36.571429 0 0 1-36.571428-36.571429v-215.771428a36.571429 36.571429 0 0 1 31.890286-36.278857l406.966857-52.553143V329.142857h-91.428572v109.714286z m-73.142857-237.714286h-438.857143V402.285714h438.857143V201.142857z" />
          </svg>
          <span class="toolbar-btn__label">{{ t(locale, 'paintFormat') }}</span>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('clear')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="clear"
      >
        <button
          class="toolbar-btn"
          :class="{ 'toolbar-btn--disabled': !hasSelection }"
          :title="t(locale, 'clearFormat')"
          :disabled="!hasSelection"
          @click="emit('clear-format')"
        >
          <svg
            class="toolbar-btn__icon"
            viewBox="0 0 1024 1024"
            fill="currentColor"
          >
            <path d="M672.748 105.674c-3.666-3.799-8.778-5.949-14.125-5.949-5.341 0-10.459 2.15-14.119 5.949L10.418 754.633c-7.789 8.163-7.789 20.798 0 28.967l123.353 126.213c7.782 7.979 23.113 14.461 34.111 14.461h395.042c12.774-0.742 24.882-5.854 34.162-14.461l416.525-426.362c7.751-8.163 7.751-20.76 0-28.916l-340.92-348.861h0.057zM557.85 832.801c-9.273 8.582-21.343 13.707-34.111 14.461H217.888c-12.781-0.742-24.882-5.867-34.162-14.461l-58.074-59.482c-7.782-8.163-7.782-20.804 0-28.967l232.333-237.87c3.666-3.799 8.778-5.949 14.125-5.949s10.453 2.15 14.119 5.949l231.102 236.551c7.744 8.157 7.744 20.753 0 28.916l-59.539 60.909 0.058-0.057z m0 0" />
          </svg>
          <span class="toolbar-btn__label">{{ t(locale, 'clearFormat') }}</span>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('sep1')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="sep1"
      >
        <div class="toolbar-sep" />
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('font')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="font"
      >
        <SpDropdown
          class="toolbar-font"
          :model-value="selFontFamily"
          :options="fontFamilyOptions"
          :width="isOverflow('font') ? '100%' : 110"
          :menu-width="isOverflow('font') ? 120 : undefined"
          :visible-count="8"
          :title="t(locale, 'fontFamily')"
          align="right"
          :model-open="fontMenuOpen"
          :boundary-el="boundaryEl"
          @update:model-open="coordToolbarMenu('font', $event)"
          @change="emit('font-family-change', $event)"
        />
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('fontSize')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="fontSize"
      >
        <div class="toolbar-font-size">
          <input
            class="toolbar-font-size__input"
            type="number"
            min="5"
            max="72"
            step="1"
            :value="fontSizeInput"
            :title="t(locale, 'fontSize')"
            @mousedown.stop
            @input="emit('font-size-input', ($event.target as HTMLInputElement).value)"
            @blur="emit('font-size-blur')"
            @keydown="emit('font-size-keydown', $event)"
          >
          <SpDropdown
            class="toolbar-font-size__dropdown"
            :model-value="selFontSize"
            :options="fontSizeOptions"
            :width="isOverflow('fontSize') ? '100%' : 56"
            :menu-width="isOverflow('fontSize') ? 120 : 56"
            :visible-count="9"
            :title="t(locale, 'fontSize')"
            :hide-trigger="true"
            :model-open="fontSizeMenuOpen"
            align="right"
            :trigger-el="fontSizeArrowRef"
            :boundary-el="boundaryEl"
            @update:model-open="coordToolbarMenu('fontSize', $event)"
            @change="emit('font-size-change', $event)"
          />
          <button
            ref="fontSizeArrowRef"
            class="toolbar-font-size__btn"
            type="button"
            :title="t(locale, 'fontSize')"
            @mousedown.prevent
            @click="emit('font-size-toggle')"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053333 361.386667a32 32 0 0 1 45.226667 0L512 648.106667l286.72-286.72a32 32 0 1 1 45.226667 45.226666l-309.333334 309.333334a32 32 0 0 1-45.226666 0L180.053333 406.613333a32 32 0 0 1 0-45.226666z" /></svg>
          </button>
          <button
            class="toolbar-btn toolbar-btn--step"
            type="button"
            :title="t(locale, 'fontSizeDecrease')"
            :disabled="!hasSelection"
            @mousedown.prevent
            @click="emit('font-size-step-down')"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M675.2 184.533333h260.266667a12.8 12.8 0 0 1 12.8 12.8v21.333334a12.8 12.8 0 0 1-12.8 12.8H675.2a12.8 12.8 0 0 1-12.8-12.8v-21.333334a12.8 12.8 0 0 1 12.8-12.8zM687.744 739.413333l87.722667 197.717334a12.8 12.8 0 0 0 11.733333 7.594666h54.016a12.8 12.8 0 0 0 11.605333-18.133333l-7.466666-16.213333-131.2-287.829334-35.413334-77.653333-166.570666-365.525333a36.266667 36.266667 0 0 0-66.432 0.938666l-154.154667 365.482667-34.688 82.261333-34.688 82.218667-84.778667 201.045333-6.570666 15.658667a12.8 12.8 0 0 0 11.776 17.749333h57.557333a12.8 12.8 0 0 0 11.904-8.106666l102.4-258.474667 343.466667-4.010667 29.781333 65.28zM480.426667 284.672l132.352 290.261333 12.288 27.050667-279.808 3.242667 13.184-31.232 122.026666-289.28z" /></svg>
          </button>
          <button
            class="toolbar-btn toolbar-btn--step"
            type="button"
            :title="t(locale, 'fontSizeIncrease')"
            :disabled="!hasSelection"
            @mousedown.prevent
            @click="emit('font-size-step-up')"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M769.066667 77.952v93.781333h-93.866667a12.8 12.8 0 0 0-12.8 12.8v46.933334a12.8 12.8 0 0 0 12.8 12.8h93.866667v93.952a12.8 12.8 0 0 0 12.8 12.8h46.933333a12.8 12.8 0 0 0 12.8-12.8V244.266667h93.866667a12.8 12.8 0 0 0 12.8-12.8v-46.933334a12.8 12.8 0 0 0-12.8-12.8h-93.866667V77.952a12.8 12.8 0 0 0-12.8-12.8h-46.933333a12.8 12.8 0 0 0-12.8 12.8zM687.744 739.413333l87.722667 197.717334a12.8 12.8 0 0 0 11.733333 7.594666h54.016a12.8 12.8 0 0 0 11.605333-18.133333l-7.466666-16.213333-131.2-287.829334-35.413334-77.653333-166.570666-365.525333a36.266667 36.266667 0 0 0-66.432 0.938666l-154.154667 365.482667-34.688 82.261333-34.688 82.218667-84.778667 201.045333-6.570666 15.658667a12.8 12.8 0 0 0 11.776 17.749333h57.557333a12.8 12.8 0 0 0 11.904-8.106666l102.4-258.474667 343.466667-4.010667 29.781333 65.28zM480.426667 284.672l132.352 290.261333 12.288 27.050667-279.808 3.242667 13.184-31.232 122.026666-289.28z" /></svg>
          </button>
        </div>
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('sep2')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="sep2"
      >
        <div class="toolbar-sep" />
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('bold')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="bold"
      >
        <button
          class="toolbar-btn"
          :class="{ 'toolbar-btn--active': selFontWeight }"
          :title="t(locale, 'bold')"
          :disabled="!hasSelection"
          @click="emit('bold-toggle')"
        >
          <svg
            viewBox="0 0 1024 1024"
            fill="currentColor"
          ><path d="M214.857 889.143v-68.571h68.571V203.429H214.857v-68.571h411.429v1.257c96.114 10.629 171.429 87.383 171.429 181.6 0 58.971-29.486 111.086-75.109 144.457 72.069 39.291 120.823 113.234 120.823 198.4 0 119.291-95.634 216.594-217.12 227.543l-0.286.029H214.857z m388.572-388.571H352v320h251.429c95.086 0 171.429-72.091 171.429-160s-76.343-160-171.429-160z m0-297.143H352v228.571h251.429l5.211-0.091c67.52-2.515 120.503-53.235 120.503-114.195 0-62.537-55.749-114.285-125.714-114.285z" /></svg>
          <span class="toolbar-btn__label">{{ t(locale, 'bold') }}</span>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('italic')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="italic"
      >
        <button
          class="toolbar-btn"
          :class="{ 'toolbar-btn--active': selFontStyle }"
          :title="t(locale, 'italic')"
          :disabled="!hasSelection"
          @click="emit('italic-toggle')"
        >
          <svg
            viewBox="0 0 1024 1024"
            fill="currentColor"
          ><path d="M730.143 127.714v64.286h-112.329l-166.521 621.429h128.871v64.286H276.286v-64.286h108.45l166.5-621.429H426.286V127.714h303.857z" /></svg>
          <span class="toolbar-btn__label">{{ t(locale, 'italic') }}</span>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('underline')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="underline"
      >
        <button
          class="toolbar-btn"
          :class="{ 'toolbar-btn--active': selUnderline }"
          :title="t(locale, 'underline')"
          :disabled="!hasSelection"
          @click="emit('underline-toggle')"
        >
          <svg
            viewBox="0 0 1024 1024"
            fill="currentColor"
          ><path d="M512 123.639a36.409 36.409 0 0 1 33.642 22.525l230.59 558.27a36.409 36.409 0 1 1-67.284 27.768L638.072 560.545H385.928l-70.876 171.656a36.409 36.409 0 1 1-67.332-27.768l230.59-558.27A36.409 36.409 0 0 1 512 123.639z m-95.974 364.089h191.948L512 255.439l-95.974 232.289zM769.289 827.544c19.418 0 38.836 14.564 38.836 38.836 0 19.418-14.564 33.982-29.127 33.982H259.565c-19.418 0-38.836-14.564-38.836-38.836 0-19.418 14.564-33.982 29.127-33.982h519.433z" /></svg>
          <span class="toolbar-btn__label">{{ t(locale, 'underline') }}</span>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('strike')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="strike"
      >
        <button
          class="toolbar-btn"
          :class="{ 'toolbar-btn--active': selStrikethrough }"
          :title="t(locale, 'strikethrough')"
          :disabled="!hasSelection"
          @click="emit('strikethrough-toggle')"
        >
          <svg
            viewBox="0 0 1024 1024"
            fill="currentColor"
          ><path d="M182.044 490.667h659.911a34.133 34.133 0 0 1 4.642 67.948l-4.597 0.319h-135.395c40.05 37 60.803 81.601 60.803 133.575 0 128.569-147.092 211.171-307.382 192.512-101.717-11.833-173.352-52.565-210.944-122.971a34.133 34.133 0 0 1 60.211-32.176c25.942 48.606 77.46 77.915 158.606 87.381 124.837 14.473 231.242-45.283 231.242-124.746 0-53.339-36.636-96.802-116.736-131.345l-5.279-2.23H182.044a34.133 34.133 0 0 1-33.815-29.492L147.911 524.8a34.133 34.133 0 0 1 29.491-33.815l4.642-0.318z m68.767-176.447c6.918-128.796 128.432-203.343 287.812-184.82 99.579 11.56 175.81 47.923 226.737 109.636a34.133 34.133 0 1 1-52.657 43.463c-38.775-47.013-98.759-75.639-181.999-85.288-123.654-14.381-211.627 36.591-211.627 117.009 0 35.135 10.65 61.349 37.774 90.203l5.826 6.007c4.278 4.369 8.966 8.875 11.377 10.923l1.411 0.91H288.085l-1.092-1.729c-6.508-9.376-38.958-54.386-36.182-106.314z" /></svg>
          <span class="toolbar-btn__label">{{ t(locale, 'strikethrough') }}</span>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('sep3')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="sep3"
      >
        <div class="toolbar-sep" />
      </div>
    </Teleport>

    <!-- 文字颜色 -->
    <Teleport
      :disabled="teleportDisabled('textColor')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="textColor"
      >
        <div class="toolbar-split">
          <button
            class="toolbar-btn toolbar-split__main"
            :title="t(locale, 'fontColor')"
            :disabled="!hasSelection"
            @click="emit('apply-text-color')"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            >
              <g transform="translate(102.4, 102.4) scale(0.8)">
                <path d="M663.120842 529.946947H364.759579l-84.07579 212.884211a53.894737 53.894737 0 0 1-50.122105 34.169263h-14.551579a34.869895 34.869895 0 0 1-32.498526-47.696842L443.715368 70.063158a53.894737 53.894737 0 0 1 50.122106-34.115369h41.768421a53.894737 53.894737 0 0 1 50.176 34.277053l257.670737 659.078737a34.977684 34.977684 0 0 1-32.552421 47.696842h-14.389895a53.894737 53.894737 0 0 1-50.229895-34.277053l-83.159579-212.776421z m-35.139368-89.788631l-113.340632-289.953684-114.472421 289.953684h227.813053z" />
              </g>
              <path
                d="M62.895 844.369m53.895 0l790.474 0q53.895 0 53.895 53.895l0 26.947q0 53.895-53.895 53.895l-790.474 0q-53.895 0-53.895-53.895l0-26.947q0-53.895 53.895-53.895z"
                :fill="cachedTextColor || '#000000'"
              />
            </svg>
            <span class="toolbar-btn__label">{{ t(locale, 'fontColor') }}</span>
          </button>
          <button
            ref="textColorArrowRef"
            class="toolbar-btn toolbar-split__arrow"
            :title="t(locale, 'fontColor')"
            :disabled="!hasSelection"
            @click="coordToolbarMenu('textColor', !textColorMenuOpen)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053 361.387a32 32 0 0 1 45.227 0L512 648.107l286.72-286.72a32 32 0 1 1 45.227 45.227l-309.334 309.333a32 32 0 0 1-45.226 0L180.053 406.613a32 32 0 0 1 0-45.226z" /></svg>
          </button>
          <ColorPicker
            :model-open="textColorMenuOpen"
            color-key="text"
            :current-color="selTextColor"
            :locale="locale"
            :trigger-el="textColorArrowRef"
            :boundary-el="boundaryEl"
            @update:model-open="coordToolbarMenu('textColor', $event)"
            @change="emit('text-color-change', $event)"
          />
        </div>
      </div>
    </Teleport>

    <!-- 填充颜色 -->
    <Teleport
      :disabled="teleportDisabled('fillColor')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="fillColor"
      >
        <div class="toolbar-split">
          <button
            class="toolbar-btn toolbar-split__main"
            :title="t(locale, 'fillColor')"
            :disabled="!hasSelection"
            @click="emit('apply-fill-color')"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            >
              <path d="M447.018667 37.952l352.298666 352.298667c6.613333 6.613333 6.613333 17.344 0 23.957333L446.101333 767.424a16.938667 16.938667 0 0 1-23.957333 0L121.429333 466.688a16.938667 16.938667 0 0 1 0-23.957333L428.608 135.552 388.992 96a8.469333 8.469333 0 0 1 0-11.989333l46.058667-46.037334a8.469333 8.469333 0 0 1 11.968 0z m346.325333 517.461333l57.514667 60.074667c31.744 33.194667 31.744 86.997333 0 120.192a78.869333 78.869333 0 0 1-115.008 0c-31.765333-33.194667-31.765333-86.997333 0-120.192l57.493333-60.074667zM486.101333 193.066667l-261.12 261.12 20.458667 20.458666 380.16-1.728 70.186667-70.186666-209.706667-209.664z" />
              <path
                d="M85.333333 853.333333m8.896 0l835.541334 0q8.896 0 8.896 8.896l0 110.208q0 8.896-8.896 8.896l-835.541334 0q-8.896 0-8.896-8.896l0-110.208q0-8.896 8.896-8.896Z"
                :fill="cachedFillColor || 'currentColor'"
              />
            </svg>
            <span class="toolbar-btn__label">{{ t(locale, 'fillColor') }}</span>
          </button>
          <button
            ref="fillColorArrowRef"
            class="toolbar-btn toolbar-split__arrow"
            :title="t(locale, 'fillColor')"
            :disabled="!hasSelection"
            @click="coordToolbarMenu('fillColor', !fillColorMenuOpen)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053 361.387a32 32 0 0 1 45.227 0L512 648.107l286.72-286.72a32 32 0 1 1 45.227 45.227l-309.334 309.333a32 32 0 0 1-45.226 0L180.053 406.613a32 32 0 0 1 0-45.226z" /></svg>
          </button>
          <ColorPicker
            :model-open="fillColorMenuOpen"
            color-key="fill"
            :current-color="selFillColor"
            :locale="locale"
            :trigger-el="fillColorArrowRef"
            :boundary-el="boundaryEl"
            @update:model-open="coordToolbarMenu('fillColor', $event)"
            @change="emit('fill-color-change', $event)"
          />
        </div>
      </div>
    </Teleport>

    <!-- 边框 -->
    <Teleport
      :disabled="teleportDisabled('border')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="border"
      >
        <div class="toolbar-split">
          <button
            class="toolbar-btn toolbar-split__main"
            :title="t(locale, 'borders')"
            :disabled="!hasSelection"
            @click="emit('apply-border')"
          >
            <svg
              viewBox="0 0 30 30"
              fill="none"
              stroke="currentColor"
            >
              <line
                v-for="s in BORDER_SEGS"
                :key="s.name"
                :x1="s.x1"
                :y1="s.y1"
                :x2="s.x2"
                :y2="s.y2"
                :stroke-width="segRole(cachedBorder, s.name) === 'thick' ? 3 : 1.5"
                :stroke-dasharray="segRole(cachedBorder, s.name) === 'dashed' ? '0 4' : 'none'"
                :stroke-linecap="segRole(cachedBorder, s.name) === 'dashed' ? 'round' : 'square'"
              />
            </svg>
            <span class="toolbar-btn__label">{{ t(locale, BORDER_LABEL_KEY[cachedBorder] ?? 'borders') }}</span>
          </button>
          <button
            ref="borderArrowRef"
            class="toolbar-btn toolbar-split__arrow"
            :title="t(locale, 'borders')"
            :disabled="!hasSelection"
            @click="coordToolbarMenu('border', !borderMenuOpen)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053 361.387a32 32 0 0 1 45.227 0L512 648.107l286.72-286.72a32 32 0 1 1 45.227 45.227l-309.334 309.333a32 32 0 0 1-45.226 0L180.053 406.613a32 32 0 0 1 0-45.226z" /></svg>
          </button>
          <BorderPicker
            :model-open="borderMenuOpen"
            :locale="locale"
            :current-border="cachedBorder"
            :trigger-el="borderArrowRef"
            :boundary-el="boundaryEl"
            @update:model-open="coordToolbarMenu('border', $event)"
            @change="emit('border-change', $event)"
          />
        </div>
      </div>
    </Teleport>

    <Teleport
      :disabled="teleportDisabled('sep4')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="sep4"
      >
        <div class="toolbar-sep" />
      </div>
    </Teleport>

    <!-- 水平对齐 -->
    <Teleport
      :disabled="teleportDisabled('hAlign')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="hAlign"
      >
        <SpDropdown
          class="toolbar-align"
          :model-value="selHAlign"
          :options="hAlignOptions"
          :width="isOverflow('hAlign') ? '100%' : 44"
          :menu-width="isOverflow('hAlign') ? 120 : undefined"
          :visible-count="3"
          align="right"
          :title="t(locale, 'hAlign')"
          :model-open="hAlignMenuOpen"
          :boundary-el="boundaryEl"
          @update:model-open="coordToolbarMenu('hAlign', $event)"
          @change="emit('h-align-change', $event)"
        />
      </div>
    </Teleport>

    <!-- 垂直对齐 -->
    <Teleport
      :disabled="teleportDisabled('vAlign')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="vAlign"
      >
        <SpDropdown
          class="toolbar-align"
          :model-value="selVAlign"
          :options="vAlignOptions"
          :width="isOverflow('vAlign') ? '100%' : 44"
          :menu-width="isOverflow('vAlign') ? 120 : undefined"
          :visible-count="3"
          align="right"
          :title="t(locale, 'vAlign')"
          :model-open="vAlignMenuOpen"
          :boundary-el="boundaryEl"
          @update:model-open="coordToolbarMenu('vAlign', $event)"
          @change="emit('v-align-change', $event)"
        />
      </div>
    </Teleport>

    <!-- 自动换行 -->
    <Teleport
      :disabled="teleportDisabled('wrap')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="wrap"
      >
        <button
          class="toolbar-btn"
          :class="{ 'toolbar-btn--active': selWrap }"
          type="button"
          :title="t(locale, 'wrap')"
          @click="emit('wrap-toggle')"
        >
          <svg
            viewBox="0 0 1024 1024"
            fill="currentColor"
          ><path d="M896 179.2a38.4 38.4 0 0 0-76.8 0v665.6a38.4 38.4 0 0 0 76.8 0v-665.6zM204.8 281.6A38.4 38.4 0 0 0 204.8 358.4h179.2a38.4 38.4 0 0 0 0-76.8H204.8zM550.4 281.6a38.4 38.4 0 0 0 0 76.8h51.2c35.328 0 64 28.672 64 64v179.2c0 35.328-28.672 64-64 64H246.272l36.864-36.864a38.4 38.4 0 1 0-54.272-54.272l-102.4 102.4a38.4 38.4 0 0 0 0 54.272l102.4 102.4a38.4 38.4 0 0 0 54.272-54.272l-36.864-36.864h355.328a140.8 140.8 0 0 0 140.8-140.8v-179.2a140.8 140.8 0 0 0-140.8-140.8h-51.2z" /></svg>
          <span class="toolbar-btn__label">{{ t(locale, 'wrap') }}</span>
        </button>
      </div>
    </Teleport>

    <!-- 合并单元格 -->
    <Teleport
      :disabled="teleportDisabled('merge')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="merge"
      >
        <div class="toolbar-split">
          <button
            class="toolbar-btn toolbar-split__main"
            :title="t(locale, 'mergeCenter')"
            :disabled="!hasSelection"
            @click="emit('apply-merge')"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M709.952 465.92l88-76.032C801.92 385.984 806.656 384 812.032 384s10.048 1.984 14.08 5.952C830.08 393.92 832 398.656 832 403.968L832 448l32 0C881.664 448 896 462.336 896 480S881.664 512 864 512L832 512l0 44.032c0 5.376-1.92 10.112-5.952 14.08C822.08 574.08 817.344 576 812.032 576s-10.048-1.92-14.08-5.952L709.952 494.08C705.984 490.112 704 485.376 704 480S705.984 469.952 709.952 465.92zM378.048 465.92 290.048 389.952C286.08 385.984 281.344 384 275.968 384s-10.048 1.984-14.08 5.952C257.92 393.92 256 398.656 256 403.968L256 448 224 448C206.336 448 192 462.336 192 480S206.336 512 224 512L256 512l0 44.032c0 5.376 1.92 10.112 5.952 14.08C265.92 574.08 270.656 576 275.968 576s10.048-1.92 14.08-5.952L378.048 494.08C382.016 490.112 384 485.376 384 480S382.016 469.952 378.048 465.92zM448 128 128 128l0 704 320 0 0-128 64 0 0 128c0 35.392-28.608 64-64 64L128 896c-35.392 0-64-28.608-64-64L64 128c0-35.392 28.608-64 64-64l320 0 0 0c35.392 0 64 28.608 64 64l0 128L448 256 448 128M640 128l320 0 0 704-320 0 0-128L576 704l0 128c0 35.392 28.608 64 64 64l320 0c35.392 0 64-28.608 64-64L1024 128c0-35.392-28.608-64-64-64l-320 0 0 0C604.608 64 576 92.608 576 128l0 128 64 0L640 128M722.304 642.304c0 8.512-3.52 16.32-10.496 23.36s-15.424 10.624-25.344 10.624c-5.76 0-10.688-1.088-14.72-3.136-4.096-2.048-7.616-4.928-10.432-8.512s-5.824-9.088-9.024-16.512-5.952-13.952-8.32-19.648l-17.28-46.016L479.36 582.464 462.08 629.568c-6.72 18.304-12.48 30.656-17.344 37.12s-12.544 9.6-23.424 9.6c-9.28 0-17.408-3.456-24.512-10.24s-10.624-14.592-10.624-23.232c0-4.992 0.896-10.176 2.496-15.488S393.024 614.592 396.8 605.056l92.672-238.016C492.096 360.256 495.296 352 499.008 342.464s7.68-17.536 11.904-23.872 9.664-11.456 16.576-15.36c6.784-3.968 15.232-5.888 25.344-5.888 10.176 0 18.752 1.92 25.472 5.888 6.848 3.968 12.352 8.96 16.64 15.104 4.096 6.208 7.744 12.8 10.624 19.904s6.528 16.576 11.008 28.352l94.656 236.48C718.592 621.056 722.304 634.112 722.304 642.304zM606.912 526.784 552.32 375.552 498.624 526.784 606.912 526.784z" /></svg>
            <span class="toolbar-btn__label">{{ t(locale, 'mergeCenter') }}</span>
          </button>
          <button
            ref="mergeArrowRef"
            class="toolbar-btn toolbar-split__arrow"
            :title="t(locale, 'mergeCells')"
            :disabled="!hasSelection"
            @click="coordToolbarMenu('merge', !mergeMenuOpen)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053 361.387a32 32 0 0 1 45.227 0L512 648.107l286.72-286.72a32 32 0 1 1 45.227 45.227l-309.334 309.333a32 32 0 0 1-45.226 0L180.053 406.613a32 32 0 0 1 0-45.226z" /></svg>
          </button>
          <MergePicker
            :model-open="mergeMenuOpen"
            :locale="locale"
            :trigger-el="mergeArrowRef"
            :boundary-el="boundaryEl"
            @update:model-open="coordToolbarMenu('merge', $event)"
            @change="emit('merge-change', $event)"
          />
        </div>
      </div>
    </Teleport>

    <!-- sep6: merge 后分隔符 -->
    <Teleport
      :disabled="teleportDisabled('sep6')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="sep6"
      >
        <div class="toolbar-sep" />
      </div>
    </Teleport>

    <!-- 数字格式 -->
    <Teleport
      :disabled="teleportDisabled('numFmt')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="numFmt"
      >
        <div class="toolbar-number-format-group">
          <SpDropdown
            class="toolbar-number-format"
            :model-value="selNumberFormat"
            :options="nfOptions"
            :width="isOverflow('numFmt') ? 'auto' : 92"
            :menu-width="isOverflow('numFmt') ? 150 : 150"
            :visible-count="8"
            :title="t(locale, 'numberFormat')"
            :fallback-label="nfFallbackLabel"
            align="right"
            :model-open="numFmtMenuOpen"
            :boundary-el="boundaryEl"
            @update:model-open="coordToolbarMenu('numFmt', $event)"
            @change="emit('number-format-change', String($event))"
          />
          <!-- 增加小数位数 -->
          <button
            class="toolbar-btn toolbar-number-format__btn"
            :class="{ 'toolbar-btn--disabled': !canIncreaseDecimals }"
            :title="t(locale, 'nfIncreaseDecimals')"
            :disabled="!canIncreaseDecimals"
            @click="emit('increase-decimals')"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <text
                x="0.5"
                y="16"
                font-size="9"
                font-weight="700"
                font-family="Arial, sans-serif"
              >.00</text>
              <path d="M19 5.5l4.2 5.2h-2.7v7.8h-3v-7.8h-2.7z" />
            </svg>
          </button>
          <!-- 减少小数位数 -->
          <button
            class="toolbar-btn toolbar-number-format__btn"
            :class="{ 'toolbar-btn--disabled': !canDecreaseDecimals }"
            :title="t(locale, 'nfDecreaseDecimals')"
            :disabled="!canDecreaseDecimals"
            @click="emit('decrease-decimals')"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <text
                x="0.5"
                y="16"
                font-size="9"
                font-weight="700"
                font-family="Arial, sans-serif"
              >.00</text>
              <path d="M19 18.5l-4.2-5.2h2.7V5.5h3v7.8h2.7z" />
            </svg>
          </button>
        </div>
      </div>
    </Teleport>

    <!-- sep7: numFmt 后分隔符 -->
    <Teleport
      :disabled="teleportDisabled('sep7')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="sep7"
      >
        <div class="toolbar-sep" />
      </div>
    </Teleport>

    <!-- 计算（求和 / 平均值） -->
    <Teleport
      :disabled="teleportDisabled('calc')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="calc"
      >
        <div class="toolbar-split">
          <button
            class="toolbar-btn toolbar-split__main"
            :title="t(locale, 'sum')"
            :disabled="!hasSelection || isSingleCell"
            @click="emit('calc-sum')"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
            ><path d="M19 3H5l7 9-7 9h14v-2H8l5.5-7L8 5h11z" /></svg>
            <span class="toolbar-btn__label">{{ t(locale, 'sum') }}</span>
          </button>
          <button
            ref="calcArrowRef"
            class="toolbar-btn toolbar-split__arrow"
            :title="t(locale, 'calculate')"
            :disabled="!hasSelection"
            @click="coordToolbarMenu('calc', !calcMenuOpen)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053 361.387a32 32 0 0 1 45.227 0L512 648.107l286.72-286.72a32 32 0 1 1 45.227 45.227l-309.334 309.333a32 32 0 0 1-45.226 0L180.053 406.613a32 32 0 0 1 0-45.226z" /></svg>
          </button>
          <CalcPicker
            :model-open="calcMenuOpen"
            :locale="locale"
            :trigger-el="calcArrowRef"
            :disabled="isSingleCell"
            :boundary-el="boundaryEl"
            @update:model-open="coordToolbarMenu('calc', $event)"
            @change="emit(`calc-${$event}`)"
          />
        </div>
      </div>
    </Teleport>

    <!-- 排序 -->
    <Teleport
      :disabled="teleportDisabled('sort')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="sort"
      >
        <div class="toolbar-split">
          <button
            class="toolbar-btn toolbar-split__main"
            :title="cachedSortOrder === 'asc' ? t(locale, 'sortAsc') : t(locale, 'sortDesc')"
            :disabled="!canSort"
            @click="emit('apply-sort')"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="none"
              stroke="currentColor"
              stroke-width="64"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line
                v-for="b in SORT_BARS"
                :key="b.name"
                :x1="b.x1"
                :y1="b.y1"
                :x2="b.x2"
                :y2="b.y2"
              />
              <path :d="SORT_ARROW_PATHS[cachedSortOrder]" />
            </svg>
            <span class="toolbar-btn__label">{{ t(locale, 'sort') }}</span>
          </button>
          <button
            ref="sortArrowRef"
            class="toolbar-btn toolbar-split__arrow"
            :title="t(locale, 'sort')"
            :disabled="!canSort"
            @click="coordToolbarMenu('sort', !sortMenuOpen)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053 361.387a32 32 0 0 1 45.227 0L512 648.107l286.72-286.72a32 32 0 1 1 45.227 45.227l-309.334 309.333a32 32 0 0 1-45.226 0L180.053 406.613a32 32 0 0 1 0-45.226z" /></svg>
          </button>
          <SortPicker
            :model-open="sortMenuOpen"
            :locale="locale"
            :current-sort="cachedSortOrder"
            :trigger-el="sortArrowRef"
            :boundary-el="boundaryEl"
            @update:model-open="coordToolbarMenu('sort', $event)"
            @change="emit('sort-change', $event)"
          />
        </div>
      </div>
    </Teleport>

    <!-- 分组 / 折叠（Outline），位于排序与筛选之间 -->
    <Teleport
      :disabled="teleportDisabled('outline')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="outline"
      >
        <button
          ref="outlineArrowRef"
          class="toolbar-btn outline-trigger"
          :class="{ 'is-open': outlineMenuOpen }"
          :disabled="!outlineAxis"
          :title="t(locale, 'outlineGroup')"
          @click="coordToolbarMenu('outline', !outlineMenuOpen)"
        >
          <svg
            class="outline-trigger__icon"
            viewBox="0 0 1024 1024"
            fill="none"
            stroke="currentColor"
            stroke-width="56"
            stroke-linecap="round"
            stroke-linejoin="round"
          ><path d="M160 224 H560 V800 H160 Z" /><path
            stroke-width="44"
            d="M664 640 H864 V384 H664"
          /></svg>
          <span class="toolbar-btn__label">{{ t(locale, 'outlineGroup') }}</span>
          <svg
            class="outline-trigger__caret"
            viewBox="0 0 1024 1024"
            fill="currentColor"
          ><path d="M180.053 361.387a32 32 0 0 1 45.227 0L512 648.107l286.72-286.72a32 32 0 1 1 45.227 45.227l-309.334 309.333a32 32 0 0 1-45.226 0L180.053 406.613a32 32 0 0 1 0-45.226z" /></svg>
        </button>
        <OutlinePicker
          :model-open="outlineMenuOpen"
          :locale="locale"
          :trigger-el="outlineArrowRef"
          :boundary-el="boundaryEl"
          :axis="outlineAxis"
          @update:model-open="coordToolbarMenu('outline', $event)"
          @action="emit('outline-action', $event)"
        />
      </div>
    </Teleport>

    <!-- 筛选（位于排序之后） -->
    <Teleport
      :disabled="teleportDisabled('filter')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="filter"
      >
        <button
          class="toolbar-btn"
          :class="{ 'toolbar-btn--active': filterActive }"
          :disabled="!canFilter"
          :title="filterActive ? t(locale, 'clearFilter') : t(locale, 'filter')"
          @click="onFilterClick"
        >
          <svg
            viewBox="0 0 1024 1024"
            fill="currentColor"
          ><path d="M96 192c0-17.6 14.4-32 32-32h768c17.6 0 32 14.4 32 32 0 9.6-4.8 19.2-12.8 25.6L608 480v320c0 19.2-12.8 35.2-32 40-4.8 1.6-9.6 1.6-14.4 1.6-12.8 0-24-4.8-33.6-12.8l-128-108.8c-8-6.4-12.8-16-12.8-25.6V480L108.8 217.6C100.8 211.2 96 201.6 96 192z" /></svg>
          <span class="toolbar-btn__label">{{ t(locale, 'filter') }}</span>
        </button>
      </div>
    </Teleport>

    <!-- 冻结窗格 -->
    <Teleport
      :disabled="teleportDisabled('freeze')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="freeze"
      >
        <SpDropdown
          class="toolbar-freeze"
          :model-value="''"
          :options="freezeOptions"
          :width="isOverflow('freeze') ? '100%' : 44"
          :menu-width="isOverflow('freeze') ? 120 : undefined"
          :visible-count="4"
          align="right"
          :title="t(locale, 'freezePane')"
          :trigger-icon="FREEZE_ICON"
          :trigger-label="t(locale, 'freezePane')"
          :model-open="freezeMenuOpen"
          :boundary-el="boundaryEl"
          @update:model-open="coordToolbarMenu('freeze', $event)"
          @change="emit('freeze-change', String($event))"
        />
      </div>
    </Teleport>

    <!-- 条件格式 -->
    <Teleport
      :disabled="teleportDisabled('cf')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="cf"
      >
        <ConditionalFormatMenu
          :locale="locale"
          :has-selection="hasSelection"
          :theme-vars="themeVars"
          :model-open="cfMenuOpen"
          :boundary-el="boundaryEl"
          @update:model-open="coordToolbarMenu('cf', $event)"
          @preset="emit('cf-preset', $event)"
          @new-rule="emit('cf-new-rule')"
          @manage="emit('cf-manage')"
          @clear="emit('cf-clear', $event)"
        />
      </div>
    </Teleport>

    <!-- 数据验证 -->
    <Teleport
      :disabled="teleportDisabled('dv')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="dv"
      >
        <button
          class="toolbar-btn"
          :title="t(locale, 'dv')"
          @click="onDataValidationClick"
        >
          <svg
            viewBox="0 0 1024 1024"
            fill="currentColor"
          ><path d="M933.76 705.728l-74.112 74.048 74.88 74.944-58.88 58.88-74.88-75.008-74.88 74.88-58.88-58.752 74.88-74.88-74.048-74.112 58.88-58.88 74.112 74.048 74.048-74.048 58.88 58.88z" />
            <path d="M832.576 607.104H167.808v162.944h370.688v83.2H126.208a41.664 41.664 0 0 1-41.6-41.6V565.376a41.6 41.6 0 0 1 41.6-41.6h706.368v83.2zM908.608 241.856l30.848 27.904-158.08 174.08a41.664 41.664 0 0 1-60.224 1.408L605.824 329.856l58.816-58.88 84.48 84.48 128.768-141.568 30.72 27.968z" />
            <path d="M832.576 193.664H167.808v162.944h370.688v83.2H126.208a41.6 41.6 0 0 1-41.6-41.6V151.936a41.6 41.6 0 0 1 41.6-41.6h706.368v83.2z" /></svg>
          <span class="toolbar-btn__label">{{ t(locale, 'dv') }}</span>
        </button>
      </div>
    </Teleport>

    <!-- 查找和替换 -->
    <Teleport
      :disabled="teleportDisabled('find')"
      :to="overflowMenuTarget"
    >
      <div
        class="tb-item"
        data-key="find"
      >
        <button
          class="toolbar-btn"
          :title="t(locale, 'find')"
          @click="onFindClick"
        >
          <svg
            class="toolbar-btn__icon"
            viewBox="0 0 1024 1024"
            fill="currentColor"
          >
            <path d="M448 128a320 320 0 0 1 251.2 516.8l171.2 171.2a32 32 0 0 1-45.2 45.2L654 689.9A320 320 0 1 1 448 128zm0 64a256 256 0 1 0 0 512 256 256 0 0 0 0-512z" />
          </svg>
          <span class="toolbar-btn__label">{{ t(locale, 'findReplace') }}</span>
        </button>
      </div>
    </Teleport>

    <!-- 「更多」按钮 -->
    <button
      v-if="hasOverflow"
      ref="moreBtnEl"
      class="toolbar-more"
      type="button"
      :class="{ 'toolbar-more--active': overflowOpen }"
      @click="toggleOverflow"
    >
      <svg
        viewBox="0 0 1024 1024"
        fill="currentColor"
      >
        <circle
          cx="512"
          cy="160"
          r="96"
        />
        <circle
          cx="512"
          cy="512"
          r="96"
        />
        <circle
          cx="512"
          cy="864"
          r="96"
        />
      </svg>
    </button>
  </div>

  <!-- 溢出菜单：通过 Teleport 渲染到 body，使用 fixed 定位，彻底隔离 stacking context -->
  <Teleport to="body">
    <Transition name="menu-pop">
      <div
        v-show="overflowOpen"
        class="overflow-menu-wrap"
        :class="{ 'no-anim': skipCloseAnim }"
        :style="menuStyle"
        @pointerdown.stop.prevent
      >
        <button
          v-if="overflowCanUp || overflowCanDown"
          type="button"
          class="overflow-nav"
          :class="{ 'overflow-nav--disabled': !overflowCanUp }"
          :disabled="!overflowCanUp"
          @click="scrollOverflowBy(-1)"
        >
          <svg
            viewBox="0 0 1024 1024"
            fill="currentColor"
          ><path d="M180.053 662.613a32 32 0 0 0 45.227 0L512 375.893l286.72 286.72a32 32 0 1 0 45.227-45.226L534.613 307.053a32 32 0 0 0-45.226 0L134.827 617.387a32 32 0 0 0 0 45.226z" /></svg>
        </button>
        <div
          ref="overflowMenuEl"
          :key="overflowKeyVersion"
          class="overflow-menu"
          @scroll="onOverflowScroll"
          @click="onOverflowMenuClick"
        />
        <button
          v-if="overflowCanUp || overflowCanDown"
          type="button"
          class="overflow-nav"
          :class="{ 'overflow-nav--disabled': !overflowCanDown }"
          :disabled="!overflowCanDown"
          @click="scrollOverflowBy(1)"
        >
          <svg
            viewBox="0 0 1024 1024"
            fill="currentColor"
          ><path d="M134.827 361.387a32 32 0 0 1 45.226 0L512 693.333l331.947-331.946a32 32 0 1 1 45.226 45.226L534.613 738.56a32 32 0 0 1-45.226 0L134.827 406.613a32 32 0 0 1 0-45.226z" /></svg>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toolbar { position: relative; display: flex; align-items: center; height: 32px; min-height: 32px; gap: 2px; padding: 0 6px; background: var(--sp-toolbar-bg); border-bottom: 1px solid var(--sp-toolbar-border); user-select: none; }
/* 初始化时先隐藏内容（opacity，不影响尺寸测量），等溢出计算完成后淡入，避免窄屏先全显示再闪现溢出按钮 */
/* 初始化时先淡入（both 保证结束时停在 opacity:1），避免窄屏先全显示再闪现溢出按钮。
   关键：纯 CSS animation，绝不依赖 JS 测量的 toolbar--ready —— 无论 overflow 测量成功与否、甚至
   JS 未执行，0.15s 后一定 opacity:1，杜绝「整条 toolbar 永久透明」的 bug。 */
.toolbar > * { animation: toolbar-fade-in .15s ease-out both; }
@keyframes toolbar-fade-in { from { opacity: 0; } to { opacity: 1; } }
.tb-item { display: flex; align-items: center; flex: 0 0 auto; }
.toolbar-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--sp-toolbar-border); }
.toolbar-font, .toolbar-number-format, .toolbar-align, .toolbar-freeze { flex: 0 0 auto; }
.toolbar-font-size, .toolbar-number-format-group { display: inline-flex; align-items: center; gap: 0; height: 26px; position: relative; }
.toolbar-font-size__input { width: 36px; height: 26px; border: 1px solid transparent; border-right: none; border-radius: 3px 0 0 3px; background: transparent; color: var(--sp-toolbar-btn-color); font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; text-align: left; padding: 0 5px; outline: none; box-sizing: border-box; appearance: none; -moz-appearance: textfield; }
.toolbar-font-size__input::-webkit-outer-spin-button,
.toolbar-font-size__input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.toolbar-font-size__input:hover { background: var(--sp-toolbar-btn-hover-bg); }
.toolbar-font-size__input:focus { border-color: var(--sp-toolbar-border); background: #fff; }
.toolbar-font-size__btn { display: flex; align-items: center; justify-content: center; width: 16px; height: 26px; border: 1px solid transparent; border-left: none; border-radius: 0 3px 3px 0; background: transparent; color: var(--sp-toolbar-btn-color); cursor: pointer; padding: 0; }
.toolbar-font-size__btn:hover { background: var(--sp-toolbar-btn-hover-bg); }
.toolbar-font-size__btn svg { width: 10px; height: 10px; }
.toolbar-font-size__dropdown { position: absolute; width: 56px; height: 26px; pointer-events: none; }
.toolbar-btn { display: flex; align-items: center; justify-content: center; width: 30px; height: 26px; border: none; border-radius: 3px; background: transparent; color: var(--sp-toolbar-btn-color); cursor: pointer; padding: 0; }
.toolbar-btn:hover:not(:disabled) { background: var(--sp-toolbar-btn-hover-bg); }
.toolbar-btn:active:not(:disabled) { opacity: 0.7; }
.toolbar-btn--active { background: var(--sp-toolbar-btn-hover-bg); color: var(--sp-toolbar-btn-active-color); }
.toolbar-btn--step { width: 26px; height: 26px; }
.toolbar-btn--step svg { width: 16px; height: 16px; }
.toolbar-btn:disabled { color: var(--sp-toolbar-btn-disabled-color); cursor: default; }
.toolbar-btn__icon { width: 18px; height: 18px; }
.toolbar-btn svg:not(.toolbar-btn__icon) { width: 18px; height: 18px; }
.toolbar-btn__label { display: none; font-size: 12px; margin-left: 6px; }
.toolbar-split { display: inline-flex; align-items: center; position: relative; height: 26px; }
.toolbar-split__main { border: 1px solid transparent; border-right: none; border-radius: 3px 0 0 3px; }
.toolbar-split__arrow { display: flex; align-items: center; justify-content: center; width: 16px; height: 26px; border: 1px solid transparent; border-radius: 0 3px 3px 0; background: transparent; color: var(--sp-toolbar-btn-color); cursor: pointer; padding: 0; }
.toolbar-split__arrow:hover:not(:disabled) { background: var(--sp-toolbar-btn-hover-bg); }
.toolbar-split__arrow svg { width: 10px !important; height: 10px !important; }

/* 分组（Outline）触发按钮：单按钮（图标 + 文字 + 箭头），参考条件格式下拉框按钮 .cf-menu-trigger */
.outline-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  height: 26px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #444);
  font-size: 12px;
  cursor: pointer;
  padding: 0 5px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  min-width: 0;
}
.outline-trigger:hover:not(:disabled) { background: var(--sp-toolbar-btn-hover-bg, #e6e6e6); }
.outline-trigger:disabled { color: var(--sp-toolbar-btn-disabled-color, #aaa); cursor: default; }
.outline-trigger.is-open { background: var(--sp-toolbar-btn-hover-bg, #e6e6e6); }
.outline-trigger__icon { width: 16px; height: 16px; flex: none; }
.outline-trigger .toolbar-btn__label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.toolbar-btn.outline-trigger .outline-trigger__caret { width: 10px; height: 10px; opacity: 0.7; flex: none; }

/* 「更多」按钮 */
.toolbar-more { display: flex; align-items: center; justify-content: center; width: 30px; height: 26px; border: none; border-radius: 3px; background: transparent; color: var(--sp-toolbar-btn-color); cursor: pointer; padding: 0; flex: 0 0 auto; margin-left: auto; }
.toolbar-more:hover { background: var(--sp-toolbar-btn-hover-bg); }
.toolbar-more--active { background: var(--sp-toolbar-btn-hover-bg); color: var(--sp-toolbar-btn-active-color); }
.toolbar-more svg { width: 18px; height: 18px; }

/* 溢出菜单：fixed 定位 + 渲染到 body，彻底隔离 stacking context */
.overflow-menu-wrap {
  min-width: 180px;
  max-width: 260px;
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 4px 6px;
  z-index: 1000;
  transform-origin: top right;
  display: flex;
  flex-direction: column;
}
.overflow-menu-wrap.no-anim { transition: none !important; }
.overflow-menu {
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.overflow-menu::-webkit-scrollbar { display: none; }
.overflow-nav {
  flex: 0 0 auto;
  height: 18px;
  border: none;
  background: transparent;
  color: #888;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
}
.overflow-nav:hover:not(:disabled) { background: #eef3f9; }
.overflow-nav:disabled { color: #d5d5d5; cursor: default; }
.overflow-nav svg { width: 10px; height: 10px; }

/* 统一弹出动画：fade + scale */
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }
</style>

<!-- 非 scoped 样式：溢出菜单经 Teleport 渲染到 body。选择器要伸进子组件内部（cf-menu-trigger、
     sp-dropdown__trigger 等，不带本组件 data-v）的必须写在这里；溢出覆盖规则统一只在此维护，
     不在 scoped 块另写副本，避免双份不同步 -->
<style>
.overflow-menu .tb-item { width: 100%; }
.overflow-menu .toolbar-sep { width: 100%; height: 1px; margin: 2px 0; }
.overflow-menu .toolbar-split { width: 100%; }
.overflow-menu .toolbar-split__main { flex: 1 1 auto; justify-content: flex-start; padding-left: 6px; }
.overflow-menu .toolbar-font-size { width: 100%; justify-content: flex-start; }
.overflow-menu .toolbar-number-format-group { width: 100%; justify-content: flex-start; }
.overflow-menu .toolbar-font { width: 100%; }
.overflow-menu .toolbar-number-format { flex: 1 1 auto; width: auto !important; min-width: 0; }
.overflow-menu .toolbar-align { width: 100%; }
.overflow-menu .toolbar-freeze { width: 100%; }
.overflow-menu .toolbar-btn:not(.toolbar-btn--step):not(.toolbar-split__arrow):not(.toolbar-number-format__btn) { width: 100%; justify-content: flex-start; padding-left: 6px; }
.overflow-menu .toolbar-btn__label { display: inline; }
.overflow-menu .toolbar-number-format__btn { flex: 0 0 auto; width: 30px; }
.overflow-menu .toolbar-color { width: 100%; }
.overflow-menu .toolbar-wrap { width: 100%; justify-content: flex-start; }
.overflow-menu .sp-dropdown .sp-dropdown__trigger { padding-left: 6px; gap: 6px; }
.overflow-menu .cf-menu-root .cf-menu-trigger { padding-left: 6px; gap: 6px; }
.overflow-menu .cf-menu-trigger__icon { width: 18px; height: 18px; }
.overflow-menu .outline-trigger { padding-left: 6px; gap: 6px; }
.overflow-menu .outline-trigger .toolbar-btn__label { margin-left: 0; }
.overflow-menu .outline-trigger__icon { width: 18px; height: 18px; flex: none; }
.overflow-menu .toolbar-font-size__input { flex: 1 1 auto; width: auto; min-width: 40px; }

/* 以下带 .overflow-menu 前缀的 hover/active/disabled/focus 规则（原 .toolbar-btn:hover、:active、
   --active、:disabled、.toolbar-split__arrow:hover、.toolbar-font-size__input:hover/:focus/__btn:hover、
   .toolbar-more:hover/--active）已全部删除：toolbar 自有元素经 Teleport 渲染到 body 后仍携带本组件
   data-v，scoped 基础规则(.toolbar-btn:hover 等)本身即可命中，重复写一份纯属冗余、且两处不同步是隐患。
   仅保留 scoped 缺失的 .toolbar-split__main:hover（溢出态整行高亮），以及子组件内部元素
   (.sp-dropdown__trigger / .cf-menu-trigger / .cf-menu-trigger__icon) 与新增覆盖属性（width:100% 等）。 */
.overflow-menu .toolbar-split__main:hover:not(:disabled) { background: var(--sp-toolbar-btn-hover-bg); }
</style>
