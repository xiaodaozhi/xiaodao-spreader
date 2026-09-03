<script setup lang="ts">
/**
 * 数据验证下拉列表弹窗（List Validation）。
 * - 搜索：实时过滤，不做任何 DOM 全量创建
 * - 虚拟列表：固定行高 + 窗口渲染，数千项也不会产生等量 DOM
 * - 键盘：↑ ↓ / Home / End / PageUp / PageDown / Enter / Escape
 * 定位完全由调用方传入的单元格屏幕矩形（cellToScreenRect）决定，自动兼容冻结窗格与合并单元格。
 */
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch, inject } from 'vue';
import { t } from '../../core/constants';
import { getFloatBounds } from '../../core/utils';

// 主题作用域：浮层经 Teleport 脱离组件 DOM 树，无法继承组件根上的 --sp-* 变量，
// 故在此 inject spreader 下发的主题，并在浮层根挂载作用域类，使 dark 变量仅本组件内生效，
// 而不依赖 <html> 全局类（以免污染调用方项目的主题）。
const spTheme = inject('sp-theme', 'light') as string;

const props = withDefaults(defineProps<{
  items?: string[];
  /** 当前单元格原始值（用于标记已选项） */
  current?: string;
  locale?: string;
  /** 锚点单元格在视口中的位置与尺寸（client 坐标） */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** 边界基准元素（通常是表格容器 wrapper）：下拉不得越出其可视区，见 getFloatBounds */
  boundaryEl?: HTMLElement | null;
}>(), {
  items: () => [],
  current: '',
  locale: 'zh-CN',
  x: 0,
  y: 0,
  width: 100,
  height: 24,
});

const emit = defineEmits<{
  (e: 'select', value: string): void;
  (e: 'close'): void;
}>();

const ROW_H = 24;
const MAX_H = 244;
const MIN_W = 140;

const query = ref('');
const activeIdx = ref(0);
const scrollTop = ref(0);
const searchRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLDivElement | null>(null);
const rootRef = ref<HTMLDivElement | null>(null);
const pos = ref<{ left: number; top: number; up: boolean }>({ left: props.x, top: props.y + props.height + 2, up: false });

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.items;
  return props.items.filter((it) => String(it ?? '').toLowerCase().includes(q));
});

const viewH = computed(() => Math.min(MAX_H, Math.max(ROW_H, filtered.value.length * ROW_H)));
const menuW = computed(() => Math.max(MIN_W, Math.min(360, props.width)));

/** 窗口渲染：只创建可见区间 + 少量缓冲的 DOM */
const startIdx = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - 1));
const endIdx = computed(() => Math.min(
  filtered.value.length,
  Math.ceil((scrollTop.value + viewH.value) / ROW_H) + 1,
));
const visible = computed(() => filtered.value.slice(startIdx.value, endIdx.value));
const padTop = computed(() => startIdx.value * ROW_H);
const padBottom = computed(() => Math.max(0, (filtered.value.length - endIdx.value) * ROW_H));

function isChecked(item: string): boolean {
  return String(item ?? '').trim().toLowerCase() === String(props.current ?? '').trim().toLowerCase();
}

/** 定位：优先向下弹，空间不足时向上；最后贴边界兜底 */
function layout() {
  const h = viewH.value + (searchWrapHeight());
  const b = getFloatBounds(props.boundaryEl);
  const spaceBelow = b.bottom - (props.y + props.height) - 8;
  const spaceAbove = props.y - b.top - 8;
  const up = spaceBelow < h && spaceAbove > spaceBelow;
  let top = up ? props.y - h - 2 : props.y + props.height + 2;
  top = Math.max(b.top + 8, Math.min(b.bottom - h - 8, top));
  const left = Math.max(b.left + 8, Math.min(b.right - menuW.value - 8, props.x));
  pos.value = { left, top, up };
}

function searchWrapHeight(): number {
  // 搜索框（含内边距与分隔线）固定高度；仅在候选较多时显示
  return filtered.value.length > 8 || query.value ? 34 : 0;
}

watch(() => [props.x, props.y, props.width, props.height], () => layout());

onMounted(() => {
  nextTick(() => {
    layout();
    // 候选项较少时不渲染搜索框，需让容器自身获得焦点以接收键盘导航
    if (searchRef.value) searchRef.value.focus();
    else rootRef.value?.focus();
  });
  document.addEventListener('pointerdown', onDocDown, true);
  window.addEventListener('resize', onClose);
  window.addEventListener('scroll', onClose, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown, true);
  window.removeEventListener('resize', onClose);
  window.removeEventListener('scroll', onClose, true);
});

function onDocDown(e: PointerEvent) {
  if (rootRef.value?.contains(e.target as Node)) return;
  onClose();
}

function onClose() {
  emit('close');
}

function ensureVisible(idx: number) {
  const el = listRef.value;
  if (!el) return;
  const top = idx * ROW_H;
  const bottom = top + ROW_H;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (bottom > el.scrollTop + viewH.value) el.scrollTop = bottom - viewH.value;
}

function move(delta: number) {
  const len = filtered.value.length;
  if (len === 0) return;
  activeIdx.value = (activeIdx.value + delta + len) % len;
  ensureVisible(activeIdx.value);
}

function commit(idx: number) {
  const item = filtered.value[idx];
  if (item === undefined) return;
  emit('select', item);
}

function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLDivElement).scrollTop;
}

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      e.stopPropagation();
      move(1);
      return;
    case 'ArrowUp':
      e.preventDefault();
      e.stopPropagation();
      move(-1);
      return;
    case 'Home':
      e.preventDefault();
      e.stopPropagation();
      activeIdx.value = 0;
      scrollTop.value = 0;
      if (listRef.value) listRef.value.scrollTop = 0;
      return;
    case 'End': {
      e.preventDefault();
      e.stopPropagation();
      const len = filtered.value.length;
      activeIdx.value = Math.max(0, len - 1);
      ensureVisible(activeIdx.value);
      return;
    }
    case 'PageDown':
      e.preventDefault();
      e.stopPropagation();
      move(Math.max(1, Math.floor(viewH.value / ROW_H)));
      return;
    case 'PageUp':
      e.preventDefault();
      e.stopPropagation();
      move(-Math.max(1, Math.floor(viewH.value / ROW_H)));
      return;
    case 'Enter':
      e.preventDefault();
      e.stopPropagation();
      commit(activeIdx.value);
      return;
    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    case 'Tab':
      e.preventDefault();
      e.stopPropagation();
      commit(activeIdx.value);
      return;
  }
}

watch(query, () => {
  activeIdx.value = 0;
  scrollTop.value = 0;
  if (listRef.value) listRef.value.scrollTop = 0;
  nextTick(layout);
});

/** 初始 activeIdx 定位到当前值所在项 */
watch(filtered, (list) => {
  const idx = list.findIndex((it) => isChecked(it));
  if (idx >= 0) {
    activeIdx.value = idx;
    nextTick(() => ensureVisible(idx));
  }
}, { immediate: true });
</script>

<template>
  <div
    ref="rootRef"
    class="dvd sp-spreader-overlay"
    tabindex="-1"
    :style="{ left: pos.left + 'px', top: pos.top + 'px', width: menuW + 'px' }"
    :class="{ dark: spTheme === 'dark' }"
    @keydown="onKeydown"
    @wheel.stop
  >
    <div
      v-if="searchWrapHeight() > 0"
      class="dvd__search"
    >
      <input
        ref="searchRef"
        v-model="query"
        class="dvd__search-input"
        type="text"
        spellcheck="false"
        :placeholder="t(locale, 'dvSearchPlaceholder')"
        @keydown="onKeydown"
      >
    </div>
    <div
      ref="listRef"
      class="dvd__list"
      :style="{ height: viewH + 'px' }"
      @scroll="onScroll"
    >
      <div :style="{ height: padTop + 'px' }" />
      <div
        v-for="(item, i) in visible"
        :key="startIdx + i"
        class="dvd__item"
        :class="{
          'dvd__item--active': startIdx + i === activeIdx,
          'dvd__item--checked': isChecked(item),
        }"
        :style="{ height: ROW_H + 'px', lineHeight: ROW_H + 'px' }"
        @mousedown.prevent
        @mouseenter="activeIdx = startIdx + i"
        @click="commit(startIdx + i)"
      >
        <span class="dvd__check">{{ isChecked(item) ? '✓' : '' }}</span>
        <span class="dvd__label">{{ item === '' ? t(locale, 'emptyCellLabel') : item }}</span>
      </div>
      <div :style="{ height: padBottom + 'px' }" />
    </div>
    <div
      v-if="filtered.length === 0"
      class="dvd__empty"
    >
      {{ t(locale, 'dvNoMatch') }}
    </div>
  </div>
</template>

<style scoped>
.dvd {
  position: fixed;
  z-index: 10004;
  box-sizing: border-box;
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border, #ccc);
  border-radius: 3px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  color: var(--sp-toolbar-btn-color, #333);
  overflow: hidden;
  user-select: none;
}
.dvd__search {
  height: 33px;
  padding: 4px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--sp-toolbar-border, #e6e6e6);
}
.dvd__search-input {
  width: 100%;
  height: 24px;
  box-sizing: border-box;
  border: 1px solid var(--sp-toolbar-border, #c8c8c8);
  border-radius: 2px;
  outline: none;
  padding: 0 6px;
  font-size: 13px;
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  background: var(--sp-formula-bar-input-bg, #fff);
}
.dvd__search-input:focus {
  border-color: #0078d7;
  box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3);
}
.dvd__list {
  overflow-y: auto;
  overflow-x: hidden;
}
.dvd__item {
  display: flex;
  align-items: center;
  padding: 0 6px;
  box-sizing: border-box;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.dvd__item--active {
  background: var(--sp-toolbar-item-active-bg, #e8f0fe);
}
.dvd__item--checked {
  font-weight: 600;
}
.dvd__check {
  width: 14px;
  flex: none;
  color: var(--sp-toolbar-btn-active-color, #0078d7);
  font-size: 12px;
}
.dvd__label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dvd__empty {
  padding: 8px 10px;
  color: var(--sp-toolbar-text-muted, #999);
  font-size: 12px;
  text-align: center;
}
</style>
