<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { t } from '../../core/constants';

export type CalcType = 'sum' | 'avg' | 'count';

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
  triggerEl?: HTMLElement | null;
  disabled?: boolean;
}>(), {
  modelOpen: undefined,
  locale: 'zh-CN',
  triggerEl: null,
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:modelOpen', v: boolean): void;
  (e: 'change', v: CalcType): void;
}>();

const CALC_OPTIONS: { key: CalcType; labelKey: string }[] = [
  { key: 'sum', labelKey: 'sum' },
  { key: 'avg', labelKey: 'avg' },
  { key: 'count', labelKey: 'count' },
];

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
  if (props.modelOpen !== undefined) {
    emit('update:modelOpen', true);
  }
  nextTick(() => {
    const el = props.triggerEl ?? rootRef.value;
    if (el) {
      const r = el.getBoundingClientRect();
      const menuH = CALC_OPTIONS.length * 30 + 12;
      const estMenuW = 160;
      let right: number | undefined = window.innerWidth - r.right;
      let top = r.bottom + 4;
      let posLeft: number | undefined;
      if (r.left - estMenuW < 4) {
        right = undefined;
        posLeft = Math.max(4, r.left);
      }
      if (top + menuH > window.innerHeight - 4) {
        top = r.top - menuH - 4;
      }
      if (top < 4) {
        top = 4;
      }
      pos.value = right !== undefined ? { right, top } : { left: posLeft!, top };
    }
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

function select(v: CalcType) {
  if (props.disabled) return;
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
    class="calc-picker"
  >
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="open"
          ref="menuRef"
          class="calc-picker__menu"
          :style="{
            left: pos.left !== undefined ? pos.left + 'px' : undefined,
            right: pos.right !== undefined ? pos.right + 'px' : undefined,
            top: pos.top + 'px',
          }"
          @mousedown.stop
        >
          <button
            v-for="opt in CALC_OPTIONS"
            :key="opt.key"
            class="calc-picker__item"
            :class="{ 'calc-picker__item--disabled': disabled }"
            :disabled="disabled"
            :title="t(locale, opt.labelKey)"
            @click="select(opt.key)"
          >
            <span class="calc-picker__label">{{ t(locale, opt.labelKey) }}</span>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.calc-picker { position: relative; display: inline-flex; height: 26px; }
.calc-picker__menu {
  position: fixed;
  z-index: 9999;
  min-width: 120px;
  background: #fff;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  user-select: none;
  padding: 4px;
  transform-origin: top right;
}
.calc-picker__item {
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
.calc-picker__item:hover:not(.calc-picker__item--disabled) { background: #eef3f9; }
.calc-picker__item--disabled { color: var(--sp-toolbar-btn-disabled-color, #bbb); cursor: default; }
.calc-picker__label { overflow: hidden; text-overflow: ellipsis; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }
</style>
