<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { t } from './constants';

interface ColorOption {
  key: string;
  value: string;
}

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  colorKey?: string;
  currentColor?: string;
  locale?: string;
}>(), {
  modelOpen: undefined,
  colorKey: 'text',
  currentColor: '',
  locale: 'zh-CN',
});

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void;
  (e: 'change', v: string): void;
  (e: 'update:modelOpen', v: boolean): void;
}>();

const COLOR_GROUPS: ColorOption[][] = [
  [
    { key: 'colorAutomatic', value: '' },
    { key: 'colorLightBlue', value: '#DEEBF7' },
    { key: 'colorLightOrange', value: '#FCE4D6' },
    { key: 'colorLightYellow', value: '#FFE79A' },
    { key: 'colorLightGreen', value: '#E2EFDA' },
  ],
  [
    { key: 'colorLightGray', value: '#F2F2F2' },
    { key: 'colorPaleBlue', value: '#BDD7EE' },
    { key: 'colorPaleOrange', value: '#F8CBAD' },
    { key: 'colorPaleYellow', value: '#FFD966' },
    { key: 'colorPaleGreen', value: '#C6EFCE' },
  ],
  [
    { key: 'colorSilver', value: '#D9D9D9' },
    { key: 'colorSkyBlue', value: '#9BC2E6' },
    { key: 'colorCoral', value: '#F4B183' },
    { key: 'colorGold', value: '#FFC000' },
    { key: 'colorMint', value: '#A9D18E' },
  ],
  [
    { key: 'colorGray', value: '#BFBFBF' },
    { key: 'colorMediumBlue', value: '#6FA8DC' },
    { key: 'colorOrange', value: '#ED7D31' },
    { key: 'colorAmber', value: '#F1C232' },
    { key: 'colorMediumGreen', value: '#70AD47' },
  ],
  [
    { key: 'colorDarkGray', value: '#A5A5A5' },
    { key: 'colorRoyalBlue', value: '#4A86E8' },
    { key: 'colorRed', value: '#E06666' },
    { key: 'colorDarkGold', value: '#BF8F00' },
    { key: 'colorDarkGreen', value: '#548235' },
  ],
  [
    { key: 'colorCharcoal', value: '#808080' },
    { key: 'colorDeepBlue', value: '#2E75B6' },
    { key: 'colorDarkRed', value: '#CC4125' },
    { key: 'colorOlive', value: '#806000' },
    { key: 'colorForest', value: '#375623' },
  ],
  [
    { key: 'colorSlate', value: '#595959' },
    { key: 'colorNavy', value: '#1F4E79' },
    { key: 'colorCrimson', value: '#993300' },
    { key: 'colorDarkOlive', value: '#5C4500' },
    { key: 'colorDeepForest', value: '#2D6A4F' },
  ],
  [
    { key: 'colorDarkSlate', value: '#404040' },
    { key: 'colorMidnight', value: '#17375E' },
    { key: 'colorMaroon', value: '#5A1E00' },
    { key: 'colorCoffee', value: '#3D3000' },
    { key: 'colorEvergreen', value: '#1B4332' },
  ],
  [
    { key: 'colorBlack', value: '#000000' },
    { key: 'colorDarkNavy', value: '#0C2340' },
    { key: 'colorDarkMaroon', value: '#2E0A00' },
    { key: 'colorDarkCoffee', value: '#1F1800' },
    { key: 'colorInkGreen', value: '#081C15' },
  ],
];

const FILL_COLOR_GROUPS: ColorOption[][] = [
  [
    { key: 'colorNoFill', value: '' },
    { key: 'colorLightBlue', value: '#DEEBF7' },
    { key: 'colorLightOrange', value: '#FCE4D6' },
    { key: 'colorLightYellow', value: '#FFE79A' },
    { key: 'colorLightGreen', value: '#E2EFDA' },
  ],
  [
    { key: 'colorWhite', value: '#FFFFFF' },
    { key: 'colorPaleBlue', value: '#BDD7EE' },
    { key: 'colorPaleOrange', value: '#F8CBAD' },
    { key: 'colorPaleYellow', value: '#FFD966' },
    { key: 'colorPaleGreen', value: '#C6EFCE' },
  ],
  [
    { key: 'colorLightGray', value: '#F2F2F2' },
    { key: 'colorSkyBlue', value: '#9BC2E6' },
    { key: 'colorCoral', value: '#F4B183' },
    { key: 'colorGold', value: '#FFC000' },
    { key: 'colorMint', value: '#A9D18E' },
  ],
  [
    { key: 'colorSilver', value: '#D9D9D9' },
    { key: 'colorMediumBlue', value: '#6FA8DC' },
    { key: 'colorOrange', value: '#ED7D31' },
    { key: 'colorAmber', value: '#F1C232' },
    { key: 'colorMediumGreen', value: '#70AD47' },
  ],
  [
    { key: 'colorGray', value: '#BFBFBF' },
    { key: 'colorRoyalBlue', value: '#4A86E8' },
    { key: 'colorRed', value: '#E06666' },
    { key: 'colorDarkGold', value: '#BF8F00' },
    { key: 'colorDarkGreen', value: '#548235' },
  ],
  [
    { key: 'colorDarkGray', value: '#A5A5A5' },
    { key: 'colorDeepBlue', value: '#2E75B6' },
    { key: 'colorDarkRed', value: '#CC4125' },
    { key: 'colorOlive', value: '#806000' },
    { key: 'colorForest', value: '#375623' },
  ],
  [
    { key: 'colorCharcoal', value: '#808080' },
    { key: 'colorNavy', value: '#1F4E79' },
    { key: 'colorCrimson', value: '#993300' },
    { key: 'colorDarkOlive', value: '#5C4500' },
    { key: 'colorDeepForest', value: '#2D6A4F' },
  ],
  [
    { key: 'colorSlate', value: '#595959' },
    { key: 'colorMidnight', value: '#17375E' },
    { key: 'colorMaroon', value: '#5A1E00' },
    { key: 'colorCoffee', value: '#3D3000' },
    { key: 'colorEvergreen', value: '#1B4332' },
  ],
  [
    { key: 'colorDarkSlate', value: '#404040' },
    { key: 'colorDarkNavy', value: '#0C2340' },
    { key: 'colorDarkMaroon', value: '#2E0A00' },
    { key: 'colorDarkCoffee', value: '#1F1800' },
    { key: 'colorInkGreen', value: '#081C15' },
  ],
];

const groups = computed(() =>
  props.colorKey === 'fill' ? FILL_COLOR_GROUPS : COLOR_GROUPS
);

function labelOf(key: string): string {
  return t(props.locale, key);
}

function isSelected(value: string): boolean {
  const cur = props.currentColor;
  if (!cur && !value) return true;
  if (!cur) return false;
  return cur.toLowerCase() === value.toLowerCase();
}

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);

watch(() => props.modelOpen, (v) => {
  if (v !== undefined && v !== open.value) {
    if (v) openMenu(); else close();
  }
});

function onClickOutside(e: MouseEvent) {
  const el = rootRef.value;
  if (el && !el.contains(e.target as Node)) {
    close();
  }
}

function openMenu() {
  open.value = true;
  if (props.modelOpen !== undefined) emit('update:modelOpen', true);
  nextTick(() => {
    document.addEventListener('mousedown', onClickOutside);
  });
}

function close() {
  open.value = false;
  if (props.modelOpen !== undefined) emit('update:modelOpen', false);
  document.removeEventListener('mousedown', onClickOutside);
}

function selectColor(v: string) {
  emit('update:modelValue', v);
  emit('change', v);
  close();
}

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onClickOutside);
});

defineExpose({ open, openMenu, close });
</script>

<template>
  <div ref="rootRef" class="color-picker">
    <Transition name="menu-pop">
    <div
      v-if="open"
      ref="menuRef"
      class="color-picker__menu"
      @mousedown.stop
    >
      <div
        v-for="(row, ri) in groups"
        :key="ri"
        class="color-picker__row"
      >
        <button
          v-for="c in row"
          :key="c.value"
          class="color-picker__swatch"
          :class="{ 'color-picker__swatch--selected': isSelected(c.value) }"
          :title="labelOf(c.key)"
          :style="{
            background: c.value || 'transparent',
            border: !c.value ? '1px dashed #999' : '1px solid rgba(0,0,0,0.15)',
          }"
          @click="selectColor(c.value)"
        />
      </div>
    </div>
    </Transition>
  </div>
</template>

<style scoped>
.color-picker { position: relative; display: inline-flex; height: 26px; }
.color-picker__menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 9999;
  background: #fff;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  padding: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  user-select: none;
  transform-origin: top right;
}
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }
.color-picker__row {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}
.color-picker__row:last-child { margin-bottom: 0; }
.color-picker__swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.08s, box-shadow 0.08s;
  position: relative;
}
.color-picker__swatch:hover {
  transform: scale(1.18);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.2);
  z-index: 1;
}
.color-picker__swatch--selected {
  box-shadow: 0 0 0 2px #0078d7;
}
</style>
