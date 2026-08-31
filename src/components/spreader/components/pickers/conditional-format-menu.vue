<script setup lang="ts">
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { t } from '../../core/constants';
import { getFloatBounds, cssRightFromX } from '../../core/utils';

const props = withDefaults(defineProps<{
  locale: string;
  hasSelection: boolean;
  themeVars?: Record<string, string>;
  /** 边界基准元素（通常是表格容器 wrapper）：菜单不得越出其可视区，见 getFloatBounds */
  boundaryEl?: HTMLElement | null;
}>(), {
  themeVars: () => ({}),
  boundaryEl: null,
});

const emit = defineEmits<{
  (e: 'preset', type: string): void;
  (e: 'new-rule' | 'manage'): void;
  (e: 'clear', scope: 'selection' | 'sheet'): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const btnRef = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const highlightSubRef = ref<HTMLElement | null>(null);
const clearSubRef = ref<HTMLElement | null>(null);
const open = ref(false);
const submenu = ref<'highlight' | 'clear' | null>(null);
// 各子菜单独立记录弹出方向：否则两者共用一个值时，快速在两项间切换会让
// 正在退场的那个面板按新方向收拢，收拢角与弹出角对不上。
const highlightDir = ref<'left' | 'right'>('right');
const clearDir = ref<'left' | 'right'>('right');
const highlightUp = ref(false);
const clearUp = ref(false);
const pos = ref<{ right: number; top: number; up: boolean }>({ right: 0, top: 0, up: false });
const canUp = ref(false);
const canDown = ref(false);
const highlightCanUp = ref(false);
const highlightCanDown = ref(false);
const clearCanUp = ref(false);
const clearCanDown = ref(false);
interface SubPos { left?: number; right?: number; top: number }
const highlightSubPos = ref<SubPos>({ top: 0 });
const clearSubPos = ref<SubPos>({ top: 0 });
let subCloseTimer: ReturnType<typeof setTimeout> | undefined;

// 突出显示单元格规则子项（数值/文本比较）
const highlightItems = [
  { type: 'equal', key: 'cfEqual' },
  { type: 'notEqual', key: 'cfNotEqual' },
  { type: 'greaterThan', key: 'cfGreaterThan' },
  { type: 'greaterThanOrEqual', key: 'cfGreaterThanOrEqual' },
  { type: 'lessThan', key: 'cfLessThan' },
  { type: 'lessThanOrEqual', key: 'cfLessThanOrEqual' },
  { type: 'between', key: 'cfBetween' },
  { type: 'notBetween', key: 'cfNotBetween' },
  { type: 'textContains', key: 'cfTextContains' },
  { type: 'textNotContains', key: 'cfTextNotContains' },
];

function toggle() {
  if (open.value) {
    close();
  } else {
    openMenu();
  }
}

function openMenu() {
  const el = btnRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  open.value = true;
  submenu.value = null;
  const b = getFloatBounds(props.boundaryEl);
  pos.value = {
    right: cssRightFromX(Math.min(r.right, b.right)),
    top: r.bottom + 4,
    up: false,
  };
  // 下一帧菜单 DOM 已挂载，测量实际高度再决定向上还是向下
  nextTick(() => {
    const menu = menuRef.value?.closest('.cf-menu') as HTMLElement | null;
    if (!menu) return;
    const h = menu.offsetHeight;
    const spaceBelow = b.bottom - r.bottom - 8;
    const spaceAbove = r.top - b.top - 8;
    // 下方放得下就向下；下方放不下但上方有空间（哪怕不够完整）就向上；两边都不够→兜底贴顶
    const up = spaceBelow < h && spaceAbove > 0;
    let top = up ? r.top - h - 4 : r.bottom + 4;
    top = Math.max(b.top + 8, Math.min(b.bottom - h - 8, top));
    pos.value = {
      right: cssRightFromX(Math.min(r.right, b.right)),
      top,
      up,
    };
    onMenuScroll();
  });
}

function close() {
  open.value = false;
  clearTimeout(subCloseTimer);
  submenu.value = null;
}

function onMenuScroll() {
  const el = menuRef.value;
  if (!el) return;
  canUp.value = el.scrollTop > 1;
  canDown.value = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
}
function scrollBy(d: number) {
  const el = menuRef.value;
  if (!el) return;
  el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + d * 30));
}
function onSubScroll(sub: 'highlight' | 'clear') {
  const el = sub === 'highlight' ? highlightSubRef.value : clearSubRef.value;
  if (!el) return;
  const cU = el.scrollTop > 1;
  const cD = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  if (sub === 'highlight') {
    highlightCanUp.value = cU;
    highlightCanDown.value = cD;
  } else {
    clearCanUp.value = cU;
    clearCanDown.value = cD;
  }
}
function scrollSubBy(sub: 'highlight' | 'clear', d: number) {
  const el = sub === 'highlight' ? highlightSubRef.value : clearSubRef.value;
  if (!el) return;
  el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + d * 30));
}
function onWheelFor(el: HTMLElement | null, e: WheelEvent) {
  if (!el) return;
  if (el.scrollHeight <= el.clientHeight) return;
  e.preventDefault();
  el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + e.deltaY));
}
function onMenuWheel(e: WheelEvent) {
  onWheelFor(menuRef.value, e);
  onMenuScroll();
}
function onHighlightWheel(e: WheelEvent) {
  onWheelFor(highlightSubRef.value, e);
  onSubScroll('highlight');
}
function onClearWheel(e: WheelEvent) {
  onWheelFor(clearSubRef.value, e);
  onSubScroll('clear');
}

function onDocDown(e: PointerEvent) {
  if (!open.value) return;
  const t = e.target as Node;
  if (rootRef.value?.contains(t)) return;
  if (menuRef.value?.contains(t)) return;
  if (highlightSubRef.value?.closest('.cf-submenu-wrap')?.contains(t)) return;
  if (clearSubRef.value?.closest('.cf-submenu-wrap')?.contains(t)) return;
  close();
}

function enterSub(name: 'highlight' | 'clear', e?: MouseEvent) {
  clearTimeout(subCloseTimer);
  submenu.value = name;
  // 子菜单 DOM 在独立 Teleport 中渲染，nextTick 后可测量
  nextTick(() => {
    const el = e?.currentTarget instanceof HTMLElement ? e.currentTarget : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const subEl = name === 'highlight'
      ? highlightSubRef.value?.closest('.cf-submenu-wrap') as HTMLElement | null
      : clearSubRef.value?.closest('.cf-submenu-wrap') as HTMLElement | null;
    if (!subEl) return;
    const b = getFloatBounds(props.boundaryEl);
    const subW = subEl.offsetWidth;
    const subH = subEl.offsetHeight;
    // 左右翻向：默认向右；右侧放不下（含 8px 余量）则翻左；左右都放不下仍选左（宁左勿右兜底）
    const wantRight = r.right + subW + 8 > b.right;
    const wantLeft = r.left - subW - 8 < b.left;
    let dir: 'left' | 'right' = 'right';
    if (wantRight) dir = 'left';
    // 上下翻向：默认向下弹（top 对齐触发项顶 -5px，与右键 .context-submenu 的 top:-5px 等距）；
    // 向下会溢出有效下边界（触发项顶 + 子高 > 下边界 - 8）则向上弹，子菜单底对齐触发项底 +5px
    // （等价于右键向上弹的 bottom:-5px），与 -5px 约定对称。两处偏移需同步维护。
    const overflowDown = r.top + subH > b.bottom - 8;
    let top = overflowDown ? r.bottom + 5 - subH : r.top - 5;
    top = Math.max(b.top + 8, Math.min(b.bottom - subH - 8, top));
    const posObj = dir === 'right'
      ? { left: r.right + 4, top }
      : { right: cssRightFromX(r.left - 4), top };
    if (name === 'highlight') {
      highlightDir.value = dir;
      highlightUp.value = overflowDown;
      highlightSubPos.value = posObj;
    } else {
      clearDir.value = dir;
      clearUp.value = overflowDown;
      clearSubPos.value = posObj;
    }
    onSubScroll(name);
  });
}
function leaveSub() {
  clearTimeout(subCloseTimer);
  subCloseTimer = setTimeout(() => {
    submenu.value = null;
  }, 150);
}
function enterSubPanel() {
  clearTimeout(subCloseTimer);
}

function pickPreset(type: string) {
  emit('preset', type);
  close();
}
function pickNew() {
  emit('new-rule');
  close();
}
function pickManage() {
  emit('manage');
  close();
}
function pickClear(scope: 'selection' | 'sheet') {
  emit('clear', scope);
  close();
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocDown);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', close, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown);
  window.removeEventListener('resize', close);
  window.removeEventListener('scroll', close, true);
});
</script>

<template>
  <div
    ref="rootRef"
    class="cf-menu-root"
  >
    <button
      ref="btnRef"
      type="button"
      class="toolbar-btn cf-menu-trigger"
      :title="t(locale, 'conditionalFormat')"
      :disabled="!hasSelection"
      @click="toggle"
    >
      <svg
        class="cf-menu-trigger__icon"
        viewBox="0 0 1097 1024"
        version="1.1"
        fill="currentColor"
      >
        <path d="M877.714286 52.809143V487.862857h-73.142857V125.952H73.142857v585.142857h247.661714v73.142857H0v-731.428571z" />
        <path d="M841.142857 267.702857v73.142857H36.571429v-73.142857zM287.451429 457.142857v73.142857H36.571429v-73.142857z" />
        <path d="M324.022857 109.714286v674.596571h-73.142857V109.714286zM584.850286 109.714286v341.942857h-73.142857V109.714286zM1060.278857 512h-658.285714v475.428571h658.285714V512z m-73.216 73.142857v329.142857h-512V585.142857h512z" />
        <path d="M877.421714 637.952v73.142857H568.539429v-73.142857zM877.421714 784.237714v73.142857H568.539429v-73.142857z" />
      </svg>
      <span class="cf-menu-trigger__label">{{ t(locale, 'conditionalFormat') }}</span>
      <svg
        class="cf-menu-trigger__caret"
        viewBox="0 0 1024 1024"
        fill="currentColor"
      ><path d="M180.053 361.387a32 32 0 0 1 45.227 0L512 648.107l286.72-286.72a32 32 0 1 1 45.227 45.227l-309.334 309.333a32 32 0 0 1-45.226 0L180.053 406.613a32 32 0 0 1 0-45.226z" /></svg>
    </button>

    <Teleport to="body">
      <Transition name="cf-pop">
        <div
          v-if="open"
          class="cf-menu"
          :style="{ ...themeVars, right: pos.right + 'px', top: pos.top + 'px' }"
          @click.stop
          @mousedown.prevent
        >
          <button
            v-if="canUp || canDown"
            type="button"
            class="cf-menu__nav"
            :class="{ 'cf-menu__nav--disabled': !canUp }"
            :disabled="!canUp"
            @click="scrollBy(-1)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053 662.613a32 32 0 0 0 45.227 0L512 375.893l286.72 286.72a32 32 0 1 0 45.227-45.226L534.613 307.053a32 32 0 0 0-45.226 0L134.827 617.387a32 32 0 0 0 0 45.226z" /></svg>
          </button>
          <div
            ref="menuRef"
            class="cf-menu__body"
            @scroll="onMenuScroll"
            @wheel.passive="onMenuWheel"
          >
            <div
              class="cf-menu__item cf-menu__item--sub"
              @mouseenter="enterSub('highlight', $event)"
              @mouseleave="leaveSub"
            >
              <span>{{ t(locale, 'cfHighlightRules') }}</span>
              <svg
                class="cf-menu__arrow"
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M361.387 180.053a32 32 0 0 0 0 45.227L648.107 512l-286.72 286.72a32 32 0 1 0 45.227 45.227l309.333-309.334a32 32 0 0 0 0-45.226L406.613 180.053a32 32 0 0 0-45.226 0z" /></svg>
            </div>

            <div class="cf-menu__sep" />

            <button
              type="button"
              class="cf-menu__item"
              :class="{ 'cf-menu__item--disabled': !hasSelection }"
              :disabled="!hasSelection"
              @click="hasSelection && pickPreset('blank')"
            >
              {{ t(locale, 'cfBlank') }}
            </button>
            <button
              type="button"
              class="cf-menu__item"
              :class="{ 'cf-menu__item--disabled': !hasSelection }"
              :disabled="!hasSelection"
              @click="hasSelection && pickPreset('notBlank')"
            >
              {{ t(locale, 'cfNotBlank') }}
            </button>
            <button
              type="button"
              class="cf-menu__item"
              :class="{ 'cf-menu__item--disabled': !hasSelection }"
              :disabled="!hasSelection"
              @click="hasSelection && pickPreset('duplicate')"
            >
              {{ t(locale, 'cfDuplicate') }}
            </button>
            <button
              type="button"
              class="cf-menu__item"
              :class="{ 'cf-menu__item--disabled': !hasSelection }"
              :disabled="!hasSelection"
              @click="hasSelection && pickPreset('unique')"
            >
              {{ t(locale, 'cfUnique') }}
            </button>

            <div class="cf-menu__sep" />

            <button
              type="button"
              class="cf-menu__item"
              @click="pickNew"
            >
              {{ t(locale, 'cfNewRule') }}
            </button>
            <button
              type="button"
              class="cf-menu__item"
              @click="pickManage"
            >
              {{ t(locale, 'cfManageRules') }}
            </button>

            <div
              class="cf-menu__item cf-menu__item--sub"
              @mouseenter="enterSub('clear', $event)"
              @mouseleave="leaveSub"
            >
              <span>{{ t(locale, 'cfClearRules') }}</span>
              <svg
                class="cf-menu__arrow"
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M361.387 180.053a32 32 0 0 0 0 45.227L648.107 512l-286.72 286.72a32 32 0 1 0 45.227 45.227l309.333-309.334a32 32 0 0 0 0-45.226L406.613 180.053a32 32 0 0 0-45.226 0z" /></svg>
            </div>
          </div>
          <button
            v-if="canUp || canDown"
            type="button"
            class="cf-menu__nav"
            :class="{ 'cf-menu__nav--disabled': !canDown }"
            :disabled="!canDown"
            @click="scrollBy(1)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M134.827 361.387a32 32 0 0 1 45.226 0L512 693.333l331.947-331.946a32 32 0 1 1 45.226 45.226L534.613 738.56a32 32 0 0 1-45.226 0L134.827 406.613a32 32 0 0 1 0-45.226z" /></svg>
          </button>
        </div>
      </Transition>
    </Teleport>

    <!-- 突出显示子菜单：独立 Teleport，避免被 cf-menu overflow 裁掉 -->
    <Teleport to="body">
      <Transition name="cf-sub-pop">
        <div
          v-if="open && submenu === 'highlight'"
          class="cf-submenu-wrap"
          :class="{ 'cf-submenu-wrap--left': highlightDir === 'left', 'cf-submenu-wrap--up': highlightUp }"
          :style="{
            ...themeVars,
            left: highlightSubPos.left !== undefined ? highlightSubPos.left + 'px' : undefined,
            right: highlightSubPos.right !== undefined ? highlightSubPos.right + 'px' : undefined,
            top: highlightSubPos.top + 'px',
          }"
          @click.stop
          @mousedown.prevent
          @mouseenter="enterSubPanel"
          @mouseleave="leaveSub"
        >
          <button
            v-if="highlightCanUp || highlightCanDown"
            type="button"
            class="cf-subnav"
            :class="{ 'cf-subnav--disabled': !highlightCanUp }"
            :disabled="!highlightCanUp"
            @click="scrollSubBy('highlight', -1)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053 662.613a32 32 0 0 0 45.227 0L512 375.893l286.72 286.72a32 32 0 1 0 45.227-45.226L534.613 307.053a32 32 0 0 0-45.226 0L134.827 617.387a32 32 0 0 0 0 45.226z" /></svg>
          </button>
          <div
            ref="highlightSubRef"
            class="cf-submenu"
            @scroll="onSubScroll('highlight')"
            @wheel.passive="onHighlightWheel"
          >
            <button
              v-for="it in highlightItems"
              :key="it.type"
              type="button"
              class="cf-menu__subitem"
              @click="pickPreset(it.type)"
            >
              {{ t(locale, it.key) }}
            </button>
          </div>
          <button
            v-if="highlightCanUp || highlightCanDown"
            type="button"
            class="cf-subnav"
            :class="{ 'cf-subnav--disabled': !highlightCanDown }"
            :disabled="!highlightCanDown"
            @click="scrollSubBy('highlight', 1)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M134.827 361.387a32 32 0 0 1 45.226 0L512 693.333l331.947-331.946a32 32 0 1 1 45.226 45.226L534.613 738.56a32 32 0 0 1-45.226 0L134.827 406.613a32 32 0 0 1 0-45.226z" /></svg>
          </button>
        </div>
      </Transition>
    </Teleport>

    <!-- 清除规则子菜单：独立 Teleport -->
    <Teleport to="body">
      <Transition name="cf-sub-pop">
        <div
          v-if="open && submenu === 'clear'"
          class="cf-submenu-wrap"
          :class="{ 'cf-submenu-wrap--left': clearDir === 'left', 'cf-submenu-wrap--up': clearUp }"
          :style="{
            ...themeVars,
            left: clearSubPos.left !== undefined ? clearSubPos.left + 'px' : undefined,
            right: clearSubPos.right !== undefined ? clearSubPos.right + 'px' : undefined,
            top: clearSubPos.top + 'px',
          }"
          @click.stop
          @mousedown.prevent
          @mouseenter="enterSubPanel"
          @mouseleave="leaveSub"
        >
          <button
            v-if="clearCanUp || clearCanDown"
            type="button"
            class="cf-subnav"
            :class="{ 'cf-subnav--disabled': !clearCanUp }"
            :disabled="!clearCanUp"
            @click="scrollSubBy('clear', -1)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M180.053 662.613a32 32 0 0 0 45.227 0L512 375.893l286.72 286.72a32 32 0 1 0 45.227-45.226L534.613 307.053a32 32 0 0 0-45.226 0L134.827 617.387a32 32 0 0 0 0 45.226z" /></svg>
          </button>
          <div
            ref="clearSubRef"
            class="cf-submenu"
            @scroll="onSubScroll('clear')"
            @wheel.passive="onClearWheel"
          >
            <button
              type="button"
              class="cf-menu__subitem"
              :class="{ 'cf-menu__item--disabled': !hasSelection }"
              :disabled="!hasSelection"
              @click="hasSelection && pickClear('selection')"
            >
              {{ t(locale, 'cfClearSelected') }}
            </button>
            <button
              type="button"
              class="cf-menu__subitem"
              @click="pickClear('sheet')"
            >
              {{ t(locale, 'cfClearSheet') }}
            </button>
          </div>
          <button
            v-if="clearCanUp || clearCanDown"
            type="button"
            class="cf-subnav"
            :class="{ 'cf-subnav--disabled': !clearCanDown }"
            :disabled="!clearCanDown"
            @click="scrollSubBy('clear', 1)"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M134.827 361.387a32 32 0 0 1 45.226 0L512 693.333l331.947-331.946a32 32 0 1 1 45.226 45.226L534.613 738.56a32 32 0 0 1-45.226 0L134.827 406.613a32 32 0 0 1 0-45.226z" /></svg>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.cf-menu-root { display: flex; align-items: center; flex: 0 0 auto; width: 100%; }
.cf-menu-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  height: 26px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #444);
  font-size: 12px;
  cursor: pointer;
  padding: 0 5px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  min-width: 0;
}
.cf-menu-trigger:hover:not(:disabled) { background: var(--sp-toolbar-btn-hover-bg, #e6e6e6); }
.cf-menu-trigger:disabled { color: var(--sp-toolbar-btn-disabled-color, #aaa); cursor: default; }
.cf-menu-trigger__icon { width: 16px; height: 16px; }
.cf-menu-trigger__label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.cf-menu-trigger__caret { width: 10px; height: 10px; opacity: 0.7; flex: none; }

.cf-menu {
  position: fixed;
  z-index: 40000;
  background: #fff;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  padding: 4px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  transform-origin: top center;
  white-space: nowrap;
  display: flex;
  flex-direction: column;
}
.cf-menu__body {
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  scrollbar-width: none;
}
.cf-menu__body::-webkit-scrollbar { display: none; }
.cf-menu__nav {
  flex: 0 0 auto;
  height: 18px;
  border: none;
  background: transparent;
  color: #888;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
}
.cf-menu__nav:hover:not(:disabled) { background: #eef3f9; }
.cf-menu__nav:disabled { color: #d5d5d5; cursor: default; }
.cf-menu__nav svg { width: 10px; height: 10px; }
.cf-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #444);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 3px;
  box-sizing: border-box;
}
.cf-menu__item:hover { background: #eef3f9; }
.cf-menu__item--disabled { color: #c9c9c9; cursor: default; }
.cf-menu__item--disabled:hover { background: transparent; }
.cf-menu__item--sub { position: relative; }
.cf-menu__arrow { width: 12px; height: 12px; flex: none; fill: #888; }
.cf-menu__sep { height: 1px; background: var(--sp-toolbar-border, #e0e0e0); margin: 3px 4px; }
.cf-submenu-wrap {
  position: fixed;
  background: #fff;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  padding: 4px;
  box-sizing: border-box;
  z-index: 40000;
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  /* 从「弹出的那个角」起展开/收拢：右弹→左上角，左弹→右上角 */
  transform-origin: top left;
}
.cf-submenu-wrap--left { transform-origin: top right; }
.cf-submenu-wrap--up { transform-origin: bottom left; }
.cf-submenu-wrap--left.cf-submenu-wrap--up { transform-origin: bottom right; }
.cf-submenu {
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  scrollbar-width: none;
}
.cf-submenu::-webkit-scrollbar { display: none; }
.cf-subnav {
  flex: 0 0 auto;
  height: 18px;
  border: none;
  background: transparent;
  color: #888;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
}
.cf-subnav:hover:not(:disabled) { background: #eef3f9; }
.cf-subnav:disabled { color: #d5d5d5; cursor: default; }
.cf-subnav svg { width: 10px; height: 10px; }
.cf-menu__subitem {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #444);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 3px;
  box-sizing: border-box;
}
.cf-menu__subitem:hover { background: #eef3f9; }
.cf-menu__subitem--disabled { color: #c9c9c9; cursor: default; }
.cf-menu__subitem--disabled:hover { background: transparent; }

.cf-pop-enter-active, .cf-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.cf-pop-enter-from, .cf-pop-leave-to { opacity: 0; transform: scaleY(0.85); }
/* 子菜单：以弹出的角为原点做二维缩放，向其余三个方向扩展 / 收拢 */
.cf-sub-pop-enter-active, .cf-sub-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.cf-sub-pop-enter-from, .cf-sub-pop-leave-to { opacity: 0; transform: scale(0.85); }
</style>
