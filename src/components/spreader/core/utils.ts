// ============ 纯工具函数 ============

import { HEADER_HEIGHT, HEADER_WIDTH } from './constants';
import type { CellCoord } from './types';

/** 列号 → Excel 风格列标签 (0→A, 25→Z, 26→AA) */
export function colToLabel(col: number): string {
  let label = '';
  let n = col;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** Excel 风格列标签 → 列号 (A→0, Z→25, AA→26) */
export function labelToCol(label: string): number {
  let col = 0;
  for (let i = 0; i < label.length; i++) {
    col = col * 26 + (label.toUpperCase().charCodeAt(i) - 64);
  }
  return col - 1;
}

/** 解析 CSS 尺寸值，返回像素数值或 null */
export function resolveSize(val: number | string | undefined): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    if (val.endsWith('%')) return null;
    return isNaN(n) ? null : n;
  }
  return null;
}

/** 写入剪贴板（兼容旧浏览器） */
export function writeClipboardText(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

/** 根据行列索引生成单元格标志符 */
export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** 将单元格引用字符串转为坐标（如 "A1" → {col:0, row:0}） */
export function parseCellRef(ref: string, colCount: number, rowCount: number): CellCoord | null {
  const m = ref.match(/^\$?([A-Z]+)\$?(\d+)$/i);
  if (!m) return null;
  const col = labelToCol(m[1]!);
  const row = parseInt(m[2]!, 10) - 1;
  if (col < 0 || col >= colCount || row < 0 || row >= rowCount) return null;
  return { col, row };
}

/** 命中测试：根据 X 坐标二分查找所在列 */
export function hitTestCol(x: number, colPositions: number[], colCount: number): number {
  if (x < 0 || x >= colPositions[colCount]!) return -1;
  let lo = 0, hi = colCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (colPositions[mid]! <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 命中测试：根据 Y 坐标二分查找所在行 */
export function hitTestRow(y: number, rowPositions: number[], rowCount: number): number {
  if (y < 0 || y >= rowPositions[rowCount]!) return -1;
  let lo = 0, hi = rowCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rowPositions[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 获取 canvas 相对坐标 */
export function getCanvasXY(
  e: MouseEvent,
  canvas: HTMLCanvasElement | null,
): { x: number; y: number } {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/** 网格可视区域宽度（减去列头和滚动条） */
export function gridViewW(viewW: number, sbSize: number): number {
  return Math.max(0, viewW - HEADER_WIDTH - sbSize);
}

/** 网格可视区域高度（减去行头和滚动条） */
export function gridViewH(viewH: number, sbSize: number): number {
  return Math.max(0, viewH - HEADER_HEIGHT - sbSize);
}
