<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { t } from '../core/constants';
import type { FontOption, MergeType } from '../core/constants';
import SpDropdown from './dropdown.vue';
import ColorPicker from './pickers/colorPicker.vue';
import BorderPicker, { type BorderType } from './pickers/borderPicker.vue';
import MergePicker from './pickers/mergePicker.vue';

// 田字型边框按钮图标：4 个外边 + 1 条竖中线 + 1 条横中线（与 borderPicker.vue 保持一致）
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

// ============ 工具栏溢出 → 「更多」菜单 ============
// 工具项顺序与 data-key 一一对应
const TOOL_KEYS = [
  'undo', 'redo', 'paint', 'clear', 'sep1', 'font', 'fontSize', 'sep2',
  'bold', 'italic', 'underline', 'strike', 'sep3', 'textColor', 'fillColor', 'border',
  'sep4', 'hAlign', 'vAlign', 'wrap', 'merge',
] as const;

const rootEl = ref<HTMLElement | null>(null);
const overflowMenuEl = ref<HTMLElement | null>(null);
const moreBtnEl = ref<HTMLElement | null>(null);
const textColorArrowRef = ref<HTMLElement | null>(null);
const fillColorArrowRef = ref<HTMLElement | null>(null);
const borderArrowRef = ref<HTMLElement | null>(null);
const mergeArrowRef = ref<HTMLElement | null>(null);
const fontSizeArrowRef = ref<HTMLElement | null>(null);
const overflowKeys = ref<Set<string>>(new Set());
const overflowOpen = ref(false);
const skipCloseAnim = ref(false);
const overflowKeyVersion = ref(0);

const GAP = 2;     // .toolbar 的列间距
const PAD = 6;     // .toolbar 左右内边距
const MORE_W = 34; // 「更多」按钮预留宽度
const naturalWidths = new Map<string, number>();

const hasOverflow = computed(() => overflowKeys.value.size > 0);
function isOverflow(key: string): boolean {
  return overflowKeys.value.has(key);
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
function scheduleRecompute() {
  if (recomputeRaf) cancelAnimationFrame(recomputeRaf);
  // 兜底：布局长期不可用时最多重试若干次，避免无限 rAF
  if (recomputeTries > 60) return;
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
  return {
    ...props.themeVars,
    position: 'fixed' as const,
    top: `${rect.bottom + 4}px`,
    right: `${window.innerWidth - rect.right}px`,
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
  if (overflowMenuEl.value?.contains(target)) return;
  if (moreBtnEl.value?.contains(target)) return;
  skipCloseAnim.value = true;
  overflowOpen.value = false;
  nextTick(() => {
    skipCloseAnim.value = false;
  });
}

function toggleOverflow() {
  overflowOpen.value = !overflowOpen.value;
}

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
  selHAlign: string;
  selVAlign: string;
  selWrap: boolean;
  hAlignOptions: FontOption[];
  vAlignOptions: FontOption[];
  mergeMenuOpen: boolean;
  themeVars?: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: 'undo' | 'redo' | 'paint-format' | 'clear-format' | 'font-size-blur' | 'font-size-toggle' | 'font-size-step-up' | 'font-size-step-down' | 'bold-toggle' | 'italic-toggle' | 'underline-toggle' | 'strikethrough-toggle' | 'apply-text-color' | 'apply-fill-color' | 'apply-border' | 'wrap-toggle' | 'apply-merge'): void;
  (e: 'font-family-change' | 'font-size-change' | 'h-align-change' | 'v-align-change', v: string | number): void;
  (e: 'font-size-input' | 'text-color-change' | 'fill-color-change', v: string): void;
  (e: 'font-size-keydown', ev: KeyboardEvent): void;
  (e: 'update:font-size-menu-open' | 'update:text-color-menu-open' | 'update:fill-color-menu-open' | 'update:border-menu-open' | 'update:merge-menu-open', v: boolean): void;
  (e: 'border-change', v: BorderType): void;
  (e: 'merge-change', v: MergeType): void;
}>();
</script>

<template>
  <div
    ref="rootEl"
    class="toolbar"
  >
    <Teleport
      :disabled="!isOverflow('undo')"
      :to="overflowMenuEl ?? undefined"
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
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('redo')"
      :to="overflowMenuEl ?? undefined"
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
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('paint')"
      :to="overflowMenuEl ?? undefined"
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
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('clear')"
      :to="overflowMenuEl ?? undefined"
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
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('sep1')"
      :to="overflowMenuEl ?? undefined"
    >
      <div
        class="tb-item"
        data-key="sep1"
      >
        <div class="toolbar-sep" />
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('font')"
      :to="overflowMenuEl ?? undefined"
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
          @change="emit('font-family-change', $event)"
        />
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('fontSize')"
      :to="overflowMenuEl ?? undefined"
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
            @update:model-open="emit('update:font-size-menu-open', $event)"
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
            ><path d="M484.352 164.555a26.5554 26.5554 0 0 0 26.495 34.37h-57.006c-10.917 0 -20.718 6.678 -24.705 16.83L112.346 840.014c-6.849 17.415 5.994 36.261 24.705 36.261h31.923c11.034 0 20.916 -6.822 24.822 -17.136l72.801 -192.015h328.086l73.746 192.114a26.559 26.559 0 0 0 75.986 68.237h32.004c18.72 0 31.554 -18.846 24.705 -36.261L484.352 164.555zM297.323 585.854l130.842 -345.942h1.98l132.822 345.942H297.323zM886.976 227.366h-159.3c-14.661 0 -26.55 11.889 -26.55 26.55s11.889 26.55 26.55 26.55h159.3c14.661 0 26.55 -11.889 26.55 -26.55s-11.889 -26.55 -26.55 -26.55z" /></svg>
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
            ><path d="M484.352 164.555a26.5554 26.5554 0 0 0 26.495 34.37h-57.006c-10.917 0 -20.718 6.678 -24.705 16.83L112.346 840.014c-6.849 17.415 5.994 36.261 24.705 36.261h31.923c11.034 0 20.916 -6.822 24.822 -17.136l72.801 -192.015h328.086l73.746 192.114a26.559 26.559 0 0 0 75.986 68.237h32.004c18.72 0 31.554 -18.846 24.705 -36.261L484.352 164.555zM297.323 585.854l130.842 -345.942h1.98l132.822 345.942H297.323zM886.976 227.366h-53.1v-53.1c0 -14.661 -11.889 -26.55 -26.55 -26.55s-26.55 11.889 -26.55 26.55v53.1h-53.1c-14.661 0 -26.55 11.889 -26.55 26.55s11.889 26.55 26.55 26.55h53.1v53.1c0 14.661 11.889 26.55 26.55 26.55s26.55 -11.889 26.55 -26.55v-53.1h53.1c14.661 0 26.55 -11.889 26.55 -26.55s-11.889 -26.55 -26.55 -26.55z" /></svg>
          </button>
        </div>
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('sep2')"
      :to="overflowMenuEl ?? undefined"
    >
      <div
        class="tb-item"
        data-key="sep2"
      >
        <div class="toolbar-sep" />
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('bold')"
      :to="overflowMenuEl ?? undefined"
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
          ><path d="M671.5597 480.1126A192.6451 192.6451 0 0 0 537.9277 150.9786H275.456a38.4 38.4 0 0 0 143.36 220.16h31.1194a7.68 7.68 0 0 1 151.04 151.04V788.48a7.68 7.68 0 0 1 135.68 151.04H275.456a38.4 38.4 0 1 0 143.36 220.16h306.0634a207.1142 207.1142 0 0 0 233.3696 -249.4259zm-133.632 -252.3341a115.5686 115.5686 0 0 1 143.36 374.4666H398.7354a7.68 7.68 0 0 1 135.68 135.68V235.52a7.68 7.68 0 0 1 151.04 135.68zm43.6224 568.32H398.7354a7.68 7.68 0 0 1 135.68 135.68v-245.0534a7.68 7.68 0 0 1 151.04 135.68H581.5501a130.2221 130.2221 0 0 1 143.36 403.7734z"/></svg>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('italic')"
      :to="overflowMenuEl ?? undefined"
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
          ><path d="M834.56 150.9786h-234.6086a38.4 38.4 0 0 0 143.36 220.16h33.3619a7.68 7.68 0 0 1 149.8419 155.1565L290.2016 789.0022a15.36 15.36 0 0 1 130.3962 150.4563H189.44a38.4 38.4 0 0 0 143.36 220.16h234.6086a38.4 38.4 0 0 0 143.36 66.56H390.6867a7.68 7.68 0 0 1 136.8781 131.5635L733.7984 234.9056a15.36 15.36 0 0 1 156.3238 136.233H834.56a38.4 38.4 0 0 0 143.36 66.56z"/></svg>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('underline')"
      :to="overflowMenuEl ?? undefined"
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
          ><path d="M834.56 796.0986h-645.12a38.4 38.4 0 0 0 143.36 220.16h645.12a38.4 38.4 0 0 0 143.36 66.56zM204.1242 227.7786h41.8714a7.68 7.68 0 0 1 151.04 151.04v261.8266a258.3245 258.3245 0 0 0 660.009 143.36V235.52a7.68 7.68 0 0 1 151.04 135.68h41.8714a38.4 38.4 0 0 0 143.36 66.56H644.096a38.4 38.4 0 0 0 143.36 220.16h41.8714a7.68 7.68 0 0 1 151.04 151.04v261.8266a181.5245 181.5245 0 0 1 -219.689 143.36V235.52a7.68 7.68 0 0 1 151.04 135.68H379.904a38.4 38.4 0 1 0 143.36 66.56H204.1242a38.4 38.4 0 0 0 143.36 220.16z"/></svg>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('strike')"
      :to="overflowMenuEl ?? undefined"
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
          ><path d="M872.96 541.2454A38.4 38.4 0 0 0 834.56 502.784h-274.5139a15.1142 15.1142 0 0 1 134.697 140.5952c-22.1798 -15.7594 -45.527 -30.1363 -68.137 -43.991 -86.016 -52.6848 -138.24 -89.088 -138.24 -149.3914 0 -68.6592 67.799 -78.9197 108.2266 -78.9197a139.4688 139.4688 0 0 1 238.0083 166.8301 81.7766 81.7766 0 0 1 157.0918 204.4928v9.216a38.4 38.4 0 1 0 220.16 143.36v-8.233a150.1286 150.1286 0 0 0 107.5712 27.3306C571.8733 166.1235 523.0285 150.9786 453.3555 150.9786c-112.3738 0 -185.0266 61.1021 -185.0266 155.7197 0 85.1866 58.1222 138.6086 122.88 182.0774a7.68 7.68 0 0 1 139.0899 157.4298H189.44a38.4 38.4 0 0 0 143.36 220.16h337.2134a7.7107 7.7107 0 0 1 148.2445 145.1418 133.2941 133.2941 0 0 1 202.711 249.8355c0 100.393 -105.2467 108.1958 -137.5334 108.1958 -55.7261 0 -96.4301 -12.4416 -117.7805 -36.0346a104.2637 104.2637 0 0 1 123.392 60.416 38.4 38.4 0 0 0 66.9286 135.8029A176.9472 176.9472 0 0 0 278.528 811.6122c36.864 40.6733 95.6621 61.44 174.7354 61.44 128.2253 0 214.3334 -74.3424 214.3334 -184.9958a186.1325 186.1325 0 0 0 117.2787 46.6842 7.68 7.68 0 0 1 149.9955 131.7786H834.56a38.4 38.4 0 0 0 181.76 104.8064z"/></svg>
        </button>
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('sep3')"
      :to="overflowMenuEl ?? undefined"
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
      :disabled="!isOverflow('textColor')"
      :to="overflowMenuEl ?? undefined"
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
          </button>
          <button
            ref="textColorArrowRef"
            class="toolbar-btn toolbar-split__arrow"
            :title="t(locale, 'fontColor')"
            :disabled="!hasSelection"
            @click="emit('update:text-color-menu-open', !textColorMenuOpen)"
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
            @update:model-open="emit('update:text-color-menu-open', $event)"
            @change="emit('text-color-change', $event)"
          />
        </div>
      </div>
    </Teleport>

    <!-- 填充颜色 -->
    <Teleport
      :disabled="!isOverflow('fillColor')"
      :to="overflowMenuEl ?? undefined"
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
          </button>
          <button
            ref="fillColorArrowRef"
            class="toolbar-btn toolbar-split__arrow"
            :title="t(locale, 'fillColor')"
            :disabled="!hasSelection"
            @click="emit('update:fill-color-menu-open', !fillColorMenuOpen)"
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
            @update:model-open="emit('update:fill-color-menu-open', $event)"
            @change="emit('fill-color-change', $event)"
          />
        </div>
      </div>
    </Teleport>

    <!-- 边框 -->
    <Teleport
      :disabled="!isOverflow('border')"
      :to="overflowMenuEl ?? undefined"
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
          </button>
          <button
            ref="borderArrowRef"
            class="toolbar-btn toolbar-split__arrow"
            :title="t(locale, 'borders')"
            :disabled="!hasSelection"
            @click="emit('update:border-menu-open', !borderMenuOpen)"
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
            @update:model-open="emit('update:border-menu-open', $event)"
            @change="emit('border-change', $event)"
          />
        </div>
      </div>
    </Teleport>

    <Teleport
      :disabled="!isOverflow('sep4')"
      :to="overflowMenuEl ?? undefined"
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
      :disabled="!isOverflow('hAlign')"
      :to="overflowMenuEl ?? undefined"
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
          @change="emit('h-align-change', $event)"
        />
      </div>
    </Teleport>

    <!-- 垂直对齐 -->
    <Teleport
      :disabled="!isOverflow('vAlign')"
      :to="overflowMenuEl ?? undefined"
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
          @change="emit('v-align-change', $event)"
        />
      </div>
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
        </button>
      </div>
    </Teleport>

    <!-- 合并单元格 -->
    <Teleport
      :disabled="!isOverflow('merge')"
      :to="overflowMenuEl ?? undefined"
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
          </button>
          <button
            ref="mergeArrowRef"
            class="toolbar-btn toolbar-split__arrow"
            :title="t(locale, 'mergeCells')"
            :disabled="!hasSelection"
            @click="emit('update:merge-menu-open', !mergeMenuOpen)"
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
            @update:model-open="emit('update:merge-menu-open', $event)"
            @change="emit('merge-change', $event)"
          />
        </div>
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
        ref="overflowMenuEl"
        :key="overflowKeyVersion"
        class="overflow-menu"
        :class="{ 'no-anim': skipCloseAnim }"
        :style="menuStyle"
      />
    </Transition>
  </Teleport>
</template>

<style scoped>
.toolbar { position: relative; display: flex; align-items: center; height: 32px; min-height: 32px; gap: 2px; padding: 0 6px; background: var(--sp-toolbar-bg); border-bottom: 1px solid var(--sp-toolbar-border); user-select: none; }
.tb-item { display: flex; align-items: center; flex: 0 0 auto; }
.toolbar-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--sp-toolbar-border); }
.toolbar-font { flex: 0 0 auto; }
.toolbar-align { flex: 0 0 auto; }
.toolbar-font-size { display: inline-flex; align-items: center; gap: 0; height: 26px; position: relative; }
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
.toolbar-split { display: inline-flex; align-items: center; position: relative; height: 26px; }
.toolbar-split__main { border: 1px solid transparent; border-right: none; border-radius: 3px 0 0 3px; }
.toolbar-split__arrow { display: flex; align-items: center; justify-content: center; width: 16px; height: 26px; border: 1px solid transparent; border-radius: 0 3px 3px 0; background: transparent; color: var(--sp-toolbar-btn-color); cursor: pointer; padding: 0; }
.toolbar-split__arrow:hover:not(:disabled) { background: var(--sp-toolbar-btn-hover-bg); }
.toolbar-split__arrow svg { width: 10px !important; height: 10px !important; }

/* 「更多」按钮 */
.toolbar-more { display: flex; align-items: center; justify-content: center; width: 30px; height: 26px; border: none; border-radius: 3px; background: transparent; color: var(--sp-toolbar-btn-color); cursor: pointer; padding: 0; flex: 0 0 auto; margin-left: auto; }
.toolbar-more:hover { background: var(--sp-toolbar-btn-hover-bg); }
.toolbar-more--active { background: var(--sp-toolbar-btn-hover-bg); color: var(--sp-toolbar-btn-active-color); }
.toolbar-more svg { width: 18px; height: 18px; }

/* 溢出菜单：fixed 定位 + 渲染到 body，彻底隔离 stacking context */
.overflow-menu { min-width: 180px; max-width: 260px; max-height: calc(100vh - 40px); overflow-y: auto; background: var(--sp-toolbar-bg, #fff); border: 1px solid var(--sp-toolbar-border); border-radius: 4px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12); padding: 4px 6px; display: flex; flex-direction: column; gap: 2px; z-index: 1000; transform-origin: top right; }
.overflow-menu.no-anim { transition: none !important; }
.overflow-menu .tb-item { width: 100%; }
.overflow-menu .toolbar-sep { width: 100%; height: 1px; margin: 2px 0; }
.overflow-menu .toolbar-split { width: 100%; }
.overflow-menu .toolbar-split__main { flex: 1 1 auto; justify-content: flex-start; padding-left: 6px; }
.overflow-menu .toolbar-font-size { width: 100%; justify-content: flex-start; }
.overflow-menu .toolbar-font { width: 100%; }
.overflow-menu .toolbar-align { width: 100%; }
.overflow-menu .toolbar-btn:not(.toolbar-btn--step):not(.toolbar-split__arrow) { width: 100%; justify-content: flex-start; padding-left: 6px; }
.overflow-menu .toolbar-color { width: 100%; }
.overflow-menu .toolbar-wrap { width: 100%; justify-content: flex-start; }

/* 统一弹出动画：fade + scale */
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }
</style>

<!-- 非 scoped 样式：溢出菜单通过 Teleport 渲染到 body，scoped 样式无法穿透 -->
<style>
.overflow-menu .tb-item { width: 100%; }
.overflow-menu .toolbar-sep { width: 100%; height: 1px; margin: 2px 0; }
.overflow-menu .toolbar-split { width: 100%; }
.overflow-menu .toolbar-split__main { flex: 1 1 auto; justify-content: flex-start; padding-left: 6px; }
.overflow-menu .toolbar-font-size { width: 100%; justify-content: flex-start; }
.overflow-menu .toolbar-font { width: 100%; }
.overflow-menu .toolbar-align { width: 100%; }
.overflow-menu .toolbar-btn:not(.toolbar-btn--step):not(.toolbar-split__arrow) { width: 100%; justify-content: flex-start; padding-left: 6px; }
.overflow-menu .toolbar-color { width: 100%; }
.overflow-menu .toolbar-wrap { width: 100%; justify-content: flex-start; }
.overflow-menu .toolbar-font-size__input { flex: 1 1 auto; width: auto; min-width: 40px; }

.overflow-menu .toolbar-btn:hover:not(:disabled) { background: var(--sp-toolbar-btn-hover-bg); }
.overflow-menu .toolbar-btn:active:not(:disabled) { opacity: 0.7; }
.overflow-menu .toolbar-btn--active { background: var(--sp-toolbar-btn-hover-bg); color: var(--sp-toolbar-btn-active-color); }
.overflow-menu .toolbar-btn:disabled { color: var(--sp-toolbar-btn-disabled-color); cursor: default; }

.overflow-menu .toolbar-split__main:hover:not(:disabled) { background: var(--sp-toolbar-btn-hover-bg); }
.overflow-menu .toolbar-split__arrow:hover:not(:disabled) { background: var(--sp-toolbar-btn-hover-bg); }

.overflow-menu .toolbar-font-size__input:hover { background: var(--sp-toolbar-btn-hover-bg); }
.overflow-menu .toolbar-font-size__input:focus { border-color: var(--sp-toolbar-border); background: #fff; }
.overflow-menu .toolbar-font-size__btn:hover { background: var(--sp-toolbar-btn-hover-bg); }

.overflow-menu .toolbar-more:hover { background: var(--sp-toolbar-btn-hover-bg); }
.overflow-menu .toolbar-more--active { background: var(--sp-toolbar-btn-hover-bg); color: var(--sp-toolbar-btn-active-color); }
</style>
