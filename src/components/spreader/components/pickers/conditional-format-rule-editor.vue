<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { t } from '../../core/constants';
import { colToLabel, parseCellRef } from '../../core/utils';
import type {
  ConditionalFormattingRule,
  ConditionalFormattingCondition,
  ConditionalFormattingFormat,
  SelectionRange,
  CellIsOperator,
} from '../../core/types';
import ColorPicker from './color-picker.vue';
import SpDropdown from '../dropdown.vue';

const props = withDefaults(defineProps<{
  locale: string;
  mode: 'create' | 'edit';
  rule?: ConditionalFormattingRule | null;
  defaultRangeText?: string;
  themeVars?: Record<string, string>;
}>(), {
  rule: null,
  defaultRangeText: '',
  themeVars: () => ({}),
});

const emit = defineEmits<{
  (e: 'save', rule: ConditionalFormattingRule): void;
  (e: 'cancel'): void;
}>();

type RuleType = 'cellIs' | 'textContains' | 'textNotContains' | 'blank' | 'notBlank' | 'duplicate' | 'unique' | 'formula';

const typeOptions = [
  { label: 'cfCellIs', value: 'cellIs' },
  { label: 'cfTextContains', value: 'textContains' },
  { label: 'cfTextNotContains', value: 'textNotContains' },
  { label: 'cfBlank', value: 'blank' },
  { label: 'cfNotBlank', value: 'notBlank' },
  { label: 'cfDuplicate',  value: 'duplicate' },
  { label: 'cfUnique', value: 'unique' },
  { label: 'cfFormulaShort', value: 'formula' },
];

const operatorOptions = [
  { label: 'cfEqual', value: 'equal' },
  { label: 'cfNotEqual', value: 'notEqual' },
  { label: 'cfGreaterThan', value: 'greaterThan' },
  { label: 'cfGreaterThanOrEqual', value: 'greaterThanOrEqual' },
  { label: 'cfLessThan', value: 'lessThan' },
  { label: 'cfLessThanOrEqual', value: 'lessThanOrEqual' },
  { label: 'cfBetween', value: 'between' },
  { label: 'cfNotBetween', value: 'notBetween' },
];

interface FormState {
  type: RuleType;
  operator: string;
  value: string;
  value2: string;
  formula: string;
  backgroundColor: string;
  color: string;
  fontWeight: boolean;
  fontStyle: boolean;
  underline: boolean;
  strikethrough: boolean;
  rangeText: string;
  stopIfTrue: boolean;
  enabled: boolean;
}

function initForm(): FormState {
  if (props.rule) {
    const c = props.rule.condition;
    const f: FormState = {
      type: c.type === 'cellIs' || c.type === 'textContains' || c.type === 'textNotContains'
        || c.type === 'blank' || c.type === 'notBlank' || c.type === 'duplicate'
        || c.type === 'unique' || c.type === 'formula'
        ? c.type
        : 'cellIs',
      operator: c.type === 'cellIs' ? c.operator : 'greaterThan',
      value: c.type === 'cellIs' || c.type === 'textContains' || c.type === 'textNotContains' ? c.value : '',
      value2: c.type === 'cellIs' ? (c.value2 ?? '') : '',
      formula: c.type === 'formula' ? c.formula : '',
      backgroundColor: props.rule.format.backgroundColor ?? '',
      color: props.rule.format.color ?? '',
      fontWeight: props.rule.format.fontWeight === 'bold',
      fontStyle: props.rule.format.fontStyle === 'italic',
      underline: props.rule.format.underline === 'underline',
      strikethrough: props.rule.format.strikethrough === 'line-through',
      rangeText: props.rule.ranges.length
        ? props.rule.ranges.map((r) => rangeToText(r)).join(', ')
        : props.defaultRangeText,
      stopIfTrue: props.rule.stopIfTrue,
      enabled: props.rule.enabled,
    };
    return f;
  }
  return {
    type: 'cellIs',
    operator: 'greaterThan',
    value: '',
    value2: '',
    formula: '',
    // 默认取颜色下拉菜单中的预设色（填充用填充色组浅蓝，文字用文字色组深蓝，保证对比协调）
    backgroundColor: '#DEEBF7',
    color: '#17375E',
    fontWeight: false,
    fontStyle: false,
    underline: false,
    strikethrough: false,
    rangeText: props.defaultRangeText,
    stopIfTrue: false,
    enabled: true,
  };
}

const form = reactive<FormState>(initForm());

const fillOpen = ref(false);
const fontOpen = ref(false);
const fillTrigger = ref<HTMLElement | null>(null);
const fontTrigger = ref<HTMLElement | null>(null);

const rangeError = ref('');

function rangeToText(r: SelectionRange): string {
  const a = colToLabel(r.startCol) + (r.startRow + 1);
  if (r.startCol === r.endCol && r.startRow === r.endRow) return a;
  return a + ':' + colToLabel(r.endCol) + (r.endRow + 1);
}

function parseRangeText(text: string): SelectionRange[] | null {
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
  const ranges: SelectionRange[] = [];
  for (const part of parts) {
    const m = part.match(/^[A-Za-z]+\d+(?::[A-Za-z]+\d+)?$/i);
    if (!m) return null;
    const a = parseCellRef(part.split(':')[0]!, 99999, 99999);
    const bRaw = part.split(':')[1];
    const b = bRaw ? parseCellRef(bRaw, 99999, 99999) : a;
    if (!a || !b) return null;
    ranges.push({
      startCol: Math.min(a.col, b.col),
      endCol: Math.max(a.col, b.col),
      startRow: Math.min(a.row, b.row),
      endRow: Math.max(a.row, b.row),
    });
  }
  return ranges.length ? ranges : null;
}

const needsBetween = computed(() => form.type === 'cellIs' && (form.operator === 'between' || form.operator === 'notBetween'));
const needsFormula = computed(() => form.type === 'formula');
const needsNoInput = computed(() => ['blank', 'notBlank', 'duplicate', 'unique'].includes(form.type));

// 供 SpDropdown 使用：将 i18n 键翻译为实际显示文本
const typeDropdownOptions = computed(() =>
  typeOptions.map((o) => ({ value: o.value, label: t(props.locale, o.label) })),
);
const operatorDropdownOptions = computed(() =>
  operatorOptions.map((o) => ({ value: o.value, label: t(props.locale, o.label) })),
);

function onTypeChange(v: string | number) {
  form.type = v as RuleType;
}
function onOperatorChange(v: string | number) {
  form.operator = String(v);
}
function onToggleFill() {
  fillOpen.value = !fillOpen.value;
}
function onToggleFontColor() {
  fontOpen.value = !fontOpen.value;
}

function validate(): boolean {
  rangeError.value = '';
  const ranges = parseRangeText(form.rangeText);
  if (!ranges) {
    rangeError.value = t(props.locale, 'cfRangeInvalid');
    return false;
  }
  // 纯文本/空白/重复规则无需值校验
  if (needsFormula.value && !form.formula.trim()) {
    rangeError.value = t(props.locale, 'cfFormulaRequired');
    return false;
  }
  return true;
}

function buildCondition(): ConditionalFormattingCondition {
  switch (form.type) {
    case 'cellIs':
      return { type: 'cellIs', operator: form.operator as CellIsOperator, value: form.value, value2: form.value2 || undefined };
    case 'textContains':
      return { type: 'textContains', value: form.value };
    case 'textNotContains':
      return { type: 'textNotContains', value: form.value };
    case 'blank':
      return { type: 'blank' };
    case 'notBlank':
      return { type: 'notBlank' };
    case 'duplicate':
      return { type: 'duplicate' };
    case 'unique':
      return { type: 'unique' };
    case 'formula':
      return { type: 'formula', formula: form.formula };
  }
}

function buildFormat(): ConditionalFormattingFormat {
  return {
    backgroundColor: form.backgroundColor || undefined,
    color: form.color || undefined,
    fontWeight: form.fontWeight ? 'bold' : '',
    fontStyle: form.fontStyle ? 'italic' : '',
    underline: form.underline ? 'underline' : '',
    strikethrough: form.strikethrough ? 'line-through' : '',
  };
}

function onSave() {
  if (!validate()) return;
  const ranges = parseRangeText(form.rangeText)!;
  const rule: ConditionalFormattingRule = {
    id: props.rule?.id ?? '',
    condition: buildCondition(),
    format: buildFormat(),
    ranges,
    priority: props.rule?.priority ?? 0,
    stopIfTrue: form.stopIfTrue,
    enabled: form.enabled,
  };
  emit('save', rule);
}

function onCancel() {
  emit('cancel');
}
</script>

<template>
  <div
    class="cf-editor"
    :style="themeVars"
  >
    <div class="cf-editor__header">
      <span class="cf-editor__title">{{ mode === 'edit' ? t(locale, 'cfEdit') : t(locale, 'cfNewRule') }}</span>
      <button
        type="button"
        class="cf-editor__close"
        @click="onCancel"
      >
        ×
      </button>
    </div>

    <div class="cf-editor__body">
      <div class="cf-row">
        <label class="cf-label">{{ t(locale, 'cfType') }}</label>
        <SpDropdown
          class="cf-dropdown"
          :model-value="form.type"
          :options="typeDropdownOptions"
          :width="'100%'"
          :visible-count="8"
          :title="t(locale, 'cfType')"
          align="right"
          @change="onTypeChange"
        />
      </div>

      <template v-if="form.type === 'cellIs'">
        <div class="cf-row">
          <label class="cf-label">{{ t(locale, 'cfOperator') }}</label>
          <SpDropdown
            class="cf-dropdown"
            :model-value="form.operator"
            :options="operatorDropdownOptions"
            :width="'100%'"
            :visible-count="9"
            :title="t(locale, 'cfOperator')"
            align="right"
            @change="onOperatorChange"
          />
        </div>
        <div class="cf-row">
          <label class="cf-label">{{ t(locale, 'cfValue') }}</label>
          <input
            v-model="form.value"
            class="cf-input"
            type="text"
          >
        </div>
        <div
          v-if="needsBetween"
          class="cf-row"
        >
          <label class="cf-label">{{ t(locale, 'cfValue2') }}</label>
          <input
            v-model="form.value2"
            class="cf-input"
            type="text"
          >
        </div>
      </template>

      <template v-else-if="needsFormula">
        <div class="cf-row">
          <label class="cf-label">{{ t(locale, 'cfFormulaShort') }}</label>
          <input
            v-model="form.formula"
            class="cf-input"
            type="text"
            :placeholder="t(locale, 'cfFormulaExample')"
          >
        </div>
        <p class="cf-hint">
          {{ t(locale, 'cfFormula') }}
        </p>
      </template>

      <template v-else-if="!needsNoInput">
        <div class="cf-row">
          <label class="cf-label">{{ t(locale, 'cfValue') }}</label>
          <input
            v-model="form.value"
            class="cf-input"
            type="text"
          >
        </div>
      </template>

      <div class="cf-row">
        <label class="cf-label">{{ t(locale, 'cfFormat') }}</label>
        <div class="cf-format-row">
          <!-- 填充颜色 -->
          <button
            ref="fillTrigger"
            type="button"
            class="toolbar-btn"
            :class="{ 'toolbar-btn--active': fillOpen }"
            :title="t(locale, 'fillColor')"
            @click="onToggleFill"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            >
              <path d="M447.018667 37.952l352.298666 352.298667c6.613333 6.613333 6.613333 17.344 0 23.957333L446.101333 767.424a16.938667 16.938667 0 0 1-23.957333 0L121.429333 466.688a16.938667 16.938667 0 0 1 0-23.957333L428.608 135.552 388.992 96a8.469333 8.469333 0 0 1 0-11.989333l46.058667-46.037334a8.469333 8.469333 0 0 1 11.968 0z m346.325333 517.461333l57.514667 60.074667c31.744 33.194667 31.744 86.997333 0 120.192a78.869333 78.869333 0 0 1-115.008 0c-31.765333-33.194667-31.765333-86.997333 0-120.192l57.493333-60.074667zM486.101333 193.066667l-261.12 261.12 20.458667 20.458666 380.16-1.728 70.186667-70.186666-209.706667-209.664z" />
              <path
                d="M85.333333 853.333333m8.896 0l835.541334 0q8.896 0 8.896 8.896l0 110.208q0 8.896-8.896 8.896l-835.541334 0q-8.896 0-8.896-8.896l0-110.208q0-8.896 8.896-8.896Z"
                :fill="form.backgroundColor || 'currentColor'"
              />
            </svg>
          </button>
          <ColorPicker
            :model-open="fillOpen"
            color-key="fill"
            :current-color="form.backgroundColor"
            :trigger-el="fillTrigger"
            :locale="locale"
            @update:model-open="fillOpen = $event"
            @change="form.backgroundColor = $event"
          />

          <!-- 文字颜色 -->
          <button
            ref="fontTrigger"
            type="button"
            class="toolbar-btn"
            :class="{ 'toolbar-btn--active': fontOpen }"
            :title="t(locale, 'fontColor')"
            @click="onToggleFontColor"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            >
              <g transform="translate(102.4, 102.4) scale(0.8)">
                <path d="M663.120842 529.946947H364.759579l-84.07579 212.884211a53.894737 53.894737 0 0 1-50.122105 34.169263h-14.551579a34.869895 34.869895 0 0 1-32.498526-47.696842L443.715368 70.063158a53.894737 53.894737 0 0 1 50.122106-34.115369h41.768421a53.894737 53.894737 0 0 1 50.176 34.277053l257.670737 659.078737a34.977684 34.977684 0 0 1-32.552421 47.696842h-14.389895a53.894737 53.894737 0 0 1-50.229895-34.277053l-83.159579-212.776421z m-35.139368-89.788631l-113.340632-289.953684-114.472421 289.953684h227.813053z" />
              </g>
              <path
                d="M62.895 844.369m53.895 0l790.474 0q53.895 0 53.895 53.895l0 26.947q0 53.895-53.895 53.895l-790.474 0q-53.895 0-53.895-53.895l0-26.947q0-53.895 53.895-53.895z"
                :fill="form.color || '#000000'"
              />
            </svg>
          </button>
          <ColorPicker
            :model-open="fontOpen"
            color-key="text"
            :current-color="form.color"
            :trigger-el="fontTrigger"
            :locale="locale"
            @update:model-open="fontOpen = $event"
            @change="form.color = $event"
          />

          <!-- 粗体 -->
          <button
            type="button"
            class="toolbar-btn"
            :class="{ 'toolbar-btn--active': form.fontWeight }"
            :title="t(locale, 'bold')"
            @click="form.fontWeight = !form.fontWeight"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M214.857 889.143v-68.571h68.571V203.429H214.857v-68.571h411.429v1.257c96.114 10.629 171.429 87.383 171.429 181.6 0 58.971-29.486 111.086-75.109 144.457 72.069 39.291 120.823 113.234 120.823 198.4 0 119.291-95.634 216.594-217.12 227.543l-0.286.029H214.857z m388.572-388.571H352v320h251.429c95.086 0 171.429-72.091 171.429-160s-76.343-160-171.429-160z m0-297.143H352v228.571h251.429l5.211-0.091c67.52-2.515 120.503-53.235 120.503-114.195 0-62.537-55.749-114.285-125.714-114.285z" /></svg>
          </button>

          <!-- 斜体 -->
          <button
            type="button"
            class="toolbar-btn"
            :class="{ 'toolbar-btn--active': form.fontStyle }"
            :title="t(locale, 'italic')"
            @click="form.fontStyle = !form.fontStyle"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M730.143 127.714v64.286h-112.329l-166.521 621.429h128.871v64.286H276.286v-64.286h108.45l166.5-621.429H426.286V127.714h303.857z" /></svg>
          </button>

          <!-- 下划线 -->
          <button
            type="button"
            class="toolbar-btn"
            :class="{ 'toolbar-btn--active': form.underline }"
            :title="t(locale, 'underline')"
            @click="form.underline = !form.underline"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M512 123.639a36.409 36.409 0 0 1 33.642 22.525l230.59 558.27a36.409 36.409 0 1 1-67.284 27.768L638.072 560.545H385.928l-70.876 171.656a36.409 36.409 0 1 1-67.332-27.768l230.59-558.27A36.409 36.409 0 0 1 512 123.639z m-95.974 364.089h191.948L512 255.439l-95.974 232.289zM769.289 827.544c19.418 0 38.836 14.564 38.836 38.836 0 19.418-14.564 33.982-29.127 33.982H259.565c-19.418 0-38.836-14.564-38.836-38.836 0-19.418 14.564-33.982 29.127-33.982h519.433z" /></svg>
          </button>

          <!-- 删除线 -->
          <button
            type="button"
            class="toolbar-btn"
            :class="{ 'toolbar-btn--active': form.strikethrough }"
            :title="t(locale, 'strikethrough')"
            @click="form.strikethrough = !form.strikethrough"
          >
            <svg
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M182.044 490.667h659.911a34.133 34.133 0 0 1 4.642 67.948l-4.597 0.319h-135.395c40.05 37 60.803 81.601 60.803 133.575 0 128.569-147.092 211.171-307.382 192.512-101.717-11.833-173.352-52.565-210.944-122.971a34.133 34.133 0 0 1 60.211-32.176c25.942 48.606 77.46 77.915 158.606 87.381 124.837 14.473 231.242-45.283 231.242-124.746 0-53.339-36.636-96.802-116.736-131.345l-5.279-2.23H182.044a34.133 34.133 0 0 1-33.815-29.492L147.911 524.8a34.133 34.133 0 0 1 29.491-33.815l4.642-0.318z m68.767-176.447c6.918-128.796 128.432-203.343 287.812-184.82 99.579 11.56 175.81 47.923 226.737 109.636a34.133 34.133 0 1 1-52.657 43.463c-38.775-47.013-98.759-75.639-181.999-85.288-123.654-14.381-211.627 36.591-211.627 117.009 0 35.135 10.65 61.349 37.774 90.203l5.826 6.007c4.278 4.369 8.966 8.875 11.377 10.923l1.411 0.91H288.085l-1.092-1.729c-6.508-9.376-38.958-54.386-36.182-106.314z" /></svg>
          </button>
        </div>
      </div>

      <div class="cf-row">
        <label class="cf-label">{{ t(locale, 'cfAppliedTo') }}</label>
        <input
          v-model="form.rangeText"
          class="cf-input"
          type="text"
        >
      </div>
      <div
        v-if="rangeError"
        class="cf-error"
      >
        {{ rangeError }}
      </div>

      <div class="cf-row cf-row--inline">
        <label class="cf-chk">
          <input
            class="cf-chk__input"
            type="checkbox"
            :checked="form.stopIfTrue"
            @change="form.stopIfTrue = ($event.target as HTMLInputElement).checked"
          >
          <span class="cf-chk__box">
            <svg
              class="cf-chk__tick"
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M405 697L195 487l58-58 152 152 304-304 58 58z" /></svg>
          </span>{{ t(locale, 'cfStopIfTrue') }}
        </label>
        <label class="cf-chk">
          <input
            class="cf-chk__input"
            type="checkbox"
            :checked="form.enabled"
            @change="form.enabled = ($event.target as HTMLInputElement).checked"
          >
          <span class="cf-chk__box">
            <svg
              class="cf-chk__tick"
              viewBox="0 0 1024 1024"
              fill="currentColor"
            ><path d="M405 697L195 487l58-58 152 152 304-304 58 58z" /></svg>
          </span>{{ t(locale, 'cfEnabled') }}
        </label>
      </div>
    </div>

    <div class="cf-editor__footer">
      <button
        type="button"
        class="cf-btn cf-btn--primary"
        @click="onSave"
      >
        {{ t(locale, 'ok') }}
      </button>
      <button
        type="button"
        class="cf-btn"
        @click="onCancel"
      >
        {{ t(locale, 'cancel') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.cf-editor {
  width: 360px;
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0, 0.18);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: var(--sp-toolbar-btn-color, #333);
  box-sizing: border-box;
}
.cf-editor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--sp-toolbar-border, #eee);
  font-weight: 600;
  font-size: 14px;
}
.cf-editor__close {
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--sp-toolbar-btn-color, #888);
}
.cf-editor__close:hover { color: var(--sp-toolbar-btn-color, #333); }
.cf-editor__body { padding: 12px 14px; }
.cf-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.cf-hint {
  margin: -6px 0 10px 0;
  font-size: 12px;
  color: var(--sp-find-hint-color, #888);
  line-height: 1.5;
}
.cf-row--inline { justify-content: flex-start; gap: 18px; }
.cf-label { width: 64px; flex: 0 0 auto; font-size: 13px; color: var(--sp-toolbar-text-secondary, #666); }
.cf-dropdown { flex: 1; min-width: 0; }
/* SpDropdown 在对话框中的表单风格（同数字格式对话框） */
.cf-dropdown :deep(.sp-dropdown__trigger) {
  border: 1px solid var(--sp-toolbar-border, #c0c0c0);
  background: var(--sp-toolbar-bg, #fff);
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  padding: 0 6px;
}
.cf-dropdown :deep(.sp-dropdown__trigger:hover) { background: var(--sp-toolbar-btn-hover-bg, #f5f5f5); }
.cf-dropdown :deep(.sp-dropdown__trigger--open) {
  border-color: #0078d7;
  box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3);
}
.cf-input {
  flex: 1;
  height: 28px;
  border: 1px solid var(--sp-toolbar-border, #c4c4c4);
  border-radius: 3px;
  padding: 0 8px;
  font-size: 13px;
  background: var(--sp-toolbar-bg, #fff);
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  box-sizing: border-box;
  outline: none;
}
.cf-input:focus { border-color: #0078d7; }
.cf-format-row { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
/* 复用 toolbar 的按钮/分裂按钮样式（基于 --sp-toolbar-* 主题变量，由外层组件注入） */
.toolbar-btn { display: flex; align-items: center; justify-content: center; width: 30px; height: 26px; border: none; border-radius: 3px; background: transparent; color: var(--sp-toolbar-btn-color, #444); cursor: pointer; padding: 0; }
.toolbar-btn:hover:not(:disabled) { background: var(--sp-toolbar-btn-hover-bg, #e6e6e6); }
.toolbar-btn:active:not(:disabled) { opacity: 0.7; }
.toolbar-btn--active { background: var(--sp-toolbar-btn-hover-bg, #e6e6e6); color: var(--sp-toolbar-btn-active-color, #0078d7); }
.toolbar-btn svg { width: 18px; height: 18px; }
.cf-error { color: #d93025; font-size: 12px; margin: -4px 0 8px 72px; }
.cf-chk {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--sp-toolbar-btn-color, #333);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
/* 原生 input 仅保留状态/可访问性，视觉由自定义 box 呈现（同查找栏样式） */
.cf-chk__input {
  position: absolute;
  width: 0;
  height: 0;
  margin: 0;
  padding: 0;
  opacity: 0;
  pointer-events: none;
}
.cf-chk__box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  box-sizing: border-box;
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 3px;
  background: var(--sp-toolbar-bg, #fff);
  transition: background 0.12s ease, border-color 0.12s ease;
}
.cf-chk__tick {
  width: 12px;
  height: 12px;
  color: #fff;
  opacity: 0;
  transform: scale(0.5);
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.cf-chk__input:checked + .cf-chk__box {
  background: #0078d7;
  border-color: #0078d7;
}
.cf-chk__input:checked + .cf-chk__box .cf-chk__tick {
  opacity: 1;
  transform: scale(1);
}
.cf-chk__input:focus-visible + .cf-chk__box {
  outline: 2px solid rgba(0, 120, 215, 0.4);
  outline-offset: 1px;
}
.cf-editor__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--sp-toolbar-border, #eee);
}
.cf-btn {
  height: 30px;
  padding: 0 16px;
  border: 1px solid var(--sp-toolbar-border, #c4c4c4);
  border-radius: 3px;
  background: var(--sp-toolbar-bg, #fff);
  cursor: pointer;
  font-size: 13px;
  color: var(--sp-toolbar-btn-color, #333);
}
.cf-btn:hover { background: var(--sp-toolbar-btn-hover-bg, #f0f0f0); }
.cf-btn--primary { border-color: #0078d7; background: #0078d7; color: #fff; }
.cf-btn--primary:hover { background: #0069c0; }
</style>
