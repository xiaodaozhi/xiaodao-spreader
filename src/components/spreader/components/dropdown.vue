<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { FontOption } from '../core/constants';

const props = withDefaults(defineProps<{
  modelValue: string | number;
  options: FontOption[];
  width?: string | number;
  menuWidth?: string | number;
  visibleCount?: number;
  title?: string;
  modelOpen?: boolean;
  hideTrigger?: boolean;
  align?: 'left' | 'right';
  triggerEl?: HTMLElement | null;
}>(), {
  width: 'auto',
  menuWidth: undefined,
  visibleCount: 8,
  title: '',
  modelOpen: undefined,
  hideTrigger: false,
  align: 'left',
  triggerEl: null,
});

const emit = defineEmits<{
  (e: 'update:modelValue' | 'change', v: string | number): void;
  (e: 'update:modelOpen', v: boolean): void;
}>();

const open = ref(false);
const viewStart = ref(0);
const rootRef = ref<HTMLDivElement | null>(null);
const listRef = ref<HTMLDivElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const pos = ref<{ left?: number; right?: number; top: number; up: boolean }>({ top: 0, up: false });
const tY = ref(0);
const tDrag = ref(false);

const current = computed(() => props.options.find((o) => String(o.value) === String(props.modelValue)));
const effMenuWidth = computed(() => props.menuWidth);
const vc = computed(() => Math.min(props.visibleCount, props.options.length));
const list = computed(() => props.options.slice(viewStart.value, viewStart.value + vc.value));
const canUp = computed(() => viewStart.value > 0);
const canDown = computed(() => viewStart.value + vc.value < props.options.length);
const scrollable = computed(() => props.options.length > vc.value);

function scrollBy(d: number) {
  viewStart.value = Math.max(0, Math.min(props.options.length - vc.value, viewStart.value + d));
}

function openMenu() {
  open.value = true;
  if (props.modelOpen !== undefined) {
    emit('update:modelOpen', true);
  }
  const el = props.triggerEl ?? rootRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const menuH = vc.value * 22 + (scrollable.value ? 2 * 15 : 0) + 8;
  const spaceBelow = window.innerHeight - r.bottom - 4;
  const up = spaceBelow < menuH && r.top - 4 > menuH;
  if (props.align === 'right') {
    pos.value = {
      right: window.innerWidth - r.right,
      top: up ? r.top - menuH - 4 : r.bottom + 4,
      up,
    };
  } else {
    pos.value = {
      left: r.left,
      top: up ? r.top - menuH - 4 : r.bottom + 4,
      up,
    };
  }
  const idx = props.options.findIndex((o) => String(o.value) === String(props.modelValue));
  viewStart.value = idx >= 0
    ? Math.max(0, Math.min(idx - Math.floor(vc.value / 2), props.options.length - vc.value))
    : 0;
}

function close() {
  open.value = false;
  if (props.modelOpen !== undefined) {
    emit('update:modelOpen', false);
  }
}

function toggle() {
  if (open.value) {
    close();
  } else {
    openMenu();
  }
}

function select(o: FontOption) {
  emit('update:modelValue', o.value);
  emit('change', o.value);
  close();
}

function onDocDown(e: MouseEvent) {
  if (!open.value) return;
  const t = e.target as Node;
  // 菜单通过 Teleport 渲染到 body，需同时排除菜单内部点击，否则 mousedown 阶段会提前关闭菜单导致 click 丢失
  if (rootRef.value?.contains(t) || menuRef.value?.contains(t)) return;
  close();
}

function onWheel(e: WheelEvent) {
  if (!open.value) return;
  e.preventDefault();
  scrollBy(e.deltaY > 0 ? 1 : -1);
}

// Vue 将 @wheel 默认注册为 passive，无法 preventDefault，需手动挂载非 passive 监听
watch(open, (v) => {
  nextTick(() => {
    if (v) {
      listRef.value?.addEventListener('wheel', onWheel, { passive: false });
    } else {
      listRef.value?.removeEventListener('wheel', onWheel);
    }
  });
});

watch(() => props.modelOpen, (v) => {
  if (v !== undefined && v !== open.value) {
    if (v) {
      openMenu();
    } else {
      close();
    }
  }
});

function onTs(e: TouchEvent) {
  if (open.value) {
    tY.value = e.touches[0]!.clientY;
    tDrag.value = true;
  }
}

function onTm(e: TouchEvent) {
  if (!open.value || !tDrag.value) return;
  const dy = e.touches[0]!.clientY - tY.value;
  if (Math.abs(dy) > 5) {
    scrollBy(dy < 0 ? 1 : -1);
    tY.value = e.touches[0]!.clientY;
  }
}
function onTe() {
  tDrag.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

onMounted(() => {
  document.addEventListener('mousedown', onDocDown);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', close, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown);
  window.removeEventListener('resize', close);
  window.removeEventListener('scroll', close, true);
});
</script>

<template>
  <div
    ref="rootRef"
    class="sp-dropdown"
    :style="typeof width === 'number' ? { width: width + 'px' } : { width }"
  >
    <button
      v-if="!hideTrigger"
      type="button"
      class="sp-dropdown__trigger"
      :class="{ 'sp-dropdown__trigger--open': open }"
      :title="title"
      @click="toggle"
    >
      <!-- eslint-disable vue/no-v-html -->
      <span
        v-if="current?.icon"
        class="sp-dropdown__icon"
        v-html="current.icon"
      />
      <!-- eslint-enable vue/no-v-html -->
      <span
        v-else
        class="sp-dropdown__value"
      >{{ current?.label ?? '' }}</span>
      <svg
        class="sp-dropdown__caret"
        viewBox="0 0 1024 1024"
        fill="currentColor"
      >
        <path d="M180.053333 361.386667a32 32 0 0 1 45.226667 0L512 648.106667l286.72-286.72a32 32 0 1 1 45.226667 45.226666l-309.333334 309.333334a32 32 0 0 1-45.226666 0L180.053333 406.613333a32 32 0 0 1 0-45.226666z" />
      </svg>
    </button>
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="open"
          ref="menuRef"
          class="sp-dropdown__menu"
          :class="{ 'sp-dropdown__menu--up': pos.up }"
          :style="{ left: pos.left !== undefined ? pos.left + 'px' : undefined, right: pos.right !== undefined ? pos.right + 'px' : undefined, top: pos.top + 'px', minWidth: effMenuWidth !== undefined ? (typeof effMenuWidth === 'number' ? effMenuWidth + 'px' : effMenuWidth) : undefined }"
          @keydown="onKeydown"
        >
          <button
            v-if="scrollable"
            type="button"
            class="sp-dropdown__nav"
            :class="{ 'sp-dropdown__nav--disabled': !canUp }"
            :disabled="!canUp"
            @click="scrollBy(-1)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053333 662.613333a32 32 0 0 0 45.226667 0L512 375.893333l286.72 286.72a32 32 0 1 0 45.226667-45.226666l-309.333334-309.333334a32 32 0 0 0-45.226666 0l-309.333334 309.333334a32 32 0 0 0 0 45.226666z" /></svg>
          </button>
          <div
            ref="listRef"
            class="sp-dropdown__list"
            @touchstart="onTs"
            @touchmove="onTm"
            @touchend="onTe"
          >
            <button
              v-for="o in list"
              :key="String(o.value)"
              type="button"
              class="sp-dropdown__item"
              :class="{ 'sp-dropdown__item--active': String(o.value) === String(modelValue) }"
              @click="select(o)"
            >
              <!-- eslint-disable vue/no-v-html -->
              <span
                v-if="o.icon"
                class="sp-dropdown__item-icon"
                v-html="o.icon"
              />
              <!-- eslint-enable vue/no-v-html -->
              <span class="sp-dropdown__item-label">{{ o.label }}</span>
            </button>
          </div>
          <button
            v-if="scrollable"
            type="button"
            class="sp-dropdown__nav"
            :class="{ 'sp-dropdown__nav--disabled': !canDown }"
            :disabled="!canDown"
            @click="scrollBy(1)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053333 361.386667a32 32 0 0 1 45.226667 0L512 648.106667l286.72-286.72a32 32 0 1 1 45.226667 45.226666l-309.333334 309.333334a32 32 0 0 1-45.226666 0L180.053333 406.613333a32 32 0 0 1 0-45.226666z" /></svg>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.sp-dropdown {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.sp-dropdown__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  width: 100%;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #444);
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  cursor: pointer;
  padding: 0 5px;
  box-sizing: border-box;
}
.sp-dropdown__trigger:hover { background: var(--sp-toolbar-btn-hover-bg, #e6e6e6); }
.sp-dropdown__trigger--open {
  background: var(--sp-toolbar-btn-hover-bg, #e6e6e6);
  border-color: var(--sp-toolbar-border, #d8d8d8);
}
.sp-dropdown__value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.sp-dropdown__caret {
  width: 10px;
  height: 10px;
  min-width: 10px;
  opacity: 0.7;
}
.sp-dropdown__menu {
  position: fixed;
  z-index: 20000;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 4px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  transform-origin: top center;
}
.sp-dropdown__menu--up { transform-origin: bottom center; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scaleY(0.85); }
.sp-dropdown__nav {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 15px;
  min-height: 15px;
  border: none;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #666);
  cursor: pointer;
  padding: 0;
  border-radius: 3px;
}
.sp-dropdown__nav:hover:not(:disabled) { background: #eef3f9; }
.sp-dropdown__nav:disabled { color: #ccc; cursor: default; }
.sp-dropdown__nav svg { width: 10px; height: 10px; }
.sp-dropdown__list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  touch-action: none;
}
.sp-dropdown__icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.sp-dropdown__icon :deep(svg) { width: 18px; height: 18px; display: block; }
.sp-dropdown__item-icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.sp-dropdown__item-icon :deep(svg) { width: 16px; height: 16px; display: block; }
.sp-dropdown__item-label { white-space: nowrap; }
.sp-dropdown__item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #444);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  box-sizing: border-box;
  border-radius: 3px;
}
.sp-dropdown__item:hover { background: #eef3f9; }
.sp-dropdown__item--active { background: #e5f1fb; color: #0078d7; }
</style>
