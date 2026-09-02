<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { t } from '../../core/constants';
import { getFloatBounds, cssRightFromX } from '../../core/utils';
import { useFloatMenuPosition } from '../../composables/float-menu-position';
import ColorPalette from './color-palette.vue';
import {
  BORDER_OPTIONS,
  BORDER_SEGS,
  segRole,
  needsCornerDot,
  CORNER_DOT_R,
  CORNER_DOT_CX,
  CORNER_DOT_CY,
} from '../../core/border-icon';
import { borderLineDash, normalizeBorderLineStyle, type BorderLineStyle } from '../../core/border-style';
import type { BorderType } from '../../core/border-icon';

// 类型与图标定义已收敛到 core/border-icon.ts（toolbar 主按钮共用同一份），
// 此处 re-export 仅为兼容既有的 `from './pickers/border-picker.vue'` 导入
export type { BorderType } from '../../core/border-icon';

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
  currentBorder?: BorderType;
  /** 当前选区在「当前边框类型作用域」内的统一边框颜色；'' = 自动（混合 / 无线条） */
  currentColor?: string;
  /** 当前选中的边框线型（用于线型子菜单高亮）；'' = 未选中（混合 / 无线条） */
  currentLineStyle?: string;
  triggerEl?: HTMLElement | null;
  /** 边界基准元素（通常是表格容器 wrapper）：菜单不得越出其可视区，见 getFloatBounds */
  boundaryEl?: HTMLElement | null;
}>(), {
  modelOpen: undefined,
  locale: 'zh-CN',
  currentBorder: 'none',
  currentColor: '',
  currentLineStyle: '',
  triggerEl: null,
  boundaryEl: null,
});

const emit = defineEmits<{
  (e: 'update:modelOpen', v: boolean): void;
  (e: 'change', v: BorderType): void;
  /** 边框颜色变更：沿用当前边框类型作用到已存在的边，不创建新边框 */
  (e: 'changeColor', v: string): void;
  /** 边框线型变更：更新默认线型 + 立即改选区已存在边框，不创建新边框 */
  (e: 'change-line-style', v: BorderLineStyle): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
// 边框颜色子菜单（复用通用 ColorPalette，色板与文字色一致，首项为「自动」），
// 参考条件格式下拉框的「清除规则」子菜单：hover 展开、按角落方向弹出。
const colorSub = ref(false);
const colorSubRef = ref<HTMLElement | null>(null);
const colorSubDir = ref<'left' | 'right'>('right');
const colorSubUp = ref(false);
let colorSubTimer: ReturnType<typeof setTimeout> | undefined;
interface SubPos { left?: number; right?: number; top: number }
const colorSubPos = ref<SubPos>({ top: 0 });
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
  const tgt = e.target as Node;
  if (el && el.contains(tgt)) return;
  if (mEl && mEl.contains(tgt)) return;
  // 嵌套的边框颜色子菜单（.border-submenu-wrap 已 Teleport 到 body）内的点击不应关闭边框浮层
  if (tgt instanceof Element && tgt.closest('.border-submenu-wrap')) return;
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
  colorSub.value = false;
  if (props.modelOpen !== undefined) emit('update:modelOpen', false);
  document.removeEventListener('pointerdown', onClickOutside);
}

function selectBorder(v: BorderType) {
  emit('change', v);
  close();
}

// ---- 边框颜色子菜单：参考条件格式「清除规则」子菜单的角落弹出机制 ----
function enterColorSub(e: MouseEvent) {
  clearTimeout(colorSubTimer);
  colorSub.value = true;
  nextTick(() => {
    const el = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const subEl = colorSubRef.value?.closest('.border-submenu-wrap') as HTMLElement | null;
    if (!subEl) return;
    const b = getFloatBounds(props.boundaryEl);
    const subW = subEl.offsetWidth;
    const subH = subEl.offsetHeight;
    // 左右翻向：默认向右；右侧放不下（含 8px 余量）则翻左
    const wantRight = r.right + subW + 8 > b.right;
    const dir: 'left' | 'right' = wantRight ? 'left' : 'right';
    // 上下翻向：默认向下弹（top 对齐触发项顶 -5px）；向下溢出下边界则向上弹（底对齐触发项底 +5px）
    const overflowDown = r.top + subH > b.bottom - 8;
    const ideal = overflowDown ? r.bottom + 5 - subH : r.top - 5;
    // 夹紧下界：不得高于当前理想位置（避免被硬推离触发项）
    const lower = Math.min(b.top + 8, ideal);
    const top = Math.max(lower, Math.min(b.bottom - subH - 8, ideal));
    colorSubDir.value = dir;
    colorSubUp.value = overflowDown;
    colorSubPos.value = dir === 'right'
      ? { left: r.right + 4, top }
      : { right: cssRightFromX(r.left - 4), top };
  });
}

function leaveColorSub() {
  clearTimeout(colorSubTimer);
  colorSubTimer = setTimeout(() => {
    colorSub.value = false;
  }, 150);
}

function enterColorPanel() {
  clearTimeout(colorSubTimer);
}

function onColorChange(v: string) {
  colorSub.value = false;
  emit('changeColor', v);
  close();
}

// ---- 边框线型子菜单：与边框颜色子菜单同构（hover 展开、按角落方向弹出）----
const LINE_STYLES: { key: BorderLineStyle; i18nKey: string }[] = [
  { key: 'solid', i18nKey: 'lineSolid' },
  { key: 'dashed', i18nKey: 'lineDashed' },
  { key: 'dotted', i18nKey: 'lineDotted' },
];

const lineSub = ref(false);
const lineSubRef = ref<HTMLElement | null>(null);
const lineSubDir = ref<'left' | 'right'>('right');
const lineSubUp = ref(false);
let lineSubTimer: ReturnType<typeof setTimeout> | undefined;
const lineSubPos = ref<SubPos>({ top: 0 });

/** 返回某线型的预览 dash（与 Canvas 实际绘制共用同一套参数），solid 返回 undefined */
function linePreviewDash(style: BorderLineStyle): string | undefined {
  const d = borderLineDash(style, 2);
  return d ? `${d[0]} ${d[1]}` : undefined;
}
function isLineActive(style: BorderLineStyle): boolean {
  return normalizeBorderLineStyle(props.currentLineStyle) === style;
}

function enterLineSub(e: MouseEvent) {
  clearTimeout(lineSubTimer);
  lineSub.value = true;
  nextTick(() => {
    const el = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const subEl = lineSubRef.value?.closest('.border-submenu-wrap') as HTMLElement | null;
    if (!subEl) return;
    const b = getFloatBounds(props.boundaryEl);
    const subW = subEl.offsetWidth;
    const subH = subEl.offsetHeight;
    const wantRight = r.right + subW + 8 > b.right;
    const dir: 'left' | 'right' = wantRight ? 'left' : 'right';
    const overflowDown = r.top + subH > b.bottom - 8;
    const ideal = overflowDown ? r.bottom + 5 - subH : r.top - 5;
    const lower = Math.min(b.top + 8, ideal);
    const top = Math.max(lower, Math.min(b.bottom - subH - 8, ideal));
    lineSubDir.value = dir;
    lineSubUp.value = overflowDown;
    lineSubPos.value = dir === 'right'
      ? { left: r.right + 4, top }
      : { right: cssRightFromX(r.left - 4), top };
  });
}

function leaveLineSub() {
  clearTimeout(lineSubTimer);
  lineSubTimer = setTimeout(() => {
    lineSub.value = false;
  }, 150);
}

function enterLinePanel() {
  clearTimeout(lineSubTimer);
}

function onLineStyleChange(v: BorderLineStyle) {
  lineSub.value = false;
  emit('change-line-style', v);
  close();
}

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onClickOutside);
  clearTimeout(colorSubTimer);
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

          <div class="border-picker__divider" />

          <!-- 边框线型：作为子菜单项，hover 展开实际线型预览面板（参考边框颜色子菜单） -->
          <div
            class="border-picker__item border-picker__item--sub"
            :class="{ 'border-picker__item--sub-open': lineSub }"
            @mouseenter="enterLineSub($event)"
            @mouseleave="leaveLineSub"
          >
            <span
              class="border-picker__line-icon"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 40 20"
                class="border-picker__line-svg"
              >
                <line
                  x1="2"
                  y1="10"
                  x2="38"
                  y2="10"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-dasharray="none"
                  stroke-linecap="butt"
                />
              </svg>
            </span>
            <span class="border-picker__item--sub-label">{{ t(locale, 'borderLineStyle') }}</span>
            <svg
              class="border-picker__arrow"
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M361.387 180.053a32 32 0 0 0 0 45.227L648.107 512l-286.72 286.72a32 32 0 1 0 45.227 45.227l309.333-309.334a32 32 0 0 0 0-45.226L406.613 180.053a32 32 0 0 0-45.226 0z" /></svg>
          </div>

          <!-- 边框颜色：作为子菜单项，hover 展开色板（参考条件格式「清除规则」子菜单） -->
          <div
            class="border-picker__item border-picker__item--sub"
            :class="{ 'border-picker__item--sub-open': colorSub }"
            @mouseenter="enterColorSub($event)"
            @mouseleave="leaveColorSub"
          >
            <svg
              viewBox="0 0 1024 1024"
              class="border-picker__item--sub-icon"
              fill="currentColor"
            ><path d="M563.39456 743.34208v-51.38432h308.3264V332.24704h-102.76864V280.85248h154.14784v462.4896h-359.7056z m-230.84544 51.88608l-26.84928-102.56896 283.93984-463.89248 127.2576 75.17184-284.17024 463.78496-100.17792 27.50464z m-180.26496-103.26528h102.784v51.38432H100.89984V280.85248h359.7056v51.39456H152.28416v359.71584z" /></svg>
            <span class="border-picker__item--sub-label">{{ t(locale, 'borderColor') }}</span>
            <span
              class="border-picker__item--sub-swatch"
              :style="{ background: currentColor || 'var(--sp-border-default, #444)' }"
            />
            <svg
              class="border-picker__arrow"
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M361.387 180.053a32 32 0 0 0 0 45.227L648.107 512l-286.72 286.72a32 32 0 1 0 45.227 45.227l309.333-309.334a32 32 0 0 0 0-45.226L406.613 180.053a32 32 0 0 0-45.226 0z" /></svg>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 边框颜色子菜单面板：独立 Teleport，避免被 border-picker__menu 裁掉 -->
    <Teleport to="body">
      <Transition name="border-sub-pop">
        <div
          v-if="open && colorSub"
          ref="colorSubRef"
          class="border-submenu-wrap"
          :class="{ 'border-submenu-wrap--left': colorSubDir === 'left', 'border-submenu-wrap--up': colorSubUp }"
          :style="{
            left: colorSubPos.left !== undefined ? colorSubPos.left + 'px' : undefined,
            right: colorSubPos.right !== undefined ? colorSubPos.right + 'px' : undefined,
            top: colorSubPos.top + 'px',
          }"
          @click.stop
          @mousedown.prevent
          @mouseenter="enterColorPanel"
          @mouseleave="leaveColorSub"
        >
          <ColorPalette
            color-key="border"
            :current-color="currentColor"
            :locale="locale"
            @pick="onColorChange"
          />
        </div>
      </Transition>
    </Teleport>

    <!-- 边框线型子菜单面板：独立 Teleport，避免被 border-picker__menu 裁掉 -->
    <Teleport to="body">
      <Transition name="border-sub-pop">
        <div
          v-if="open && lineSub"
          ref="lineSubRef"
          class="border-submenu-wrap"
          :class="{ 'border-submenu-wrap--left': lineSubDir === 'left', 'border-submenu-wrap--up': lineSubUp }"
          :style="{
            left: lineSubPos.left !== undefined ? lineSubPos.left + 'px' : undefined,
            right: lineSubPos.right !== undefined ? lineSubPos.right + 'px' : undefined,
            top: lineSubPos.top + 'px',
          }"
          @click.stop
          @mousedown.prevent
          @mouseenter="enterLinePanel"
          @mouseleave="leaveLineSub"
        >
          <button
            v-for="opt in LINE_STYLES"
            :key="opt.key"
            class="border-picker__line-item"
            :class="{ 'border-picker__line-item--active': isLineActive(opt.key) }"
            :title="t(locale, opt.i18nKey)"
            @click="onLineStyleChange(opt.key)"
          >
            <svg
              viewBox="0 0 64 20"
              class="border-picker__line-preview"
            >
              <line
                x1="3"
                y1="10"
                x2="61"
                y2="10"
                stroke="currentColor"
                stroke-width="2"
                :stroke-dasharray="linePreviewDash(opt.key) || 'none'"
                :stroke-linecap="opt.key === 'dotted' ? 'round' : 'butt'"
              />
            </svg>
            <span class="border-picker__line-label">{{ t(locale, opt.i18nKey) }}</span>
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
  background: var(--sp-toolbar-bg, #fff);
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
.border-picker__item:hover { background: var(--sp-toolbar-btn-hover-bg, #eef3f9); }
.border-picker__icon { width: 18px; height: 18px; flex-shrink: 0; }
.border-picker__label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.border-picker__divider { height: 1px; background: var(--sp-toolbar-border, #e3e3e3); margin: 4px 2px; }
.border-picker__item--sub { position: relative; }
.border-picker__item--sub-icon { width: 16px; height: 16px; flex-shrink: 0; }
.border-picker__item--sub-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.border-picker__item--sub-swatch {
  width: 16px;
  height: 12px;
  flex-shrink: 0;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.25);
  box-shadow: inset 0 0 0 1px #fff;
}
.border-picker__arrow { width: 12px; height: 12px; flex: none; fill: var(--sp-toolbar-btn-color, #888); }

/* 边框颜色子菜单面板：与条件格式子菜单同构，按角落方向弹出 */
.border-submenu-wrap {
  position: fixed;
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 6px;
  box-sizing: border-box;
  z-index: 40000;
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  transform-origin: top left;
}
.border-submenu-wrap--left { transform-origin: top right; }
.border-submenu-wrap--up { transform-origin: bottom left; }
.border-submenu-wrap--left.border-submenu-wrap--up { transform-origin: bottom right; }

/* 边框线型子菜单项（面板内每行：实际线型预览 + 文案，高亮当前选中） */
.border-picker__line-item {
  display: flex;
  align-items: center;
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
  box-sizing: border-box;
}
.border-picker__line-item:hover { background: var(--sp-toolbar-btn-hover-bg, #eef3f9); }
.border-picker__line-item--active { background: #e3edf9; }
.border-picker__line-item--active:hover { background: #d5e4f7; }
.border-picker__line-preview {
  width: 64px;
  height: 20px;
  flex: 0 0 auto;
  color: var(--sp-toolbar-btn-color, #444);
}
.border-picker__line-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 边框线型子菜单触发器里的静态实线图标 */
.border-picker__line-icon { width: 16px; height: 16px; flex-shrink: 0; display: inline-flex; align-items: center; }
.border-picker__line-svg { width: 40px; height: 20px; color: var(--sp-toolbar-btn-color, #444); }

.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scaleY(0.85); }
.border-sub-pop-enter-active, .border-sub-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.border-sub-pop-enter-from, .border-sub-pop-leave-to { opacity: 0; transform: scale(0.85); }
</style>
