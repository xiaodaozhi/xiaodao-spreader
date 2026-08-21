<script setup lang="ts">
import { t } from './constants';
import type { SheetState } from './types';

const _props = defineProps<{
  locale: string;
  sheets: SheetState[];
  activeSheetIndex: number;
  renTab: number | null;
  renTabVal: string;
}>();

const emit = defineEmits<{
  (e: 'tab-click' | 'tab-dblclick', i: number): void;
  (e: 'tab-contextmenu', payload: { ev: MouseEvent; i: number }): void;
  (e: 'tab-rename-input', v: string): void;
  (e: 'tab-rename-keydown', ev: KeyboardEvent): void;
  (e: 'tab-rename-commit' | 'add-sheet'): void;
  (e: 'tabbar-contextmenu', ev: MouseEvent): void;
}>();
</script>

<template>
  <div
    class="tab-bar"
    @contextmenu="emit('tabbar-contextmenu', $event)"
  >
    <div class="tab-list">
      <template
        v-for="(s, i) in sheets"
        :key="s.id"
      >
        <div
          class="tab-item"
          :class="{ 'tab-item--active': i === activeSheetIndex }"
          @click="emit('tab-click', i)"
          @dblclick.prevent="emit('tab-dblclick', i)"
          @contextmenu="emit('tab-contextmenu', { ev: $event, i: i })"
        >
          <template v-if="renTab === i">
            <input
              class="tab-rename-input"
              :value="renTabVal"
              @input="emit('tab-rename-input', ($event.target as HTMLInputElement).value)"
              @keydown="emit('tab-rename-keydown', $event)"
              @blur="emit('tab-rename-commit')"
              @click.stop
            >
          </template>
          <template v-else>
            <span class="tab-item__name">{{ s.name }}</span>
          </template>
        </div>
      </template>
    </div>
    <button
      class="tab-bar__add-btn"
      :title="t(locale, 'addSheet')"
      @click="emit('add-sheet')"
    >
      +
    </button>
  </div>
</template>

<style scoped>
.tab-bar { display: flex; align-items: stretch; height: 30px; min-height: 30px; background: var(--sp-tab-bar-bg); border-top: 1px solid var(--sp-tab-bar-border); user-select: none; margin-top: 4px; }
.tab-list { display: flex; align-items: flex-start; flex: 1; overflow: hidden; gap: 1px; padding: 0 1px; }
.tab-item { display: flex; align-items: center; height: 28px; min-width: 0; max-width: 120px; padding: 0 10px; cursor: pointer; border: 1px solid var(--sp-tab-inactive-border); background: var(--sp-tab-inactive-bg); color: var(--sp-tab-inactive-color); font-size: 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; white-space: nowrap; transition: background 0.1s; }
.tab-item:hover { background: var(--sp-tab-hover-bg); }
.tab-item--active { height: 28px; background: var(--sp-tab-active-bg); color: var(--sp-tab-active-color); border-color: var(--sp-tab-active-bg) var(--sp-tab-bar-border) var(--sp-tab-bar-border); border-top: 2px solid var(--sp-tab-active-border); font-size: 16px; }
.tab-item--active:hover { background: var(--sp-tab-active-bg); }
.tab-item__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-rename-input { width: 100%; height: 18px; border: none; border-radius: 0; outline: none; padding: 0; font-size: 16px; font-family: inherit; background: var(--sp-tab-active-bg); color: var(--sp-tab-active-color); box-sizing: border-box; }
.tab-bar__add-btn { width: 24px; min-width: 24px; height: 24px; margin: 0 4px 3px 3px; border: none; background: transparent; color: var(--sp-tab-add-btn-color); font-size: 16px; line-height: 22px; text-align: center; cursor: pointer; padding: 0; }
.tab-bar__add-btn:hover { background: var(--sp-tab-add-btn-hover-bg); }
</style>
