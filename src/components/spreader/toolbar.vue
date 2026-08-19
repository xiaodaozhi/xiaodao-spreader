<script setup lang="ts">
import { t, type FontOption } from './constants';
import SpDropdown from './dropdown.vue';
import ColorPicker from './colorPicker.vue';
import BorderPicker, { type BorderType } from './borderPicker.vue';

// 田字型边框按钮图标：4 个外边 + 1 条竖中线 + 1 条横中线（与 borderPicker.vue 保持一致）
interface BorderSeg { name: string; x1: number; y1: number; x2: number; y2: number; }
const BORDER_SEGS: BorderSeg[] = [
  { name: 'top', x1: 4, y1: 4, x2: 26, y2: 4 },
  { name: 'bottom', x1: 4, y1: 26, x2: 26, y2: 26 },
  { name: 'left', x1: 4, y1: 4, x2: 4, y2: 26 },
  { name: 'right', x1: 26, y1: 4, x2: 26, y2: 26 },
  { name: 'vMid', x1: 15, y1: 4, x2: 15, y2: 26 },
  { name: 'hMid', x1: 4, y1: 15, x2: 26, y2: 15 },
];
const SOLID_SEGS: Record<BorderType, string[]> = {
  bottom: ['bottom'], top: ['top'], left: ['left'], right: ['right'], none: [],
  all: ['top', 'bottom', 'left', 'right', 'vMid', 'hMid'],
  outer: ['top', 'bottom', 'left', 'right'],
  thickOuter: ['top', 'bottom', 'left', 'right'],
};
const THICK_SEGS: Record<BorderType, string[]> = {
  bottom: [], top: [], left: [], right: [], none: [], all: [], outer: [],
  thickOuter: ['top', 'bottom', 'left', 'right'],
};
function segRole(bt: BorderType, name: string): 'solid' | 'dashed' | 'thick' {
  if (THICK_SEGS[bt].includes(name)) return 'thick';
  if (SOLID_SEGS[bt].includes(name)) return 'solid';
  return 'dashed';
}

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
}>();

const emit = defineEmits<{
  (e: 'undo'): void;
  (e: 'redo'): void;
  (e: 'paint-format'): void;
  (e: 'clear-format'): void;
  (e: 'font-family-change', v: string | number): void;
  (e: 'font-size-input', v: string): void;
  (e: 'font-size-blur'): void;
  (e: 'font-size-keydown', ev: KeyboardEvent): void;
  (e: 'font-size-change', v: string | number): void;
  (e: 'update:font-size-menu-open', v: boolean): void;
  (e: 'font-size-toggle'): void;
  (e: 'font-size-step-up'): void;
  (e: 'font-size-step-down'): void;
  (e: 'bold-toggle'): void;
  (e: 'italic-toggle'): void;
  (e: 'underline-toggle'): void;
  (e: 'strikethrough-toggle'): void;
  (e: 'text-color-change', v: string): void;
  (e: 'update:text-color-menu-open', v: boolean): void;
  (e: 'fill-color-change', v: string): void;
  (e: 'update:fill-color-menu-open', v: boolean): void;
  (e: 'apply-text-color'): void;
  (e: 'apply-fill-color'): void;
  (e: 'update:border-menu-open', v: boolean): void;
  (e: 'border-change', v: BorderType): void;
  (e: 'apply-border'): void;
}>();
</script>

<template>
  <div class="toolbar">
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
        <path transform="translate(1024, 0) scale(-1, 1)" d="M596.16 284.064H258.56l101.376-101.44a31.968 31.968 0 1 0-45.248-45.216L178.56 273.504c-11.904 11.872-18.496 27.84-18.56 44.8a63.04 63.04 0 0 0 18.56 45.28l136.128 136.16a31.904 31.904 0 0 0 45.248 0 31.968 31.968 0 0 0 0-45.248l-106.752-106.496H596.16c114.88 0 208.32 93.312 208.32 208s-93.44 208-208.32 208h-223.36a32 32 0 0 0 0 64h223.36c150.144 0 272.32-122.016 272.32-272 0-149.984-122.176-272-272.32-272" />
      </svg>
    </button>
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
    <div class="toolbar-sep" />
    <SpDropdown
      class="toolbar-font"
      :model-value="selFontFamily"
      :options="fontFamilyOptions"
      :width="110"
      :visible-count="8"
      :title="t(locale, 'fontFamily')"
      @change="emit('font-family-change', $event)"
    />
    <div class="toolbar-font-size">
      <input
        class="toolbar-font-size__input"
        type="text"
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
          :width="56"
          :visible-count="9"
          :title="t(locale, 'fontSize')"
          :hide-trigger="true"
          :model-open="fontSizeMenuOpen"
          @update:model-open="emit('update:font-size-menu-open', $event)"
          @change="emit('font-size-change', $event)"
        />
        <button
          class="toolbar-font-size__btn"
          type="button"
          :title="t(locale, 'fontSize')"
          @mousedown.prevent
          @click="emit('font-size-toggle')"
        >
          <svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M180.053333 361.386667a32 32 0 0 1 45.226667 0L512 648.106667l286.72-286.72a32 32 0 1 1 45.226667 45.226666l-309.333334 309.333334a32 32 0 0 1-45.226666 0L180.053333 406.613333a32 32 0 0 1 0-45.226666z" /></svg>
        </button>
        <button
          class="toolbar-btn toolbar-btn--step"
          type="button"
          :title="t(locale, 'fontSizeDecrease')"
          :disabled="!hasSelection"
          @mousedown.prevent
          @click="emit('font-size-step-down')"
        >
          <svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M481.28 125.95a29.506 29.506 0 0 0-27.45-18.7h-63.34c-12.13 0-23.02 7.42-27.45 18.7L67.94 876.46c-7.61 19.35 6.66 40.29 27.45 40.29h35.47c12.26 0 23.24-7.58 27.58-19.04l80.89-213.35h364.54l81.94 213.46a29.51 29.51 0 0 0 27.54 18.93h35.56c20.8 0 35.06-20.94 27.45-40.29L481.28 125.95zM273.47 594.06l145.38-384.38h2.2l147.58 384.38H273.47zM928.64 195.74h-177c-16.29 0-29.5 13.21-29.5 29.5s13.21 29.5 29.5 29.5h177c16.29 0 29.5-13.21 29.5-29.5s-13.21-29.5-29.5-29.5z" /></svg>
        </button>
        <button
          class="toolbar-btn toolbar-btn--step"
          type="button"
          :title="t(locale, 'fontSizeIncrease')"
          :disabled="!hasSelection"
          @mousedown.prevent
          @click="emit('font-size-step-up')"
        >
          <svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M481.28 125.95a29.506 29.506 0 0 0-27.45-18.7h-63.34c-12.13 0-23.02 7.42-27.45 18.7L67.94 876.46c-7.61 19.35 6.66 40.29 27.45 40.29h35.47c12.26 0 23.24-7.58 27.58-19.04l80.89-213.35h364.54l81.94 213.46a29.51 29.51 0 0 0 27.54 18.93h35.56c20.8 0 35.06-20.94 27.45-40.29L481.28 125.95zM273.47 594.06l145.38-384.38h2.2l147.58 384.38H273.47zM928.64 195.74h-59v-59c0-16.29-13.21-29.5-29.5-29.5s-29.5 13.21-29.5 29.5v59h-59c-16.29 0-29.5 13.21-29.5 29.5s13.21 29.5 29.5 29.5h59v59c0 16.29 13.21 29.5 29.5 29.5s29.5-13.21 29.5-29.5v-59h59c16.29 0 29.5-13.21 29.5-29.5s-13.21-29.5-29.5-29.5z" /></svg>
        </button>
      </div>
      <div class="toolbar-sep" />
      <button
        class="toolbar-btn"
        :class="{ 'toolbar-btn--active': selFontWeight }"
        :title="t(locale, 'bold')"
        :disabled="!hasSelection"
        @click="emit('bold-toggle')"
      >
        <svg viewBox="0 0 1024 1024" fill="currentColor"><g transform="translate(102.4, 102.4) scale(0.8)"><path d="M733.610667 467.712A267.562667 267.562667 0 0 0 548.010667 10.581333H183.466667a53.333333 53.333333 0 0 0 0 106.666667h43.221333a10.666667 10.666667 0 0 1 10.666667 10.666667V896a10.666667 10.666667 0 0 1-10.666667 10.666667H183.466667a53.333333 53.333333 0 1 0 0 106.666666h425.088a287.658667 287.658667 0 0 0 125.013333-545.536z m-185.6-350.464a160.512 160.512 0 0 1 0 320.981333H354.688a10.666667 10.666667 0 0 1-10.666667-10.666666V128a10.666667 10.666667 0 0 1 10.666667-10.666667z m60.586666 789.333333H354.688a10.666667 10.666667 0 0 1-10.666667-10.666666v-340.352a10.666667 10.666667 0 0 1 10.666667-10.666667H608.597333a180.864 180.864 0 0 1 0 361.685333z" /></g></svg>
      </button>
      <button
        class="toolbar-btn"
        :class="{ 'toolbar-btn--active': selFontStyle }"
        :title="t(locale, 'italic')"
        :disabled="!hasSelection"
        @click="emit('italic-toggle')"
      >
        <svg viewBox="0 0 1024 1024" fill="currentColor"><g transform="translate(102.4, 102.4) scale(0.8)"><path d="M960 10.581333h-325.845333a53.333333 53.333333 0 0 0 0 106.666667h46.336a10.666667 10.666667 0 0 1 9.002666 16.384L203.946667 896.725333a21.333333 21.333333 0 0 1-18.005334 9.856H64a53.333333 53.333333 0 0 0 0 106.666667h325.845333a53.333333 53.333333 0 0 0 0-106.666667H343.509333a10.666667 10.666667 0 0 1-9.002666-16.384L820.053333 127.146667a21.333333 21.333333 0 0 1 18.005334-9.898667H960a53.333333 53.333333 0 0 0 0-106.666667z" /></g></svg>
      </button>
      <button
        class="toolbar-btn"
        :class="{ 'toolbar-btn--active': selUnderline }"
        :title="t(locale, 'underline')"
        :disabled="!hasSelection"
        @click="emit('underline-toggle')"
      >
        <svg viewBox="0 0 1024 1024" fill="currentColor"><g transform="translate(102.4, 102.4) scale(0.8)"><path d="M960 906.581333h-896a53.333333 53.333333 0 0 0 0 106.666667h896a53.333333 53.333333 0 0 0 0-106.666667zM84.394667 117.248h58.154666a10.666667 10.666667 0 0 1 10.666667 10.666667v363.648a358.784 358.784 0 0 0 717.568 0V128a10.666667 10.666667 0 0 1 10.666667-10.666667h58.154666a53.333333 53.333333 0 0 0 0-106.666666H695.466667a53.333333 53.333333 0 0 0 0 106.666666h58.154666a10.666667 10.666667 0 0 1 10.666667 10.666667v363.648a252.117333 252.117333 0 0 1-504.234667 0V128a10.666667 10.666667 0 0 1 10.666667-10.666667H328.533333a53.333333 53.333333 0 1 0 0-106.666666H84.394667a53.333333 53.333333 0 0 0 0 106.666666z" /></g></svg>
      </button>
      <button
        class="toolbar-btn"
        :class="{ 'toolbar-btn--active': selStrikethrough }"
        :title="t(locale, 'strikethrough')"
        :disabled="!hasSelection"
        @click="emit('strikethrough-toggle')"
      >
        <svg viewBox="0 0 1024 1024" fill="currentColor"><g transform="translate(102.4, 102.4) scale(0.8)"><path d="M1013.333333 552.618667A53.333333 53.333333 0 0 0 960 499.2h-381.269333a20.992 20.992 0 0 1-12.032-3.84c-30.805333-21.888-63.232-41.856-94.634667-61.098667-119.466667-73.173333-192-123.733333-192-207.488 0-95.36 94.165333-109.610667 150.314667-109.610666a193.706667 193.706667 0 0 1 131.456 32.597333 113.578667 113.578667 0 0 1 19.072 84.906667v12.8a53.333333 53.333333 0 1 0 106.666666 0v-11.434667a208.512 208.512 0 0 0-49.706666-161.152C595.157333 31.616 527.317333 10.581333 430.549333 10.581333c-156.074667 0-256.981333 84.864-256.981333 216.277334 0 118.314667 80.725333 192.512 170.666667 252.885333a10.666667 10.666667 0 0 1-5.930667 19.541333H64a53.333333 53.333333 0 0 0 0 106.666667h468.352a10.709333 10.709333 0 0 1 6.784 2.474667 185.130667 185.130667 0 0 1 82.432 147.882666c0 139.434667-146.176 150.272-191.018667 150.272-77.397333 0-133.930667-17.28-163.584-50.048a144.810667 144.810667 0 0 1-27.733333-115.2 53.333333 53.333333 0 0 0-106.154667-10.496A245.76 245.76 0 0 0 187.733333 928.128c51.2 56.490667 132.864 85.333333 242.688 85.333333 178.090667 0 297.685333-103.253333 297.685334-256.938666a258.517333 258.517333 0 0 0-36.224-134.272 10.666667 10.666667 0 0 1 9.216-16.085334H960a53.333333 53.333333 0 0 0 53.333333-53.546666z" /></g></svg>
      </button>
      <div class="toolbar-sep" />
      <!-- 文字颜色 -->
      <div class="toolbar-split">
        <button
          class="toolbar-btn toolbar-split__main"
          :title="t(locale, 'fontColor')"
          :disabled="!hasSelection"
          @click="emit('apply-text-color')"
        >
          <svg viewBox="0 0 1024 1024" fill="currentColor">
            <g transform="translate(102.4, 102.4) scale(0.8)">
              <path d="M663.120842 529.946947H364.759579l-84.07579 212.884211a53.894737 53.894737 0 0 1-50.122105 34.169263h-14.551579a34.869895 34.869895 0 0 1-32.498526-47.696842L443.715368 70.063158a53.894737 53.894737 0 0 1 50.122106-34.115369h41.768421a53.894737 53.894737 0 0 1 50.176 34.277053l257.670737 659.078737a34.977684 34.977684 0 0 1-32.552421 47.696842h-14.389895a53.894737 53.894737 0 0 1-50.229895-34.277053l-83.159579-212.776421z m-35.139368-89.788631l-113.340632-289.953684-114.472421 289.953684h227.813053z" />
            </g>
            <path d="M62.895 844.369m53.895 0l790.474 0q53.895 0 53.895 53.895l0 26.947q0 53.895-53.895 53.895l-790.474 0q-53.895 0-53.895-53.895l0-26.947q0-53.895 53.895-53.895z" :fill="cachedTextColor || '#000000'" />
          </svg>
        </button>
        <button
          class="toolbar-btn toolbar-split__arrow"
          :title="t(locale, 'fontColor')"
          :disabled="!hasSelection"
          @click="emit('update:text-color-menu-open', !textColorMenuOpen)"
        >
          <svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M180.053 361.387a32 32 0 0 1 45.227 0L512 648.107l286.72-286.72a32 32 0 1 1 45.227 45.227l-309.334 309.333a32 32 0 0 1-45.226 0L180.053 406.613a32 32 0 0 1 0-45.226z" /></svg>
        </button>
        <ColorPicker
          :model-open="textColorMenuOpen"
          color-key="text"
          :current-color="selTextColor"
          :locale="locale"
          @update:model-open="emit('update:text-color-menu-open', $event)"
          @change="emit('text-color-change', $event)"
        />
      </div>
      <!-- 填充颜色 -->
      <div class="toolbar-split">
        <button
          class="toolbar-btn toolbar-split__main"
          :title="t(locale, 'fillColor')"
          :disabled="!hasSelection"
          @click="emit('apply-fill-color')"
        >
          <svg viewBox="0 0 1024 1024" fill="currentColor">
            <path d="M447.018667 37.952l352.298666 352.298667c6.613333 6.613333 6.613333 17.344 0 23.957333L446.101333 767.424a16.938667 16.938667 0 0 1-23.957333 0L121.429333 466.688a16.938667 16.938667 0 0 1 0-23.957333L428.608 135.552 388.992 96a8.469333 8.469333 0 0 1 0-11.989333l46.058667-46.037334a8.469333 8.469333 0 0 1 11.968 0z m346.325333 517.461333l57.514667 60.074667c31.744 33.194667 31.744 86.997333 0 120.192a78.869333 78.869333 0 0 1-115.008 0c-31.765333-33.194667-31.765333-86.997333 0-120.192l57.493333-60.074667zM486.101333 193.066667l-261.12 261.12 20.458667 20.458666 380.16-1.728 70.186667-70.186666-209.706667-209.664z" />
            <path d="M85.333333 853.333333m8.896 0l835.541334 0q8.896 0 8.896 8.896l0 110.208q0 8.896-8.896 8.896l-835.541334 0q-8.896 0-8.896-8.896l0-110.208q0-8.896 8.896-8.896Z" :fill="cachedFillColor || 'currentColor'" />
          </svg>
        </button>
        <button
          class="toolbar-btn toolbar-split__arrow"
          :title="t(locale, 'fillColor')"
          :disabled="!hasSelection"
          @click="emit('update:fill-color-menu-open', !fillColorMenuOpen)"
        >
          <svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M180.053 361.387a32 32 0 0 1 45.227 0L512 648.107l286.72-286.72a32 32 0 1 1 45.227 45.227l-309.334 309.333a32 32 0 0 1-45.226 0L180.053 406.613a32 32 0 0 1 0-45.226z" /></svg>
        </button>
        <ColorPicker
          :model-open="fillColorMenuOpen"
          color-key="fill"
          :current-color="selFillColor"
          :locale="locale"
          @update:model-open="emit('update:fill-color-menu-open', $event)"
          @change="emit('fill-color-change', $event)"
        />
      </div>
      <!-- 边框 -->
      <div class="toolbar-split">
        <button
          class="toolbar-btn toolbar-split__main"
          :title="t(locale, 'borders')"
          :disabled="!hasSelection"
          @click="emit('apply-border')"
        >
          <svg viewBox="0 0 30 30" fill="none" stroke="currentColor">
            <line
              v-for="s in BORDER_SEGS"
              :key="s.name"
              :x1="s.x1" :y1="s.y1" :x2="s.x2" :y2="s.y2"
              :stroke-width="segRole(cachedBorder, s.name) === 'thick' ? 3 : 1.5"
              :stroke-dasharray="segRole(cachedBorder, s.name) === 'dashed' ? '0 4' : 'none'"
              :stroke-linecap="segRole(cachedBorder, s.name) === 'dashed' ? 'round' : 'square'"
            />
          </svg>
        </button>
        <button
          class="toolbar-btn toolbar-split__arrow"
          :title="t(locale, 'borders')"
          :disabled="!hasSelection"
          @click="emit('update:border-menu-open', !borderMenuOpen)"
        >
          <svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M180.053 361.387a32 32 0 0 1 45.227 0L512 648.107l286.72-286.72a32 32 0 1 1 45.227 45.227l-309.334 309.333a32 32 0 0 1-45.226 0L180.053 406.613a32 32 0 0 1 0-45.226z" /></svg>
        </button>
        <BorderPicker
          :model-open="borderMenuOpen"
          :locale="locale"
          :current-border="cachedBorder"
          @update:model-open="emit('update:border-menu-open', $event)"
          @change="emit('border-change', $event)"
        />
      </div>
    </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; height: 32px; min-height: 32px; gap: 2px; padding: 0 6px; background: var(--sp-toolbar-bg); border-bottom: 1px solid var(--sp-toolbar-border); user-select: none; }
.toolbar-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--sp-toolbar-border); }
.toolbar-font { flex: 0 0 auto; }
.toolbar-font-size { display: inline-flex; align-items: center; gap: 0; height: 26px; position: relative; }
.toolbar-font-size__input { width: 36px; height: 26px; border: 1px solid transparent; border-right: none; border-radius: 3px 0 0 3px; background: transparent; color: var(--sp-toolbar-btn-color); font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; text-align: center; padding: 0 2px; outline: none; box-sizing: border-box; }
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
</style>