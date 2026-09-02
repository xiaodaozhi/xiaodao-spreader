<script setup lang="ts">
/**
 * 单元格批注浮层（Note Popup / Note Editor）。
 *
 * 分层原则：
 *  - 数据读写全部由调用方（spreader.vue → core-state/notes）负责，本组件纯展示 + 交互；
 *  - 位置：调用方传入「单元格屏幕矩形」anchor（由 cellToScreenRect + wrapper 偏移得到，
 *    已兼容滚动/冻结/合并/筛选/分组），本组件据 anchor 做视口外智能偏移；
 *  - 不产生常驻 DOM：仅当有 active note（view/edit）时挂载单个实例。
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, type CSSProperties } from 'vue';
import { t } from '../core/constants';

type NoteMode = 'view' | 'edit';
type Anchor = { x: number; y: number; width: number; height: number };

const props = withDefaults(defineProps<{
  anchor: Anchor;
  mode: NoteMode;
  /** 批注对象（view 一定有；edit 可能为空=新建） */
  note?: { text: string; author?: string; createdAt: number; updatedAt: number } | null;
  /** 当前作者名（新建/保存用于 author 字段） */
  author: string;
  locale: string;
  placeholder?: string;
  boundaryEl?: HTMLElement | null;
}>(), {
  note: null,
  placeholder: '',
  boundaryEl: null,
});

const emit = defineEmits<{
  (e: 'save', text: string): void;
  (e: 'delete' | 'close'): void;
}>();

const el = ref<HTMLDivElement | null>(null);
const draft = ref(props.note?.text ?? '');

// 编辑态同步新打开的新建/编辑内容（组件复用同一实例，切格时重置草稿）
watch(
  () => [props.mode, props.note?.text, props.anchor.x, props.anchor.y] as const,
  () => {
    draft.value = props.note?.text ?? '';
  },
);

// 居中定位：状态给到 ref 再由 style 使用，适配视口外翻向
const pos = ref<{ left: number; top: number }>({ left: 0, top: 0 });
const style = computed<CSSProperties>(() => ({
  left: pos.value.left + 'px',
  top: pos.value.top + 'px',
  // 始终高于两个画布（body z:0 / freeze z:1），确保选中格的填充方块不被浮在上层；
  // 仍低于滚动条（z:3），避免遮挡可交互的滚动条
  zIndex: 2,
}));

function layout() {
  const dom = el.value;
  const a = props.anchor;
  if (!dom) {
    pos.value = { left: a.x + a.width + 6, top: a.y + 6 };
    return;
  }
  const w = dom.offsetWidth;
  const h = dom.offsetHeight;
  // wrapper 相对坐标：boundary 为 body 区域（避开行列头 HEADER_WIDTH=52, HEADER_HEIGHT=24）
  const HW = 52, HH = 24;
  const b = { left: HW, top: HH, right: (props.boundaryEl?.offsetWidth ?? 0), bottom: (props.boundaryEl?.offsetHeight ?? 0) };
  const GAP = 6;
  const MARGIN = 8;

  // 优先：单元格右下
  let left = a.x + a.width + GAP;
  let top = a.y + GAP;
  // 水平：放不下→左下方；仍放不下→夹在左右
  if (left + w > b.right - MARGIN) {
    left = a.x - w - GAP;
    if (left < b.left + MARGIN) {
      left = Math.min(Math.max(b.left + MARGIN, a.x), b.right - w - MARGIN);
      if (b.right - w - MARGIN < b.left + MARGIN) left = b.left + MARGIN;
    }
  }
  // 垂直：放不下→右上方；仍放不下→夹在上下
  if (top + h > b.bottom - MARGIN) {
    top = a.y + a.height - GAP - h;
    if (top < b.top + MARGIN) {
      top = Math.min(Math.max(b.top + MARGIN, a.y), b.bottom - h - MARGIN);
      if (b.bottom - h - MARGIN < b.top + MARGIN) top = b.top + MARGIN;
    }
  }
  pos.value = { left, top };
}

// 依赖渲染后测量，重新布局（含打开瞬间 / 数据或锚点变化）
watch(
  () => [props.anchor.x, props.anchor.y, props.anchor.width, props.note?.text, draft.value] as const,
  () => nextTick(layout),
  { immediate: true, flush: 'post' },
);
function onResize() {
  nextTick(layout);
}
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));

// 编辑输入：Enter 换行，Alt/Ctrl/Meta+Enter 保存文案（实际保存由 save 事件上抛），Escape 关闭
function onTextKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    e.preventDefault();
    emit('close');
  } else if (e.key === 'Enter' && !e.shiftKey && (e.ctrlKey || e.metaKey || e.altKey)) {
    e.stopPropagation();
    e.preventDefault();
    save();
  }
}
function save() {
  emit('save', draft.value.trim());
}
</script>

<template>
  <div
    v-if="mode"
    ref="el"
    class="note-overlay"
    :class="`note-overlay--${mode}`"
    :style="style"
    @mousedown.stop
    @contextmenu.stop
    @click.stop
  >
    <template v-if="mode === 'view'">
      <div class="note-overlay__header">
        <span class="note-overlay__author">{{ note?.author || author || t(locale, 'noteUnnamed') }}</span>
        <button
          type="button"
          class="note-overlay__icon"
          :title="t(locale, 'findClose')"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
      <div class="note-overlay__body">
        {{ note?.text || t(locale, 'noteEmpty') }}
      </div>
    </template>
    <template v-else>
      <div class="note-overlay__header">
        <span class="note-overlay__author">{{ author || t(locale, 'noteUnnamed') }}</span>
      </div>
      <textarea
        v-model="draft"
        class="note-overlay__editor"
        :placeholder="placeholder"
        rows="3"
        @keydown="onTextKeydown"
        @blur="save"
      />
      <div class="note-overlay__footer">
        <button
          type="button"
          class="note-overlay__btn note-overlay__btn--ghost"
          @click="emit('close')"
        >
          {{ t(locale, 'cancel') }}
        </button>
        <button
          type="button"
          class="note-overlay__btn note-overlay__btn--primary"
          @click="save"
        >
          {{ t(locale, 'noteSave') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.note-overlay {
  position: absolute;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-width: 200px;
  max-width: 320px;
  min-height: 60px;
  border: 1px solid var(--sp-toolbar-border, #b8bcc4);
  border-radius: 4px;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.2);
  padding: 6px 8px 4px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  line-height: 1.45;
}
.note-overlay--view {
  background: #fffef7;
  color: #333;
}
.note-overlay--edit {
  background: var(--sp-toolbar-bg, #fff);
  color: var(--sp-toolbar-btn-color, #333);
}
.note-overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 3px;
}
.note-overlay__author {
  font-size: 11px;
  font-weight: 600;
  color: #5b5b5b;
}
.note-overlay__icon {
  border: none;
  background: transparent;
  color: #888;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.note-overlay__icon:hover {
  color: #333;
}
.note-overlay__body {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}
.note-overlay__editor {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--sp-toolbar-border, #c6ccd6);
  border-radius: 3px;
  font: inherit;
  line-height: 1.5;
  padding: 5px 6px;
  color: var(--sp-toolbar-btn-color, #333);
  background: var(--sp-formula-bar-input-bg, #fff);
  resize: none;
  min-height: 64px;
  max-height: 192px;
  overflow-y: auto;
}
.note-overlay__editor:focus {
  outline: none;
  border-color: #4c8bf5;
  box-shadow: 0 0 0 1px rgba(76, 139, 245, 0.4);
}
.note-overlay__footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}
.note-overlay__btn {
  border: 1px solid var(--sp-toolbar-border, #c6ccd6);
  border-radius: 3px;
  padding: 3px 12px;
  font-size: 12px;
  cursor: pointer;
  background: var(--sp-toolbar-bg, #fff);
  color: var(--sp-toolbar-btn-color, #333);
}
.note-overlay__btn--primary {
  background: #4c8bf5;
  border-color: #4c8bf5;
  color: #fff;
}
.note-overlay__btn--ghost:hover {
  background: var(--sp-toolbar-btn-hover-bg, #f0f0f0);
}
.note-overlay__btn--primary:hover {
  background: #3f7be8;
}
</style>
