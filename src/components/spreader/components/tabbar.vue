<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, inject } from 'vue';
import { t } from '../core/constants';

// 主题作用域：浮层经 Teleport 脱离组件 DOM 树，无法继承组件根上的 --sp-* 变量，
// 故在此 inject spreader 下发的主题，并在浮层根挂载作用域类，使 dark 变量仅本组件内生效，
// 而不依赖 <html> 全局类（以免污染调用方项目的主题）。
import type { SheetState } from '../core/types';
import { getFloatBounds } from '../core/utils';

const spTheme = inject('sp-theme', 'light') as string;

const props = defineProps<{
  locale: string;
  sheets: SheetState[];
  activeSheetIndex: number;
  renTab: number | null;
  renTabVal: string;
  /** 边界基准元素（通常是表格容器 wrapper）：列表菜单不得越出其可视区，见 getFloatBounds */
  boundaryEl?: HTMLElement | null;
  /** 是否可编辑；false = 只读模式，新增工作表按钮禁用 */
  editable?: boolean;
}>();

const emit = defineEmits<{
  (e: 'tab-click' | 'tab-dblclick' | 'delete-sheet', i: number): void;
  (e: 'tab-contextmenu', payload: { ev: MouseEvent; i: number }): void;
  (e: 'tab-rename-input', v: string): void;
  (e: 'tab-rename-keydown', ev: KeyboardEvent): void;
  (e: 'tab-rename-commit' | 'add-sheet'): void;
  (e: 'tabbar-contextmenu', ev: MouseEvent): void;
}>();

// ============ 工作表列表菜单 ============
const VISIBLE_COUNT = 8;
const listBtnRef = ref<HTMLButtonElement | null>(null);
const listMenuOpen = ref(false);
const viewStart = ref(0);
// 用 bottom 定位，菜单底部对齐按钮顶部，自然向上生长
const listMenuPos = ref<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
const listRef = ref<HTMLDivElement | null>(null);

const vc = computed(() => Math.min(VISIBLE_COUNT, props.sheets.length));
const visibleList = computed(() => props.sheets.slice(viewStart.value, viewStart.value + vc.value));
const canUp = computed(() => viewStart.value > 0);
const canDown = computed(() => viewStart.value + vc.value < props.sheets.length);
const scrollable = computed(() => props.sheets.length > vc.value);
// 仅有一张工作表时不允许删除
const canDelete = computed(() => props.sheets.length > 1);

// 删除后若 viewStart 越界则回拉，保持可见项稳定
watch(() => props.sheets.length, () => {
  if (!listMenuOpen.value) return;
  const maxStart = Math.max(0, props.sheets.length - vc.value);
  if (viewStart.value > maxStart) viewStart.value = maxStart;
});

function scrollBy(d: number) {
  viewStart.value = Math.max(0, Math.min(props.sheets.length - vc.value, viewStart.value + d));
}

function toggleListMenu() {
  if (listMenuOpen.value) {
    listMenuOpen.value = false;
    return;
  }
  const el = listBtnRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const b = getFloatBounds(props.boundaryEl);
  listMenuPos.value = {
    left: Math.max(b.left, r.left),
    // CSS bottom 以视口底边为基准：菜单底边锚定按钮顶部上方 4px，自然向上生长。
    // 不能用 b.bottom：它是 wrapper 底边的 clientY 坐标，而 wrapper 底边在 tabbar
    // 之上，误用会把菜单底边推到视口最底，整体盖住 tabbar 与本按钮。
    bottom: window.innerHeight - r.top + 4,
  };
  // 活动项居中显示
  const idx = props.activeSheetIndex;
  viewStart.value = idx >= 0
    ? Math.max(0, Math.min(idx - Math.floor(vc.value / 2), props.sheets.length - vc.value))
    : 0;
  listMenuOpen.value = true;
}

function onListSelect(i: number) {
  emit('tab-click', i);
  listMenuOpen.value = false;
}

function onDeleteSheet(i: number) {
  if (!canDelete.value) return;
  emit('delete-sheet', i);
}

// 外部点击 / Escape 关闭
function onDocPointerdown(e: PointerEvent) {
  if (!listMenuOpen.value) return;
  const target = e.target as Node;
  if (listBtnRef.value?.contains(target)) return;
  const menu = document.querySelector('.tab-list-menu');
  if (menu?.contains(target)) return;
  listMenuOpen.value = false;
}

function onDocKeydown(e: KeyboardEvent) {
  if (listMenuOpen.value && e.key === 'Escape') listMenuOpen.value = false;
}

// 鼠标滚轮翻页（与 dropdown 一致）
function onWheel(e: WheelEvent) {
  if (!listMenuOpen.value) return;
  e.preventDefault();
  scrollBy(e.deltaY > 0 ? 1 : -1);
}

function closeListMenu() {
  listMenuOpen.value = false;
}

// 滚动关闭：仅在外部滚动时关闭，菜单内部滚动不关闭
function onScrollClose(e: Event) {
  if (!listMenuOpen.value) return;
  const target = e.target as Node;
  if (target === listRef.value) return;
  closeListMenu();
}

// 触屏滑动翻页（与 dropdown 一致）
const tY = ref(0);
const tDrag = ref(false);
function onTs(e: TouchEvent) {
  if (listMenuOpen.value) {
    tY.value = e.touches[0]!.clientY;
    tDrag.value = true;
  }
}
function onTm(e: TouchEvent) {
  if (!listMenuOpen.value || !tDrag.value) return;
  const dy = e.touches[0]!.clientY - tY.value;
  if (Math.abs(dy) > 5) {
    scrollBy(dy < 0 ? 1 : -1);
    tY.value = e.touches[0]!.clientY;
  }
}
function onTe() {
  tDrag.value = false;
}

// ============ 触屏长按右键菜单（与鼠标 @contextmenu 等价）============
const TAB_LONG_MS = 450;
const TAB_MOVE_TOL = 8;
let tTabTimer: number | null = null;
let tTabIdx = -1;
let tTabX = 0, tTabY = 0;
let tTabSuppressClick = false;
let tBarTimer: number | null = null;
let tBarX = 0, tBarY = 0;

// 触屏长按构造最小 MouseEvent（供右键菜单定位）；必须提供 preventDefault/stopPropagation，
// 否则 onTabCtxMenu 内 e.stopPropagation() 会抛 TypeError 导致菜单不弹出
function makeCtxMouseEv(x: number, y: number, target: EventTarget | null): MouseEvent {
  return { clientX: x, clientY: y, target, preventDefault() {}, stopPropagation() {} } as unknown as MouseEvent;
}

function onTabTouchStart(e: TouchEvent, i: number) {
  const tch = e.touches[0];
  if (!tch) return;
  tTabX = tch.clientX;
  tTabY = tch.clientY;
  tTabIdx = i;
  if (tTabTimer !== null) clearTimeout(tTabTimer);
  const startEl = e.target as HTMLElement;
  tTabTimer = window.setTimeout(() => {
    tTabSuppressClick = true; // 吞掉松手后合成的 click（避免切换 sheet）
    const ev = makeCtxMouseEv(tTabX, tTabY, startEl);
    emit('tab-contextmenu', { ev, i: tTabIdx });
  }, TAB_LONG_MS);
}
function onTabTouchMove(e: TouchEvent) {
  const tch = e.touches[0];
  if (!tch || tTabTimer === null) return;
  if (Math.abs(tch.clientX - tTabX) > TAB_MOVE_TOL || Math.abs(tch.clientY - tTabY) > TAB_MOVE_TOL) {
    clearTimeout(tTabTimer);
    tTabTimer = null;
  }
}
function onTabTouchEnd() {
  if (tTabTimer !== null) {
    clearTimeout(tTabTimer);
    tTabTimer = null;
  }
}
// 长按触发的菜单已接管，松手后合成 click 不应切换到该 sheet
function onTabClickEmit(i: number) {
  if (tTabSuppressClick) {
    tTabSuppressClick = false;
    return;
  }
  emit('tab-click', i);
}

function onBarTouchStart(e: TouchEvent) {
  const tch = e.touches[0];
  if (!tch) return;
  const el = e.target as HTMLElement;
  // 命中具体 tab / 加号 / 列表按钮时交给各自逻辑，不弹空白区菜单
  if (el.closest('.tab-item') || el.closest('.tab-bar__add-btn') || el.closest('.tab-bar__list-btn')) return;
  tBarX = tch.clientX;
  tBarY = tch.clientY;
  if (tBarTimer !== null) clearTimeout(tBarTimer);
  const startEl = el;
  tBarTimer = window.setTimeout(() => {
    const ev = makeCtxMouseEv(tBarX, tBarY, startEl);
    emit('tabbar-contextmenu', ev);
  }, TAB_LONG_MS);
}
function onBarTouchMove(e: TouchEvent) {
  const tch = e.touches[0];
  if (!tch || tBarTimer === null) return;
  if (Math.abs(tch.clientX - tBarX) > TAB_MOVE_TOL || Math.abs(tch.clientY - tBarY) > TAB_MOVE_TOL) {
    clearTimeout(tBarTimer);
    tBarTimer = null;
  }
}
function onBarTouchEnd() {
  if (tBarTimer !== null) {
    clearTimeout(tBarTimer);
    tBarTimer = null;
  }
}

// 菜单打开/关闭时挂载/卸载非 passive wheel 监听
watch(listMenuOpen, (v) => {
  nextTick(() => {
    if (v) {
      listRef.value?.addEventListener('wheel', onWheel, { passive: false });
    } else {
      listRef.value?.removeEventListener('wheel', onWheel);
    }
  });
});

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerdown);
  document.addEventListener('keydown', onDocKeydown);
  window.addEventListener('resize', closeListMenu);
  window.addEventListener('scroll', onScrollClose, true);
});

onBeforeUnmount(() => {
  if (tTabTimer !== null) clearTimeout(tTabTimer);
  if (tBarTimer !== null) clearTimeout(tBarTimer);
  document.removeEventListener('pointerdown', onDocPointerdown);
  document.removeEventListener('keydown', onDocKeydown);
  window.removeEventListener('resize', closeListMenu);
  window.removeEventListener('scroll', onScrollClose, true);
});
</script>

<template>
  <div
    class="tab-bar"
    @contextmenu="emit('tabbar-contextmenu', $event)"
    @touchstart="onBarTouchStart"
    @touchmove="onBarTouchMove"
    @touchend="onBarTouchEnd"
    @touchcancel="onBarTouchEnd"
  >
    <button
      ref="listBtnRef"
      class="tab-bar__list-btn"
      type="button"
      :title="t(locale, 'sheetList')"
      :class="{ 'tab-bar__list-btn--active': listMenuOpen }"
      @click="toggleListMenu"
    >
      <svg
        viewBox="0 0 1024 1024"
        fill="currentColor"
      ><path d="M128 256h768a32 32 0 0 0 0-64H128a32 32 0 0 0 0 64z m0 256h768a32 32 0 0 0 0-64H128a32 32 0 0 0 0 64z m0 256h768a32 32 0 0 0 0-64H128a32 32 0 0 0 0 64z" /></svg>
    </button>
    <div class="tab-list">
      <template
        v-for="(s, i) in sheets"
        :key="s.id"
      >
        <div
          class="tab-item"
          :class="{ 'tab-item--active': i === activeSheetIndex }"
          @click="onTabClickEmit(i)"
          @dblclick.prevent="emit('tab-dblclick', i)"
          @contextmenu="emit('tab-contextmenu', { ev: $event, i: i })"
          @touchstart="onTabTouchStart($event, i)"
          @touchmove="onTabTouchMove"
          @touchend="onTabTouchEnd"
          @touchcancel="onTabTouchEnd"
        >
          <template v-if="renTab === i">
            <input
              class="tab-rename-input"
              :value="renTabVal"
              @input="emit('tab-rename-input', ($event.target as HTMLInputElement).value)"
              @keydown="emit('tab-rename-keydown', $event)"
              @blur="emit('tab-rename-commit')"
              @click.stop
            >
          </template>
          <template v-else>
            <span class="tab-item__name">{{ s.name }}</span>
          </template>
        </div>
      </template>
    </div>
    <button
      class="tab-bar__add-btn"
      :class="{ 'tab-bar__add-btn--disabled': props.editable === false }"
      :disabled="props.editable === false"
      :title="t(locale, 'addSheet')"
      @click="emit('add-sheet')"
    >
      +
    </button>
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="listMenuOpen"
          class="tab-list-menu sp-spreader-overlay"
          :style="{ left: listMenuPos.left + 'px', bottom: listMenuPos.bottom + 'px' }"
          :class="{ dark: spTheme === 'dark' }"
          @mousedown.prevent
        >
          <button
            v-if="scrollable"
            type="button"
            class="tab-list-menu__nav"
            :class="{ 'tab-list-menu__nav--disabled': !canUp }"
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
            class="tab-list-menu__list"
            @touchstart="onTs"
            @touchmove="onTm"
            @touchend="onTe"
          >
            <div
              v-for="s in visibleList"
              :key="s.id"
              class="tab-list-menu__item"
              :class="{ 'tab-list-menu__item--active': sheets.indexOf(s) === activeSheetIndex }"
              :title="s.name"
              @click="onListSelect(sheets.indexOf(s))"
            >
              <span class="tab-list-menu__name">{{ s.name }}</span>
              <button
                type="button"
                class="tab-list-menu__del"
                :title="t(locale, 'delete')"
                :disabled="!canDelete || props.editable === false"
                @click.stop="onDeleteSheet(sheets.indexOf(s))"
              >
                <svg
                  viewBox="0 0 1024 1024"
                  fill="currentColor"
                ><path d="M571.733333 512l288.533334-288.533333c17.066667-17.066667 17.066667-42.666667 0-59.733334-17.066667-17.066667-42.666667-17.066667-59.733334 0L512 452.266667 223.466667 164.266667c-17.066667-17.066667-42.666667-17.066667-59.733334 0-17.066667 17.066667-17.066667 42.666667 0 59.733333L452.266667 512 164.266667 800c-17.066667 17.066667-17.066667 42.666667 0 59.733333 8.533333 8.533333 19.2 12.8 29.866666 12.8 10.666667 0 21.333333-4.266667 29.866667-12.8L512 571.733333l288.533333 288.533334c8.533333 8.533333 19.2 12.8 29.866667 12.8 10.666667 0 21.333333-4.266667 29.866667-12.8 17.066667-17.066667 17.066667-42.666667 0-59.733334L571.733333 512z" /></svg>
              </button>
            </div>
          </div>
          <button
            v-if="scrollable"
            type="button"
            class="tab-list-menu__nav"
            :class="{ 'tab-list-menu__nav--disabled': !canDown }"
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
.tab-bar { display: flex; align-items: stretch; height: 30px; min-height: 30px; background: var(--sp-tab-bar-bg); border-top: 1px solid var(--sp-tab-bar-border); user-select: none; -webkit-touch-callout: none; }
.tab-list { display: flex; align-items: flex-start; flex: 1; overflow: hidden; gap: 1px; padding: 0 1px; }
.tab-item { display: flex; align-items: center; height: 28px; min-width: 0; max-width: 120px; padding: 0 10px; cursor: pointer; border: 1px solid var(--sp-tab-inactive-border); background: var(--sp-tab-inactive-bg); color: var(--sp-tab-inactive-color); font-size: 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; white-space: nowrap; transition: background 0.1s; -webkit-touch-callout: none; }
.tab-item:hover { background: var(--sp-tab-hover-bg); }
.tab-item--active { height: 28px; background: var(--sp-tab-active-bg); color: var(--sp-tab-active-color); border-color: var(--sp-tab-active-bg) var(--sp-tab-bar-border) var(--sp-tab-bar-border); border-top: 2px solid var(--sp-tab-active-border); }
.tab-item--active:hover { background: var(--sp-tab-active-bg); }
.tab-item__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-rename-input { width: 100%; height: 18px; border: none; border-radius: 0; outline: none; padding: 0; font-size: 14px; font-family: inherit; background: var(--sp-tab-active-bg); color: var(--sp-tab-active-color); box-sizing: border-box; }
.tab-bar__list-btn { display: flex; align-items: center; justify-content: center; width: 24px; min-width: 24px; height: 24px; margin: 0 2px 3px 3px; border: none; background: transparent; color: var(--sp-tab-add-btn-color); cursor: pointer; padding: 0; align-self: flex-end; }
.tab-bar__list-btn:hover, .tab-bar__list-btn--active { background: var(--sp-tab-add-btn-hover-bg); }
.tab-bar__list-btn svg { width: 14px; height: 14px; }
.tab-bar__add-btn { display: flex; align-items: center; justify-content: center; width: 24px; min-width: 24px; height: 24px; margin: 0 4px 3px 3px; border: none; background: transparent; color: var(--sp-tab-add-btn-color); font-size: 16px; line-height: 22px; text-align: center; cursor: pointer; padding: 0; align-self: flex-end; }
.tab-bar__add-btn:hover { background: var(--sp-tab-add-btn-hover-bg); }
.tab-bar__add-btn--disabled { color: var(--sp-toolbar-btn-disabled-color, #bbb); cursor: default; }
.tab-bar__add-btn--disabled:hover { background: transparent; }
</style>

<style>
/* 非 scoped：菜单 teleport 到 body，需全局样式 */
.tab-list-menu { position: fixed; display: flex; flex-direction: column; background: var(--sp-toolbar-bg, #fff); border: 1px solid var(--sp-toolbar-border, #d8d8d8); border-radius: 4px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12); padding: 4px; z-index: 1000; transform-origin: bottom left; min-width: 140px; max-width: 260px; box-sizing: border-box; }
.tab-list-menu__nav { display: flex; align-items: center; justify-content: center; height: 15px; min-height: 15px; border: none; background: transparent; color: var(--sp-toolbar-btn-color, #666); cursor: pointer; padding: 0; border-radius: 3px; }
.tab-list-menu__nav:hover:not(:disabled) { background: var(--sp-toolbar-btn-hover-bg, #eef3f9); }
.tab-list-menu__nav:disabled { color: var(--sp-toolbar-btn-disabled-color, #ccc); cursor: default; }
.tab-list-menu__nav svg { width: 10px; height: 10px; }
.tab-list-menu__list { display: flex; flex-direction: column; overflow: hidden; touch-action: none; }
.tab-list-menu__item { display: flex; align-items: center; gap: 4px; width: 100%; height: 28px; padding: 0 6px 0 10px; border: none; background: transparent; color: var(--sp-toolbar-btn-color, #444); font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; cursor: pointer; white-space: nowrap; border-radius: 3px; box-sizing: border-box; }
.tab-list-menu__item:hover { background: var(--sp-toolbar-btn-hover-bg, #e6e6e6); }
.tab-list-menu__item--active { color: var(--sp-tab-active-border, #0078d7); font-weight: 500; }
.tab-list-menu__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-list-menu__del { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; flex: 0 0 auto; border: none; background: transparent; color: var(--sp-toolbar-btn-color, #999); cursor: pointer; padding: 0; border-radius: 3px; opacity: 0.55; }
.tab-list-menu__item:hover .tab-list-menu__del { opacity: 1; }
.tab-list-menu__del:hover:not(:disabled) { background: rgba(0,0,0,0.08); color: #d9534f; }
.tab-list-menu__del:disabled { cursor: default; opacity: 0.25; }
.tab-list-menu__del svg { width: 12px; height: 12px; }
</style>
