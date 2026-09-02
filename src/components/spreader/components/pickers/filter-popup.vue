<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { t } from '../../core/constants';
import { colToLabel, getFloatBounds } from '../../core/utils';
import { FILTER_BLANK } from '../../core/filter-core';
import type { SheetFilter, FilterColumn, FilterCondition, FilterOperator } from '../../core/types';
import SpDropdown from '../dropdown.vue';

const props = withDefaults(defineProps<{
  /** 正在筛选的列（0-based） */
  col: number;
  /** 锚点：筛选按钮左上角（屏幕坐标） */
  anchor: { x: number; y: number };
  locale?: string;
  /** 当前列 Header 单元格的值（如「班级」），缺省回退到列字母 */
  headerLabel?: string;
  getFilter: () => SheetFilter | null;
  setFilter: (f: SheetFilter | null) => void;
  setFilterColumn: (col: number, fc: FilterColumn | null) => void;
  clearFilterColumn: (col: number) => void;
  getColumnCandidates: (col: number) => { values: string[]; hasBlank: boolean };
  close: () => void;
  /** 边界基准元素（通常是表格容器 wrapper）：弹窗不得越出其可视区，见 getFloatBounds */
  boundaryEl?: HTMLElement | null;
}>(), {
  locale: 'zh-CN',
});

const POPUP_W = 248;
const ITEM_H = 28;
const LIST_H = 252;

const rootRef = ref<HTMLDivElement | null>(null);
const listRef = ref<HTMLDivElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const pos = ref<{ left: number; top: number }>({ left: 0, top: 0 });
const viewMode = ref<'values' | 'text' | 'number' | 'date'>('values');
const search = ref('');
const selected = ref<Set<string>>(new Set());
const blankChecked = ref(false);
const scrollTop = ref(0);
const snapshot = ref<SheetFilter | null>(null);

// 条件筛选编辑状态
const condOp = ref<FilterOperator>('equals');
const condVal = ref('');
const condVal2 = ref('');

/** 候选值（级联：随其它列筛选实时重算） */
const cand = computed(() => props.getColumnCandidates(props.col));

const searchActive = computed(() => search.value.trim() !== '');
const filteredCandidates = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return cand.value.values;
  return cand.value.values.filter((v) => v.toLowerCase().includes(q));
});

/** 展示列表 = 搜索过滤后的候选 + 空白项 */
const listItems = computed<{ key: string; label: string; isBlank: boolean }[]>(() => {
  const items = filteredCandidates.value.map((v) => ({ key: v, label: v, isBlank: false }));
  if (cand.value.hasBlank && !searchActive.value) {
    items.push({ key: FILTER_BLANK, label: t(props.locale, 'filterBlank'), isBlank: true });
  }
  return items;
});

// ---- 虚拟列表 ----
const visibleCount = Math.ceil(LIST_H / ITEM_H);
const startIdx = computed(() => Math.max(0, Math.floor(scrollTop.value / ITEM_H) - 2));
const endIdx = computed(() => Math.min(listItems.value.length, startIdx.value + visibleCount + 4));
const slice = computed(() => listItems.value.slice(startIdx.value, endIdx.value));
const padTop = computed(() => startIdx.value * ITEM_H);
const padBottom = computed(() => Math.max(0, (listItems.value.length - endIdx.value) * ITEM_H));

function onListScroll(e: Event) {
  scrollTop.value = (e.target as HTMLElement).scrollTop;
}

// ---- 条件筛选算子 ----
const TEXT_OPS: FilterOperator[] = ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith'];
const NUM_OPS: FilterOperator[] = ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between'];
const OP_I18N: Record<FilterOperator, string> = {
  equals: 'filterEquals',
  notEquals: 'filterNotEquals',
  contains: 'filterContains',
  notContains: 'filterNotContains',
  startsWith: 'filterStartsWith',
  endsWith: 'filterEndsWith',
  gt: 'filterGreaterThan',
  gte: 'filterGreaterThanOrEqual',
  lt: 'filterLessThan',
  lte: 'filterLessThanOrEqual',
  between: 'filterBetween',
  blank: 'filterBlank',
  notBlank: 'filterNonBlank',
};
const currentOps = computed(() => (viewMode.value === 'text' ? TEXT_OPS : NUM_OPS));
/** SpDropdown options（label 走 i18n，value 为 FilterOperator） */
const operatorOptions = computed(() =>
  currentOps.value.map((op) => ({ value: op, label: t(props.locale, OP_I18N[op]) })),
);
function onCondOpChange(v: string | number) {
  condOp.value = v as FilterOperator;
}
/** 当前模式对应的本地化文案（用于条件视图右上角「文本筛选 / 数字筛选 / 日期筛选」徽标） */
const MODE_I18N: Record<'text' | 'number' | 'date', string> = {
  text: 'filterText',
  number: 'filterNumber',
  date: 'filterDate',
};
const currentModeLabel = computed(() => {
  const m = viewMode.value;
  const key = MODE_I18N[m as 'text' | 'number' | 'date'] ?? MODE_I18N.text;
  return t(props.locale, key);
});

/** 该列当前筛选是否已生效（用于头部高亮标记） */
const columnActive = computed(() => {
  const f = props.getFilter();
  const fc = f?.columns[props.col];
  if (!fc) return false;
  if (fc.type === 'values') return (fc.values?.length ?? 0) > 0;
  return !!fc.condition;
});

// ---- 初始化 ----
function initFromFilter() {
  const f = props.getFilter();
  const fc = f?.columns[props.col];
  if (fc && fc.type === 'values') {
    selected.value = new Set((fc.values ?? []).filter((v) => v !== FILTER_BLANK));
    blankChecked.value = (fc.values ?? []).includes(FILTER_BLANK);
  } else if (fc && fc.condition) {
    viewMode.value = fc.type;
    condOp.value = fc.condition.operator;
    condVal.value = fc.condition.value ?? '';
    condVal2.value = fc.condition.value2 ?? '';
  } else {
    // 该列未筛选：默认全选
    selected.value = new Set(cand.value.values);
    blankChecked.value = cand.value.hasBlank;
  }
}

// ---- 值列表模式：仅维护本地态，点击「确定」才提交（避免实时影响表格） ----
function syncValuesFilter() {
  const f = props.getFilter();
  if (!f) return;
  const allVals = cand.value.values;
  const allBlank = cand.value.hasBlank;
  const allChecked
    = selected.value.size === allVals.length
      && allVals.every((v) => selected.value.has(v))
      && blankChecked.value === allBlank;
  if (allChecked) {
    props.setFilterColumn(props.col, null);
  } else {
    const vals = [...selected.value];
    if (blankChecked.value) vals.push(FILTER_BLANK);
    props.setFilterColumn(props.col, { type: 'values', values: vals });
  }
}

function toggleValue(v: string) {
  const next = new Set(selected.value);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  selected.value = next;
}

function toggleBlank() {
  blankChecked.value = !blankChecked.value;
}

function selectAll() {
  const items = searchActive.value ? filteredCandidates.value : cand.value.values;
  const next = new Set(selected.value);
  items.forEach((v) => next.add(v));
  selected.value = next;
  blankChecked.value = true;
}

function clearAllSelection() {
  selected.value = new Set();
  blankChecked.value = false;
}

// ---- 条件模式 ----
function enterMode(m: 'text' | 'number' | 'date') {
  viewMode.value = m;
  condOp.value = m === 'text' ? 'contains' : 'equals';
  condVal.value = '';
  condVal2.value = '';
}

function backToValues() {
  viewMode.value = 'values';
  initFromFilter();
}

function applyCondition() {
  const cond: FilterCondition = { operator: condOp.value, value: condVal.value };
  if (viewMode.value !== 'text' && condOp.value === 'between') cond.value2 = condVal2.value;
  if (condVal.value.trim() === '') return;
  props.setFilterColumn(props.col, { type: viewMode.value, condition: cond });
  props.close();
}

// ---- 底部操作 ----
function clearColumn() {
  // 仅把本地选择置为「全选」（等价于该列无筛选），提交后由 onOk 生效；不实时改 filter
  selected.value = new Set(cand.value.values);
  blankChecked.value = cand.value.hasBlank;
}

function onOk() {
  syncValuesFilter();
  props.close();
}

function onCancel() {
  if (snapshot.value) props.setFilter(snapshot.value);
  props.close();
}

// ---- 外部点击 / 键盘 ----
function onPointerDown(e: PointerEvent) {
  const el = rootRef.value;
  if (el && e.target instanceof Node && el.contains(e.target)) return;
  props.close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') onCancel();
}

onMounted(async () => {
  snapshot.value = props.getFilter() ? JSON.parse(JSON.stringify(props.getFilter())) : null;
  initFromFilter();
  await nextTick();
  // 定位：右缘对齐按钮右缘；底部越界时向上翻转
  const estH = rootRef.value?.offsetHeight ?? 400;
  let x = props.anchor.x + 15 - POPUP_W;
  let y = props.anchor.y + 24;
  const b = getFloatBounds(props.boundaryEl);
  if (x < b.left + 4) x = Math.max(b.left + 4, props.anchor.x);
  if (x + POPUP_W > b.right - 4) x = Math.max(b.left + 4, b.right - POPUP_W - 4);
  if (y + estH > b.bottom - 4) y = Math.max(b.top + 4, props.anchor.y - estH - 4);
  pos.value = { left: x, top: y };
  searchInputRef.value?.focus();
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('keydown', onKeydown, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootRef"
      class="filter-popup"
      :style="{ left: pos.left + 'px', top: pos.top + 'px' }"
      @pointerdown.stop
    >
      <!-- 头部 -->
      <div class="filter-popup__head">
        <span class="filter-popup__head-label">{{ headerLabel || colToLabel(col) }}</span>
        <span
          v-if="columnActive"
          class="filter-popup__head-badge"
        >{{ t(locale, 'filterActive') }}</span>
      </div>

      <!-- 值列表模式 -->
      <template v-if="viewMode === 'values'">
        <div class="filter-popup__search">
          <input
            ref="searchInputRef"
            v-model="search"
            class="filter-popup__search-input"
            type="text"
            :placeholder="t(locale, 'filterSearchPlaceholder')"
          >
        </div>
        <div class="filter-popup__tools">
          <button
            class="filter-popup__tool"
            @click="selectAll"
          >
            {{ t(locale, 'filterSelectAll') }}
          </button>
          <button
            class="filter-popup__tool"
            @click="clearAllSelection"
          >
            {{ t(locale, 'filterClearAll') }}
          </button>
          <span class="filter-popup__count">{{ t(locale, 'filterFilteredCount').replace('{n}', String(cand.values.length)) }}</span>
        </div>
        <div
          ref="listRef"
          class="filter-popup__list"
          @scroll="onListScroll"
        >
          <div :style="{ height: padTop + 'px' }" />
          <label
            v-for="item in slice"
            :key="item.key"
            class="filter-popup__item"
          >
            <input
              class="filter-popup__item-input"
              type="checkbox"
              :checked="item.isBlank ? blankChecked : selected.has(item.key)"
              @change="item.isBlank ? toggleBlank() : toggleValue(item.key)"
            >
            <span class="filter-popup__item-box">
              <svg
                class="filter-popup__item-tick"
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M405 697L195 487l58-58 152 152 304-304 58 58z" /></svg>
            </span>
            <span class="filter-popup__item-label">{{ item.label }}</span>
            <span
              v-if="item.isBlank"
              class="filter-popup__item-note"
            >({{ t(locale, 'filterBlank') }})</span>
          </label>
          <div :style="{ height: padBottom + 'px' }" />
          <div
            v-if="listItems.length === 0"
            class="filter-popup__empty"
          >
            {{ t(locale, 'filterNoData') }}
          </div>
        </div>
        <!-- 条件筛选入口 -->
        <div class="filter-popup__modes">
          <button
            class="filter-popup__mode"
            @click="enterMode('text')"
          >
            {{ t(locale, 'filterText') }}
          </button>
          <button
            class="filter-popup__mode"
            @click="enterMode('number')"
          >
            {{ t(locale, 'filterNumber') }}
          </button>
          <button
            class="filter-popup__mode"
            @click="enterMode('date')"
          >
            {{ t(locale, 'filterDate') }}
          </button>
        </div>
      </template>

      <!-- 条件模式 -->
      <template v-else>
        <div class="filter-popup__cond">
          <div class="filter-popup__cond-nav">
            <button
              type="button"
              class="filter-popup__back"
              @click="backToValues"
            >
              <svg
                class="filter-popup__back-icon"
                viewBox="0 0 16 16"
                aria-hidden="true"
              ><path
                d="M10 3l-5 5 5 5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              /></svg>
              <span>{{ t(locale, 'filterBack') }}</span>
            </button>
            <span class="filter-popup__cond-mode">{{ currentModeLabel }}</span>
          </div>
          <div class="filter-popup__cond-title">
            {{ t(locale, 'filterCustom') }}
          </div>
          <SpDropdown
            class="filter-popup__cond-op"
            :model-value="condOp"
            :options="operatorOptions"
            :title="t(locale, 'filterCustom')"
            @change="onCondOpChange"
          />
          <div
            v-if="condOp === 'between'"
            class="filter-popup__cond-row filter-popup__cond-row--between"
          >
            <input
              v-model="condVal"
              class="filter-popup__cond-input"
              type="text"
              @keydown.enter="applyCondition"
            >
            <span class="filter-popup__cond-and">{{ t(locale, 'filterAnd') }}</span>
            <input
              v-model="condVal2"
              class="filter-popup__cond-input"
              type="text"
              @keydown.enter="applyCondition"
            >
          </div>
          <div
            v-else
            class="filter-popup__cond-row"
          >
            <input
              v-model="condVal"
              class="filter-popup__cond-input"
              type="text"
              :placeholder="viewMode === 'date' ? 'YYYY-MM-DD' : ''"
              @keydown.enter="applyCondition"
            >
          </div>
          <p
            v-if="viewMode === 'date'"
            class="filter-popup__cond-hint"
          >
            {{ t(locale, 'filterDateHint') }}
          </p>
        </div>
      </template>

      <!-- 底部 -->
      <div class="filter-popup__footer">
        <button
          class="filter-popup__btn filter-popup__btn--clear"
          @click="clearColumn"
        >
          {{ t(locale, 'clearFilter') }}
        </button>
        <span class="filter-popup__footer-spacer" />
        <button
          class="filter-popup__btn"
          @click="onCancel"
        >
          {{ t(locale, 'cancelFilter') }}
        </button>
        <button
          class="filter-popup__btn filter-popup__btn--primary"
          @click="viewMode === 'values' ? onOk() : applyCondition()"
        >
          {{ t(locale, 'filterOk') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.filter-popup {
  position: fixed;
  z-index: 10005;
  width: 248px;
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  color: var(--sp-toolbar-btn-color, #333);
  user-select: none;
  overflow: hidden;
  transform-origin: top right;
}
.filter-popup__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 6px;
  border-bottom: 1px solid var(--sp-toolbar-border, #eee);
}
.filter-popup__head-label {
  font-weight: 600;
  font-size: 13px;
}
.filter-popup__head-badge {
  font-size: 11px;
  color: #0078d7;
  background: rgba(0, 120, 215, 0.1);
  border-radius: 8px;
  padding: 1px 6px;
}
.filter-popup__search { padding: 8px 10px 4px; }
.filter-popup__search-input {
  width: 100%;
  box-sizing: border-box;
  height: 26px;
  border: 1px solid var(--sp-toolbar-border, #ccc);
  border-radius: 3px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  background: var(--sp-formula-bar-input-bg, #fff);
  outline: none;
}
.filter-popup__search-input:focus { border-color: #0078d7; }
.filter-popup__tools {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px 6px;
}
.filter-popup__tool {
  border: none;
  background: transparent;
  color: #0078d7;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
}
.filter-popup__tool:hover { text-decoration: underline; }
.filter-popup__count { margin-left: auto; font-size: 11px; color: var(--sp-toolbar-text-muted, #999); }
.filter-popup__list {
  height: 252px;
  overflow-y: auto;
  border-top: 1px solid var(--sp-toolbar-border, #f0f0f0);
  border-bottom: 1px solid var(--sp-toolbar-border, #f0f0f0);
  /* 自定义滚动条：dark 模式下用主题 thumb 色，避免浏览器默认浅色滚动条在深色背景上突兀 */
  scrollbar-width: thin;
  scrollbar-color: var(--sp-scroll-thumb, #c0c0c0) transparent;
}
.filter-popup__list::-webkit-scrollbar { width: 8px; height: 8px; }
.filter-popup__list::-webkit-scrollbar-track { background: transparent; }
.filter-popup__list::-webkit-scrollbar-thumb {
  background: var(--sp-scroll-thumb, #c0c0c0);
  border-radius: 4px;
}
.filter-popup__list::-webkit-scrollbar-thumb:hover {
  background: var(--sp-scroll-thumb-hover, #a0a0a0);
}
.filter-popup__item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  box-sizing: border-box;
  cursor: pointer;
  white-space: nowrap;
}
.filter-popup__item:hover { background: var(--sp-toolbar-btn-hover-bg, #eef3f9); }

/* 自实现复选框：与查找栏同款（隐藏原生 input，视觉由 box + tick 呈现） */
.filter-popup__item-input {
  position: absolute;
  width: 0;
  height: 0;
  margin: 0;
  padding: 0;
  opacity: 0;
  pointer-events: none;
}
.filter-popup__item-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  box-sizing: border-box;
  border: 1px solid var(--sp-toolbar-border, #c8c8c8);
  border-radius: 2px;
  background: var(--sp-formula-bar-input-bg, #fff);
  transition: background 0.12s ease, border-color 0.12s ease;
}
.filter-popup__item-tick {
  width: 11px;
  height: 11px;
  color: #fff;
  opacity: 0;
  transform: scale(0.5);
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.filter-popup__item-input:checked + .filter-popup__item-box {
  background: #0078d7;
  border-color: #0078d7;
}
.filter-popup__item-input:checked + .filter-popup__item-box .filter-popup__item-tick {
  opacity: 1;
  transform: scale(1);
}
.filter-popup__item-input:focus-visible + .filter-popup__item-box {
  outline: 2px solid rgba(0, 120, 215, 0.4);
  outline-offset: 1px;
}
.filter-popup__item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}
.filter-popup__item-note { font-size: 11px; color: var(--sp-toolbar-text-muted, #999); flex-shrink: 0; }
.filter-popup__empty {
  padding: 16px 10px;
  text-align: center;
  color: var(--sp-toolbar-text-muted, #999);
  font-size: 12px;
}
.filter-popup__modes {
  display: flex;
  gap: 2px;
  padding: 6px 10px;
}
.filter-popup__mode {
  flex: 1;
  border: 1px solid var(--sp-toolbar-border, #e0e0e0);
  background: var(--sp-toolbar-bg, #f7f7f7);
  border-radius: 3px;
  font-size: 12px;
  color: var(--sp-toolbar-btn-color, #444);
  padding: 5px 0;
  cursor: pointer;
}
.filter-popup__mode:hover {
  background: var(--sp-toolbar-btn-hover-bg, #eef3f9);
}

/* ============ 条件视图（文本 / 数字 / 日期 自定义筛选）============ */
.filter-popup__cond {
  padding: 10px 12px 8px;
}
.filter-popup__cond-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.filter-popup__back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px 0 6px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #444);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.filter-popup__back:hover {
  background: var(--sp-toolbar-btn-hover-bg, #eef3f9);
  border-color: var(--sp-toolbar-border, #d0d0d0);
}
.filter-popup__back-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--sp-find-hint-color, #888);
}
.filter-popup__back:hover .filter-popup__back-icon { color: #0078d7; }
.filter-popup__cond-mode {
  font-size: 11px;
  font-weight: 600;
  color: #0078d7;
  background: rgba(0, 120, 215, 0.12);
  border-radius: 8px;
  padding: 2px 8px;
  letter-spacing: 0.2px;
  white-space: nowrap;
}
.filter-popup__cond-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--sp-toolbar-btn-color, #333);
  letter-spacing: 0.2px;
}

/* operator 下拉：复用项目内 SpDropdown，仅 :deep 重写 trigger 样式与弹窗上下文一致 */
.filter-popup__cond-op { display: block; margin-bottom: 8px; }
.filter-popup__cond-op :deep(.sp-dropdown__trigger) {
  width: 100%;
  height: 28px;
  border: 1px solid var(--sp-toolbar-border, #c4c4c4);
  background: var(--sp-formula-bar-input-bg, #fff);
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  padding: 0 8px;
  box-sizing: border-box;
  border-radius: 3px;
  font-size: 13px;
}
.filter-popup__cond-op :deep(.sp-dropdown__trigger:hover) {
  border-color: #0078d7;
  background: var(--sp-toolbar-btn-hover-bg, #f5f5f5);
}
.filter-popup__cond-op :deep(.sp-dropdown__trigger--open) {
  border-color: #0078d7;
  box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3);
}
.filter-popup__cond-op :deep(.sp-dropdown__caret) {
  width: 10px;
  height: 10px;
  color: var(--sp-find-hint-color, #888);
}

.filter-popup__cond-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.filter-popup__cond-row--between { gap: 4px; }
.filter-popup__cond-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  border: 1px solid var(--sp-toolbar-border, #c4c4c4);
  border-radius: 3px;
  padding: 0 8px;
  font-size: 13px;
  font-family: inherit;
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  background: var(--sp-formula-bar-input-bg, #fff);
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.filter-popup__cond-input:hover { border-color: #0078d7; }
.filter-popup__cond-input:focus {
  border-color: #0078d7;
  box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3);
}
.filter-popup__cond-and {
  font-size: 12px;
  color: var(--sp-toolbar-text-secondary, #666);
  flex: 0 0 auto;
  padding: 0 2px;
}
.filter-popup__cond-hint {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--sp-find-hint-color, #888);
}
.filter-popup__footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--sp-toolbar-border, #eee);
}
.filter-popup__btn {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 3px;
  background: var(--sp-toolbar-bg, #f7f7f7);
  color: var(--sp-toolbar-btn-color, #333);
  font-size: 12px;
  cursor: pointer;
}
.filter-popup__btn:hover { background: var(--sp-toolbar-btn-hover-bg, #eef3f9); }
.filter-popup__btn--primary { background: #0078d7; border-color: #0078d7; color: #fff; }
.filter-popup__btn--primary:hover { background: #006cbe; }
.filter-popup__btn--clear {
  color: #ff6b6b;
  border-color: var(--sp-toolbar-border, #d0d0d0);
}
.filter-popup__btn--clear:hover {
  background: rgba(198, 40, 40, 0.18);
  border-color: rgba(198, 40, 40, 0.45);
}
.filter-popup__footer-spacer { flex: 1; }
</style>
