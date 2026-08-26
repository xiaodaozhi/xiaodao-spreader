<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { t } from '../core/constants';
import type { FindScope } from '../core/types';
import type { FontOption } from '../core/constants';
import SpDropdown from './dropdown.vue';

const props = defineProps<{
  open: boolean;
  findText: string;
  replaceText: string;
  scope: FindScope;
  matchCase: boolean;
  matchEntireCell: boolean;
  currentIndex: number;
  total: number;
  message: string;
  focusToken: number;
  locale: string;
  themeVars?: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: 'update:findText' | 'update:replaceText', v: string): void;
  (e: 'update:scope', v: FindScope): void;
  (e: 'update:matchCase' | 'update:matchEntireCell', v: boolean): void;
  (e: 'prev' | 'next' | 'replace' | 'replace-all' | 'close'): void;
}>();

const findInputRef = ref<HTMLInputElement | null>(null);

const countText = computed(() => {
  if (props.total > 0) return `${props.currentIndex + 1}/${props.total}`;
  return props.message || '';
});

const scopeOptions = computed<FontOption[]>(() => [
  { label: t(props.locale, 'scopeSheet'), value: 'sheet' },
  { label: t(props.locale, 'scopeWorkbook'), value: 'workbook' },
  { label: t(props.locale, 'scopeSelection'), value: 'selection' },
]);

// 打开 / 需要聚焦时聚焦查找输入框
watch(
  () => props.focusToken,
  () => {
    nextTick(() => findInputRef.value?.focus());
  },
);

function onInputKd(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) emit('prev');
    else emit('next');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}
</script>

<template>
  <div
    v-if="open"
    class="find-bar"
    :style="themeVars"
  >
    <input
      ref="findInputRef"
      class="find-bar__input"
      :placeholder="t(locale, 'findPlaceholder')"
      :value="findText"
      @input="emit('update:findText', ($event.target as HTMLInputElement).value)"
      @keydown="onInputKd"
    >
    <input
      class="find-bar__input"
      :placeholder="t(locale, 'replacePlaceholder')"
      :value="replaceText"
      @input="emit('update:replaceText', ($event.target as HTMLInputElement).value)"
      @keydown="onInputKd"
    >
    <SpDropdown
      class="find-bar__dropdown"
      :model-value="scope"
      :options="scopeOptions"
      :title="t(locale, 'findScope')"
      @update:model-value="$emit('update:scope', $event as FindScope)"
    />
    <label class="find-bar__chk">
      <input
        type="checkbox"
        :checked="matchCase"
        @change="emit('update:matchCase', ($event.target as HTMLInputElement).checked)"
      >{{ t(locale, 'matchCase') }}
    </label>
    <label class="find-bar__chk">
      <input
        type="checkbox"
        :checked="matchEntireCell"
        @change="emit('update:matchEntireCell', ($event.target as HTMLInputElement).checked)"
      >{{ t(locale, 'matchEntireCell') }}
    </label>
    <span class="find-bar__count">{{ countText }}</span>
    <button
      class="find-bar__btn find-bar__btn--icon"
      :title="t(locale, 'findPrev')"
      :disabled="total === 0"
      @click="emit('prev')"
    >
      <svg
        viewBox="0 0 1024 1024"
        fill="currentColor"
      ><path d="M512 320a32 32 0 0 1 45.254 0l288 288a32 32 0 0 1-45.254 45.254L512 410.51 214.254 653.254A32 32 0 0 1 169 608l288-288z" /></svg>
    </button>
    <button
      class="find-bar__btn find-bar__btn--icon"
      :title="t(locale, 'findNext')"
      :disabled="total === 0"
      @click="emit('next')"
    >
      <svg
        viewBox="0 0 1024 1024"
        fill="currentColor"
      ><path d="M512 704a32 32 0 0 1-45.254 0l-288-288A32 32 0 0 1 214.254 370.746L512 613.49 809.746 370.746A32 32 0 0 1 855 416l-288 288z" /></svg>
    </button>
    <button
      class="find-bar__btn find-bar__btn--text"
      :disabled="total === 0"
      @click="emit('replace')"
    >
      {{ t(locale, 'replace') }}
    </button>
    <button
      class="find-bar__btn find-bar__btn--text"
      :disabled="total === 0"
      @click="emit('replace-all')"
    >
      {{ t(locale, 'replaceAll') }}
    </button>
    <button
      class="find-bar__btn find-bar__btn--close"
      :title="t(locale, 'findClose')"
      @click="emit('close')"
    >
      <svg
        viewBox="0 0 1024 1024"
        fill="currentColor"
      ><path d="M512 451.669L369.664 294.336a32 32 0 0 0-45.312 45.312L466.688 497 309.355 654.336a32 32 0 0 0 45.312 45.312L512 542.688l157.333 157.334a32 32 0 0 0 45.312-45.312L557.312 497 714.645 339.664a32 32 0 0 0-45.312-45.312z" /></svg>
    </button>
  </div>
</template>

<style scoped>
.find-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--sp-toolbar-bg);
  border-bottom: 1px solid var(--sp-toolbar-border);
  user-select: none;
  flex-wrap: nowrap;
  overflow-x: auto;
}
.find-bar__input {
  height: 24px;
  width: 160px;
  flex: 0 0 auto;
  border: 1px solid var(--sp-toolbar-border);
  border-radius: 3px;
  padding: 0 6px;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: var(--sp-formula-bar-input-color, #1a1a1a);
  background: #fff;
  outline: none;
  box-sizing: border-box;
}
.find-bar__input:focus {
  border-color: var(--sp-toolbar-btn-active-color);
}
.find-bar__dropdown { flex: 0 0 auto; }
.find-bar__dropdown :deep(.sp-dropdown__trigger) {
  height: 24px;
  border: 1px solid var(--sp-toolbar-border);
  background: #fff;
  color: var(--sp-formula-bar-input-color, #1a1a1a);
  font-size: 12px;
  padding: 0 4px;
}
.find-bar__dropdown :deep(.sp-dropdown__trigger:hover) { background: #f5f5f5; }
.find-bar__dropdown :deep(.sp-dropdown__trigger--open) {
  border-color: var(--sp-toolbar-btn-active-color);
}
.find-bar__chk {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--sp-toolbar-btn-color);
  white-space: nowrap;
  cursor: pointer;
}
.find-bar__chk input {
  margin: 0;
}
.find-bar__count {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--sp-toolbar-btn-color);
  min-width: 44px;
  text-align: center;
  white-space: nowrap;
}
.find-bar__btn {
  height: 24px;
  flex: 0 0 auto;
  border: 1px solid var(--sp-toolbar-border);
  border-radius: 3px;
  background: transparent;
  color: var(--sp-toolbar-btn-color);
  cursor: pointer;
  font-size: 12px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.find-bar__btn:hover:not(:disabled) {
  background: var(--sp-toolbar-btn-hover-bg);
}
.find-bar__btn:disabled {
  color: var(--sp-toolbar-btn-disabled-color);
  cursor: default;
}
.find-bar__btn--icon {
  width: 26px;
  padding: 0;
}
.find-bar__btn--icon svg {
  width: 14px;
  height: 14px;
}
.find-bar__btn--close {
  width: 26px;
  padding: 0;
  margin-left: auto;
}
.find-bar__btn--close svg {
  width: 14px;
  height: 14px;
}
</style>
