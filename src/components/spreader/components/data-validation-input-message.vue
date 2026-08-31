<script setup lang="ts">
/**
 * 数据验证输入信息（Input Message）：选中单元格时显示的轻量提示气泡。
 * 默认 showInputMessage = false，避免每次点击单元格都弹出干扰。
 * 位置由调用方通过 cellToScreenRect 计算后传入（兼容冻结窗格与合并单元格）。
 */
withDefaults(defineProps<{
  title: string;
  message: string;
  x: number;
  y: number;
  width: number;
  height: number;
}>(), {
  title: '',
  message: '',
  x: 0,
  y: 0,
  width: 100,
  height: 24,
});
</script>

<template>
  <div
    class="dvim"
    :style="{ left: x + 'px', top: (y + height + 4) + 'px', minWidth: Math.min(220, Math.max(width, 140)) + 'px' }"
  >
    <div
      v-if="title"
      class="dvim__title"
    >
      {{ title }}
    </div>
    <div class="dvim__message">
      {{ message }}
    </div>
  </div>
</template>

<style scoped>
.dvim {
  position: fixed;
  z-index: 10002;
  max-width: 260px;
  padding: 6px 9px;
  box-sizing: border-box;
  background: #fffde7;
  border: 1px solid #d6cf8f;
  border-radius: 3px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #4a4200;
  pointer-events: none;
  user-select: none;
}
.dvim__title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 2px;
  word-break: break-word;
}
.dvim__message {
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
