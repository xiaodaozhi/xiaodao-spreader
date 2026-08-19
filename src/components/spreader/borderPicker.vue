<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { t } from './constants';

export type BorderType = 'none' | 'bottom' | 'top' | 'left' | 'right' | 'all' | 'outer' | 'thickOuter';

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
  currentBorder?: BorderType;
}>(), {
  modelOpen: undefined,
  locale: 'zh-CN',
  currentBorder: 'none',
});

const emit = defineEmits<{
  (e: 'update:modelOpen', v: boolean): void;
  (e: 'change', v: BorderType): void;
}>();

const BORDER_OPTIONS: { key: BorderType; i18nKey: string }[] = [
  { key: 'bottom', i18nKey: 'borderBottom' },
  { key: 'top', i18nKey: 'borderTop' },
  { key: 'left', i18nKey: 'borderLeft' },
  { key: 'right', i18nKey: 'borderRight' },
  { key: 'none', i18nKey: 'borderNone' },
  { key: 'all', i18nKey: 'borderAll' },
  { key: 'outer', i18nKey: 'borderOuter' },
  { key: 'thickOuter', i18nKey: 'borderThickOuter' },
];

// 田字型边框图标：4 个外边 + 1 条竖中线 + 1 条横中线
interface BorderSeg { name: string; x1: number; y1: number; x2: number; y2: number; }
const BORDER_SEGS: BorderSeg[] = [
  { name: 'top', x1: 4, y1: 4, x2: 26, y2: 4 },
  { name: 'bottom', x1: 4, y1: 26, x2: 26, y2: 26 },
  { name: 'left', x1: 4, y1: 4, x2: 4, y2: 26 },
  { name: 'right', x1: 26, y1: 4, x2: 26, y2: 26 },
  { name: 'vMid', x1: 15, y1: 4, x2: 15, y2: 26 },
  { name: 'hMid', x1: 4, y1: 15, x2: 26, y2: 15 },
];
// 各边框类型对应的实线段；粗外框线对应粗实线段；未列出者为虚线
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

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);

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

function selectBorder(v: BorderType) {
  emit('change', v);
  close();
}

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onClickOutside);
});

defineExpose({ open, openMenu, close });
</script>

<template>
  <div ref="rootRef" class="border-picker">
    <Transition name="menu-pop">
      <div
        v-if="open"
        class="border-picker__menu"
        @mousedown.stop
      >
        <button
          v-for="opt in BORDER_OPTIONS"
          :key="opt.key"
          class="border-picker__item"
          :title="t(locale, opt.i18nKey)"
          @click="selectBorder(opt.key)"
        >
          <svg viewBox="0 0 30 30" class="border-picker__icon">
            <line
              v-for="s in BORDER_SEGS"
              :key="s.name"
              :x1="s.x1" :y1="s.y1" :x2="s.x2" :y2="s.y2"
              stroke="currentColor"
              :stroke-width="segRole(opt.key, s.name) === 'thick' ? 3 : 1.5"
              :stroke-dasharray="segRole(opt.key, s.name) === 'dashed' ? '0 4' : 'none'"
              :stroke-linecap="segRole(opt.key, s.name) === 'dashed' ? 'round' : 'square'"
            />
          </svg>
          <span class="border-picker__label">{{ t(locale, opt.i18nKey) }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.border-picker { position: relative; display: inline-flex; height: 26px; }
.border-picker__menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 9999;
  background: #fff;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  user-select: none;
  padding: 4px;
  transform-origin: top right;
}
.border-picker__item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #444);
  cursor: pointer;
  border-radius: 3px;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  white-space: nowrap;
}
.border-picker__item:hover { background: #eef3f9; }
.border-picker__icon { width: 18px; height: 18px; flex-shrink: 0; }
.border-picker__label { overflow: hidden; text-overflow: ellipsis; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }
</style>