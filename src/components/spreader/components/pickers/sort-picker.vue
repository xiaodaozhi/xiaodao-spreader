<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { t } from '../../core/constants';
import { useFloatMenuPosition } from '../../composables/float-menu-position';
import type { SortOrder } from '../../core/sort-core';
import { SORT_OPTIONS, SORT_BARS, SORT_ARROW_PATHS } from '../../core/sort-icon';

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
  currentSort?: SortOrder;
  triggerEl?: HTMLElement | null;
  /** 边界基准元素（通常是表格容器 wrapper）：菜单不得越出其可视区，见 getFloatBounds */
  boundaryEl?: HTMLElement | null;
}>(), {
  modelOpen: undefined,
  locale: 'zh-CN',
  currentSort: 'asc',
  triggerEl: null,
  boundaryEl: null,
});

const emit = defineEmits<{
  (e: 'update:modelOpen', v: boolean): void;
  (e: 'change', v: SortOrder): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
// 复用与条件格式下拉框同一套定位逻辑（useFloatMenuPosition），不再单独写一套
const { pos, place } = useFloatMenuPosition();

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
  const el = props.triggerEl ?? rootRef.value;
  if (!el) return;
  open.value = true;
  if (props.modelOpen !== undefined) emit('update:modelOpen', true);
  // 与条件格式下拉框同构：初始下落放置 → nextTick 量高后上下翻向夹紧
  place(el, props.boundaryEl);
  nextTick(() => {
    const el2 = props.triggerEl ?? rootRef.value;
    if (!el2) return;
    const menuEl = menuRef.value;
    if (!menuEl) return;
    place(el2, props.boundaryEl, menuEl);
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
  z-index: 40000;
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  user-select: none;
  padding: 4px;
  transform-origin: top center;
}
.sort-picker__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #444);
  cursor: pointer;
  border-radius: 3px;
  font-size: 12px;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  white-space: nowrap;
  box-sizing: border-box;
}
.sort-picker__item:hover { background: var(--sp-toolbar-btn-hover-bg, #eef3f9); }
.sort-picker__icon { width: 18px; height: 18px; flex-shrink: 0; }
.sort-picker__label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scaleY(0.85); }
</style>
