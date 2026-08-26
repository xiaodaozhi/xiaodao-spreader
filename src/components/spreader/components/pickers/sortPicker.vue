<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { t } from '../../core/constants';
import type { SortOrder } from '../../core/sort-core';

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
  currentSort?: SortOrder;
  triggerEl?: HTMLElement | null;
}>(), {
  modelOpen: undefined,
  locale: 'zh-CN',
  currentSort: 'asc',
  triggerEl: null,
});

const emit = defineEmits<{
  (e: 'update:modelOpen', v: boolean): void;
  (e: 'change', v: SortOrder): void;
}>();

const SORT_OPTIONS: { key: SortOrder; i18nKey: string }[] = [
  { key: 'asc', i18nKey: 'sortAsc' },
  { key: 'desc', i18nKey: 'sortDesc' },
];

// 排序图标（与 toolbar 触发按钮保持一致）：左侧三条渐宽横线 + 右侧方向箭头
interface SortBar { name: string; x1: number; y1: number; x2: number; y2: number }
const SORT_BARS: SortBar[] = [
  { name: 'bar1', x1: 96, y1: 224, x2: 352, y2: 224 },
  { name: 'bar2', x1: 96, y1: 512, x2: 512, y2: 512 },
  { name: 'bar3', x1: 96, y1: 800, x2: 672, y2: 800 },
];
const SORT_ARROW_PATHS: Record<SortOrder, string> = {
  // 升序：箭头向上
  asc: 'M832 800V288M672 448l160-160 160 160',
  // 降序：箭头向下
  desc: 'M832 224v512M672 576l160 160 160-160',
};

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const pos = ref<{ left?: number; right?: number; top: number }>({ top: 0 });

watch(() => props.modelOpen, (v) => {
  if (v !== undefined && v !== open.value) {
    if (v) {
      openMenu();
    } else {
      close();
    }
  }
});

function onClickOutside(e: PointerEvent) {
  const el = rootRef.value;
  const mEl = menuRef.value;
  const t = e.target as Node;
  if (el && el.contains(t)) return;
  if (mEl && mEl.contains(t)) return;
  close();
}

function openMenu() {
  open.value = true;
  if (props.modelOpen !== undefined) emit('update:modelOpen', true);
  nextTick(() => {
    const el = props.triggerEl ?? rootRef.value;
    if (el) {
      const r = el.getBoundingClientRect();
      const menuH = 84;
      const estMenuW = 160;
      let right: number | undefined = window.innerWidth - r.right;
      let top = r.bottom + 4;
      let posLeft: number | undefined;
      if (r.left - estMenuW < 4) {
        right = undefined;
        posLeft = Math.max(4, r.left);
      }
      if (top + menuH > window.innerHeight - 4) top = r.top - menuH - 4;
      if (top < 4) top = 4;
      pos.value = right !== undefined ? { right, top } : { left: posLeft!, top };
    }
    document.addEventListener('pointerdown', onClickOutside);
  });
}

function close() {
  open.value = false;
  if (props.modelOpen !== undefined) emit('update:modelOpen', false);
  document.removeEventListener('pointerdown', onClickOutside);
}

function selectSort(v: SortOrder) {
  emit('change', v);
  close();
}

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onClickOutside);
});

defineExpose({ open, openMenu, close });
</script>

<template>
  <div
    ref="rootRef"
    class="sort-picker"
  >
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="open"
          ref="menuRef"
          class="sort-picker__menu"
          :style="{ left: pos.left !== undefined ? pos.left + 'px' : undefined, right: pos.right !== undefined ? pos.right + 'px' : undefined, top: pos.top + 'px' }"
          @mousedown.stop.prevent
        >
          <button
            v-for="opt in SORT_OPTIONS"
            :key="opt.key"
            class="sort-picker__item"
            :title="t(locale, opt.i18nKey)"
            @click="selectSort(opt.key)"
          >
            <svg
              viewBox="0 0 1024 1024"
              class="sort-picker__icon"
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
              <path :d="SORT_ARROW_PATHS[opt.key]" />
            </svg>
            <span class="sort-picker__label">{{ t(locale, opt.i18nKey) }}</span>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.sort-picker { position: relative; display: inline-flex; height: 26px; }
.sort-picker__menu {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  user-select: none;
  padding: 4px;
  transform-origin: top right;
}
.sort-picker__item {
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
.sort-picker__item:hover { background: #eef3f9; }
.sort-picker__icon { width: 18px; height: 18px; flex-shrink: 0; }
.sort-picker__label { overflow: hidden; text-overflow: ellipsis; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }
</style>
