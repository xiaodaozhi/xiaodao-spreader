<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { t } from '../../core/constants';
import {
  formatNumber,
  buildNumberFormatCode,
  NF_DIALOG_CATEGORIES,
  NF_GENERAL,
  NF_TEXT,
  isGeneralFormat,
  type NFDialogCategory,
} from '../../core/number-format';
import SpDropdown from '../dropdown.vue';
import type { FontOption } from '../../core/constants';

// 数字格式配置对话框（参考 Excel「设置单元格格式 / 数字」）
// 说明：本对话框仅产生 style.numberFormat 格式代码，绝不修改 Cell.value。

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
  /** 当前选区格式（混合时由父组件传入空串，从常规开始） */
  currentFormat?: string;
  /** 选区数字格式带自定义分类标记（常规单元格经小数位按钮生成）：打开时分类直接显示为「自定义」 */
  isCustom?: boolean;
  /** 预览样例值（默认 1234.5） */
  sampleValue?: string;
}>(), {
  modelOpen: false,
  locale: 'zh-CN',
  currentFormat: '',
  isCustom: false,
  sampleValue: '1234.5',
});

const emit = defineEmits<{
  (e: 'update:modelOpen', v: boolean): void;
  (e: 'apply', formatCode: string): void;
}>();

const open = ref(false);
const category = ref<NFDialogCategory>('general');
const decimals = ref(2);
const thousands = ref(false);
const symbol = ref<'¥' | '$' | '€' | '£'>('$');
const dateFmt = ref('m/d/yyyy');
const timeFmt = ref('h:mm:ss');
const dateTimeFmt = ref('m/d/yyyy h:mm:ss');
const durationFmt = ref('[h]:mm:ss');
const customCode = ref('');
const customCodeRef = ref<HTMLTextAreaElement | null>(null);

const SYMBOLS: { label: string; value: '¥' | '$' | '€' | '£' }[] = [
  { label: '¥', value: '¥' },
  { label: '$', value: '$' },
  { label: '€', value: '€' },
  { label: '£', value: '£' },
];

// 中英文日期时间格式全部合并到下拉列表，
// 顺序：先当前 locale 对应的候选作为前几项（贴近用户习惯），再追加另一 locale 的候选。
const ZH_DATE = ['yyyy"年"m"月"d"日"', 'yyyy-mm-dd', 'yyyy/m/d', 'm"月"d"日"'] as const;
const EN_DATE = ['m/d/yyyy', 'mm/dd/yyyy', 'd-mmm-yyyy', 'mmmm d, yyyy'] as const;
const ZH_DATETIME = [
  'yyyy"年"m"月"d"日" h:mm:ss',
  'yyyy"年"m"月"d"日" hh:mm',
  'yyyy-mm-dd hh:mm:ss',
  'yyyy/m/d h:mm',
] as const;
const EN_DATETIME = [
  'm/d/yyyy h:mm:ss',
  'm/d/yyyy hh:mm',
  'mm/dd/yyyy h:mm AM/PM',
  'd-mmm-yyyy hh:mm:ss',
] as const;

const DATE_FORMATS = computed(() =>
  props.locale === 'zh-CN'
    ? [...ZH_DATE, ...EN_DATE]
    : [...EN_DATE, ...ZH_DATE],
);

const TIME_FORMATS = ['h:mm:ss', 'h:mm', 'hh:mm:ss', 'h:mm AM/PM', 'hh"时"mm"分"ss"秒"', 'H:mm:ss'] as const;

const DATETIME_FORMATS = computed(() =>
  props.locale === 'zh-CN'
    ? [...ZH_DATETIME, ...EN_DATETIME]
    : [...EN_DATETIME, ...ZH_DATETIME],
);

const DURATION_FORMATS = ['[h]:mm:ss', '[h]:mm', 'mm:ss', '[h]"小时"mm"分"ss"秒"', '[h]:mm:ss.00', 'd"天"h:mm:ss'] as const;

const CATEGORY_LABELS: Record<NFDialogCategory, string> = {
  general: 'nfGeneral',
  text: 'nfText',
  number: 'nfNumber',
  percent: 'nfPercent',
  scientific: 'nfScientific',
  accounting: 'nfAccounting',
  financial: 'nfFinancial',
  currency: 'nfCurrency',
  currencyRounded: 'nfCurrencyRounded',
  date: 'nfDate',
  time: 'nfTime',
  dateTime: 'nfDateTime',
  duration: 'nfDuration',
  custom: 'nfCatCustom',
};

// SpDropdown 选项（将各类格式列表转换为 FontOption[]）
const categoryOptions = computed<FontOption[]>(() =>
  NF_DIALOG_CATEGORIES.map((cat) => ({ label: t(props.locale, CATEGORY_LABELS[cat]), value: cat })),
);
const symbolOptions: FontOption[] = SYMBOLS.map((s) => ({ label: s.label, value: s.value }));
const dateFormatOptions = computed<FontOption[]>(() =>
  DATE_FORMATS.value.map((f) => ({ label: f, value: f })),
);
const timeFormatOptions: FontOption[] = (TIME_FORMATS as readonly string[]).map((f) => ({ label: f, value: f }));
const dateTimeFormatOptions = computed<FontOption[]>(() =>
  DATETIME_FORMATS.value.map((f) => ({ label: f, value: f })),
);
const durationFormatOptions: FontOption[] = (DURATION_FORMATS as readonly string[]).map((f) => ({ label: f, value: f }));

// 控制项是否展示
const showThousands = computed(() =>
  ['number', 'currency', 'currencyRounded', 'accounting', 'financial'].includes(category.value),
);
const showSymbol = computed(() => ['currency', 'currencyRounded', 'accounting'].includes(category.value));
const showDate = computed(() => category.value === 'date');
const showTime = computed(() => category.value === 'time');
const showDateTime = computed(() => category.value === 'dateTime');
const showDuration = computed(() => category.value === 'duration');
const showDecimals = computed(() =>
  ['number', 'currency', 'accounting', 'financial', 'percent', 'scientific'].includes(category.value),
);
// 由当前控件状态生成格式代码
function genCode(): string {
  if (category.value === 'general') return NF_GENERAL;
  if (category.value === 'text') return NF_TEXT;
  if (category.value === 'custom') return customCode.value;
  if (category.value === 'date') return dateFmt.value;
  if (category.value === 'time') return timeFmt.value;
  if (category.value === 'dateTime') return dateTimeFmt.value;
  if (category.value === 'duration') return durationFmt.value;
  const dec = Math.max(0, Math.min(30, decimals.value));
  // currency / currencyRounded / accounting 受货币符号影响
  if (category.value === 'currency' || category.value === 'currencyRounded' || category.value === 'accounting') {
    return buildWithSymbol(category.value, dec, thousands.value, symbol.value);
  }
  return buildNumberFormatCode(props.locale, category.value, dec, thousands.value);
}

function buildWithSymbol(cat: NFDialogCategory, dec: number, th: boolean, sym: string): string {
  const intPart = th ? '#,##0' : '0';
  // currencyRounded 强制取整（Toolbar preset 货币取整不带小数）
  if (cat === 'currencyRounded') return sym + intPart;
  const frac = dec > 0 ? '.' + '0'.repeat(dec) : '';
  const base = intPart + frac;
  if (cat === 'currency') return sym + base;
  return `${sym}${base};(${sym}${base});${sym}"-"`;
}

// 根据已有格式代码反推分类与控件（尽力而为，无法识别则保留代码本身）
function detectFromCode(code: string): void {
  customCode.value = code;
  if (isGeneralFormat(code)) {
    category.value = 'general';
    return;
  }
  if (code === '@') {
    category.value = 'text';
    return;
  }
  // 持续时间：含 [h] 且不含 y/d 等日期字符。
  // 日期/时间判定前先移除 [Red]/[>100] 等修饰符（其内含 d 等字母，会触发日期误判），仅保留 [h]
  const stripped = code.replace(/\[[^\]]*\]/gi, (m) => (/\[h\]/i.test(m) ? m : ''));
  if (/\[h\]/i.test(stripped) && !/[yd]/i.test(stripped)) {
    category.value = 'duration';
    if ((DURATION_FORMATS as readonly string[]).includes(code)) durationFmt.value = code;
    // 若 code 不在候选：保持 initFormatDefaultsByLocale 写入的首个候选，下拉不为空
    return;
  }
  // 日期 + 时间：同时含日期标记(y/d/m)与时间标记(h/s 或 AM/PM)
  const hasDateMark = /[yd]/i.test(stripped);
  const hasTimeMark = /h|s|AM\/PM/i.test(stripped);
  if (hasDateMark && hasTimeMark) {
    category.value = 'dateTime';
    if ((DATETIME_FORMATS.value as readonly string[]).includes(code)) dateTimeFmt.value = code;
    return;
  }
  if (hasDateMark || /AM\/PM/i.test(stripped)) {
    if (hasTimeMark && !hasDateMark) {
      category.value = 'time';
      if ((TIME_FORMATS as readonly string[]).includes(code)) timeFmt.value = code;
    } else {
      category.value = 'date';
      if ((DATE_FORMATS.value as readonly string[]).includes(code)) dateFmt.value = code;
    }
    return;
  }
  if (code.includes('%')) {
    category.value = 'percent';
    decimals.value = countDecimals(code);
    return;
  }
  if (/E[+-]/i.test(code)) {
    category.value = 'scientific';
    decimals.value = countDecimals(code);
    return;
  }
  const curSym = SYMBOLS.find((s) => code.startsWith(s.value));
  if (code.includes('[Red](')) {
    category.value = 'financial';
    thousands.value = code.includes(',');
    decimals.value = countDecimals(code);
    return;
  }
  if (curSym) {
    if (code.includes('(')) {
      category.value = 'accounting';
      symbol.value = curSym.value;
      thousands.value = code.includes(',');
      decimals.value = countDecimals(code);
    } else {
      // 货币取整：符号 + 整数格式（无小数位）
      const hasDecimalDot = /\.\d/.test(code.slice(curSym.value.length));
      if (!hasDecimalDot) {
        category.value = 'currencyRounded';
        symbol.value = curSym.value;
        thousands.value = code.includes(',');
      } else {
        category.value = 'currency';
        symbol.value = curSym.value;
        thousands.value = code.includes(',');
        decimals.value = countDecimals(code);
      }
    }
    return;
  }
  category.value = 'number';
  thousands.value = code.includes(',');
  decimals.value = countDecimals(code);
}

function countDecimals(code: string): number {
  const m = code.match(/\.([0#?]+)/);
  return m ? m[1]!.length : 0;
}

// 控件变化 → 重新生成代码写入 customCode（用户随后仍可手动编辑）
function onControlChange() {
  // 切换到 custom 或已在 custom 分类下：保留用户已有 customCode 不覆盖
  if (category.value === 'custom') return;
  customCode.value = genCode();
}

function onCustomInput() {
  // 用户手动编辑：不再由控件覆盖，直到切换控件
}

// 打开对话框时：将日期/时间/日期时间/持续时间的默认值设为当前合并后下拉列表的第一项，
// 避免硬编码默认值不在候选列表里，导致下拉框选中项显示为空。
function initFormatDefaultsByLocale() {
  dateFmt.value = DATE_FORMATS.value[0]!;
  timeFmt.value = TIME_FORMATS[0]!;
  dateTimeFmt.value = DATETIME_FORMATS.value[0]!;
  durationFmt.value = DURATION_FORMATS[0]!;
}

function openDialog() {
  open.value = true;
  if (props.modelOpen !== undefined) emit('update:modelOpen', true);
  initFormatDefaultsByLocale();
  detectFromCode(props.currentFormat ?? '');
  // 带自定义分类标记：不按代码反推分类，直接显示为「自定义」（代码已写入 customCode）
  if (props.isCustom) category.value = 'custom';
  nextTick(() => customCodeRef.value?.focus());
}

function close() {
  open.value = false;
  if (props.modelOpen !== undefined) emit('update:modelOpen', false);
}

function onApply() {
  emit('apply', customCode.value);
  close();
}

function onMaskClick() {
  close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

watch(() => props.modelOpen, (v) => {
  if (v && !open.value) openDialog();
  else if (!v && open.value) close();
});

// 预览：按当前 customCode 格式化样例值（General 走 formatGeneral 自动格式化）
const previewText = computed(() => {
  return formatNumber(props.sampleValue, customCode.value, props.locale);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="nf-dialog">
      <div
        v-if="open"
        class="nf-dialog__mask"
        @mousedown="onMaskClick"
        @keydown="onKeydown"
      >
        <div
          class="nf-dialog"
          :class="{ 'nf-dialog--zh': locale === 'zh-CN' }"
          @mousedown.stop
        >
          <div class="nf-dialog__header">
            <span class="nf-dialog__title">{{ t(locale, 'nfDialogTitle') }}</span>
            <button
              class="nf-dialog__close"
              type="button"
              @click="close"
            >
              <svg
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M571.733333 512l288.533334-288.533333c17.066667-17.066667 17.066667-42.666667 0-59.733334-17.066667-17.066667-42.666667-17.066667-59.733334 0L512 452.266667 223.466667 164.266667c-17.066667-17.066667-42.666667-17.066667-59.733334 0-17.066667 17.066667-17.066667 42.666667 0 59.733333L452.266667 512 164.266667 800c-17.066667 17.066667-17.066667 42.666667 0 59.733333 8.533333 8.533333 19.2 12.8 29.866666 12.8 10.666667 0 21.333333-4.266667 29.866667-12.8L512 571.733333l288.533333 288.533334c8.533333 8.533333 19.2 12.8 29.866667 12.8 10.666667 0 21.333333-4.266667 29.866667-12.8 17.066667-17.066667 17.066667-42.666667 0-59.733334L571.733333 512z" /></svg>
            </button>
          </div>

          <div class="nf-dialog__body">
            <div class="nf-field">
              <label class="nf-field__label">{{ t(locale, 'nfCategory') }}</label>
              <SpDropdown
                class="nf-field__dropdown"
                :model-value="category"
                :options="categoryOptions"
                @update:model-value="category = $event as NFDialogCategory"
                @change="onControlChange"
              />
            </div>

            <div
              v-if="showDecimals"
              class="nf-field"
            >
              <label class="nf-field__label">{{ t(locale, 'nfDecimals') }}</label>
              <input
                v-model.number="decimals"
                class="nf-field__input"
                type="number"
                min="0"
                max="30"
                @input="onControlChange"
              >
            </div>

            <div
              v-if="showThousands"
              class="nf-field nf-field--inline"
            >
              <label class="nf-checkbox">
                <input
                  v-model="thousands"
                  type="checkbox"
                  @change="onControlChange"
                >
                <span>{{ t(locale, 'nfThousands') }}</span>
              </label>
            </div>

            <div
              v-if="showSymbol"
              class="nf-field"
            >
              <label class="nf-field__label">{{ t(locale, 'nfSymbol') }}</label>
              <SpDropdown
                class="nf-field__dropdown"
                :model-value="symbol"
                :options="symbolOptions"
                @update:model-value="symbol = $event as '¥' | '$' | '€' | '£'"
                @change="onControlChange"
              />
            </div>

            <div
              v-if="showDate"
              class="nf-field"
            >
              <label class="nf-field__label">{{ t(locale, 'nfDateFormat') }}</label>
              <SpDropdown
                class="nf-field__dropdown"
                :model-value="dateFmt"
                :options="dateFormatOptions"
                @update:model-value="dateFmt = $event as string"
                @change="onControlChange"
              />
            </div>

            <div
              v-if="showTime"
              class="nf-field"
            >
              <label class="nf-field__label">{{ t(locale, 'nfTimeFormat') }}</label>
              <SpDropdown
                class="nf-field__dropdown"
                :model-value="timeFmt"
                :options="timeFormatOptions"
                @update:model-value="timeFmt = $event as string"
                @change="onControlChange"
              />
            </div>

            <div
              v-if="showDateTime"
              class="nf-field"
            >
              <label class="nf-field__label">{{ t(locale, 'nfDateTime') }}</label>
              <SpDropdown
                class="nf-field__dropdown"
                :model-value="dateTimeFmt"
                :options="dateTimeFormatOptions"
                @update:model-value="dateTimeFmt = $event as string"
                @change="onControlChange"
              />
            </div>

            <div
              v-if="showDuration"
              class="nf-field"
            >
              <label class="nf-field__label">{{ t(locale, 'nfDuration') }}</label>
              <SpDropdown
                class="nf-field__dropdown"
                :model-value="durationFmt"
                :options="durationFormatOptions"
                @update:model-value="durationFmt = $event as string"
                @change="onControlChange"
              />
            </div>

            <div class="nf-field">
              <label class="nf-field__label">{{ t(locale, 'nfCustomCode') }}</label>
              <textarea
                ref="customCodeRef"
                v-model="customCode"
                class="nf-field__textarea"
                rows="2"
                spellcheck="false"
                @input="onCustomInput"
              />
            </div>
          </div>

          <div class="nf-dialog__footer">
            <div class="nf-preview">
              <span class="nf-preview__label">{{ t(locale, 'nfPreview') }}</span>
              <span class="nf-preview__value">{{ previewText || '-' }}</span>
            </div>
            <div class="nf-dialog__actions">
              <button
                class="nf-btn nf-btn--primary"
                type="button"
                @click="onApply"
              >
                {{ t(locale, 'ok') }}
              </button>
              <button
                class="nf-btn"
                type="button"
                @click="close"
              >
                {{ t(locale, 'cancel') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.nf-dialog__mask {
  position: fixed;
  inset: 0;
  z-index: 30000;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
}
.nf-dialog {
  width: 380px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  user-select: none;
}
.nf-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--sp-toolbar-border, #ececec);
}
.nf-dialog__title { font-size: 13px; font-weight: 600; }
.nf-dialog__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--sp-toolbar-btn-color, #888);
  cursor: pointer;
  border-radius: 3px;
  padding: 0;
}
.nf-dialog__close:hover { background: var(--sp-toolbar-btn-hover-bg, #f0f0f0); color: var(--sp-toolbar-btn-color, #444); }
.nf-dialog__close svg { width: 14px; height: 14px; }
.nf-dialog__body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.nf-field { display: flex; align-items: center; gap: 8px; }
.nf-field--inline { min-height: 26px; }
.nf-field__label { width: 88px; min-width: 88px; font-size: 12px; color: #555; }
.nf-field__input {
  flex: 1;
  height: 26px;
  border: 1px solid var(--sp-toolbar-border, #c0c0c0);
  border-radius: 3px;
  background: var(--sp-toolbar-bg, #fff);
  font-size: 12px;
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  padding: 0 6px;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
}
.nf-field__input:focus { border-color: #0078d7; box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3); }

/* SpDropdown 在对话框中的表单风格 */
.nf-field__dropdown { flex: 1; }
.nf-field__dropdown :deep(.sp-dropdown__trigger) {
  border: 1px solid var(--sp-toolbar-border, #c0c0c0);
  background: var(--sp-toolbar-bg, #fff);
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  padding: 0 6px;
}
.nf-field__dropdown :deep(.sp-dropdown__trigger:hover) { background: var(--sp-toolbar-btn-hover-bg, #f5f5f5); }
.nf-field__dropdown :deep(.sp-dropdown__trigger--open) {
  border-color: #0078d7;
  box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3);
}
.nf-field__textarea {
  flex: 1;
  min-height: 44px;
  border: 1px solid var(--sp-toolbar-border, #c0c0c0);
  border-radius: 3px;
  background: var(--sp-toolbar-bg, #fff);
  font-size: 12px;
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  padding: 4px 6px;
  outline: none;
  box-sizing: border-box;
  resize: none;
  font-family: "Consolas", "Courier New", monospace;
}
.nf-field__textarea:focus { border-color: #0078d7; box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3); }
.nf-checkbox { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--sp-toolbar-btn-color, #333); cursor: pointer; }
.nf-checkbox input { margin: 0; cursor: pointer; }
.nf-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--sp-toolbar-border, #ececec);
}
.nf-preview { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.nf-preview__label { font-size: 11px; color: var(--sp-toolbar-btn-color, #888); }
.nf-preview__value {
  font-size: 13px;
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
.nf-dialog__actions { display: flex; gap: 8px; }
.nf-btn {
  height: 28px;
  padding: 0 16px;
  border: 1px solid var(--sp-toolbar-border, #ccc);
  border-radius: 3px;
  background: var(--sp-toolbar-bg, #fff);
  color: var(--sp-toolbar-btn-color, #333);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.nf-btn:hover { background: var(--sp-toolbar-btn-hover-bg, #f0f0f0); }
.nf-btn--primary { border-color: #0078d7; background: #0078d7; color: #fff; }
.nf-btn--primary:hover { background: #0069c0; }
.nf-dialog-enter-active, .nf-dialog-leave-active { transition: opacity 0.14s ease-out; }
.nf-dialog-enter-from, .nf-dialog-leave-to { opacity: 0; }
.nf-dialog-enter-active .nf-dialog, .nf-dialog-leave-active .nf-dialog { transition: transform 0.14s ease-out; }
.nf-dialog-enter-from .nf-dialog, .nf-dialog-leave-to .nf-dialog { transform: scale(0.96); }
</style>
