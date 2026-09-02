<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { t } from '../../core/constants';
import { useFloatMenuPosition } from '../../composables/useFloatMenuPosition';
import {
  BORDER_OPTIONS,
  BORDER_SEGS,
  segRole,
  needsCornerDot,
  CORNER_DOT_R,
  CORNER_DOT_CX,
  CORNER_DOT_CY,
} from '../../core/border-icon';

// 类型与图标定义已收敛到 core/border-icon.ts（toolbar 主按钮共用同一份），
// 此处 re-export 仅为兼容既有的 `from './pickers/border-picker.vue'` 导入
export type { BorderType } from '../../core/border-icon';
import type { BorderType } from '../../core/border-icon';

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
  currentBorder?: BorderType;
  triggerEl?: HTMLElement | null;
  /** 边界基准元素（通常是表格容器 wrapper）：菜单不得越出其可视区，见 getFloatBounds */
  boundaryEl?: HTMLElement | null;
}>(), {
  modelOpen: undefined,
  locale: 'zh-CN',
  currentBorder: 'none',
  triggerEl: null,
  boundaryEl: null,
});

const emit = defineEmits<{
  (e: 'update:modelOpen', v: boolean): void;
  (e: 'change', v: BorderType): void;
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

function selectBorder(v: BorderType) {
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
    class="border-picker"
  >
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="open"
          ref="menuRef"
          class="border-picker__menu"
          :style="{ left: pos.left !== undefined ? pos.left + 'px' : undefined, right: pos.right !== undefined ? pos.right + 'px' : undefined, top: pos.top + 'px' }"
          @mousedown.stop.prevent
        >
          <button
            v-for="opt in BORDER_OPTIONS"
            :key="opt.key"
            class="border-picker__item"
            :title="t(locale, opt.i18nKey)"
            @click="selectBorder(opt.key)"
          >
            <svg
              viewBox="0 0 30 30"
              class="border-picker__icon"
            >
              <line
                v-for="s in BORDER_SEGS"
                :key="s.name"
                :x1="s.x1"
                :y1="s.y1"
                :x2="s.x2"
                :y2="s.y2"
                stroke="currentColor"
                :stroke-width="segRole(opt.key, s.name) === 'thick' ? 3 : 1.5"
                :stroke-dasharray="segRole(opt.key, s.name) === 'dashed' ? '0 4' : 'none'"
                :stroke-linecap="segRole(opt.key, s.name) === 'dashed' ? 'round' : 'square'"
              />
              <circle
                v-if="needsCornerDot(opt.key)"
                :cx="CORNER_DOT_CX"
                :cy="CORNER_DOT_CY"
                :r="CORNER_DOT_R"
                fill="currentColor"
              />
            </svg>
            <span class="border-picker__label">{{ t(locale, opt.i18nKey) }}</span>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.border-picker { position: relative; display: inline-flex; height: 26px; }
.border-picker__menu {
  position: fixed;
  z-index: 40000;
  background: #fff;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  user-select: none;
  padding: 4px;
  transform-origin: top center;
}
.border-picker__item {
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
.border-picker__item:hover { background: #eef3f9; }
.border-picker__icon { width: 18px; height: 18px; flex-shrink: 0; }
.border-picker__label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scaleY(0.85); }
</style>
