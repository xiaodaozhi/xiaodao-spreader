<script setup lang="ts">
import { ref, reactive, computed, type Ref, type UnwrapRef } from 'vue';
import { HEADER_HEIGHT, HEADER_WIDTH, SB_SIZE } from '../core/constants';
import Toolbar from './toolbar.vue';
import Tabbar from './tabbar.vue';
import FindReplaceBar from './find-replace-bar.vue';
import NumberFormatDialog from './pickers/numberFormatDialog.vue';
import type { SheetModelData, SheetState } from '../core/types';

import { createCoreState, type CoreState } from '../composables/core-state';
import { createUndoStyles, bindMenuRefs, type UndoStylesState } from '../composables/undo-styles';
import { createBordersMerge, type BordersMergeState } from '../composables/borders-merge';
import { createSheetsOps, type SheetsOpsState } from '../composables/sheets-ops';
import { createInteractions, type InteractionsState } from '../composables/interactions';
import { createFindReplace, type FindReplaceState } from '../composables/find-replace';
import { NF_MIXED } from '../core/number-format';

// ============ Props ============
const props = withDefaults(defineProps<{
  rowCount?: number;
  colCount?: number;
  width?: number | string;
  height?: number | string;
  theme?: 'light' | 'dark';
  locale?: string;
}>(), {
  rowCount: 200,
  colCount: 26,
  theme: 'light',
  locale: 'zh-CN',
});

// ============ v-model:data ============
const modelData = defineModel<SheetModelData[]>('data', { default: () => [] });
const lastEmittedDataRef = { value: '' };

// ============ 创建各模块实例 ============
const coreStateRaw = createCoreState(
  props,
  { rowCount: props.rowCount, colCount: props.colCount, theme: props.theme, locale: props.locale },
);

// 先创建带正确类型的 sheetsCtx 占位
const sheetsCtx: {
  sheets: Ref<SheetState[]>;
  activeSheetIndex: Ref<number>;
  saveSheet: () => void;
  loadSheet: (i: number) => void;
  mkSheet: (name: string) => SheetState;
} = {
  sheets: ref<SheetState[]>([]),
  activeSheetIndex: ref(0),
  saveSheet: () => {},
  loadSheet: (_i: number) => {},
  mkSheet: (name: string) => ({
    id: '',
    name,
    cells: {},
    merges: {},
    styles: [{}],
    selection: null,
    activeCell: { col: 0, row: 0 },
    scrollX: 0,
    scrollY: 0,
    colWidths: [],
    rowHeights: [],
  }),
};

const undoStylesRaw = createUndoStyles(coreStateRaw, sheetsCtx);
const bordersMergeRaw = createBordersMerge(coreStateRaw, undoStylesRaw);

// 绑定边框/合并菜单引用到 undo-styles（用于互斥开关）
bindMenuRefs(undoStylesRaw, {
  borderMenuOpen: bordersMergeRaw.borderMenuOpen,
  mergeMenuOpen: bordersMergeRaw.mergeMenuOpen,
});

const sheetsOpsRaw = createSheetsOps(
  coreStateRaw,
  undoStylesRaw,
  modelData,
  undefined,
  lastEmittedDataRef,
);

// 将 sheetsCtx 的实际引用替换为 sheetsOps 的
sheetsCtx.sheets = sheetsOpsRaw.sheets;
sheetsCtx.activeSheetIndex = sheetsOpsRaw.activeSheetIndex;
sheetsCtx.saveSheet = sheetsOpsRaw.saveSheet;
sheetsCtx.loadSheet = sheetsOpsRaw.loadSheet;
sheetsCtx.mkSheet = sheetsOpsRaw.mkSheet;

const interactionsRaw = createInteractions(
  coreStateRaw,
  undoStylesRaw,
  bordersMergeRaw,
  sheetsOpsRaw,
  lastEmittedDataRef,
);

// 生命周期 / watch 装配
interactionsRaw.setupLifecycle();

// ============ 查找和替换 ============
const findReplaceRaw = createFindReplace(
  coreStateRaw,
  undoStylesRaw,
  sheetsOpsRaw,
  lastEmittedDataRef,
);
findReplaceRaw.setupLifecycle();

// ============ reactive 包装：模板自动解包 ref/computed ============
const coreState = reactive(coreStateRaw) as unknown as UnwrapRef<CoreState>;
const undoStyles = reactive(undoStylesRaw) as unknown as UnwrapRef<UndoStylesState>;
const bordersMerge = reactive(bordersMergeRaw) as unknown as UnwrapRef<BordersMergeState>;
const sheetsOps = reactive(sheetsOpsRaw) as unknown as UnwrapRef<SheetsOpsState>;
// 直接用 sheetsOpsRaw 的顶层 ref 暴露给模板，避免 reactive 嵌套属性在 prop 传递时丢失响应式追踪
const sheets = sheetsOpsRaw.sheets;
const activeSheetIndex = sheetsOpsRaw.activeSheetIndex;
const interactions = reactive(interactionsRaw) as unknown as UnwrapRef<InteractionsState>;
const findReplace = reactive(findReplaceRaw) as unknown as UnwrapRef<FindReplaceState>;

// 当前选区是否为单个单元格（计算下拉框的求和/平均值在单格时禁用，与右键菜单一致）
const isSingleCell = computed(() => {
  const sel = coreState.selection;
  return !!sel && sel.startCol === sel.endCol && sel.startRow === sel.endRow;
});

// 数字格式对话框初始格式：选区一致时用该格式；混合时回退到活动单元格的格式，再不行则常规
const nfDialogCurrentFormat = computed(() => {
  const sel = undoStyles.selNumberFormat;
  if (sel !== NF_MIXED) return sel;
  const ac = coreState.activeCell;
  const st = coreStateRaw.resolveStyle(coreState.cells[coreState.cellKey(ac.col, ac.row)]);
  return typeof st?.numberFormat === 'string' ? st.numberFormat : '';
});

function setNfDialogOpen(v: boolean) {
  undoStylesRaw.nfDialogOpen.value = v;
}

// ============ 模板赋值辅助函数（用于 @update:xxx 事件）============
function setFontSizeMenuOpen(v: boolean) {
  undoStylesRaw.fontSizeMenuOpen.value = v;
}
function setTextColorMenuOpen(v: boolean) {
  undoStylesRaw.textColorMenuOpen.value = v;
}
function setFillColorMenuOpen(v: boolean) {
  undoStylesRaw.fillColorMenuOpen.value = v;
}
function setRenTabVal(v: string) {
  interactionsRaw.renTabVal.value = v;
}
function setCtxMenuNull() {
  interactionsRaw.ctxMenu.value = null;
}

// 函数 ref 绑定（用于嵌套在 reactive 对象中的 ref）
const setFormulaBarRef = (el: unknown) => {
  sheetsOpsRaw.formulaBarRef.value = el as HTMLTextAreaElement | null;
};
function toggleFormulaBarExpanded() {
  interactionsRaw.formulaBarExpanded.value = !interactionsRaw.formulaBarExpanded.value;
}
const setWrapperRef = (el: unknown) => {
  sheetsOpsRaw.wrapperRef.value = el as HTMLDivElement | null;
};
const setCanvasRef = (el: unknown) => {
  sheetsOpsRaw.canvasRef.value = el as HTMLCanvasElement | null;
};
const setEditInputRef = (el: unknown) => {
  sheetsOpsRaw.editInputRef.value = el as HTMLTextAreaElement | null;
};
const setDimInputRef = (el: unknown) => {
  interactionsRaw.dimInputRef.value = el as HTMLInputElement | null;
};
</script>

<template>
  <div
    class="spreadsheet-outer"
    :style="sheetsOps.outerStyle"
  >
    <!-- 工具栏 -->
    <Toolbar
      :locale="coreState.locale"
      :can-undo="undoStyles.canUndo"
      :can-redo="undoStyles.canRedo"
      :paint-fmt-active="undoStyles.paintFmt !== null"
      :has-selection="undoStyles.hasSelection"
      :font-family-options="undoStyles.fontFamilyOptions"
      :font-size-options="undoStyles.fontSizeOptions"
      :sel-font-family="undoStyles.selFontFamily"
      :sel-font-size="undoStyles.selFontSize"
      :font-size-input="undoStyles.fontSizeInput"
      :font-size-menu-open="undoStyles.fontSizeMenuOpen"
      :sel-font-weight="undoStyles.selFontWeight"
      :sel-font-style="undoStyles.selFontStyle"
      :sel-underline="undoStyles.selUnderline"
      :sel-strikethrough="undoStyles.selStrikethrough"
      :sel-text-color="undoStyles.selTextColor"
      :text-color-menu-open="undoStyles.textColorMenuOpen"
      :sel-fill-color="undoStyles.selFillColor"
      :fill-color-menu-open="undoStyles.fillColorMenuOpen"
      :cached-text-color="undoStyles.cachedTextColor"
      :cached-fill-color="undoStyles.cachedFillColor"
      :border-menu-open="bordersMerge.borderMenuOpen"
      :cached-border="bordersMerge.cachedBorder"
      :h-align-options="undoStyles.hAlignOptions"
      :v-align-options="undoStyles.vAlignOptions"
      :sel-h-align="undoStyles.selHAlign"
      :sel-v-align="undoStyles.selVAlign"
      :sel-wrap="undoStyles.selWrap"
      :merge-menu-open="bordersMerge.mergeMenuOpen"
      :calc-menu-open="bordersMerge.calcMenuOpen"
      :is-single-cell="isSingleCell"
      :sel-number-format="undoStyles.selNumberFormat"
      :nf-options="undoStyles.nfOptions"
      :theme-vars="sheetsOps.toolbarThemeVars"
      @undo="undoStyles.undo()"
      @redo="undoStyles.redo()"
      @paint-format="undoStyles.onPaintFormat"
      @clear-format="undoStyles.clearFormat()"
      @number-format-change="undoStyles.onNumberFormatChange($event)"
      @font-family-change="undoStyles.onFontFamilyChange($event)"
      @font-size-input="undoStyles.onFontSizeInput($event)"
      @font-size-blur="undoStyles.onFontSizeBlur"
      @font-size-keydown="undoStyles.onFontSizeKeydown($event)"
      @font-size-change="undoStyles.onFontSizeChange($event)"
      @update:font-size-menu-open="setFontSizeMenuOpen($event)"
      @font-size-toggle="undoStyles.toggleFontSizeMenu()"
      @font-size-step-up="undoStyles.onFontSizeStepUp"
      @font-size-step-down="undoStyles.onFontSizeStepDown"
      @bold-toggle="undoStyles.toggleFontWeight"
      @italic-toggle="undoStyles.toggleFontStyle"
      @underline-toggle="undoStyles.toggleUnderline"
      @strikethrough-toggle="undoStyles.toggleStrikethrough"
      @text-color-change="undoStyles.onTextColorChange($event)"
      @update:text-color-menu-open="setTextColorMenuOpen($event)"
      @fill-color-change="undoStyles.onFillColorChange($event)"
      @update:fill-color-menu-open="setFillColorMenuOpen($event)"
      @apply-text-color="undoStyles.applyCachedTextColor"
      @apply-fill-color="undoStyles.applyCachedFillColor"
      @update:border-menu-open="undoStyles.onBorderMenuToggle($event)"
      @border-change="bordersMerge.onBorderChange($event)"
      @apply-border="bordersMerge.applyCachedBorder"
      @h-align-change="undoStyles.onHAlignChange($event)"
      @v-align-change="undoStyles.onVAlignChange($event)"
      @wrap-toggle="undoStyles.onWrapToggle"
      @update:merge-menu-open="bordersMerge.onMergeMenuToggle($event)"
      @merge-change="bordersMerge.onMergeChange($event)"
      @apply-merge="bordersMerge.onApplyMerge"
      @update:calc-menu-open="bordersMerge.onCalcMenuToggle($event)"
      @calc-sum="bordersMerge.onCalcSum"
      @calc-avg="bordersMerge.onCalcAvg"
      @calc-count="bordersMerge.onCalcCount"
      @find="findReplaceRaw.openFind()"
    />

    <!-- 查找和替换栏 -->
    <FindReplaceBar
      :open="findReplace.open"
      :find-text="findReplace.findText"
      :replace-text="findReplace.replaceText"
      :scope="findReplace.scope"
      :match-case="findReplace.matchCase"
      :match-entire-cell="findReplace.matchEntireCell"
      :current-index="findReplace.currentIndex"
      :total="findReplace.results.length"
      :message="findReplace.message"
      :focus-token="findReplace.focusToken"
      :locale="coreState.locale"
      :theme-vars="sheetsOps.toolbarThemeVars"
      @update:find-text="findReplaceRaw.findText.value = $event"
      @update:replace-text="findReplaceRaw.replaceText.value = $event"
      @update:scope="findReplaceRaw.scope.value = $event"
      @update:match-case="findReplaceRaw.matchCase.value = $event"
      @update:match-entire-cell="findReplaceRaw.matchEntireCell.value = $event"
      @prev="findReplaceRaw.findPrev()"
      @next="findReplaceRaw.findNext()"
      @replace="findReplaceRaw.replace()"
      @replace-all="findReplaceRaw.replaceAll()"
      @close="findReplaceRaw.close()"
    />

    <!-- 数字格式配置对话框 -->
    <NumberFormatDialog
      :model-open="undoStyles.nfDialogOpen"
      :locale="coreState.locale"
      :current-format="nfDialogCurrentFormat"
      @update:model-open="setNfDialogOpen($event)"
      @apply="undoStyles.applyNumberFormatCode($event)"
    />

    <!-- 编辑栏 -->
    <div
      class="formula-bar"
      :class="{ 'formula-bar--expanded': interactions.formulaBarExpanded }"
    >
      <div class="formula-bar__cell-label">
        {{ interactions.activeCellLabel }}
      </div>
      <div class="formula-bar__buttons">
        <button
          type="button"
          class="formula-bar__btn formula-bar__btn--cancel"
          title="取消（Esc）"
          aria-label="取消"
          @mousedown.prevent
          @click.stop="interactions.cancelFormulaBarEdit"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden="true"
          >
            <path
              d="M3 3l8 8M11 3l-8 8"
              fill="none"
              stroke="#e53935"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="formula-bar__btn formula-bar__btn--accept"
          title="接受（Enter）"
          aria-label="接受"
          @mousedown.prevent
          @click.stop="interactions.acceptFormulaBarEdit"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden="true"
          >
            <path
              d="M2.5 7.5l3.5 3.5L12 3.5"
              fill="none"
              stroke="#2e7d32"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
      <textarea
        :ref="setFormulaBarRef"
        class="formula-bar__input"
        :class="{ 'formula-bar__input--expanded': interactions.formulaBarExpanded }"
        :rows="interactions.formulaBarExpanded ? 3 : 1"
        :value="interactions.formulaBarDisplay"
        spellcheck="false"
        @focus="interactions.onFormulaBarFocus"
        @input="interactions.onFormulaBarInput"
        @keydown="interactions.onFormulaBarKeydown"
        @blur="interactions.onFormulaBarBlur"
      />
      <button
        type="button"
        class="formula-bar__toggle"
        :title="interactions.formulaBarExpanded ? '折叠为1行' : '展开为3行'"
        @mousedown.prevent
        @click.stop="toggleFormulaBarExpanded"
      >
        <svg
          v-if="!interactions.formulaBarExpanded"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        ><path
          d="M2 4l4 4 4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg>
        <svg
          v-else
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        ><path
          d="M2 8l4-4 4 4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg>
      </button>
    </div>

    <div
      :ref="setWrapperRef"
      class="spreadsheet-wrapper"
    >
      <canvas
        :ref="setCanvasRef"
        class="grid-canvas"
        tabindex="0"
        @mousedown="interactions.onMouseDown"
        @mousemove="interactions.onMouseMove"
        @mouseup="interactions.onMouseUp"
        @mouseleave="interactions.onMouseLeave"
        @dblclick="interactions.onDblClick"
        @wheel.prevent="interactions.onWheel"
        @focus="sheetsOps.onCanvasFocus"
        @keydown="interactions.onKeydown"
        @contextmenu="interactions.onCanvasCtx"
        @touchstart.prevent="interactions.onTouchStart"
        @touchmove.prevent="interactions.onTouchMove"
        @touchend="interactions.onTouchEnd"
      />
      <textarea
        :ref="setEditInputRef"
        class="cell-editor"
        :value="coreState.editValue"
        :style="interactions.editInputStyle"
        @input="interactions.onEditInput"
        @keydown="interactions.onEditKd"
        @compositionstart="interactions.onEditCompositionStart"
        @compositionend="interactions.onEditCompositionEnd"
        @blur="interactions.onEditBlur"
        @paste="interactions.onEditPaste"
      />
      <!-- 垂直滚动条 -->
      <div
        v-if="sheetsOps.maxScrollY > 0"
        class="v-scrollbar"
        :style="{ top: HEADER_HEIGHT + 'px', height: `calc(100% - ${HEADER_HEIGHT + SB_SIZE}px)` }"
      >
        <button
          class="sb-btn sb-btn--up"
          title=""
          @mousedown.prevent="sheetsOps.clampScroll(null, coreState.scrollY - 50); interactions.scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--up" />
        </button>
        <div
          class="sb-track sb-track--v"
          @mousedown="interactions.onVTrk"
        >
          <div
            class="sb-thumb sb-thumb--v"
            :style="{ top: interactions.vThumbT + 'px', height: interactions.vThumbH + 'px' }"
            @mousedown="interactions.onVStart"
          />
        </div>
        <button
          class="sb-btn sb-btn--down"
          @mousedown.prevent="sheetsOps.clampScroll(null, coreState.scrollY + 50); interactions.scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--down" />
        </button>
      </div>
      <!-- 水平滚动条 -->
      <div
        v-if="sheetsOps.maxScrollX > 0"
        class="h-scrollbar"
        :style="{ left: HEADER_WIDTH + 'px', width: `calc(100% - ${HEADER_WIDTH + SB_SIZE}px)` }"
      >
        <button
          class="sb-btn sb-btn--left"
          @mousedown.prevent="sheetsOps.clampScroll(coreState.scrollX - 50, null); interactions.scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--left" />
        </button>
        <div
          class="sb-track sb-track--h"
          @mousedown="interactions.onHTrk"
        >
          <div
            class="sb-thumb sb-thumb--h"
            :style="{ left: interactions.hThumbL + 'px', width: interactions.hThumbW + 'px' }"
            @mousedown="interactions.onHStart"
          />
        </div>
        <button
          class="sb-btn sb-btn--right"
          @mousedown.prevent="sheetsOps.clampScroll(coreState.scrollX + 50, null); interactions.scheduleRender()"
        >
          <span class="sb-arrow sb-arrow--right" />
        </button>
      </div>
      <div
        v-if="sheetsOps.maxScrollX > 0 && sheetsOps.maxScrollY > 0"
        class="sb-corner"
      />
    </div>

    <!-- Sheet 标签栏 -->
    <Tabbar
      :locale="coreState.locale"
      :sheets="sheets"
      :active-sheet-index="activeSheetIndex"
      :ren-tab="interactions.renTab"
      :ren-tab-val="interactions.renTabVal"
      @tab-click="interactions.onTabClick($event)"
      @tab-dblclick="interactions.onTabDblClick($event)"
      @tab-contextmenu="interactions.onTabCtxMenu($event.ev, $event.i)"
      @tab-rename-input="setRenTabVal($event)"
      @tab-rename-keydown="interactions.onTabRenameKd($event)"
      @tab-rename-commit="interactions.commitTabRename"
      @tabbar-contextmenu="interactions.onTabBarCtx($event)"
      @delete-sheet="
        sheetsOps.removeSheet($event);
        interactions.scheduleRender();
      "
      @add-sheet="
        sheetsOps.addSheet();
        interactions.scheduleRender();
      "
    />

    <!-- 右键菜单 -->
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="interactions.ctxMenu"
          class="context-menu"
          :style="{ left: interactions.ctxMenu.x + 'px', top: interactions.ctxMenu.y + 'px' }"
          @click.stop
        >
          <template
            v-for="(item, i) in interactions.ctxMenu.items"
            :key="i"
          >
            <div
              class="context-menu__item"
              :class="{ 'context-menu__item--disabled': item.disabled }"
              @click="!item.disabled && item.action && (item.action(), setCtxMenuNull())"
              @mouseenter="interactions.onCtxItemEnter($event, item)"
            >
              <span class="context-menu__label">{{ item.label }}</span>
              <span
                v-if="item.children"
                class="context-menu__arrow"
              />
              <div
                v-if="item.children"
                class="context-submenu"
                :class="{ 'context-submenu--left': interactions.ctxSubmenuLeft }"
              >
                <div
                  v-for="(child, j) in item.children"
                  :key="j"
                  class="context-menu__item"
                  :class="{ 'context-menu__item--disabled': child.disabled }"
                  @click.stop="!child.disabled && child.action && (child.action(), setCtxMenuNull())"
                >
                  {{ child.label }}
                </div>
              </div>
            </div>
          </template>
        </div>
      </Transition>
    </Teleport>

    <!-- 行高/列宽浮动设置栏 -->
    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="interactions.dimPanel"
          class="dim-panel"
          :style="{ left: interactions.dimPanel.x + 'px', top: interactions.dimPanel.y + 'px' }"
          @mousedown.stop
          @click.stop
        >
          <div class="dim-panel__title">
            {{ interactions.dimPanel.type === 'row' ? '行高' : '列宽' }}
          </div>
          <div class="dim-panel__body">
            <input
              :ref="setDimInputRef"
              class="dim-panel__input"
              :class="{ 'dim-panel__input--error': interactions.dimPanel.error }"
              type="number"
              step="1"
              min="1"
              inputmode="numeric"
              :value="interactions.dimPanel.value"
              @input="interactions.onDimInput"
              @keydown="interactions.onDimKeydown"
              @blur="interactions.onDimBlur"
            >
            <span class="dim-panel__unit">px</span>
          </div>
          <div
            v-if="interactions.dimPanel.error"
            class="dim-panel__error"
          >
            {{ interactions.dimPanel.error }}
          </div>
          <div class="dim-panel__footer">
            <button
              class="dim-panel__btn dim-panel__btn--primary"
              @click="interactions.applyDimPanel"
            >
              确定
            </button>
            <button
              class="dim-panel__btn"
              @click="interactions.closeDimPanel"
            >
              取消
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.spreadsheet-outer { flex: 1; display: flex; flex-direction: column; overflow: hidden; height: 100%; min-height: 400px; width: 100%; }
.formula-bar { display: flex; align-items: flex-start; min-height: 36px; padding: 0; gap: 0; }
.formula-bar--expanded { min-height: 72px; }
.formula-bar__cell-label { width: 48px; min-width: 48px; height: 28px; line-height: 28px; margin-top: 4px; text-align: center; font-size: 12px; font-weight: 600; color: var(--sp-formula-bar-label-color); background: var(--sp-formula-bar-label-bg); border: 1px solid var(--sp-formula-bar-label-border); border-radius: 2px; user-select: none; }
.formula-bar__buttons { display: inline-flex; align-items: stretch; margin-top: 4px; margin-left: 6px; height: 28px; border: 1px solid var(--sp-formula-bar-input-border); border-radius: 2px; overflow: hidden; background: var(--sp-formula-bar-input-bg); }
.formula-bar__btn { width: 22px; height: 28px; border: none; border-radius: 0; background: transparent; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; user-select: none; color: inherit; }
.formula-bar__btn + .formula-bar__btn { border-left: 1px solid var(--sp-formula-bar-input-border); }
.formula-bar__btn:hover { background: var(--sp-scroll-btn-hover-bg, #f0f0f0); }
.formula-bar__btn--cancel:hover { color: #e53935; background: #fdecea; }
.formula-bar__btn--accept:hover { color: #2e7d32; background: #e8f5e9; }
.formula-bar__input { flex: 1; min-height: 28px; height: 28px; line-height: 20px; margin-top: 4px; border: 1px solid var(--sp-formula-bar-input-border); border-radius: 2px; outline: none; padding: 3px 6px; margin-left: 4px; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; color: var(--sp-formula-bar-input-color); background: var(--sp-formula-bar-input-bg); resize: none; overflow: hidden; box-sizing: border-box; }
.formula-bar__input--expanded { height: 68px; overflow: auto; }
.formula-bar__input:focus { border-color: var(--sp-formula-bar-input-focus-border); box-shadow: 0 0 0 1px var(--sp-formula-bar-input-focus-shadow); }
.formula-bar__toggle { width: 22px; min-width: 22px; height: 28px; margin-top: 4px; margin-left: 2px; margin-right: 2px; border: 1px solid var(--sp-formula-bar-input-border); border-radius: 2px; background: var(--sp-formula-bar-input-bg); color: var(--sp-formula-bar-input-color); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; user-select: none; }
.formula-bar__toggle:hover { background: var(--sp-scroll-btn-hover-bg, #e8e8e8); }
.spreadsheet-wrapper { flex: 1; position: relative; overflow: hidden; background: var(--sp-wrapper-bg); }
.grid-canvas { position: absolute; top: 0; left: 0; display: block; outline: none; cursor: cell; }
.grid-canvas:focus { outline: none; }
.v-scrollbar { position: absolute; right: 0; top: 0; width: 11px; height: calc(100% - 11px); display: flex; flex-direction: column; background: var(--sp-wrapper-bg); }
.h-scrollbar { position: absolute; left: 0; bottom: 0; height: 11px; width: calc(100% - 11px); display: flex; background: var(--sp-wrapper-bg); }
.sb-corner { position: absolute; right: 0; bottom: 0; width: 11px; height: 11px; background: var(--sp-wrapper-bg); }
.sb-btn { width: 11px; height: 11px; min-width: 11px; min-height: 11px; border: none; background: var(--sp-scroll-btn-bg, #e8e8e8); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; user-select: none; }
.sb-btn:hover { background: var(--sp-scroll-btn-hover-bg, #d0d0d0); }
.sb-btn:active { background: var(--sp-scroll-btn-active-bg, #c0c0c0); }
.sb-arrow { display: block; width: 0; height: 0; }
.sb-arrow--up { border-left: 3px solid transparent; border-right: 3px solid transparent; border-bottom: 4px solid var(--sp-scroll-btn-color, #666); }
.sb-arrow--down { border-left: 3px solid transparent; border-right: 3px solid transparent; border-top: 4px solid var(--sp-scroll-btn-color, #666); }
.sb-arrow--left { border-top: 3px solid transparent; border-bottom: 3px solid transparent; border-right: 4px solid var(--sp-scroll-btn-color, #666); }
.sb-arrow--right { border-top: 3px solid transparent; border-bottom: 3px solid transparent; border-left: 4px solid var(--sp-scroll-btn-color, #666); }
.sb-track { flex: 1; position: relative; background: var(--sp-scroll-track-bg, rgba(0,0,0,0.06)); }
.sb-track--v { width: 11px; }
.sb-track--h { height: 11px; }
.sb-thumb { position: absolute; border-radius: 3px; background: var(--sp-scroll-thumb); cursor: default; }
.sb-thumb:hover { background: var(--sp-scroll-thumb-hover); }
.sb-thumb--v { left: 1px; right: 1px; min-height: 16px; }
.sb-thumb--h { top: 1px; bottom: 1px; min-width: 16px; }
.cell-editor { position: absolute; border: 2px solid var(--sp-cell-editor-border); outline: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; color: var(--sp-cell-editor-color); background: var(--sp-cell-editor-bg); box-shadow: 0 0 0 1px var(--sp-cell-editor-shadow); z-index: 10; box-sizing: border-box; min-width: 0; overflow: hidden; padding: 0; margin: 0; -webkit-appearance: none; appearance: none; resize: none; white-space: pre-wrap; word-break: break-all; }
</style>

<style>
.context-menu { position: fixed; z-index: 10000; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 4px 0; min-width: 120px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; transform-origin: top left; }
.context-menu__item { padding: 6px 20px; cursor: pointer; color: #333; white-space: nowrap; position: relative; display: flex; align-items: center; justify-content: space-between; }
.context-menu__item:hover { background: #e8f0fe; }
.context-menu__item--disabled { color: #bbb; cursor: default; }
.context-menu__item--disabled:hover { background: transparent; }
.context-menu__arrow { margin-left: 16px; margin-right: -5px; width: 0; height: 0; border-top: 3px solid transparent; border-bottom: 3px solid transparent; border-left: 4px solid #888; }
.context-submenu { display: none; position: absolute; left: 100%; top: -4px; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 4px 0; min-width: 100px; z-index: 10001; }
.context-submenu--left { left: auto; right: 100%; }
.context-menu__item:hover > .context-submenu { display: block; }
.context-submenu .context-menu__item { justify-content: flex-start; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s ease-out, transform 0.12s ease-out; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: scale(0.9); }

/* 行高/列宽浮动设置栏 */
.dim-panel { position: fixed; z-index: 10002; width: 220px; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 10px 12px; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; user-select: none; transform-origin: top left; }
.dim-panel__title { font-size: 13px; font-weight: 600; color: #333; margin-bottom: 8px; }
.dim-panel__body { display: flex; align-items: center; gap: 6px; }
.dim-panel__input { flex: 1; height: 26px; border: 1px solid #c0c0c0; border-radius: 3px; outline: none; padding: 0 6px; font-size: 13px; color: #1a1a1a; background: #fff; box-sizing: border-box; }
.dim-panel__input:focus { border-color: #0078d7; box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3); }
.dim-panel__input--error { border-color: #d93025; box-shadow: 0 0 0 1px rgba(217, 48, 37, 0.3); }
.dim-panel__unit { font-size: 12px; color: #888; }
.dim-panel__error { margin-top: 6px; font-size: 12px; color: #d93025; line-height: 1.4; }
.dim-panel__footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.dim-panel__btn { height: 26px; padding: 0 14px; border: 1px solid #ccc; border-radius: 3px; background: #fff; color: #333; font-size: 13px; cursor: pointer; }
.dim-panel__btn:hover { background: #f0f0f0; }
.dim-panel__btn--primary { border-color: #0078d7; background: #0078d7; color: #fff; }
.dim-panel__btn--primary:hover { background: #0069c0; }
</style>
