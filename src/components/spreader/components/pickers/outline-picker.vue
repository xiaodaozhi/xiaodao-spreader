<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount, inject } from 'vue';
import { t } from '../../core/constants';

import { useFloatMenuPosition } from '../../composables/float-menu-position';

// 主题作用域：浮层经 Teleport 脱离组件 DOM 树，无法继承组件根上的 --sp-* 变量，
// 故在此 inject spreader 下发的主题，并在浮层根挂载作用域类，使 dark 变量仅本组件内生效，
// 而不依赖 <html> 全局类（以免污染调用方项目的主题）。
const spTheme = inject('sp-theme', 'light') as string;

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

// 工具栏「分组」菜单项：与行列右键菜单「分组」子菜单同构的 5 个动词（添加分组 → 取消分组 → 清除分组 → 全部展开 → 全部折叠），
// 按用户"按右键分组子菜单整一整"的要求排定，顺序保持与右键一致，不要擅改。
// 工具栏按钮仅在选中整行/整列时可用（axis 非 null），菜单项直接作用于该轴，不弹「行/列」子菜单。
// 轴已由选区决定（选中行→rows，选中列→cols）。action key 形如 `group-rows`/`expand-cols`。
const ITEMS: OutlineItem[] = [
  { key: 'group', i18nKey: 'outlineAddGroup' },
  { key: 'ungroup', i18nKey: 'outlineUngroup' },
  { key: 'clear', i18nKey: 'outlineClear' },
  { key: 'expand', i18nKey: 'outlineExpandAll' },
  { key: 'collapse', i18nKey: 'outlineCollapseAll' },
];

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
// 复用与条件格式下拉框同一套定位逻辑（useFloatMenuPosition），不再单独写一套
const { pos, place } = useFloatMenuPosition();

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
          class="outline-picker__menu sp-spreader-overlay"
          :style="{ left: pos.left !== undefined ? pos.left + 'px' : undefined, right: pos.right !== undefined ? pos.right + 'px' : undefined, top: pos.top + 'px' }"
          :class="{ dark: spTheme === 'dark' }"
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
/* 弹出菜单容器：与条件格式 .cf-menu 取值完全对齐（z-index / 边框 / 阴影 / transform-origin / 字体） */
.outline-picker__menu {
  position: fixed;
  z-index: 40000;
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  user-select: none;
  padding: 4px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  transform-origin: top center;
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  min-width: 168px;
}
/* 菜单项：与 .cf-menu__item 同构（space-between / gap 8px / text-align left / hover #eef3f9） */
.outline-picker__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #444);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  border-radius: 3px;
  box-sizing: border-box;
}
.outline-picker__item--open { background: var(--sp-toolbar-btn-hover-bg, #eef3f9); }
.outline-picker__item:hover { background: var(--sp-toolbar-btn-hover-bg, #eef3f9); }
.outline-picker__label { flex: 1; }
.outline-picker__arrow { width: 12px; height: 12px; flex-shrink: 0; transform: rotate(-90deg); opacity: 0.7; }
/* 分隔线：与 .cf-menu__sep 同构（1px 实线，margin 3px 4px） */
.outline-picker__sep { height: 1px; background: var(--sp-toolbar-border, #e0e0e0); margin: 3px 4px; }
/* 过渡：与 .cf-pop 同构（scaleY 纵向展开） */
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scaleY(0.85); }
</style>
