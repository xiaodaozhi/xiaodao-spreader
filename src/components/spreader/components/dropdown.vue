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
  /** 当前值未命中任何选项时触发器显示的占位文本（如选区格式不一致时的「混合」） */
  fallbackLabel?: string;
  /** 是否启用菜单内搜索框（仅按 label 实时过滤，不改变选中，须点击菜单项才算数） */
  searchable?: boolean;
  /** 搜索框占位文本 */
  searchPlaceholder?: string;
  /** 触发器固定图标（SVG 字符串）：当 modelValue 未命中任何 option 时显示，优先级低于 current.icon */
  triggerIcon?: string;
  /** 触发器左侧图标旁的固定文本标签（溢出菜单中显示） */
  triggerLabel?: string;
}>(), {
  width: 'auto',
  menuWidth: undefined,
  visibleCount: 8,
  title: '',
  modelOpen: undefined,
  hideTrigger: false,
  align: 'left',
  triggerEl: null,
  fallbackLabel: '',
  searchable: false,
  searchPlaceholder: '',
  triggerIcon: '',
  triggerLabel: '',
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
const triggerWidth = ref<number | undefined>(undefined);
const tY = ref(0);
const tDrag = ref(false);
/** 菜单内搜索框的输入值（仅 searchable 时使用） */
const query = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);

const current = computed(() => props.options.find((o) => String(o.value) === String(props.modelValue)));
const effMenuWidth = computed(() => {
  if (props.menuWidth !== undefined) return props.menuWidth;
  return triggerWidth.value;
});
/** 实际参与展示/分页的列表：searchable 时按 query 过滤，否则为全部选项 */
const baseOptions = computed(() => {
  if (!props.searchable || !query.value.trim()) return props.options;
  const q = query.value.trim().toLowerCase();
  return props.options.filter((o) => String(o.label ?? '').toLowerCase().includes(q));
});
const hasMatch = computed(() => baseOptions.value.length > 0);
const vc = computed(() => Math.min(props.visibleCount, baseOptions.value.length));
const list = computed(() => baseOptions.value.slice(viewStart.value, viewStart.value + vc.value));
const canUp = computed(() => viewStart.value > 0);
const canDown = computed(() => viewStart.value + vc.value < baseOptions.value.length);
const scrollable = computed(() => baseOptions.value.length > vc.value);

function scrollBy(d: number) {
  viewStart.value = Math.max(0, Math.min(baseOptions.value.length - vc.value, viewStart.value + d));
}

function openMenu() {
  const el = props.triggerEl ?? rootRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  triggerWidth.value = r.width;
  open.value = true;
  if (props.searchable) query.value = '';
  if (props.modelOpen !== undefined) {
    emit('update:modelOpen', true);
  }
  // 先给一个临时位置向下弹，下一帧测量实际高度再决定方向
  const tmpTop = r.bottom + 4;
  if (props.align === 'right') {
    pos.value = {
      right: window.innerWidth - r.right,
      top: tmpTop,
      up: false,
    };
  } else {
    pos.value = { left: r.left, top: tmpTop, up: false };
  }
  const idx = baseOptions.value.findIndex((o) => String(o.value) === String(props.modelValue));
  viewStart.value = idx >= 0
    ? Math.max(0, Math.min(idx - Math.floor(vc.value / 2), baseOptions.value.length - vc.value))
    : 0;
  if (props.searchable) {
    nextTick(() => searchInputRef.value?.focus());
  }
  // 测量实际菜单高度，修正方向
  nextTick(() => {
    const el2 = props.triggerEl ?? rootRef.value;
    if (!el2) return;
    const r2 = el2.getBoundingClientRect();
    const menuEl = menuRef.value;
    if (!menuEl) return;
    const h = menuEl.offsetHeight;
    const spaceBelow = window.innerHeight - r2.bottom - 8;
    const spaceAbove = r2.top - 8;
    // 下方能放就向下；下方放不下但上方够就向上；两边都不够→优先向上（尽量避开视口底部）
    const up = spaceBelow < h && spaceAbove > 0;
    let top = up ? r2.top - h - 4 : r2.bottom + 4;
    top = Math.max(8, Math.min(window.innerHeight - h - 8, top)); // 兜底贴边界
    if (props.align === 'right') {
      pos.value = {
        right: window.innerWidth - r2.right,
        top,
        up,
      };
    } else {
      pos.value = { left: r2.left, top, up };
    }
  });
}

function close() {
  open.value = false;
  query.value = '';
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
  if (o.disabled) return;
  emit('update:modelValue', o.value);
  emit('change', o.value);
  close();
}

function onDocDown(e: PointerEvent) {
  if (!open.value) return;
  const t = e.target as Node;
  // 菜单通过 Teleport 渲染到 body，需同时排除菜单内部点击，否则 pointerdown 阶段会提前关闭菜单导致 click 丢失。
  // 用 pointerdown 而非 mousedown：触屏时 canvas 的 touchstart.prevent 会抑制合成鼠标事件，mousedown 收不到，
  // 导致下拉框在触摸点画布/滚动条时无法关闭；pointerdown 不受其 preventDefault 影响，鼠标/触摸通吃（与溢出菜单一致）
  if (rootRef.value?.contains(t) || menuRef.value?.contains(t)) return;
  close();
}

function onWheel(e: WheelEvent) {
  if (!open.value) return;
  e.preventDefault();
  scrollBy(e.deltaY > 0 ? 1 : -1);
}

// Vue 将 @wheel 默认注册为 passive，无法 preventDefault，需手动挂载非 passive 监听
// 菜单使用 @mousedown.prevent 阻止按钮抢焦，导致菜单 div 无法通过子元素获焦接收 keydown，
// 需在 document 上监听 Escape 以支持键盘关闭
watch(open, (v) => {
  nextTick(() => {
    if (v) {
      listRef.value?.addEventListener('wheel', onWheel, { passive: false });
      document.addEventListener('keydown', onDocKeydown);
    } else {
      listRef.value?.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onDocKeydown);
    }
  });
});

function onDocKeydown(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === 'Escape') close();
}

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
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocDown);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', close, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown);
  document.removeEventListener('keydown', onDocKeydown);
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
        v-if="current?.icon || triggerIcon"
        class="sp-dropdown__icon"
        v-html="current?.icon || triggerIcon"
      />
      <!-- eslint-enable vue/no-v-html -->
      <span
        class="sp-dropdown__value"
      >{{ (current?.icon || triggerIcon) ? (current?.label ?? triggerLabel) : (current?.label ?? fallbackLabel) }}</span>
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
          @mousedown.prevent
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
          <input
            v-if="searchable"
            ref="searchInputRef"
            v-model="query"
            class="sp-dropdown__search"
            type="text"
            :placeholder="searchPlaceholder"
            @mousedown.stop
          >
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
              :class="{ 'sp-dropdown__item--active': !o.disabled && String(o.value) === String(modelValue), 'sp-dropdown__item--disabled': o.disabled }"
              :disabled="o.disabled"
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
          <div
            v-if="searchable && !hasMatch"
            class="sp-dropdown__empty"
          >
            无匹配
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
  z-index: 40000;
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
.sp-dropdown__search {
  flex: 0 0 auto;
  height: 26px;
  margin-bottom: 4px;
  padding: 0 8px;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  color: #1a1a1a;
  outline: none;
  box-sizing: border-box;
}
.sp-dropdown__search:focus {
  border-color: #0078d7;
  box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3);
}
.sp-dropdown__empty {
  padding: 6px 8px;
  font-size: 12px;
  color: #999;
  text-align: center;
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
.sp-dropdown__item--disabled { color: #c9c9c9; cursor: default; }
.sp-dropdown__item--disabled:hover { background: transparent; }
.sp-dropdown__item--active { background: #e5f1fb; color: #0078d7; }
</style>
