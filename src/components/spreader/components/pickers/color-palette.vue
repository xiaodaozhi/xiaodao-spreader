<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../core/constants';

interface ColorOption {
  key: string;
  value: string;
}

const props = withDefaults(defineProps<{
  /** 'text' | 'border' 用文字色板（首项为「自动」）；'fill' 用填充色板（首项为「无填充」） */
  colorKey?: string;
  /** 当前选中色；'' 表示自动 / 无填充 */
  currentColor?: string;
  locale?: string;
}>(), {
  colorKey: 'text',
  currentColor: '',
  locale: 'zh-CN',
});

const emit = defineEmits<{
  (e: 'pick', v: string): void;
}>();

// 文字 / 边框色板（首项为「自动」）。与 color-picker.vue 同源，避免两处各抄一份。
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

// 填充色板（首项为「无填充」）。
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
  props.colorKey === 'fill' ? FILL_COLOR_GROUPS : COLOR_GROUPS,
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

function onPick(v: string) {
  emit('pick', v);
}
</script>

<template>
  <div class="color-palette">
    <div
      v-for="(row, ri) in groups"
      :key="ri"
      class="color-palette__row"
    >
      <button
        v-for="c in row"
        :key="c.value"
        type="button"
        class="color-palette__swatch"
        :class="{
          'color-palette__swatch--selected': isSelected(c.value),
          'color-palette__swatch--none': !c.value,
        }"
        :title="labelOf(c.key)"
        :style="c.value ? { background: c.value, border: '1px solid rgba(0,0,0,0.15)' } : undefined"
        @click="onPick(c.value)"
      />
    </div>
  </div>
</template>

<style scoped>
.color-palette { display: flex; flex-direction: column; }
.color-palette__row {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}
.color-palette__row:last-child { margin-bottom: 0; }
.color-palette__swatch {
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
.color-palette__swatch:hover {
  transform: scale(1.18);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.2);
  z-index: 1;
}
.color-palette__swatch--selected {
  box-shadow: 0 0 0 2px #0078d7;
}
/* 「自动 / 无填充」首项：透明背景 + 虚线圆，去掉填充色；虚线边框随主题（dark 下更亮） */
.color-palette__swatch--none {
  background: transparent;
  border: 1px dashed var(--sp-toolbar-text-muted, #999);
}
</style>
