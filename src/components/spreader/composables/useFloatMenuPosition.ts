import { ref } from 'vue';
import { getFloatBounds, cssRightFromX } from '../core/utils';

export interface FloatMenuPosition {
  /** fixed 定位：右缘（px），与 trigger 右缘对齐后夹回有效右边界 */
  right?: number;
  /** fixed 定位：左缘（px）。默认不使用，仅当右缘锚定不可用时的兜底 */
  left?: number;
  /** fixed 定位：上缘（px） */
  top: number;
  /** 是否向上翻向弹出（trigger 下方放不下且上方有空间） */
  up: boolean;
}

/**
 * 主弹出菜单（工具栏下拉框：条件格式 / 分组等）的统一定位逻辑。
 *
 * 与 conditional-format-menu.vue 原实现完全同构，抽出来让所有工具栏下拉框复用同一套，
 * 不再各写一套：
 * - 右缘锚定 trigger 右缘（Math.min(r.right, b.right) 夹回有效右边界），top 先落 trigger 下缘 +4；
 * - 传入 menuEl（已挂载、可量高度）后，按「容器∩视口」有效区做上下翻向 + 夹紧：
 *   下方放得下就向下；下方放不下但上方有空间就向上；两边都放不下→夹紧贴顶/贴底兜底。
 *
 * 调用约定（与 cf-menu 一致）：先 place(trigger, boundary) 做初始下落放置，
 * 再于 nextTick 后 place(trigger, boundary, menuEl) 量高翻向。
 */
export function useFloatMenuPosition() {
  const pos = ref<FloatMenuPosition>({ top: 0, up: false });

  function place(
    triggerEl: HTMLElement,
    boundaryEl: HTMLElement | null,
    menuEl?: HTMLElement | null,
  ) {
    const b = getFloatBounds(boundaryEl);
    const r = triggerEl.getBoundingClientRect();
    const right = cssRightFromX(Math.min(r.right, b.right));
    if (!menuEl) {
      // 初始放置：向下、不翻向，等 nextTick 量到真实高度再 refine
      pos.value = { right, top: r.bottom + 4, up: false };
      return;
    }
    const h = menuEl.offsetHeight;
    const spaceBelow = b.bottom - r.bottom - 8;
    const spaceAbove = r.top - b.top - 8;
    const up = spaceBelow < h && spaceAbove > 0;
    let top = up ? r.top - h - 4 : r.bottom + 4;
    top = Math.max(b.top + 8, Math.min(b.bottom - h - 8, top));
    pos.value = { right, top, up };
  }

  return { pos, place };
}

