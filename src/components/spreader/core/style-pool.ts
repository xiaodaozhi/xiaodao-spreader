/**
 * StylePool — 样式池，用于减少重复样式数据的存储体积。
 *
 * 核心思路：
 *  - 每个 Sheet 维护一个 styles: CellStyle[] 数组，styles[0] 始终为默认空样式 {}。
 *  - 单元格通过 styleId（数组下标）引用样式，而非内联存储完整样式对象。
 *  - 相同内容的样式（即使属性顺序不同）自动复用同一 styleId。
 *  - 已注册的样式对象禁止直接修改（Object.freeze），修改必须创建副本后重新注册。
 *
 * 持久化注意：
 *  - index（Map<string, number>）仅运行时使用，不参与序列化。
 *  - 序列化时只需输出 styles 数组 + cells 中的 styleId。
 */

import type { CellData, CellStyle } from './types';

// ============ StylePool 类 ============

export class StylePool {
  /** 样式数组：styles[0] 始终为默认空样式 {} */
  private styles: CellStyle[];
  /** 运行时去重索引：stableKey → styleId，不参与持久化 */
  private index: Map<string, number>;

  constructor(existingStyles?: CellStyle[]) {
    if (existingStyles && existingStyles.length > 0) {
      // 从已有 styles 数组恢复（重建 index）
      this.styles = existingStyles;
      this.index = new Map();
      for (let i = 0; i < this.styles.length; i++) {
        const key = this.stableKey(this.styles[i]!);
        this.index.set(key, i);
      }
    } else {
      // 初始化：styles[0] = 默认空样式
      this.styles = [{}];
      this.index = new Map();
      this.index.set(this.stableKey({}), 0);
    }
  }

  /**
   * 生成稳定的样式 key：对属性名排序后 JSON.stringify。
   * 保证属性顺序不同但内容相同的样式产生相同的 key。
   */
  private stableKey(style: CellStyle): string {
    const keys = Object.keys(style).sort();
    const obj: Record<string, unknown> = {};
    for (const k of keys) {
      obj[k] = style[k];
    }
    return JSON.stringify(obj);
  }

  /**
   * 根据 styleId 获取样式对象（只读）。
   * 返回 Object.freeze 冻结的对象，禁止直接修改。
   */
  get(styleId: number): CellStyle {
    const s = this.styles[styleId];
    if (!s) return {};
    // 对空样式（id=0）直接返回，无需 freeze（空对象无属性可改）
    if (styleId === 0) return s;
    return Object.freeze(s);
  }

  /**
   * 查找或注册样式，返回对应的 styleId。
   * 相同内容的样式自动复用已有 id。
   */
  getId(style: CellStyle): number {
    // 空样式 / 无属性 → 始终映射到 id=0
    if (!style || Object.keys(style).length === 0) return 0;

    const key = this.stableKey(style);
    const existing = this.index.get(key);
    if (existing !== undefined) return existing;

    // 注册新样式
    const id = this.styles.length;
    // 存储时创建副本并冻结，防止外部引用意外修改
    const frozen = Object.freeze({ ...style });
    this.styles.push(frozen);
    this.index.set(key, id);
    return id;
  }

  /** 返回 styles 数组的浅拷贝（用于持久化/快照） */
  getStyles(): CellStyle[] {
    return [...this.styles];
  }

  /** 直接设置 styles 数组（用于恢复快照），同时重建 index */
  setStyles(styles: CellStyle[]): void {
    this.styles = styles;
    this.index = new Map();
    for (let i = 0; i < this.styles.length; i++) {
      const key = this.stableKey(this.styles[i]!);
      this.index.set(key, i);
    }
  }

  /**
   * Style GC（垃圾回收）：
   * 扫描 cells 中实际使用的 styleId，删除未被引用的 styles，
   * 重新生成连续的 styleId 并同步更新所有 cells。
   * styles[0] 始终保留。
   *
   * 建议在保存/持久化/导出时调用，不要在每次编辑时执行。
   */
  compactStyles(cells: Record<string, CellData>): CellStyle[] {
    // 1. 收集所有实际使用的 styleId
    const usedIds = new Set<number>();
    usedIds.add(0); // styles[0] 必须始终存在
    for (const key in cells) {
      const id = cells[key]!.styleId ?? 0;
      usedIds.add(id);
    }

    // 2. 构建旧 id → 新 id 映射
    const idMap = new Map<number, number>();
    const newStyles: CellStyle[] = [{}]; // 新数组，styles[0] = 默认空样式
    idMap.set(0, 0);

    // 按 id 升序遍历，保证映射稳定
    const sortedIds = Array.from(usedIds).sort((a, b) => a - b);
    for (const oldId of sortedIds) {
      if (oldId === 0) continue;
      if (oldId < this.styles.length) {
        const newId = newStyles.length;
        idMap.set(oldId, newId);
        newStyles.push(this.styles[oldId]!);
      }
    }

    // 3. 更新所有 cells 的 styleId
    for (const key in cells) {
      const cell = cells[key]!;
      const oldId = cell.styleId ?? 0;
      const newId = idMap.get(oldId);
      if (newId !== undefined && newId !== oldId) {
        cell.styleId = newId;
      }
    }

    // 4. 更新内部状态
    this.styles = newStyles;
    this.index = new Map();
    for (let i = 0; i < this.styles.length; i++) {
      const k = this.stableKey(this.styles[i]!);
      this.index.set(k, i);
    }

    return newStyles;
  }
}

// ============ 辅助函数 ============

/**
 * 解析单元格样式：根据 styleId 从 styles 数组中获取样式对象。
 * styleId 不存在或为 0 时返回 null（表示默认样式）。
 */
export function resolveStyle(cell: CellData | undefined, styles: CellStyle[]): CellStyle | null {
  if (!cell) return null;
  const id = cell.styleId;
  if (id === undefined || id === 0) return null;
  return styles[id] ?? null;
}

/**
 * 统一的单元格样式修改：读取旧样式 → 创建副本 → 合并 patch → 注册到 StylePool → 更新 styleId。
 * 不会影响其他共享相同 styleId 的单元格。
 */
export function updateCellStyle(cell: CellData, patch: Record<string, unknown>, pool: StylePool): void {
  const oldStyle = pool.get(cell.styleId ?? 0);
  let newStyle: CellStyle = { ...oldStyle };

  // 应用 patch：空值/空串/undefined/0 表示删除属性（用解构 omit 代替动态 delete）
  for (const [prop, value] of Object.entries(patch)) {
    if (value === '' || value === null || value === undefined || value === 0) {
      const { [prop]: _omitted, ...rest } = newStyle;
      newStyle = rest;
    } else {
      (newStyle as Record<string, unknown>)[prop] = value;
    }
  }

  // 如果结果为空样式 → styleId=0
  if (Object.keys(newStyle).length === 0) {
    cell.styleId = 0;
  } else {
    cell.styleId = pool.getId(newStyle);
  }
}

/**
 * 删除单元格的某个样式属性。
 */
export function unsetCellStyle(cell: CellData, key: string, pool: StylePool): void {
  const oldStyle = pool.get(cell.styleId ?? 0);
  if (!oldStyle || !(key in oldStyle)) return;

  const { [key]: _omitted, ...newStyle } = oldStyle as Record<string, unknown>;

  if (Object.keys(newStyle).length === 0) {
    cell.styleId = 0;
  } else {
    cell.styleId = pool.getId(newStyle as CellStyle);
  }
}

/**
 * 批量修改多个单元格的样式。
 */
export function updateCellsStyle(cells: CellData[], patch: Record<string, unknown>, pool: StylePool): void {
  for (const cell of cells) {
    updateCellStyle(cell, patch, pool);
  }
}

/**
 * 一次性迁移旧格式 cells（{value, style}）到新格式（{value, styleId}）。
 * 扫描所有 cells，对 style 去重，创建 styles[]，将 cell.style 转换为 cell.styleId。
 * 迁移前后视觉效果和数据语义完全一致。
 */
export function migrateCells(
  oldCells: Record<string, { value: string; style?: Record<string, unknown> | null; styleId?: number }>,
): { cells: Record<string, CellData>; styles: CellStyle[] } {
  const pool = new StylePool();
  const newCells: Record<string, CellData> = {};

  for (const [key, old] of Object.entries(oldCells)) {
    const cell: CellData = { value: old.value };

    if (old.styleId !== undefined && old.styleId > 0) {
      // 已经是新格式，直接保留 styleId（后续通过 styles 数组恢复）
      cell.styleId = old.styleId;
    }

    if (old.style && Object.keys(old.style).length > 0) {
      // 旧格式：将 style 注册到 pool
      cell.styleId = pool.getId(old.style as CellStyle);
    }

    // styleId=0 时省略（默认样式）
    if (cell.styleId === 0) {
      delete cell.styleId;
    }

    newCells[key] = cell;
  }

  return { cells: newCells, styles: pool.getStyles() };
}

/**
 * 深拷贝 cells（同时保留 styleId 引用）。
 */
export function cloneCells(src: Record<string, CellData>): Record<string, CellData> {
  const o: Record<string, CellData> = {};
  for (const [k, v] of Object.entries(src)) {
    const cell: CellData = { value: v.value };
    if (v.styleId !== undefined && v.styleId > 0) {
      cell.styleId = v.styleId;
    }
    o[k] = cell;
  }
  return o;
}
