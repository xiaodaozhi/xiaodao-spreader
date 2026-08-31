<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { t, MERGE_OPTIONS, type MergeType } from '../../core/constants';

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
  triggerEl?: HTMLElement | null;
}>(), {
  modelOpen: undefined,
  locale: 'zh-CN',
  triggerEl: null,
});

const emit = defineEmits<{
  (e: 'update:modelOpen', v: boolean): void;
  (e: 'change', v: MergeType): void;
}>();

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
  const el = props.triggerEl ?? rootRef.value;
  if (!el) return;
  open.value = true;
  if (props.modelOpen !== undefined) emit('update:modelOpen', true);
  const r = el.getBoundingClientRect();
  let right: number | undefined = window.innerWidth - r.right;
  const estMenuW = 160;
  let posLeft: number | undefined;
  if (r.left - estMenuW < 4) {
    right = undefined;
    posLeft = Math.max(4, r.left);
  }
  pos.value = right !== undefined
    ? { right, top: r.bottom + 4 }
    : { left: posLeft!, top: r.bottom + 4 };
  nextTick(() => {
    const el2 = props.triggerEl ?? rootRef.value;
    if (!el2) return;
    const r2 = el2.getBoundingClientRect();
    const menuEl = menuRef.value;
    if (!menuEl) return;
    const h = menuEl.offsetHeight;
    const spaceBelow = window.innerHeight - r2.bottom - 8;
    const spaceAbove = r2.top - 8;
    const up = spaceBelow < h && spaceAbove > 0;
    let top = up ? r2.top - h - 4 : r2.bottom + 4;
    top = Math.max(4, Math.min(window.innerHeight - h - 4, top));
    pos.value = right !== undefined
      ? { right: window.innerWidth - r2.right, top }
      : { left: posLeft!, top };
    document.addEventListener('pointerdown', onClickOutside);
  });
}

function close() {
  open.value = false;
  if (props.modelOpen !== undefined) {
    emit('update:modelOpen', false);
  }
  document.removeEventListener('pointerdown', onClickOutside);
}

function selectMerge(v: MergeType) {
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
    class="merge-picker"
  >
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="open"
          ref="menuRef"
          class="merge-picker__menu"
          :style="{
            left: pos.left !== undefined ? pos.left + 'px' : undefined,
            right: pos.right !== undefined ? pos.right + 'px' : undefined,
            top: pos.top + 'px',
          }"
          @mousedown.stop.prevent
        >
          <button
            v-for="opt in MERGE_OPTIONS"
            :key="opt.key"
            class="merge-picker__item"
            :title="t(locale, opt.labelKey)"
            @click="selectMerge(opt.key)"
          >
            <!-- eslint-disable vue/no-v-html -->
            <span
              class="merge-picker__icon"
              v-html="opt.icon"
            />
            <!-- eslint-enable vue/no-v-html -->
            <span class="merge-picker__label">{{ t(locale, opt.labelKey) }}</span>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.merge-picker { position: relative; display: inline-flex; height: 26px; }
.merge-picker__menu {
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
.merge-picker__item {
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
.merge-picker__item:hover { background: #eef3f9; }
.merge-picker__icon { width: 18px; height: 18px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.merge-picker__icon :deep(svg) { width: 18px; height: 18px; }
.merge-picker__label { overflow: hidden; text-overflow: ellipsis; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }
</style>
