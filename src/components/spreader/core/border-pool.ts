/**
 * BorderPool — 边框池，用于减少重复边框数据的存储体积。
 *
 * 核心思路：
 *  - 每个 Sheet 维护一个 borders: BorderStyle[] 数组，borders[0] 始终为默认空边框 {}。
 *  - 单元格样式通过 borderId（数组下标）引用边框，而非内联存储完整边框对象。
 *  - 相同内容的边框（即使属性顺序不同）自动复用同一 borderId。
 *  - 已注册的边框对象禁止直接修改（Object.freeze），修改必须创建副本后重新注册。
 *
 * 持久化注意：
 *  - index（Map<string, number>）仅运行时使用，不参与序列化。
 *  - 序列化时只需输出 borders 数组 + cells 中 style 的 borderId。
 */

import type { BorderStyle, BorderSide, CellData, CellStyle } from './types';

// ============ BorderPool 类 ============

export class BorderPool {
  /** 边框数组：borders[0] 始终为默认空边框 {} */
  private borders: BorderStyle[];
  /** 运行时去重索引：stableKey → borderId，不参与持久化 */
  private index: Map<string, number>;

  constructor(existingBorders?: BorderStyle[]) {
    if (existingBorders && existingBorders.length > 0) {
      // 从已有 borders 数组恢复（重建 index）
      this.borders = existingBorders;
      this.index = new Map();
      for (let i = 0; i < this.borders.length; i++) {
        const key = this.stableKey(this.borders[i]!);
        this.index.set(key, i);
      }
    } else {
      // 初始化：borders[0] = 默认空边框
      this.borders = [{}];
      this.index = new Map();
      this.index.set(this.stableKey({}), 0);
    }
  }

  /**
   * 生成稳定的边框 key：对属性名排序后 JSON.stringify。
   * 保证属性顺序不同但内容相同的边框产生相同的 key。
   */
  private stableKey(border: BorderStyle): string {
    const sides: (keyof BorderStyle)[] = ['top', 'right', 'bottom', 'left'];
    const obj: Record<string, unknown> = {};
    for (const side of sides) {
      const s = border[side];
      if (s && (s.width !== undefined || s.color !== undefined || s.style !== undefined)) {
        const sideObj: Record<string, unknown> = {};
        if (s.width !== undefined) sideObj.width = s.width;
        if (s.color !== undefined) sideObj.color = s.color;
        if (s.style !== undefined) sideObj.style = s.style;
        obj[side] = sideObj;
      }
    }
    return JSON.stringify(obj);
  }

  /**
   * 根据 borderId 获取边框对象（只读）。
   * 返回 Object.freeze 冻结的对象，禁止直接修改。
   */
  get(borderId: number): BorderStyle {
    const b = this.borders[borderId];
    if (!b) return {};
    // 对空边框（id=0）直接返回，无需 freeze
    if (borderId === 0) return b;
    return Object.freeze(b);
  }

  /**
   * 查找或注册边框，返回对应的 borderId。
   * 相同内容的边框自动复用已有 id。
   */
  getId(border: BorderStyle): number {
    // 空边框 / 无属性 → 始终映射到 id=0
    if (!border || this.isEmptyBorder(border)) return 0;

    const key = this.stableKey(border);
    const existing = this.index.get(key);
    if (existing !== undefined) return existing;

    // 注册新边框
    const id = this.borders.length;
    // 存储时创建深拷贝并冻结，防止外部引用意外修改
    const frozen = Object.freeze(this.deepCloneBorder(border));
    this.borders.push(frozen);
    this.index.set(key, id);
    return id;
  }

  /** 判断边框是否为空 */
  private isEmptyBorder(border: BorderStyle): boolean {
    return !border.top && !border.right && !border.bottom && !border.left;
  }

  /** 深拷贝边框对象 */
  private deepCloneBorder(border: BorderStyle): BorderStyle {
    const result: BorderStyle = {};
    if (border.top) result.top = { ...border.top };
    if (border.right) result.right = { ...border.right };
    if (border.bottom) result.bottom = { ...border.bottom };
    if (border.left) result.left = { ...border.left };
    return result;
  }

  /** 返回 borders 数组的浅拷贝（用于持久化/快照） */
  getBorders(): BorderStyle[] {
    return [...this.borders];
  }

  /** 直接设置 borders 数组（用于恢复快照），同时重建 index */
  setBorders(borders: BorderStyle[]): void {
    this.borders = borders;
    this.index = new Map();
    for (let i = 0; i < this.borders.length; i++) {
      const key = this.stableKey(this.borders[i]!);
      this.index.set(key, i);
    }
  }

  /**
   * Border GC（垃圾回收）：
   * 扫描 styles 中实际使用的 borderId，删除未被引用的 borders，
   * 重新生成连续的 borderId 并同步更新所有 styles。
   * borders[0] 始终保留。
   *
   * 建议在保存/持久化/导出时调用，不要在每次编辑时执行。
   */
  compactBorders(styles: CellStyle[]): BorderStyle[] {
    // 1. 收集所有实际使用的 borderId
    const usedIds = new Set<number>();
    usedIds.add(0); // borders[0] 必须始终存在
    for (const style of styles) {
      const id = style.borderId ?? 0;
      usedIds.add(id);
    }

    // 2. 构建旧 id → 新 id 映射
    const idMap = new Map<number, number>();
    const newBorders: BorderStyle[] = [{}]; // 新数组，borders[0] = 默认空边框
    idMap.set(0, 0);

    // 按 id 升序遍历，保证映射稳定
    const sortedIds = Array.from(usedIds).sort((a, b) => a - b);
    for (const oldId of sortedIds) {
      if (oldId === 0) continue;
      if (oldId < this.borders.length) {
        const newId = newBorders.length;
        idMap.set(oldId, newId);
        newBorders.push(this.borders[oldId]!);
      }
    }

    // 3. 更新所有 styles 的 borderId
    for (const style of styles) {
      const oldId = style.borderId ?? 0;
      const newId = idMap.get(oldId);
      if (newId !== undefined && newId !== oldId) {
        style.borderId = newId;
      }
    }

    // 4. 更新内部状态
    this.borders = newBorders;
    this.index = new Map();
    for (let i = 0; i < this.borders.length; i++) {
      const k = this.stableKey(this.borders[i]!);
      this.index.set(k, i);
    }

    return newBorders;
  }
}

// ============ 辅助函数 ============

/**
 * 获取单元格的 BorderSide。
 * 通过 cell.styleId → style.borderId → borderPool → BorderStyle[side]
 */
export function getCellBorderSide(
  cell: CellData | undefined,
  side: 'top' | 'right' | 'bottom' | 'left',
  styles: CellStyle[],
  borderPool: BorderPool,
): BorderSide | undefined {
  if (!cell) return undefined;
  const styleId = cell.styleId ?? 0;
  const style = styles[styleId];
  if (!style) return undefined;
  const borderId = style.borderId ?? 0;
  if (borderId === 0) return undefined;
  const border = borderPool.get(borderId);
  if (!border) return undefined;
  return border[side];
}

/**
 * 获取单元格的完整 BorderStyle。
 */
export function getCellBorder(
  cell: CellData | undefined,
  styles: CellStyle[],
  borderPool: BorderPool,
): BorderStyle | undefined {
  if (!cell) return undefined;
  const styleId = cell.styleId ?? 0;
  const style = styles[styleId];
  if (!style) return undefined;
  const borderId = style.borderId ?? 0;
  if (borderId === 0) return undefined;
  return borderPool.get(borderId);
}

/**
 * 设置单元格的某一侧边框。
 * 读取旧 BorderStyle → 创建副本 → 修改指定边 → 注册到 BorderPool → 更新 style.borderId。
 * 不会影响其他共享相同 borderId 的单元格。
 */
export function setCellBorderSide(
  cell: CellData,
  side: 'top' | 'right' | 'bottom' | 'left',
  borderSide: BorderSide | undefined,
  styles: CellStyle[],
  borderPool: BorderPool,
  registerStyle: (style: CellStyle) => number,
): void {
  const oldStyle = styles[cell.styleId ?? 0] ?? {};
  const oldBorderId = oldStyle.borderId ?? 0;
  const oldBorder = oldBorderId > 0 ? borderPool.get(oldBorderId) : {};

  // 创建新的 BorderStyle 副本
  const newBorder: BorderStyle = {
    top: oldBorder.top ? { ...oldBorder.top } : undefined,
    right: oldBorder.right ? { ...oldBorder.right } : undefined,
    bottom: oldBorder.bottom ? { ...oldBorder.bottom } : undefined,
    left: oldBorder.left ? { ...oldBorder.left } : undefined,
  };

  // 修改指定边
  if (borderSide) {
    newBorder[side] = { ...borderSide };
  } else {
    newBorder[side] = undefined;
  }

  // 注册新边框
  const newBorderId = borderPool.getId(newBorder);

  // 更新 style
  const newStyle: CellStyle = { ...oldStyle };
  if (newBorderId === 0) {
    delete newStyle.borderId;
  } else {
    newStyle.borderId = newBorderId;
  }

  // 清理旧版边框属性（兼容迁移时可能遗留）
  delete newStyle.borderTopWidth;
  delete newStyle.borderBottomWidth;
  delete newStyle.borderLeftWidth;
  delete newStyle.borderRightWidth;
  delete newStyle.borderColor;

  // 注册新样式
  if (Object.keys(newStyle).length === 0) {
    cell.styleId = 0;
  } else {
    cell.styleId = registerStyle(newStyle);
  }
}

/**
 * 设置单元格的完整边框（四边）。
 */
export function setCellBorder(
  cell: CellData,
  border: BorderStyle,
  styles: CellStyle[],
  borderPool: BorderPool,
  registerStyle: (style: CellStyle) => number,
): void {
  const oldStyle = styles[cell.styleId ?? 0] ?? {};

  // 注册新边框
  const newBorderId = borderPool.getId(border);

  // 更新 style
  const newStyle: CellStyle = { ...oldStyle };
  if (newBorderId === 0) {
    delete newStyle.borderId;
  } else {
    newStyle.borderId = newBorderId;
  }

  // 清理旧版边框属性
  delete newStyle.borderTopWidth;
  delete newStyle.borderBottomWidth;
  delete newStyle.borderLeftWidth;
  delete newStyle.borderRightWidth;
  delete newStyle.borderColor;

  // 注册新样式
  if (Object.keys(newStyle).length === 0) {
    cell.styleId = 0;
  } else {
    cell.styleId = registerStyle(newStyle);
  }
}

/**
 * 清除单元格的边框。
 */
export function clearCellBorder(
  cell: CellData,
  styles: CellStyle[],
  registerStyle: (style: CellStyle) => number,
): void {
  const oldStyle = styles[cell.styleId ?? 0] ?? {};
  const newStyle: CellStyle = { ...oldStyle };
  delete newStyle.borderId;
  delete newStyle.borderTopWidth;
  delete newStyle.borderBottomWidth;
  delete newStyle.borderLeftWidth;
  delete newStyle.borderRightWidth;
  delete newStyle.borderColor;

  if (Object.keys(newStyle).length === 0) {
    cell.styleId = 0;
  } else {
    cell.styleId = registerStyle(newStyle);
  }
}

/**
 * 迁移旧版边框数据（borderTopWidth 等）到新的 BorderPool 机制。
 * 扫描 styles 数组中所有含旧边框属性的样式，转换为 BorderStyle 注册到 BorderPool。
 */
export function migrateBordersInStyles(
  styles: CellStyle[],
): { styles: CellStyle[]; borders: BorderStyle[] } {
  const pool = new BorderPool();
  const newStyles: CellStyle[] = [];

  for (const style of styles) {
    const hasOldBorder = style.borderTopWidth !== undefined
      || style.borderBottomWidth !== undefined
      || style.borderLeftWidth !== undefined
      || style.borderRightWidth !== undefined;

    if (!hasOldBorder) {
      newStyles.push(style);
      continue;
    }

    // 构建 BorderStyle
    const borderColor = typeof style.borderColor === 'string' ? style.borderColor : undefined;
    const border: BorderStyle = {};

    if (style.borderTopWidth !== undefined && style.borderTopWidth > 0) {
      border.top = { width: style.borderTopWidth, color: borderColor };
    }
    if (style.borderBottomWidth !== undefined && style.borderBottomWidth > 0) {
      border.bottom = { width: style.borderBottomWidth, color: borderColor };
    }
    if (style.borderLeftWidth !== undefined && style.borderLeftWidth > 0) {
      border.left = { width: style.borderLeftWidth, color: borderColor };
    }
    if (style.borderRightWidth !== undefined && style.borderRightWidth > 0) {
      border.right = { width: style.borderRightWidth, color: borderColor };
    }

    const borderId = pool.getId(border);
    const newStyle: CellStyle = { ...style };
    delete newStyle.borderTopWidth;
    delete newStyle.borderBottomWidth;
    delete newStyle.borderLeftWidth;
    delete newStyle.borderRightWidth;
    delete newStyle.borderColor;

    if (borderId > 0) {
      newStyle.borderId = borderId;
    } else {
      delete newStyle.borderId;
    }

    newStyles.push(newStyle);
  }

  return { styles: newStyles, borders: pool.getBorders() };
}

/**
 * 清理 merge 内部的边框数据（可选，保存时调用）。
 * merge 内部 grid cell 的边框在渲染时会被忽略，此函数清理这些冗余数据。
 */
export function cleanupMergeInternalBorders(
  cells: Record<string, CellData>,
  merges: Record<string, { startCol: number; startRow: number; endCol: number; endRow: number }>,
  styles: CellStyle[],
  borderPool: BorderPool,
  cellKey: (c: number, r: number) => string,
  registerStyle: (style: CellStyle) => number,
): void {
  for (const mergeKey in merges) {
    const m = merges[mergeKey];
    if (!m) continue;

    for (let c = m.startCol; c <= m.endCol; c++) {
      for (let r = m.startRow; r <= m.endRow; r++) {
        // 跳过 anchor（左上角）
        if (c === m.startCol && r === m.startRow) continue;

        const key = cellKey(c, r);
        const cell = cells[key];
        if (!cell) continue;

        const style = styles[cell.styleId ?? 0];
        if (!style || !style.borderId) continue;

        // 清除非 anchor 的内部 cell 边框
        clearCellBorder(cell, styles, registerStyle);
      }
    }
  }
}
