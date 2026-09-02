// ============ 从 SheetModelData 推导逻辑尺寸 ============

import { MIN_COL_WIDTH, MIN_ROW_HEIGHT } from './constants';
import type { SheetModelData } from './types';

export interface LogicalDims {
  colCount: number;
  rowCount: number;
}

/**
 * 从序列化数据推导工作表逻辑尺寸（0-based exclusive）。
 *
 * SheetModelData 不再持久化 colCount/rowCount，导入（含 v-model 外部数据重新加载）时
 * 必须按内容推导网格大小，否则超出默认 26×200 的数据加载后会被裁剪为不可访问。
 * 参与推导的信息：
 * - cells 键（"col,row"）与 merges 范围：数据实际占据的最大行列；
 * - colWidths / rowHeights 键：用户自定义过尺寸的行列（仅当达到最小宽/高阈值）；
 * - 筛选、条件格式、数据验证范围以及行列分组：跨越数据区外缘的结构性区域。
 *
 * @param smd  序列化的工作表数据
 * @param base 保底尺寸（通常传 props 配置的默认 dims），结果不小于 base
 */
export function deriveModelDims(smd: SheetModelData, base: LogicalDims): LogicalDims {
  let maxCol = -1;
  let maxRow = -1;
  const grow = (c: number, r: number) => {
    if (Number.isInteger(c) && c >= 0 && c > maxCol) maxCol = c;
    if (Number.isInteger(r) && r >= 0 && r > maxRow) maxRow = r;
  };
  const growRange = (rg: { startCol: number; startRow: number; endCol: number; endRow: number } | undefined) => {
    if (!rg) return;
    grow(Math.max(rg.startCol, rg.endCol), Math.max(rg.startRow, rg.endRow));
  };

  for (const key of Object.keys(smd.cells)) {
    const sep = key.indexOf(',');
    if (sep < 0) continue;
    grow(Number(key.slice(0, sep)), Number(key.slice(sep + 1)));
  }
  for (const rg of Object.values(smd.merges ?? {})) growRange(rg);
  // 自定义过宽度的列：宽度本身即表明该列逻辑上存在
  if (smd.colWidths) {
    for (const [c, w] of Object.entries(smd.colWidths)) {
      const ci = Number(c);
      if (Number.isInteger(ci) && ci >= 0 && w >= MIN_COL_WIDTH) grow(ci, -1);
    }
  }
  // 自定义过高度的行：同上
  if (smd.rowHeights) {
    for (const [r, h] of Object.entries(smd.rowHeights)) {
      const ri = Number(r);
      if (Number.isInteger(ri) && ri >= 0 && h != null && h >= MIN_ROW_HEIGHT) grow(-1, ri);
    }
  }
  for (const rule of smd.conditionalFormats ?? []) {
    for (const rg of rule.ranges ?? []) growRange(rg);
  }
  for (const rule of smd.dataValidations ?? []) {
    for (const rg of rule.ranges ?? []) growRange(rg);
  }
  if (smd.filter) growRange(smd.filter.range);
  for (const o of smd.rowOutlines ?? []) grow(-1, o.end);
  for (const o of smd.columnOutlines ?? []) grow(o.end, -1);

  return {
    colCount: Math.max(1, base.colCount, maxCol + 1),
    rowCount: Math.max(1, base.rowCount, maxRow + 1),
  };
}
