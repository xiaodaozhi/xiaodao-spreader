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
        class="find-bar__chk-input"
        type="checkbox"
        :checked="matchCase"
        @change="emit('update:matchCase', ($event.target as HTMLInputElement).checked)"
      >
      <span class="find-bar__chk-box">
        <svg
          class="find-bar__chk-tick"
          viewBox="0 0 1024 1024"
          fill="currentColor"
        ><path d="M405 697L195 487l58-58 152 152 304-304 58 58z" /></svg>
      </span>{{ t(locale, 'matchCase') }}
    </label>
    <label class="find-bar__chk">
      <input
        class="find-bar__chk-input"
        type="checkbox"
        :checked="matchEntireCell"
        @change="emit('update:matchEntireCell', ($event.target as HTMLInputElement).checked)"
      >
      <span class="find-bar__chk-box">
        <svg
          class="find-bar__chk-tick"
          viewBox="0 0 1024 1024"
          fill="currentColor"
        ><path d="M405 697L195 487l58-58 152 152 304-304 58 58z" /></svg>
      </span>{{ t(locale, 'matchEntireCell') }}
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
      ><path d="M571.733333 512l288.533334-288.533333c17.066667-17.066667 17.066667-42.666667 0-59.733334-17.066667-17.066667-42.666667-17.066667-59.733334 0L512 452.266667 223.466667 164.266667c-17.066667-17.066667-42.666667-17.066667-59.733334 0-17.066667 17.066667-17.066667 42.666667 0 59.733333L452.266667 512 164.266667 800c-17.066667 17.066667-17.066667 42.666667 0 59.733333 8.533333 8.533333 19.2 12.8 29.866666 12.8 10.666667 0 21.333333-4.266667 29.866667-12.8L512 571.733333l288.533333 288.533334c8.533333 8.533333 19.2 12.8 29.866667 12.8 10.666667 0 21.333333-4.266667 29.866667-12.8 17.066667-17.066667 17.066667-42.666667 0-59.733334L571.733333 512z" /></svg>
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
  gap: 5px;
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--sp-toolbar-btn-color);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
/* 原生 input 仅保留状态/可访问性，视觉由自定义 box 呈现 */
.find-bar__chk-input {
  position: absolute;
  width: 0;
  height: 0;
  margin: 0;
  padding: 0;
  opacity: 0;
  pointer-events: none;
}
.find-bar__chk-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  box-sizing: border-box;
  border: 1px solid var(--sp-toolbar-border);
  border-radius: 3px;
  background: #fff;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.find-bar__chk-tick {
  width: 12px;
  height: 12px;
  color: #fff;
  opacity: 0;
  transform: scale(0.5);
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.find-bar__chk-input:checked + .find-bar__chk-box {
  background: #0078d7;
  border-color: #0078d7;
}
.find-bar__chk-input:checked + .find-bar__chk-box .find-bar__chk-tick {
  opacity: 1;
  transform: scale(1);
}
.find-bar__chk-input:focus-visible + .find-bar__chk-box {
  outline: 2px solid rgba(0, 120, 215, 0.4);
  outline-offset: 1px;
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
  border: none;
}
.find-bar__btn--close svg {
  width: 14px;
  height: 14px;
}
</style>
