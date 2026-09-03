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
import { t } from '../../core/constants';
import type { DataValidationSeverity } from '../../core/types';

const props = withDefaults(defineProps<{
  locale: string;
  severity: DataValidationSeverity;
  title?: string;
  message?: string;
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

interface DvIconGlyph {
  d: string;
  fill: string;
  /** 需要旋转的图形（如交叉条）携带整体变换 */
  t?: string;
}
interface DvIcon {
  paths: DvIconGlyph[];
}

// 出错样式图标：实心语义色底 + 高对比字形，参照 Excel 三种 Alert 的经典形态。
//  - stop       ：红色圆底 + 白色交叉条（禁止输入），比线框圆更醒目
//  - warning    ：琥珀三角（深棕垫底勾勒描边）+ 深色感叹号
//  - information：蓝色圆底 + 白色 i
const ICONS: Record<DataValidationSeverity, DvIcon> = {
  stop: {
    paths: [
      { d: 'M512 84a428 428 0 1 0 0 856 428 428 0 0 0 0-856z', fill: '#d93025' },
      { d: 'M412 172h200v680H412z', fill: '#ffffff', t: 'rotate(45 512 512)' },
      { d: 'M412 172h200v680H412z', fill: '#ffffff', t: 'rotate(-45 512 512)' },
    ],
  },
  warning: {
    paths: [
      { d: 'M512 96 L64 880 L960 880 Z', fill: '#8a5a00' },
      { d: 'M512 128 L91 865 L933 865 Z', fill: '#ffc107' },
      { d: 'M476 380h72v300H476z', fill: '#212121' },
      { d: 'M512 726a46 46 0 1 0 0 92 46 46 0 0 0 0-92z', fill: '#212121' },
    ],
  },
  information: {
    paths: [
      { d: 'M512 84a428 428 0 1 0 0 856 428 428 0 0 0 0-856z', fill: '#1a73e8' },
      { d: 'M512 316a56 56 0 1 0 0 112 56 56 0 0 0 0-112z', fill: '#ffffff' },
      { d: 'M474 460h76v280H474z', fill: '#ffffff' },
    ],
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
      >
        <path
          v-for="(g, gi) in icon.paths"
          :key="gi"
          :d="g.d"
          :fill="g.fill"
          :transform="g.t || undefined"
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
  border: 1px solid var(--sp-toolbar-border, #c4c4c4);
  border-radius: 3px;
  background: var(--sp-toolbar-bg, #fff);
  cursor: pointer;
  font-size: 13px;
  color: var(--sp-toolbar-btn-color, #333);
  white-space: nowrap;
}
.dv-alert__btn:hover { background: var(--sp-toolbar-btn-hover-bg, #f0f0f0); }
.dv-alert__btn--primary { border-color: #0078d7; background: #0078d7; color: #fff; }
.dv-alert__btn--primary:hover { background: #0069c0; }
</style>
