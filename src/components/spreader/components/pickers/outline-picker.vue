<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { t } from '../../core/constants';
import { getFloatBounds, cssRightFromX } from '../../core/utils';

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
  triggerEl?: HTMLElement | null;
  /** 边界基准元素（通常是表格容器 wrapper）：菜单不得越出其可视区，见 bounds() */
  boundaryEl?: HTMLElement | null;
  /** 当前选区轴：'rows'=选中整行，'cols'=选中整列，null=未选中行/列（按钮置灰）。菜单项直接作用于该轴，不再弹「行/列」子菜单。 */
  axis?: 'rows' | 'cols' | null;
}>(), {
  modelOpen: undefined,
  locale: 'zh-CN',
  triggerEl: null,
  boundaryEl: null,
  axis: null,
});

const emit = defineEmits<{
  (e: 'update:modelOpen', v: boolean): void;
  (e: 'action', v: string): void;
}>();

interface OutlineItem {
  key: string;
  i18nKey: string;
  disabled?: boolean;
  sep?: boolean;
}

// 工具栏「分组」菜单项：沿用 toolbar 原始顺序（添加分组 → 取消分组 → 分隔 → 全部展开 → 全部折叠 → 分隔 → 清除分组），
// 不再照搬右键子菜单顺序。工具栏按钮仅在选中整行/整列时可用（axis 非 null），菜单项直接作用于该轴，不弹「行/列」子菜单——
// 轴已由选区决定（选中行→rows，选中列→cols）。action key 形如 `group-rows`/`expand-cols`。
const ITEMS: OutlineItem[] = [
  { key: 'group', i18nKey: 'outlineAddGroup' },
  { key: 'ungroup', i18nKey: 'outlineUngroup' },
  { key: 'sep1', i18nKey: '_sep', disabled: true, sep: true },
  { key: 'expand', i18nKey: 'outlineExpandAll' },
  { key: 'collapse', i18nKey: 'outlineCollapseAll' },
  { key: 'sep2', i18nKey: '_sep', disabled: true, sep: true },
  { key: 'clear', i18nKey: 'outlineClearAll' },
];

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const pos = ref<{ left?: number; right?: number; top: number }>({ top: 0 });

watch(() => props.modelOpen, (v) => {
  if (v !== undefined && v !== open.value) {
    if (v) openMenu();
    else close();
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
  if (props.modelOpen !== undefined) emit('update:modelOpen', false);
  document.removeEventListener('pointerdown', onClickOutside);
}

function onItemClick(key: string) {
  if (!props.axis) return;
  emit('action', `${key}-${props.axis}`);
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
              @click="onItemClick(item.key)"
            >
              <span class="outline-picker__label">{{ t(locale, item.i18nKey) }}</span>
            </div>
          </template>
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
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }
</style>
