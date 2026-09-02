<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { t } from '../../core/constants';

const props = withDefaults(defineProps<{
  modelOpen?: boolean;
  locale?: string;
}>(), {
  modelOpen: false,
  locale: 'zh-CN',
});

const emit = defineEmits<{
  (e: 'update:modelOpen' | 'confirm', v: boolean): void;
  (e: 'cancel'): void;
}>();

const open = ref(false);
const expandSelection = ref(true);
const dialogRef = ref<HTMLDivElement | null>(null);

watch(() => props.modelOpen, (v) => {
  if (v && !open.value) openDialog();
  else if (!v && open.value) close();
});

function openDialog() {
  expandSelection.value = true;
  open.value = true;
  if (props.modelOpen !== undefined) emit('update:modelOpen', true);
  nextTick(() => {
    const primary = dialogRef.value?.querySelector('.sort-confirm__btn--primary') as HTMLElement | null;
    primary?.focus();
  });
}

function close() {
  open.value = false;
  if (props.modelOpen !== undefined) emit('update:modelOpen', false);
}

function onMaskClick() {
  onCancel();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') onCancel();
}

function onConfirm() {
  emit('confirm', expandSelection.value);
  close();
}

function onCancel() {
  emit('cancel');
  close();
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sort-confirm">
      <div
        v-if="open"
        class="sort-confirm__mask"
        @mousedown="onMaskClick"
        @keydown="onKeydown"
      >
        <div
          ref="dialogRef"
          class="sort-confirm"
          @mousedown.stop
        >
          <div class="sort-confirm__header">
            <span class="sort-confirm__title">{{ t(locale, 'sortReminderTitle') }}</span>
            <button
              class="sort-confirm__close"
              type="button"
              @click="onCancel"
            >
              <svg
                viewBox="0 0 1024 1024"
                fill="currentColor"
              ><path d="M571.733333 512l288.533334-288.533333c17.066667-17.066667 17.066667-42.666667 0-59.733334-17.066667-17.066667-42.666667-17.066667-59.733334 0L512 452.266667 223.466667 164.266667c-17.066667-17.066667-42.666667-17.066667-59.733334 0-17.066667 17.066667-17.066667 42.666667 0 59.733333L452.266667 512 164.266667 800c-17.066667 17.066667-17.066667 42.666667 0 59.733333 8.533333 8.533333 19.2 12.8 29.866666 12.8 10.666667 0 21.333333-4.266667 29.866667-12.8L512 571.733333l288.533333 288.533334c8.533333 8.533333 19.2 12.8 29.866667 12.8 10.666667 0 21.333333-4.266667 29.866667-12.8 17.066667-17.066667 17.066667-42.666667 0-59.733334L571.733333 512z" /></svg>
            </button>
          </div>

          <div class="sort-confirm__body">
            <p class="sort-confirm__message">
              {{ t(locale, 'sortReminderMessage') }}
            </p>
            <div class="sort-confirm__options">
              <label class="sort-confirm__option">
                <input
                  v-model="expandSelection"
                  type="radio"
                  :value="true"
                >
                <span>{{ t(locale, 'sortExpandSelection') }}</span>
              </label>
              <label class="sort-confirm__option">
                <input
                  v-model="expandSelection"
                  type="radio"
                  :value="false"
                >
                <span>{{ t(locale, 'sortCurrentSelection') }}</span>
              </label>
            </div>
          </div>

          <div class="sort-confirm__footer">
            <button
              class="sort-confirm__btn sort-confirm__btn--primary"
              type="button"
              @click="onConfirm"
            >
              {{ t(locale, 'sort') }}
            </button>
            <button
              class="sort-confirm__btn"
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
.sort-confirm__mask {
  position: fixed;
  inset: 0;
  z-index: 30000;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sort-confirm {
  width: 360px;
  max-width: calc(100vw - 32px);
  background: var(--sp-toolbar-bg, #fff);
  border: 1px solid var(--sp-toolbar-border, #d0d0d0);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: var(--sp-toolbar-btn-color, #1a1a1a);
  user-select: none;
}
.sort-confirm__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--sp-toolbar-border, #ececec);
}
.sort-confirm__title { font-size: 13px; font-weight: 600; }
.sort-confirm__close {
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
.sort-confirm__close:hover { background: var(--sp-toolbar-btn-hover-bg, #f0f0f0); color: var(--sp-toolbar-btn-color, #444); }
.sort-confirm__close svg { width: 14px; height: 14px; }
.sort-confirm__body { padding: 14px; }
.sort-confirm__message { margin: 0 0 12px; font-size: 12px; line-height: 1.5; color: var(--sp-toolbar-btn-color, #333); }
.sort-confirm__options { display: flex; flex-direction: column; gap: 8px; }
.sort-confirm__option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--sp-toolbar-btn-color, #333);
  cursor: pointer;
}
.sort-confirm__option input { margin: 0; cursor: pointer; }
.sort-confirm__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--sp-toolbar-border, #ececec);
}
.sort-confirm__btn {
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
.sort-confirm__btn:hover { background: var(--sp-toolbar-btn-hover-bg, #f0f0f0); }
.sort-confirm__btn--primary { border-color: #0078d7; background: #0078d7; color: #fff; }
.sort-confirm__btn--primary:hover { background: #0069c0; }
.sort-confirm-enter-active, .sort-confirm-leave-active { transition: opacity 0.14s ease-out; }
.sort-confirm-enter-from, .sort-confirm-leave-to { opacity: 0; }
.sort-confirm-enter-active .sort-confirm, .sort-confirm-leave-active .sort-confirm { transition: transform 0.14s ease-out; }
.sort-confirm-enter-from .sort-confirm, .sort-confirm-leave-to .sort-confirm { transform: scale(0.96); }
</style>
