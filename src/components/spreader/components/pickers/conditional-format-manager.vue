<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../core/constants';
import { colToLabel } from '../../core/utils';
import type { ConditionalFormattingRule, ConditionalFormattingCondition } from '../../core/types';

const props = withDefaults(defineProps<{
  locale: string;
  rules?: ConditionalFormattingRule[];
  editable?: boolean;
  themeVars?: Record<string, string>;
}>(), {
  rules: () => [],
  editable: true,
  themeVars: () => ({}),
});

const emit = defineEmits<{
  (e: 'edit', rule: ConditionalFormattingRule): void;
  (e: 'delete', id: string): void;
  (e: 'move', id: string, dir: 'up' | 'down'): void;
  (e: 'toggle', id: string, enabled: boolean): void;
  (e: 'new' | 'close'): void;
}>();

const sortedRules = computed(() =>
  [...props.rules].sort((a, b) => a.priority - b.priority),
);

function rangeText(r: ConditionalFormattingRule): string {
  return r.ranges.map((rg) => {
    const a = colToLabel(rg.startCol) + (rg.startRow + 1);
    if (rg.startCol === rg.endCol && rg.startRow === rg.endRow) return a;
    return a + ':' + colToLabel(rg.endCol) + (rg.endRow + 1);
  }).join(', ');
}

function condSummary(c: ConditionalFormattingCondition): string {
  switch (c.type) {
    case 'cellIs': {
      const op = t(props.locale, 'cf' + (c.operator === 'greaterThan'
        ? 'GreaterThan'
        : c.operator === 'lessThan'
          ? 'LessThan'
          : c.operator === 'greaterThanOrEqual'
            ? 'GreaterThanOrEqual'
            : c.operator === 'lessThanOrEqual'
              ? 'LessThanOrEqual'
              : c.operator === 'notEqual'
                ? 'NotEqual'
                : c.operator === 'between'
                  ? 'Between'
                  : c.operator === 'notBetween' ? 'NotBetween' : 'Equal'));
      if (c.operator === 'between' || c.operator === 'notBetween') {
        return `${op} ${c.value} ${t(props.locale, 'cfValue2')} ${c.value2 ?? ''}`;
      }
      return `${op} ${c.value}`;
    }
    case 'textContains': return `${t(props.locale, 'cfTextContains')} "${c.value}"`;
    case 'textNotContains': return `${t(props.locale, 'cfTextNotContains')} "${c.value}"`;
    case 'blank': return t(props.locale, 'cfBlank');
    case 'notBlank': return t(props.locale, 'cfNotBlank');
    case 'duplicate': return t(props.locale, 'cfDuplicate');
    case 'unique': return t(props.locale, 'cfUnique');
    case 'formula': return '= ' + c.formula;
    default: return t(props.locale, 'cfRuleTypeGeneric');
  }
}

function previewStyle(r: ConditionalFormattingRule): Record<string, string> {
  const s: Record<string, string> = {};
  if (r.format.backgroundColor) s.background = r.format.backgroundColor;
  if (r.format.color) s.color = r.format.color;
  if (r.format.fontWeight === 'bold') s.fontWeight = '700';
  if (r.format.fontStyle === 'italic') s.fontStyle = 'italic';
  if (r.format.underline === 'underline') s.textDecoration = 'underline';
  if (r.format.strikethrough === 'line-through') s.textDecoration = 'line-through';
  return s;
}
</script>

<template>
  <div
    class="cf-manager"
    :style="themeVars"
  >
    <div class="cf-manager__header">
      <span class="cf-manager__title">{{ t(locale, 'cfManagerTitle') }}</span>
      <button
        type="button"
        class="cf-btn cf-btn--primary cf-manager__new"
        :disabled="props.editable === false"
        @click="emit('new')"
      >
        {{ t(locale, 'cfNewRule') }}
      </button>
      <button
        type="button"
        class="cf-manager__close"
        @click="emit('close')"
      >
        ×
      </button>
    </div>

    <div
      v-if="sortedRules.length === 0"
      class="cf-manager__empty"
    >
      {{ t(locale, 'cfNoRules') }}
    </div>

    <div
      v-else
      class="cf-manager__list"
    >
      <div
        v-for="r in sortedRules"
        :key="r.id"
        class="cf-rule"
        :class="{ 'cf-rule--disabled': !r.enabled }"
      >
        <div class="cf-rule__main">
          <span
            class="cf-rule__preview"
            :style="previewStyle(r)"
          >Aa</span>
          <div class="cf-rule__info">
            <div class="cf-rule__summary">
              {{ condSummary(r.condition) }}
            </div>
            <div class="cf-rule__range">
              {{ t(locale, 'cfAppliedTo') }}: {{ rangeText(r) }}
            </div>
          </div>
        </div>
        <div class="cf-rule__actions">
          <label class="cf-chk">
            <input
              class="cf-chk__input"
              type="checkbox"
              :checked="r.enabled"
              :disabled="props.editable === false"
              @change="emit('toggle', r.id, ($event.target as HTMLInputElement).checked)"
            >
            <span class="cf-chk__box">
              <svg
                class="cf-chk__tick"
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M405 697L195 487l58-58 152 152 304-304 58 58z" /></svg>
            </span>{{ t(locale, 'cfEnabled') }}
          </label>
          <button
            type="button"
            class="cf-mini"
            :title="t(locale, 'cfMoveUp')"
            :disabled="props.editable === false"
            @click="emit('move', r.id, 'up')"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 3 L8 13 M4 7 L8 3 L12 7" />
            </svg>
          </button>
          <button
            type="button"
            class="cf-mini"
            :title="t(locale, 'cfMoveDown')"
            :disabled="props.editable === false"
            @click="emit('move', r.id, 'down')"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 3 L8 13 M4 9 L8 13 L12 9" />
            </svg>
          </button>
          <button
            type="button"
            class="cf-mini"
            :title="t(locale, 'cfEdit')"
            :disabled="props.editable === false"
            @click="emit('edit', r)"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M10.5 3.5 L13 6 L5 14 L2 14 L2 11 Z" />
              <path d="M9 5.5 L11.5 8" />
            </svg>
          </button>
          <button
            type="button"
            class="cf-mini"
            :title="t(locale, 'cfDelete')"
            :disabled="props.editable === false"
            @click="emit('delete', r.id)"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            >
              <path d="M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cf-manager {
  width: 460px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0, 0.18);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: var(--sp-toolbar-btn-color, #333);
  box-sizing: border-box;
}
.cf-manager__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--sp-toolbar-border, #eee);
}
.cf-manager__title { font-weight: 600; font-size: 14px; flex: 1; }
.cf-manager__close {
  border: none; background: transparent; font-size: 20px; line-height: 1; cursor: pointer; color: var(--sp-toolbar-btn-color, #888);
}
.cf-manager__close:hover { color: var(--sp-toolbar-btn-color, #333); }
.cf-manager__new { margin-left: auto; }
.cf-manager__empty { padding: 30px 14px; text-align: center; color: var(--sp-toolbar-text-muted, #999); font-size: 13px; }
.cf-manager__list { overflow-y: auto; padding: 8px; }
.cf-rule {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border: 1px solid var(--sp-toolbar-border, #eee);
  border-radius: 4px;
  margin-bottom: 6px;
}
.cf-rule--disabled { opacity: 0.5; }
.cf-rule__main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.cf-rule__preview {
  width: 34px; height: 24px;
  border: 1px solid var(--sp-toolbar-border, #ccc);
  border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; flex: 0 0 auto;
}
.cf-rule__info { min-width: 0; }
.cf-rule__summary { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cf-rule__range { font-size: 12px; color: var(--sp-toolbar-btn-color, #888); margin-top: 2px; }
.cf-rule__actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.cf-chk {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--sp-toolbar-btn-color, #333);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
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
.cf-mini {
  width: 26px; height: 26px;
  border: 1px solid var(--sp-toolbar-border, #c4c4c4);
  border-radius: 3px;
  background: var(--sp-toolbar-bg, #fff);
  cursor: pointer;
  color: var(--sp-toolbar-btn-color, #333);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.cf-mini svg { display: block; width: 14px; height: 14px; }
.cf-mini:hover { background: var(--sp-toolbar-btn-hover-bg, #f0f0f0); }
.cf-mini:disabled { color: var(--sp-toolbar-btn-disabled-color, #bbb); border-color: var(--sp-toolbar-border, #ddd); cursor: default; }
.cf-mini:disabled:hover { background: var(--sp-toolbar-bg, #fff); }

.cf-btn {
  height: 30px;
  padding: 0 14px;
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
.cf-btn:disabled { color: var(--sp-toolbar-btn-disabled-color, #bbb); border-color: var(--sp-toolbar-border, #ddd); background: var(--sp-toolbar-bg, #fff); cursor: default; }
.cf-btn:disabled:hover { background: var(--sp-toolbar-bg, #fff); }
.cf-chk__input:disabled + .cf-chk__box { opacity: 0.5; }
.cf-chk:has(.cf-chk__input:disabled) { cursor: default; }
</style>
