<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { useFloatMenuPosition } from '../../composables/float-menu-position';
import ColorPalette from './color-palette.vue';

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  colorKey?: string;
  currentColor?: string;
  locale?: string;
  triggerEl?: HTMLElement | null;
  /** 边界基准元素（通常是表格容器 wrapper）：菜单不得越出其可视区，见 getFloatBounds */
  boundaryEl?: HTMLElement | null;
}>(), {
  modelOpen: undefined,
  colorKey: 'text',
  currentColor: '',
  locale: 'zh-CN',
  triggerEl: null,
  boundaryEl: null,
});

const emit = defineEmits<{
  (e: 'update:modelValue' | 'change', v: string): void;
  (e: 'update:modelOpen', v: boolean): void;
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

function selectColor(v: string) {
  emit('update:modelValue', v);
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
    class="color-picker"
  >
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="open"
          ref="menuRef"
          class="color-picker__menu"
          :style="{
            left: pos.left !== undefined ? pos.left + 'px' : undefined,
            right: pos.right !== undefined ? pos.right + 'px' : undefined,
            top: pos.top + 'px',
          }"
          @mousedown.stop.prevent
        >
          <ColorPalette
            :color-key="props.colorKey"
            :current-color="props.currentColor"
            :locale="props.locale"
            @pick="selectColor"
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.color-picker { position: relative; display: inline-flex; height: 26px; }
.color-picker__menu {
  position: fixed;
  z-index: 40000;
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  padding: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  user-select: none;
  transform-origin: top center;
}
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }
</style>
