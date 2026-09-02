<script setup lang="ts">
/**
 * 数据验证对话框（Excel 风格）。
 * 三大配置区：设置 / 输入信息 / 出错警告。
 * 「允许」类型决定「数据」区的字段形态：
 *  - list       → 来源（常量列表或区域引用）+ 提供下拉箭头
 *  - 数值/日期/时间/文本长度 → 条件 + 值（between 时为最小值/最大值）
 *  - custom     → 公式（相对引用以规则范围左上角为基准）
 * 「应用于」默认取当前选区；编辑已有规则时回填该规则。
 * 视觉规范与条件格式「新建规则」对话框（conditional-format-rule-editor.vue）保持一致。
 */
import { ref, reactive, computed } from 'vue';
import { t } from '../../core/constants';
import { colToLabel, parseCellRef } from '../../core/utils';
import { parseNumericText, parseDateTimeInput } from '../../core/number-format';
import type {
  DataValidationRule,
  DataValidationType,
  DataValidationOperator,
  DataValidationErrorStyle,
  DataValidationListSource,
  SelectionRange,
} from '../../core/types';
import SpDropdown from '../dropdown.vue';

const props = withDefaults(defineProps<{
  locale: string;
  mode: 'create' | 'edit';
  rule?: DataValidationRule | null;
  defaultRangeText?: string;
  themeVars?: Record<string, string>;
}>(), {
  rule: null,
  defaultRangeText: '',
  themeVars: () => ({}),
});

const emit = defineEmits<{
  (e: 'save', rule: DataValidationRule): void;
  (e: 'cancel' | 'clear'): void;
}>();

const typeOptions = [
  { label: 'dvTypeAny', value: 'any' },
  { label: 'dvTypeList', value: 'list' },
  { label: 'dvTypeWholeNumber', value: 'wholeNumber' },
  { label: 'dvTypeDecimal', value: 'decimal' },
  { label: 'dvTypeDate', value: 'date' },
  { label: 'dvTypeTime', value: 'time' },
  { label: 'dvTypeTextLength', value: 'textLength' },
  { label: 'dvTypeCustom', value: 'custom' },
];

const operatorOptions = [
  { label: 'dvBetween', value: 'between' },
  { label: 'dvNotBetween', value: 'notBetween' },
  { label: 'dvEqual', value: 'equal' },
  { label: 'dvNotEqual', value: 'notEqual' },
  { label: 'dvGreaterThan', value: 'greaterThan' },
  { label: 'dvGreaterThanOrEqual', value: 'greaterThanOrEqual' },
  { label: 'dvLessThan', value: 'lessThan' },
  { label: 'dvLessThanOrEqual', value: 'lessThanOrEqual' },
];

const errorStyleOptions = [
  { label: 'dvStyleStop', value: 'stop' },
  { label: 'dvStyleWarning', value: 'warning' },
  { label: 'dvStyleInformation', value: 'information' },
];

interface FormState {
  type: DataValidationType;
  operator: DataValidationOperator;
  formula1: string;
  formula2: string;
  source: string;
  allowBlank: boolean;
  showDropdown: boolean;
  showInputMessage: boolean;
  inputTitle: string;
  inputMessage: string;
  showErrorMessage: boolean;
  errorStyle: DataValidationErrorStyle;
  errorTitle: string;
  errorMessage: string;
  rangeText: string;
  enabled: boolean;
}

function rangeToText(r: SelectionRange): string {
  const a = colToLabel(r.startCol) + (r.startRow + 1);
  if (r.startCol === r.endCol && r.startRow === r.endRow) return a;
  return a + ':' + colToLabel(r.endCol) + (r.endRow + 1);
}

/** list 来源 → 文本框内容（常量列表用逗号连接，区域引用还原为 A1:B10 / Sheet2!A1:B10） */
function sourceToText(rule: DataValidationRule | null): string {
  const src = rule?.listSource;
  if (src?.type === 'range') {
    const txt = rangeToText(src.range);
    return src.sheetId ? `${src.sheetId}!${txt}` : txt;
  }
  const values = src?.type === 'values' ? src.values : (rule?.values ?? []);
  return values.join(',');
}

function initForm(): FormState {
  const r = props.rule;
  return {
    type: r?.type ?? 'any',
    operator: r?.operator ?? 'between',
    formula1: r?.formula1 ?? '',
    formula2: r?.formula2 ?? '',
    source: sourceToText(r),
    allowBlank: r?.allowBlank !== false,
    showDropdown: r?.showDropdown !== false,
    showInputMessage: r?.showInputMessage === true,
    inputTitle: r?.inputTitle ?? '',
    inputMessage: r?.inputMessage ?? '',
    showErrorMessage: r?.showErrorMessage !== false,
    errorStyle: r?.errorStyle ?? 'stop',
    errorTitle: r?.errorTitle ?? '',
    errorMessage: r?.errorMessage ?? '',
    rangeText: r && r.ranges.length
      ? r.ranges.map(rangeToText).join(', ')
      : props.defaultRangeText,
    enabled: r?.enabled !== false,
  };
}

const form = reactive<FormState>(initForm());
const error = ref('');

const isList = computed(() => form.type === 'list');
const isCustom = computed(() => form.type === 'custom');
/** 需要「条件 + 值」的类型 */
const needsOperator = computed(
  () => ['wholeNumber', 'decimal', 'date', 'time', 'textLength'].includes(form.type),
);
const needsBetween = computed(
  () => needsOperator.value && (form.operator === 'between' || form.operator === 'notBetween'),
);
/** 任何值：隐藏数据区、禁用 忽略空值 / 启用 */
const isAny = computed(() => form.type === 'any');

const typeDropdownOptions = computed(() =>
  typeOptions.map((o) => ({ value: o.value, label: t(props.locale, o.label) })),
);
const operatorDropdownOptions = computed(() =>
  operatorOptions.map((o) => ({ value: o.value, label: t(props.locale, o.label) })),
);
const errorStyleDropdownOptions = computed(() =>
  errorStyleOptions.map((o) => ({ value: o.value, label: t(props.locale, o.label) })),
);

/** 解析「应用于」：支持 A1 / A1:B10 / 多段逗号分隔 */
function parseRangeText(text: string): SelectionRange[] | null {
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
  const ranges: SelectionRange[] = [];
  for (const part of parts) {
    const m = part.match(/^\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?$/);
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

const CELL_RE = '\\$?[A-Za-z]+\\$?\\d+';

/**
 * 解析 list「来源」：
 *  - 区域引用：A1:A10 / $A$1:$A$10 / Sheet2!A1:A10 / 'Sheet 2'!A1:A10 → { type:'range' }
 *  - 其余：按逗号分隔为常量列表 → { type:'values' }
 */
function parseSourceText(text: string): DataValidationListSource | null {
  const raw = text.trim();
  if (!raw) return null;
  // 形如 SheetName!A1:B10 或 'Sheet Name'!A1:B10
  const withSheet = new RegExp(`^(?:'([^']+)'|([^!'"]+))!(${CELL_RE})(?::(${CELL_RE}))?$`).exec(raw);
  if (withSheet) {
    const sheetId = (withSheet[1] ?? withSheet[2] ?? '').trim();
    const a = parseCellRef(withSheet[3]!, 99999, 99999);
    const b = withSheet[4] ? parseCellRef(withSheet[4]!, 99999, 99999) : a;
    if (!sheetId || !a || !b) return null;
    return {
      type: 'range',
      sheetId,
      range: {
        startCol: Math.min(a.col, b.col),
        endCol: Math.max(a.col, b.col),
        startRow: Math.min(a.row, b.row),
        endRow: Math.max(a.row, b.row),
      },
    };
  }
  // 形如 A1:B10（当前工作表）
  const plain = new RegExp(`^(${CELL_RE})(?::(${CELL_RE}))?$`).exec(raw);
  if (plain) {
    const a = parseCellRef(plain[1]!, 99999, 99999);
    const b = plain[2] ? parseCellRef(plain[2]!, 99999, 99999) : a;
    if (!a || !b) return null;
    return {
      type: 'range',
      range: {
        startCol: Math.min(a.col, b.col),
        endCol: Math.max(a.col, b.col),
        startRow: Math.min(a.row, b.row),
        endRow: Math.max(a.row, b.row),
      },
    };
  }
  // 常量列表
  const values = raw.split(',').map((v) => v.trim());
  if (!values.some((v) => v !== '')) return null;
  return { type: 'values', values };
}

/** 严格数值正则（与引擎 parseNumericOperand 同源）：整数/小数/正负号/科学计数法 */
const STRICT_NUM_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * 校验单个条件值（最小值/最大值/值）的字面量是否能被类型解析。
 * - 空字符串：返回必填提示（由调用方在已判空后传入时不会触发，但保留防御）；
 * - 公式（以 = 开头）：运行时求值，跳过字面校验；
 * - 复用项目既有 number-format 解析器，与「实时输入校验」保持同一套语义。
 * 返回 null 表示通过，否则返回错误文案 key 对应的翻译文本。
 */
function checkCriterionContent(type: DataValidationType, raw: string): string | null {
  const v = raw.trim();
  if (v === '') return t(props.locale, 'dvValueRequired');
  if (v.startsWith('=')) return null; // 公式：交给公式引擎运行时求值
  const locale = props.locale;
  switch (type) {
    case 'wholeNumber':
    case 'textLength': {
      const nt = parseNumericText(v, locale);
      if (nt && Number.isFinite(nt.num) && Number.isInteger(nt.num)) return null;
      if (STRICT_NUM_RE.test(v) && Number.isInteger(Number(v))) return null;
      return t(locale, 'dvMustBeInteger');
    }
    case 'decimal': {
      const nt = parseNumericText(v, locale);
      if (nt && Number.isFinite(nt.num)) return null;
      if (STRICT_NUM_RE.test(v) && Number.isFinite(Number(v))) return null;
      return t(locale, 'dvMustBeNumber');
    }
    case 'date': {
      const dt = parseDateTimeInput(v, locale);
      // 纯时间（12:30）不属于日期；日期/日期时间均可
      if (dt && dt.format !== 'h:mm:ss') return null;
      return t(locale, 'dvDateInvalid');
    }
    case 'time': {
      // 时间、日期时间、日期字面量都可解析为「一天的分数」（引擎取小数部分）
      if (parseDateTimeInput(v, locale)) return null;
      return t(locale, 'dvTimeInvalid');
    }
    default:
      return null;
  }
}

function validate(): boolean {
  error.value = '';
  if (!parseRangeText(form.rangeText)) {
    error.value = t(props.locale, 'dvRangeInvalid');
    return false;
  }
  // 「任何值」：仅保留范围校验，不做内容限制（与 Excel 一致）
  if (form.type === 'any') return true;
  if (isList.value) {
    if (!parseSourceText(form.source)) {
      error.value = t(props.locale, 'dvSourceInvalid');
      return false;
    }
    return true;
  }
  if (isCustom.value) {
    if (!form.formula1.trim()) {
      error.value = t(props.locale, 'dvFormulaRequired');
      return false;
    }
    return true;
  }
  // needsOperator 类型：条件 + 值（between/notBetween 时为 最小值/最大值）
  if (needsBetween.value) {
    if (!form.formula1.trim()) {
      error.value = t(props.locale, 'dvMinRequired');
      return false;
    }
    if (!form.formula2.trim()) {
      error.value = t(props.locale, 'dvMaxRequired');
      return false;
    }
    const m1 = checkCriterionContent(form.type, form.formula1);
    if (m1) {
      error.value = `${t(props.locale, 'dvMin')}：${m1}`;
      return false;
    }
    const m2 = checkCriterionContent(form.type, form.formula2);
    if (m2) {
      error.value = `${t(props.locale, 'dvMax')}：${m2}`;
      return false;
    }
    return true;
  }
  if (!form.formula1.trim()) {
    error.value = t(props.locale, 'dvValueRequired');
    return false;
  }
  const m = checkCriterionContent(form.type, form.formula1);
  if (m) {
    error.value = `${t(props.locale, 'dvValue')}：${m}`;
    return false;
  }
  return true;
}

function onSave() {
  if (!validate()) return;
  const ranges = parseRangeText(form.rangeText)!;
  // 「任何值」：等价于清除该范围的数据验证（与 Excel 一致）
  if (form.type === 'any') {
    emit('save', {
      id: props.rule?.id ?? '',
      type: 'any',
      ranges,
      allowBlank: form.allowBlank,
      enabled: true,
    });
    return;
  }
  const rule: DataValidationRule = {
    id: props.rule?.id ?? '',
    type: form.type,
    ranges,
    allowBlank: form.allowBlank,
    enabled: form.enabled,
    showInputMessage: form.showInputMessage,
    inputTitle: form.inputTitle || undefined,
    inputMessage: form.inputMessage || undefined,
    showErrorMessage: form.showErrorMessage,
    errorStyle: form.errorStyle,
    errorTitle: form.errorTitle || undefined,
    errorMessage: form.errorMessage || undefined,
  };
  if (isList.value) {
    const src = parseSourceText(form.source)!;
    rule.listSource = src;
    rule.values = src.type === 'values' ? src.values : undefined;
    rule.showDropdown = form.showDropdown;
  } else if (isCustom.value) {
    rule.formula1 = form.formula1.trim();
  } else {
    rule.operator = form.operator;
    rule.formula1 = form.formula1.trim();
    rule.formula2 = needsBetween.value ? form.formula2.trim() : undefined;
  }
  emit('save', rule);
}

function onTypeChange(v: string | number) {
  form.type = v as DataValidationType;
}
function onOperatorChange(v: string | number) {
  form.operator = String(v) as DataValidationOperator;
}
function onErrorStyleChange(v: string | number) {
  form.errorStyle = String(v) as DataValidationErrorStyle;
}
</script>

<template>
  <div
    class="dv-editor"
    :style="themeVars"
  >
    <div class="dv-editor__header">
      <span class="dv-editor__title">{{ t(locale, 'dvDialogTitle') }}</span>
      <button
        type="button"
        class="dv-editor__close"
        @click="emit('cancel')"
      >
        &times;
      </button>
    </div>

    <div class="dv-editor__body">
      <!-- ===== 设置 ===== -->
      <div class="dv-sec">
        <div class="dv-sec__title">
          {{ t(locale, 'dvSettings') }}
        </div>

        <div class="dv-row">
          <label class="dv-label">{{ t(locale, 'dvAllow') }}</label>
          <SpDropdown
            class="dv-dropdown"
            :model-value="form.type"
            :options="typeDropdownOptions"
            :width="'100%'"
            :visible-count="8"
            :title="t(locale, 'dvAllow')"
            align="right"
            @change="onTypeChange"
          />
        </div>

        <!-- 列表：来源 -->
        <template v-if="isList">
          <div class="dv-row">
            <label class="dv-label">{{ t(locale, 'dvSource') }}</label>
            <input
              v-model="form.source"
              class="dv-input"
              type="text"
              spellcheck="false"
            >
          </div>
          <p class="dv-hint">
            {{ t(locale, 'dvSourceHint') }}
          </p>
          <div class="dv-row dv-row--inline">
            <label class="dv-chk">
              <input
                class="dv-chk__input"
                type="checkbox"
                :checked="form.showDropdown"
                @change="form.showDropdown = ($event.target as HTMLInputElement).checked"
              >
              <span class="dv-chk__box">
                <svg
                  class="dv-chk__tick"
                  viewBox="0 0 1024 1024"
                  fill="currentColor"
                ><path d="M405 697L195 487l58-58 152 152 304-304 58 58z" /></svg>
              </span>{{ t(locale, 'dvShowDropdown') }}
            </label>
          </div>
        </template>

        <!-- 自定义：公式 -->
        <template v-else-if="isCustom">
          <div class="dv-row">
            <label class="dv-label">{{ t(locale, 'dvFormula') }}</label>
            <input
              v-model="form.formula1"
              class="dv-input"
              type="text"
              spellcheck="false"
              placeholder="=AND(A1&gt;=0,A1&lt;=100)"
            >
          </div>
          <p class="dv-hint">
            {{ t(locale, 'cfFormulaExample') }}
          </p>
        </template>

        <!-- 数值 / 日期 / 时间 / 文本长度：条件 + 值（任何值：隐藏数据区） -->
        <template v-else-if="needsOperator">
          <div class="dv-row">
            <label class="dv-label">{{ t(locale, 'dvData') }}</label>
            <SpDropdown
              class="dv-dropdown"
              :model-value="form.operator"
              :options="operatorDropdownOptions"
              :width="'100%'"
              :visible-count="9"
              :title="t(locale, 'dvOperator')"
              align="right"
              @change="onOperatorChange"
            />
          </div>
          <div
            v-if="!needsBetween"
            class="dv-row"
          >
            <label class="dv-label">{{ t(locale, 'dvValue') }}</label>
            <input
              v-model="form.formula1"
              class="dv-input"
              type="text"
              spellcheck="false"
            >
          </div>
          <template v-else>
            <div class="dv-row">
              <label class="dv-label">{{ t(locale, 'dvMin') }}</label>
              <input
                v-model="form.formula1"
                class="dv-input"
                type="text"
                spellcheck="false"
              >
            </div>
            <div class="dv-row">
              <label class="dv-label">{{ t(locale, 'dvMax') }}</label>
              <input
                v-model="form.formula2"
                class="dv-input"
                type="text"
                spellcheck="false"
              >
            </div>
          </template>
        </template>

        <div class="dv-row dv-row--inline">
          <label
            class="dv-chk"
            :class="{ 'dv-chk--disabled': isAny }"
          >
            <input
              class="dv-chk__input"
              type="checkbox"
              :checked="form.allowBlank"
              :disabled="isAny"
              @change="form.allowBlank = ($event.target as HTMLInputElement).checked"
            >
            <span class="dv-chk__box">
              <svg
                class="dv-chk__tick"
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M405 697L195 487l58-58 152 152 304-304 58 58z" /></svg>
            </span>{{ t(locale, 'dvIgnoreBlank') }}
          </label>
          <label
            class="dv-chk"
            :class="{ 'dv-chk--disabled': isAny }"
          >
            <input
              class="dv-chk__input"
              type="checkbox"
              :checked="form.enabled"
              :disabled="isAny"
              @change="form.enabled = ($event.target as HTMLInputElement).checked"
            >
            <span class="dv-chk__box">
              <svg
                class="dv-chk__tick"
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M405 697L195 487l58-58 152 152 304-304 58 58z" /></svg>
            </span>{{ t(locale, 'cfEnabled') }}
          </label>
        </div>
      </div>

      <!-- ===== 输入信息 ===== -->
      <div class="dv-sec">
        <div class="dv-sec__title">
          {{ t(locale, 'dvInputMessageTab') }}
        </div>
        <div class="dv-row dv-row--inline">
          <label class="dv-chk">
            <input
              class="dv-chk__input"
              type="checkbox"
              :checked="form.showInputMessage"
              @change="form.showInputMessage = ($event.target as HTMLInputElement).checked"
            >
            <span class="dv-chk__box">
              <svg
                class="dv-chk__tick"
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M405 697L195 487l58-58 152 152 304-304 58 58z" /></svg>
            </span>{{ t(locale, 'dvShowInputMessage') }}
          </label>
        </div>
        <div class="dv-row">
          <label class="dv-label">{{ t(locale, 'dvInputTitle') }}</label>
          <input
            v-model="form.inputTitle"
            class="dv-input"
            type="text"
            :disabled="!form.showInputMessage"
          >
        </div>
        <div class="dv-row dv-row--top">
          <label class="dv-label">{{ t(locale, 'dvInputMessage') }}</label>
          <textarea
            v-model="form.inputMessage"
            class="dv-input dv-input--area"
            rows="2"
            :disabled="!form.showInputMessage"
          />
        </div>
      </div>

      <!-- ===== 出错警告 ===== -->
      <div class="dv-sec">
        <div class="dv-sec__title">
          {{ t(locale, 'dvErrorAlertTab') }}
        </div>
        <div class="dv-row dv-row--inline">
          <label class="dv-chk">
            <input
              class="dv-chk__input"
              type="checkbox"
              :checked="form.showErrorMessage"
              @change="form.showErrorMessage = ($event.target as HTMLInputElement).checked"
            >
            <span class="dv-chk__box">
              <svg
                class="dv-chk__tick"
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M405 697L195 487l58-58 152 152 304-304 58 58z" /></svg>
            </span>{{ t(locale, 'dvShowErrorAlert') }}
          </label>
        </div>
        <div class="dv-row">
          <label class="dv-label">{{ t(locale, 'dvErrorStyle') }}</label>
          <SpDropdown
            class="dv-dropdown"
            :model-value="form.errorStyle"
            :options="errorStyleDropdownOptions"
            :width="'100%'"
            :visible-count="4"
            :title="t(locale, 'dvErrorStyle')"
            align="right"
            @change="onErrorStyleChange"
          />
        </div>
        <div class="dv-row">
          <label class="dv-label">{{ t(locale, 'dvErrorTitle') }}</label>
          <input
            v-model="form.errorTitle"
            class="dv-input"
            type="text"
            :disabled="!form.showErrorMessage"
          >
        </div>
        <div class="dv-row dv-row--top">
          <label class="dv-label">{{ t(locale, 'dvErrorMessage') }}</label>
          <textarea
            v-model="form.errorMessage"
            class="dv-input dv-input--area"
            rows="2"
            :disabled="!form.showErrorMessage"
          />
        </div>
      </div>

      <!-- ===== 应用于 ===== -->
      <div class="dv-sec">
        <div class="dv-row">
          <label class="dv-label">{{ t(locale, 'dvApplyTo') }}</label>
          <input
            v-model="form.rangeText"
            class="dv-input"
            type="text"
            spellcheck="false"
          >
        </div>
      </div>

      <div
        v-if="error"
        class="dv-error"
      >
        {{ error }}
      </div>
    </div>

    <div class="dv-editor__footer">
      <button
        type="button"
        class="dv-btn dv-btn--danger"
        @click="emit('clear')"
      >
        {{ t(locale, 'dvClearAll') }}
      </button>
      <span class="dv-editor__spacer" />
      <button
        type="button"
        class="dv-btn dv-btn--primary"
        @click="onSave"
      >
        {{ t(locale, 'ok') }}
      </button>
      <button
        type="button"
        class="dv-btn"
        @click="emit('cancel')"
      >
        {{ t(locale, 'cancel') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 与条件格式「新建规则」对话框（conditional-format-rule-editor.vue）保持同一套视觉语言 */
.dv-editor {
  width: 360px;
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0, 0.18);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: var(--sp-toolbar-btn-color, #333);
  box-sizing: border-box;
  user-select: none;
}
.dv-editor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--sp-toolbar-border, #eee);
  font-weight: 600;
  font-size: 14px;
}
.dv-editor__close {
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--sp-toolbar-btn-color, #888);
}
.dv-editor__close:hover { color: var(--sp-toolbar-btn-color, #333); }
.dv-editor__body {
  padding: 12px 14px;
  max-height: calc(100vh - 140px);
  overflow: auto;
}

/* 分区：设置 / 输入信息 / 出错警告 / 应用于 */
.dv-sec + .dv-sec {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--sp-toolbar-border, #eee);
}
.dv-sec__title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--sp-find-hint-color, #888);
}

.dv-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.dv-row--top { align-items: flex-start; }
.dv-row--inline { justify-content: flex-start; gap: 18px; }
.dv-label { width: 64px; flex: 0 0 auto; font-size: 13px; color: var(--sp-toolbar-text-secondary, #666); }
.dv-hint {
  margin: -6px 0 10px 0;
  font-size: 12px;
  color: var(--sp-find-hint-color, #888);
  line-height: 1.5;
}
.dv-dropdown { flex: 1; min-width: 0; }
/* SpDropdown 在对话框中的表单风格（同条件格式规则编辑器） */
.dv-dropdown :deep(.sp-dropdown__trigger) {
  border: 1px solid var(--sp-toolbar-border, #c0c0c0);
  background: var(--sp-toolbar-bg, #fff);
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  padding: 0 6px;
}
.dv-dropdown :deep(.sp-dropdown__trigger:hover) { background: var(--sp-toolbar-btn-hover-bg, #f5f5f5); }
.dv-dropdown :deep(.sp-dropdown__trigger--open) {
  border-color: #0078d7;
  box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3);
}
.dv-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  border: 1px solid var(--sp-toolbar-border, #c4c4c4);
  border-radius: 3px;
  padding: 0 8px;
  font-size: 13px;
  font-family: inherit;
  background: var(--sp-toolbar-bg, #fff);
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  box-sizing: border-box;
  outline: none;
}
.dv-input:focus { border-color: #0078d7; }
.dv-input:disabled { background: var(--sp-toolbar-btn-hover-bg, #f5f5f5); color: var(--sp-toolbar-text-muted, #999); }
.dv-input--area {
  height: auto;
  min-height: 46px;
  padding: 5px 8px;
  line-height: 1.5;
  resize: none;
}
.dv-error { color: #d93025; font-size: 12px; margin: -4px 0 8px 72px; }

/* 复选框：与条件格式规则编辑器 / 查找栏同款（隐藏原生 input，视觉由自定义 box 呈现） */
.dv-chk {
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
.dv-chk__input {
  position: absolute;
  width: 0;
  height: 0;
  margin: 0;
  padding: 0;
  opacity: 0;
  pointer-events: none;
}
.dv-chk__box {
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
.dv-chk__tick {
  width: 12px;
  height: 12px;
  color: #fff;
  opacity: 0;
  transform: scale(0.5);
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dv-chk__input:checked + .dv-chk__box {
  background: #0078d7;
  border-color: #0078d7;
}
.dv-chk__input:checked + .dv-chk__box .dv-chk__tick {
  opacity: 1;
  transform: scale(1);
}
.dv-chk__input:focus-visible + .dv-chk__box {
  outline: 2px solid rgba(0, 120, 215, 0.4);
  outline-offset: 1px;
}
/* 禁用态（任何值：忽略空值 / 启用 不可改） */
.dv-chk--disabled {
  color: var(--sp-find-hint-color, #aaa);
  cursor: not-allowed;
}
.dv-chk--disabled .dv-chk__box {
  background: var(--sp-toolbar-btn-hover-bg, #f5f5f5);
  border-color: var(--sp-toolbar-border, #d8d8d8);
}
.dv-chk--disabled .dv-chk__input:checked + .dv-chk__box {
  background: #c4c4c4;
  border-color: #c4c4c4;
}

.dv-editor__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--sp-toolbar-border, #eee);
}
.dv-editor__spacer { flex: 1; }
.dv-btn {
  height: 30px;
  padding: 0 16px;
  border: 1px solid var(--sp-toolbar-border, #c4c4c4);
  border-radius: 3px;
  background: var(--sp-toolbar-bg, #fff);
  cursor: pointer;
  font-size: 13px;
  color: var(--sp-toolbar-btn-color, #333);
  white-space: nowrap;
}
.dv-btn:hover { background: var(--sp-toolbar-btn-hover-bg, #f0f0f0); }
.dv-btn--primary { border-color: #0078d7; background: #0078d7; color: #fff; }
.dv-btn--primary:hover { background: #0069c0; }
.dv-btn--danger { color: #c5221f; }
.dv-btn--danger:hover { background: #fce8e6; }
</style>
