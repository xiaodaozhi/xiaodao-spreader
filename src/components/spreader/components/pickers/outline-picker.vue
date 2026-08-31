<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount, computed } from 'vue';
import { t } from '../../core/constants';
import { getFloatBounds, cssRightFromX } from '../../core/utils';

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
  triggerEl?: HTMLElement | null;
  /** 边界基准元素（通常是表格容器 wrapper）：菜单不得越出其可视区，见 bounds() */
  boundaryEl?: HTMLElement | null;
}>(), {
  modelOpen: undefined,
  locale: 'zh-CN',
  triggerEl: null,
  boundaryEl: null,
});

const emit = defineEmits<{
  (e: 'update:modelOpen', v: boolean): void;
  (e: 'action', v: string): void;
}>();

interface OutlineItem {
  key: string;
  i18nKey: string;
  /** 二级子菜单（行 / 列） */
  children?: { key: string; i18nKey: string }[];
  disabled?: boolean;
  sep?: boolean;
}

// Data > 分组 菜单项：分组/取消组合 带行·列子级，其余为直接动作
const ITEMS: OutlineItem[] = [
  { key: 'group', i18nKey: 'outlineGroup', children: [
    { key: 'group-rows', i18nKey: 'outlineRows' },
    { key: 'group-cols', i18nKey: 'outlineColumns' },
  ] },
  { key: 'ungroup', i18nKey: 'outlineUngroup', children: [
    { key: 'ungroup-rows', i18nKey: 'outlineUngroupRows' },
    { key: 'ungroup-cols', i18nKey: 'outlineUngroupColumns' },
  ] },
  { key: 'sep1', i18nKey: '_sep', disabled: true, sep: true },
  { key: 'expand-all', i18nKey: 'outlineExpandAll' },
  { key: 'collapse-all', i18nKey: 'outlineCollapseAll' },
  { key: 'sep2', i18nKey: '_sep', disabled: true, sep: true },
  { key: 'clear', i18nKey: 'outlineClearAll' },
];

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const pos = ref<{ left?: number; right?: number; top: number }>({ top: 0 });
/** 当前展开的子菜单父级 key */
const subKey = ref<string | null>(null);
/** 二级子菜单（行/列选择）DOM 与定位，仿 conditional-format-menu：fixed + JS 测量翻向 */
const subRef = ref<HTMLDivElement | null>(null);
const subPos = ref<{ left?: number; right?: number; top: number }>({ top: 0 });
const subDir = ref<'left' | 'right'>('right');
const subUp = ref(false);
const currentSubItem = computed(
  () => ITEMS.find((i) => i.key === subKey.value && i.children?.length) ?? null,
);

function enterSub(item: OutlineItem, e: MouseEvent) {
  const el = e.currentTarget as HTMLElement | null;
  if (!el || !item.children?.length) {
    subKey.value = null;
    return;
  }
  subKey.value = item.key;
  // 子菜单在独立 Teleport（fixed）渲染，nextTick 后可测量真实尺寸
  nextTick(() => {
    const r = el.getBoundingClientRect();
    const subEl = subRef.value;
    if (!subEl) return;
    const b = getFloatBounds(props.boundaryEl);
    const subW = subEl.offsetWidth;
    const subH = subEl.offsetHeight;
    // 左右翻向：默认向右（left = r.right + 4）；右侧放不下（含 8px 余量）则翻左（right = cssRightFromX(r.left - 4)）
    const wantRight = r.right + subW + 8 > b.right;
    const dir: 'left' | 'right' = wantRight ? 'left' : 'right';
    // 上下翻向：默认向下弹（top = r.top - 5，与右键 .context-submenu top:-5px 等距）；
    // 向下溢出有效下边界（r.top + subH > b.bottom - 8）则向上弹（top = r.bottom + 5 - subH，等价 bottom:-5px），对称
    const overflowDown = r.top + subH > b.bottom - 8;
    let top = overflowDown ? r.bottom + 5 - subH : r.top - 5;
    top = Math.max(b.top + 8, Math.min(b.bottom - subH - 8, top));
    subDir.value = dir;
    subUp.value = overflowDown;
    subPos.value = dir === 'right'
      ? { left: r.right + 4, top }
      : { right: cssRightFromX(r.left - 4), top };
  });
}

watch(() => props.modelOpen, (v) => {
  if (v !== undefined && v !== open.value) {
    if (v) openMenu();
    else close();
  }
});

function onClickOutside(e: PointerEvent) {
  const el = rootRef.value;
  const mEl = menuRef.value;
  const sEl = subRef.value;
  const t = e.target as Node;
  if (el && el.contains(t)) return;
  if (mEl && mEl.contains(t)) return;
  if (sEl && sEl.contains(t)) return;
  close();
}

function openMenu() {
  const el = props.triggerEl ?? rootRef.value;
  if (!el) return;
  open.value = true;
  subKey.value = null;
  if (props.modelOpen !== undefined) emit('update:modelOpen', true);
  const b = getFloatBounds(props.boundaryEl);
  const r = el.getBoundingClientRect();
  // 菜单右缘目标位置：贴 trigger 右缘，但若 trigger 右缘越出有效右边界则夹回边界内
  const menuTargetRight = Math.min(r.right, b.right);
  let right: number | undefined = cssRightFromX(menuTargetRight);
  const estMenuW = 168;
  let posLeft: number | undefined;
  if (r.left - estMenuW < b.left + 4) {
    right = undefined;
    posLeft = Math.max(b.left + 4, r.left);
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
    const spaceBelow = b.bottom - r2.bottom - 8;
    const spaceAbove = r2.top - b.top - 8;
    const up = spaceBelow < h && spaceAbove > 0;
    let top = up ? r2.top - h - 4 : r2.bottom + 4;
    top = Math.max(b.top + 4, Math.min(b.bottom - h - 4, top));
    pos.value = right !== undefined
      ? { right: cssRightFromX(Math.min(r2.right, b.right)), top }
      : { left: posLeft!, top };
    document.addEventListener('pointerdown', onClickOutside);
  });
}

function close() {
  open.value = false;
  subKey.value = null;
  if (props.modelOpen !== undefined) emit('update:modelOpen', false);
  document.removeEventListener('pointerdown', onClickOutside);
}

function onAction(key: string) {
  emit('action', key);
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
    class="outline-picker"
  >
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="open"
          ref="menuRef"
          class="outline-picker__menu"
          :style="{ left: pos.left !== undefined ? pos.left + 'px' : undefined, right: pos.right !== undefined ? pos.right + 'px' : undefined, top: pos.top + 'px' }"
          @mousedown.stop.prevent
        >
          <template
            v-for="item in ITEMS"
            :key="item.key"
          >
            <div
              v-if="item.sep"
              class="outline-picker__sep"
            />
            <div
              v-else
              class="outline-picker__item"
              :class="{ 'outline-picker__item--open': subKey === item.key }"
              @mouseenter="enterSub(item, $event)"
              @click="item.children?.length ? null : onAction(item.key)"
            >
              <span class="outline-picker__label">{{ t(locale, item.i18nKey) }}</span>
              <svg
                v-if="item.children?.length"
                class="outline-picker__arrow"
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M397.387 180.053a32 32 0 0 1 0 45.227L678.107 512l-280.72 286.72a32 32 0 1 1-45.227-45.227l258.88-241.493L352.16 225.28a32 32 0 0 1 0-45.227l45.227 0z" /></svg>
            </div>
          </template>
        </div>
      </Transition>
    </Teleport>
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="currentSubItem"
          ref="subRef"
          class="outline-picker__sub"
          :class="{ 'outline-picker__sub--left': subDir === 'left', 'outline-picker__sub--up': subUp }"
          :style="{ left: subPos.left !== undefined ? subPos.left + 'px' : undefined, right: subPos.right !== undefined ? subPos.right + 'px' : undefined, top: subPos.top + 'px' }"
          @mousedown.stop.prevent
        >
          <div
            v-for="c in currentSubItem.children"
            :key="c.key"
            class="outline-picker__sub-item"
            @click.stop="onAction(c.key)"
          >
            {{ t(locale, c.i18nKey) }}
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.outline-picker { position: relative; display: inline-flex; height: 26px; }
.outline-picker__menu {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  user-select: none;
  padding: 4px;
  transform-origin: top right;
  min-width: 168px;
}
.outline-picker__item {
  position: relative;
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
  box-sizing: border-box;
}
.outline-picker__item--open { background: #eef3f9; }
.outline-picker__item:hover { background: #eef3f9; }
.outline-picker__label { flex: 1; }
.outline-picker__arrow { width: 12px; height: 12px; flex-shrink: 0; transform: rotate(-90deg); opacity: 0.7; }
.outline-picker__sep { height: 0; border-top: 1px solid #e5e5e5; margin: 4px 2px; }
/* 二级子菜单改为 fixed + JS 测量翻向（仿 conditional-format-menu），与右键 .context-submenu 的 -5px 约定对齐 */
.outline-picker__sub {
  position: fixed;
  z-index: 10000;
  min-width: 132px;
  background: #fff;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 4px;
  transform-origin: top left;
}
.outline-picker__sub--left { transform-origin: top right; }
.outline-picker__sub--up { transform-origin: bottom left; }
.outline-picker__sub--left.outline-picker__sub--up { transform-origin: bottom right; }
.outline-picker__sub-item {
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  white-space: nowrap;
  color: var(--sp-toolbar-btn-color, #444);
  cursor: pointer;
}
.outline-picker__sub-item:hover { background: #eef3f9; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }
</style>
