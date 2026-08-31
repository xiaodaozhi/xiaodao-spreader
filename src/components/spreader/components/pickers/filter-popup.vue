<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { t } from '../../core/constants';
import { colToLabel, getFloatBounds } from '../../core/utils';
import { FILTER_BLANK } from '../../core/filter-core';
import type { SheetFilter, FilterColumn, FilterCondition, FilterOperator } from '../../core/types';

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
              type="checkbox"
              :checked="item.isBlank ? blankChecked : selected.has(item.key)"
              @change="item.isBlank ? toggleBlank() : toggleValue(item.key)"
            >
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
          <button
            class="filter-popup__cond-back"
            @click="backToValues"
          >
            ← {{ t(locale, 'filterCustom') }}
          </button>
          <div class="filter-popup__cond-row">
            <select
              v-model="condOp"
              class="filter-popup__cond-select"
            >
              <option
                v-for="op in currentOps"
                :key="op"
                :value="op"
              >
                {{ t(locale, OP_I18N[op]) }}
              </option>
            </select>
          </div>
          <div
            v-if="condOp === 'between'"
            class="filter-popup__cond-row"
          >
            <input
              v-model="condVal"
              class="filter-popup__cond-input"
              type="text"
            >
            <span class="filter-popup__cond-and">{{ t(locale, 'filterAnd') }}</span>
            <input
              v-model="condVal2"
              class="filter-popup__cond-input"
              type="text"
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
              :placeholder="viewMode === 'date' ? '2024-01-01' : ''"
              @keydown.enter="applyCondition"
            >
          </div>
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
  background: #fff;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  color: #333;
  user-select: none;
  overflow: hidden;
  transform-origin: top right;
}
.filter-popup__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 6px;
  border-bottom: 1px solid #eee;
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
  border: 1px solid #ccc;
  border-radius: 3px;
  padding: 0 8px;
  font-size: 12px;
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
.filter-popup__count { margin-left: auto; font-size: 11px; color: #999; }
.filter-popup__list {
  height: 252px;
  overflow-y: auto;
  border-top: 1px solid #f0f0f0;
  border-bottom: 1px solid #f0f0f0;
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
.filter-popup__item:hover { background: #eef3f9; }
.filter-popup__item input { margin: 0; flex-shrink: 0; }
.filter-popup__item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}
.filter-popup__item-note { font-size: 11px; color: #999; flex-shrink: 0; }
.filter-popup__empty {
  padding: 16px 10px;
  text-align: center;
  color: #999;
  font-size: 12px;
}
.filter-popup__modes {
  display: flex;
  gap: 2px;
  padding: 6px 10px;
}
.filter-popup__mode {
  flex: 1;
  border: 1px solid #e0e0e0;
  background: #f7f7f7;
  border-radius: 3px;
  font-size: 12px;
  color: #444;
  padding: 5px 0;
  cursor: pointer;
}
.filter-popup__mode:hover { background: #eef3f9; border-color: #c8d8f0; }
.filter-popup__cond { padding: 8px 10px; }
.filter-popup__cond-back {
  border: none;
  background: transparent;
  color: #0078d7;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  margin-bottom: 8px;
}
.filter-popup__cond-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.filter-popup__cond-select {
  width: 100%;
  height: 26px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 12px;
  background: #fff;
  outline: none;
}
.filter-popup__cond-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  border: 1px solid #ccc;
  border-radius: 3px;
  padding: 0 6px;
  font-size: 12px;
  box-sizing: border-box;
  outline: none;
}
.filter-popup__cond-input:focus { border-color: #0078d7; }
.filter-popup__cond-and { font-size: 12px; color: #666; }
.filter-popup__footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid #eee;
}
.filter-popup__btn {
  height: 26px;
  padding: 0 12px;
  border: 1px solid #d0d0d0;
  border-radius: 3px;
  background: #f7f7f7;
  color: #333;
  font-size: 12px;
  cursor: pointer;
}
.filter-popup__btn:hover { background: #eef3f9; }
.filter-popup__btn--primary { background: #0078d7; border-color: #0078d7; color: #fff; }
.filter-popup__btn--primary:hover { background: #006cbe; }
.filter-popup__btn--clear { color: #c62828; border-color: #e0c0c0; }
.filter-popup__btn--clear:hover { background: #fdf0f0; }
.filter-popup__footer-spacer { flex: 1; }
</style>
