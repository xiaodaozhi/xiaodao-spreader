<script setup lang="ts">
/**
 * 数据验证出错警告（Error Alert）。
 * 三种样式对应 Excel 的 Stop / Warning / Information：
 *  - stop       ：不能提交非法数据 → 按钮「取消 / 重试」
 *  - warning    ：提示后可确认继续 → 按钮「否 / 是」
 *  - information：提示后由用户决定 → 按钮「取消 / 确定」
 * 视觉规范与条件格式「新建规则」对话框 / 数据验证对话框保持一致。
 */
import { computed } from 'vue';
import { t } from '../core/constants';
import type { DataValidationSeverity } from '../core/types';

const props = withDefaults(defineProps<{
  locale: string;
  severity: DataValidationSeverity;
  title: string;
  message: string;
  themeVars?: Record<string, string>;
}>(), {
  title: '',
  message: '',
  themeVars: () => ({}),
});

const emit = defineEmits<{
  /** retry：返回编辑态修正（stop）；continue：确认继续写入；cancel：放弃本次输入 */
  (e: 'resolve', action: 'retry' | 'continue' | 'cancel'): void;
}>();

const ICONS: Record<DataValidationSeverity, { path: string; color: string }> = {
  // 停止：圆形禁止符号
  stop: {
    color: '#d93025',
    path: 'M512 64a448 448 0 1 0 0 896 448 448 0 0 0 0-896zm0 96a352 352 0 1 1 0 704 352 352 0 0 1 0-704zm-160 224h320a32 32 0 0 1 0 64H352a32 32 0 0 1 0-64z',
  },
  // 警告：三角感叹号
  warning: {
    color: '#f4b400',
    path: 'M512 96l416 736H96L512 96zm0 128L192 768h640L512 224zm-32 128a32 32 0 0 1 32 32v160a32 32 0 0 1-64 0V384a32 32 0 0 1 32-32zm0 256a36 36 0 1 1 0 72 36 36 0 0 1 0-72z',
  },
  // 信息：圆形 i
  information: {
    color: '#1a73e8',
    path: 'M512 64a448 448 0 1 0 0 896 448 448 0 0 0 0-896zm0 96a352 352 0 1 1 0 704 352 352 0 0 1 0-704zm-32 128a32 32 0 0 1 64 0v32a32 32 0 0 1-64 0V288zm32 128a36 36 0 1 1 0 72 36 36 0 0 1 0-72zm0 96a32 32 0 0 1 32 32v128a32 32 0 0 1-64 0V544a32 32 0 0 1 32-32z',
  },
};

const icon = computed(() => ICONS[props.severity] ?? ICONS.stop);

const fallbackTitle = computed(() => {
  if (props.title) return props.title;
  if (props.severity === 'warning') return t(props.locale, 'dvWarningDialogTitle');
  if (props.severity === 'information') return t(props.locale, 'dvInformationDialogTitle');
  return t(props.locale, 'dvStopDialogTitle');
});

const primaryLabel = computed(() => {
  if (props.severity === 'stop') return t(props.locale, 'dvBtnRetry');
  if (props.severity === 'warning') return t(props.locale, 'dvBtnContinue');
  return t(props.locale, 'dvBtnOk');
});

const secondaryLabel = computed(() => {
  if (props.severity === 'stop') return t(props.locale, 'cancel');
  if (props.severity === 'warning') return t(props.locale, 'dvBtnNo');
  return t(props.locale, 'cancel');
});

function onPrimary() {
  emit('resolve', props.severity === 'stop' ? 'retry' : 'continue');
}
function onSecondary() {
  emit('resolve', 'cancel');
}
</script>

<template>
  <div
    class="dv-alert"
    :style="themeVars"
  >
    <div class="dv-alert__header">
      <span class="dv-alert__title">{{ fallbackTitle }}</span>
    </div>

    <div class="dv-alert__body">
      <svg
        class="dv-alert__icon"
        viewBox="0 0 1024 1024"
        :style="{ color: icon.color }"
      >
        <path
          :d="icon.path"
          fill="currentColor"
        />
      </svg>
      <div class="dv-alert__text">
        <div
          v-if="title"
          class="dv-alert__subtitle"
        >
          {{ title }}
        </div>
        <div class="dv-alert__message">
          {{ message }}
        </div>
      </div>
    </div>

    <div class="dv-alert__footer">
      <span class="dv-alert__spacer" />
      <button
        type="button"
        class="dv-alert__btn dv-alert__btn--primary"
        @mousedown.prevent
        @click="onPrimary"
      >
        {{ primaryLabel }}
      </button>
      <button
        type="button"
        class="dv-alert__btn"
        @mousedown.prevent
        @click="onSecondary"
      >
        {{ secondaryLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 与条件格式「新建规则」对话框（conditional-format-rule-editor.vue）保持同一套视觉语言 */
.dv-alert {
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
.dv-alert__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--sp-toolbar-border, #eee);
  font-weight: 600;
  font-size: 14px;
}
.dv-alert__body {
  display: flex;
  gap: 10px;
  padding: 14px;
}
.dv-alert__icon {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
}
.dv-alert__text {
  flex: 1;
  min-width: 0;
}
.dv-alert__subtitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--sp-toolbar-btn-color, #222);
  margin-bottom: 4px;
  word-break: break-word;
}
.dv-alert__message {
  font-size: 13px;
  line-height: 1.5;
  color: var(--sp-toolbar-btn-color, #444);
  word-break: break-word;
}
.dv-alert__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--sp-toolbar-border, #eee);
}
.dv-alert__spacer { flex: 1; }
.dv-alert__btn {
  height: 30px;
  padding: 0 16px;
  border: 1px solid #c4c4c4;
  border-radius: 3px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  white-space: nowrap;
}
.dv-alert__btn:hover { background: #f0f0f0; }
.dv-alert__btn--primary { border-color: #0078d7; background: #0078d7; color: #fff; }
.dv-alert__btn--primary:hover { background: #0069c0; }
</style>
