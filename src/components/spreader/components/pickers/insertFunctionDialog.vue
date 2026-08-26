<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { t } from '../../core/constants';
import { FORMULA_PRESETS, checkFormulaStructure } from '../../core/formula';
import SpDropdown from '../dropdown.vue';
import type { FontOption } from '../../core/constants';

// 插入函数对话框：下拉选择公式 → 在 textarea 中插入函数骨架（可继续编辑）→ 插入到目标单元格
const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
}>(), {
  modelOpen: false,
  locale: 'zh-CN',
});

const emit = defineEmits<{
  (e: 'update:modelOpen', v: boolean): void;
  (e: 'insert', text: string): void;
  (e: 'cancel'): void;
}>();

const open = ref(false);
const selected = ref<string | number>('');
const formulaText = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const dialogRef = ref<HTMLDivElement | null>(null);

/** 各函数的 i18n 描述键（与 FORMULA_PRESETS 顺序一一对应） */
const DESC_KEYS: Record<string, string> = {
  SUM: 'fnDescSum',
  AVERAGE: 'fnDescAverage',
  COUNT: 'fnDescCount',
  IF: 'fnDescIf',
  VLOOKUP: 'fnDescVlookup',
  CONCATENATE: 'fnDescConcatenate',
};

const functionOptions = computed<FontOption[]>(() =>
  FORMULA_PRESETS.map(p => ({
    label: p.name,
    value: p.name,
  })),
);

/** 选中函数后在下拉框下方显示的说明文字 */
const selectedDesc = computed(() => {
  const name = String(selected.value ?? '');
  if (!name) return '';
  return t(props.locale, DESC_KEYS[name] ?? '');
});

/** 公式文本的结构校验结果（=FUNC(args) 结构、括号配平、参数数量合规） */
const formulaCheck = computed(() => checkFormulaStructure(formulaText.value));

/**
 * 「插入」按钮可用条件（全部满足才启用）：
 * 1. 下拉框已选择函数
 * 2. 公式输入框非空
 * 3. 公式结构校验通过
 * 4. 公式顶层函数与下拉所选函数一致（未被改为其他函数/破坏结构）
 */
const canInsert = computed(() => {
  if (selected.value === '' || selected.value === null) return false;
  if (!formulaText.value.trim()) return false;
  if (!formulaCheck.value.ok) return false;
  return formulaCheck.value.name === String(selected.value).toUpperCase();
});

watch(() => props.modelOpen, (v) => {
  if (v && !open.value) openDialog();
  else if (!v && open.value) close();
});

function openDialog() {
  formulaText.value = '';
  selected.value = '';
  open.value = true;
  if (props.modelOpen !== undefined) emit('update:modelOpen', true);
  nextTick(() => {
    const ta = textareaRef.value;
    if (ta) {
      try {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(ta.value.length, ta.value.length);
      } catch {
        // ignore
      }
    }
  });
}

function close() {
  open.value = false;
  if (props.modelOpen !== undefined) emit('update:modelOpen', false);
}

/** 下拉选择/切换函数：先清空 textarea，再插入该函数的骨架（空内容自动补前导 '='） */
function onFunctionChange(v: string | number) {
  selected.value = v;
  const preset = FORMULA_PRESETS.find(p => p.name === String(v));
  if (!preset) return;
  formulaText.value = '';
  insertSnippet(preset.snippet);
}

function insertSnippet(snippet: string) {
  const text = formulaText.value;
  const ta = textareaRef.value;
  const start = ta ? (ta.selectionStart ?? text.length) : text.length;
  const end = ta ? (ta.selectionEnd ?? text.length) : text.length;
  // 内容尚为空时自动补公式前导 '='
  const ins = text.trim() ? snippet : '=' + snippet;
  formulaText.value = text.slice(0, start) + ins + text.slice(end);
  nextTick(() => {
    const el = textareaRef.value;
    if (!el) return;
    const caret = start + ins.length;
    try {
      el.focus({ preventScroll: true });
      el.setSelectionRange(caret, caret);
    } catch {
      // ignore
    }
  });
}

function onInsert() {
  emit('insert', formulaText.value);
  close();
}

function onCancel() {
  emit('cancel');
  close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    onCancel();
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ifn-dialog">
      <div
        v-if="open"
        class="ifn-dialog__mask"
        @mousedown.self="onCancel"
        @keydown="onKeydown"
      >
        <div
          ref="dialogRef"
          class="ifn-dialog"
          @mousedown.stop
        >
          <div class="ifn-dialog__header">
            <span class="ifn-dialog__title">{{ t(locale, 'insertFunctionTitle') }}</span>
            <button
              class="ifn-dialog__close"
              type="button"
              @click="onCancel"
            >
              <svg
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M571.733333 512l288.533334-288.533333c17.066667-17.066667 17.066667-42.666667 0-59.733334-17.066667-17.066667-42.666667-17.066667-59.733334 0L512 452.266667 223.466667 164.266667c-17.066667-17.066667-42.666667-17.066667-59.733334 0-17.066667 17.066667-17.066667 42.666667 0 59.733333L452.266667 512 164.266667 800c-17.066667 17.066667-17.066667 42.666667 0 59.733333 8.533333 8.533333 19.2 12.8 29.866666 12.8 10.666667 0 21.333333-4.266667 29.866667-12.8L512 571.733333l288.533333 288.533334c8.533333 8.533333 19.2 12.8 29.866667 12.8 10.666667 0 21.333333-4.266667 29.866667-12.8 17.066667-17.066667 17.066667-42.666667 0-59.733334L571.733333 512z" /></svg>
            </button>
          </div>

          <div class="ifn-dialog__body">
            <div class="ifn-dialog__field">
              <label class="ifn-dialog__label">{{ t(locale, 'insertFunctionSelectLabel') }}</label>
              <SpDropdown
                class="ifn-dialog__dropdown"
                :model-value="selected"
                :options="functionOptions"
                :searchable="true"
                :search-placeholder="t(locale, 'insertFunctionSearchPlaceholder')"
                :fallback-label="t(locale, 'insertFunctionPlaceholder')"
                :title="t(locale, 'insertFunctionSelectLabel')"
                @update:model-value="onFunctionChange"
              />
              <div
                v-if="selectedDesc"
                class="ifn-dialog__desc"
              >
                {{ selectedDesc }}
              </div>
            </div>
            <div class="ifn-dialog__field">
              <label class="ifn-dialog__label">{{ t(locale, 'insertFunctionFormulaLabel') }}</label>
              <textarea
                ref="textareaRef"
                v-model="formulaText"
                class="ifn-dialog__textarea"
                spellcheck="false"
              />
            </div>
          </div>

          <div class="ifn-dialog__footer">
            <button
              class="ifn-dialog__btn ifn-dialog__btn--primary"
              type="button"
              :disabled="!canInsert"
              @click="onInsert"
            >
              {{ t(locale, 'insertFunctionBtn') }}
            </button>
            <button
              class="ifn-dialog__btn"
              type="button"
              @click="onCancel"
            >
              {{ t(locale, 'cancel') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ifn-dialog__mask {
  position: fixed;
  inset: 0;
  z-index: 30000;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ifn-dialog {
  width: 440px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #1a1a1a;
  user-select: none;
}
.ifn-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #ececec;
}
.ifn-dialog__title { font-size: 13px; font-weight: 600; }
.ifn-dialog__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: #888;
  cursor: pointer;
  border-radius: 3px;
  padding: 0;
}
.ifn-dialog__close:hover { background: #f0f0f0; color: #444; }
.ifn-dialog__close svg { width: 14px; height: 14px; }
.ifn-dialog__body { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.ifn-dialog__field { display: flex; flex-direction: column; gap: 6px; }
.ifn-dialog__label { font-size: 12px; color: #333; }
.ifn-dialog__dropdown { width: 100%; }
.ifn-dialog__dropdown :deep(.sp-dropdown__trigger) {
  border: 1px solid #c0c0c0;
  background: #fff;
  color: #1a1a1a;
  padding: 0 6px;
}
.ifn-dialog__dropdown :deep(.sp-dropdown__trigger:hover) { background: #f5f5f5; }
.ifn-dialog__dropdown :deep(.sp-dropdown__trigger--open) {
  border-color: #0078d7;
  box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3);
}
.ifn-dialog__desc {
  font-size: 12px;
  line-height: 1.5;
  color: #666;
  user-select: text;
}
.ifn-dialog__textarea {
  width: 100%;
  height: 84px;
  border: 1px solid #c0c0c0;
  border-radius: 3px;
  background: #fff;
  font-size: 12px;
  line-height: 1.5;
  color: #1a1a1a;
  padding: 5px 6px;
  outline: none;
  box-sizing: border-box;
  font-family: Consolas, Menlo, monospace;
  resize: vertical;
  user-select: text;
}
.ifn-dialog__textarea:focus {
  border-color: #0078d7;
  box-shadow: 0 0 0 1px rgba(0, 120, 215, 0.3);
}
.ifn-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #ececec;
}
.ifn-dialog__btn {
  height: 28px;
  padding: 0 16px;
  border: 1px solid #ccc;
  border-radius: 3px;
  background: #fff;
  color: #333;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.ifn-dialog__btn:hover { background: #f0f0f0; }
.ifn-dialog__btn--primary { border-color: #0078d7; background: #0078d7; color: #fff; }
.ifn-dialog__btn--primary:hover { background: #0069c0; }
.ifn-dialog__btn--primary:disabled,
.ifn-dialog__btn--primary:disabled:hover {
  border-color: #ccc;
  background: #f0f0f0;
  color: #a8a8a8;
  cursor: not-allowed;
}
.ifn-dialog-enter-active, .ifn-dialog-leave-active { transition: opacity 0.14s ease-out; }
.ifn-dialog-enter-from, .ifn-dialog-leave-to { opacity: 0; }
.ifn-dialog-enter-active .ifn-dialog, .ifn-dialog-leave-active .ifn-dialog { transition: transform 0.14s ease-out; }
.ifn-dialog-enter-from .ifn-dialog, .ifn-dialog-leave-to .ifn-dialog { transform: scale(0.96); }
</style>
