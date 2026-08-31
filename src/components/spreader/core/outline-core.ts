// ============ 行列分组 / 折叠（Outline / Grouping）纯逻辑引擎 ============
// 本模块是 Outline 的纯函数核心，负责：
//   - 分组合法性校验（禁止交叉与嵌套、至少 2 个连续维度、仅一层）
//   - 层级（level）由嵌套关系计算
//   - 折叠可见性（hidden by collapsed）、每个维度的所处层级
//   - 插入 / 删除行列后的坐标平移与清理
// 不依赖 Vue / DOM，可独立测试。
import type { DimensionOutline } from './types';
import { MAX_OUTLINE_LEVEL } from './types';

/** 分组校验失败的原因 */
export type OutlineValidationCode
  = | 'outlineMinSize'    // 分组至少需要 2 个连续行/列
    | 'outlineCrossing'   // 与既有分组部分重叠（既不相交也非完全包含）
    | 'outlineTooDeep'    // 尝试嵌套分组（违反仅一层限制）
    | 'outlineInvalid';   // start>end

export interface OutlineValidationResult {
  ok: boolean;
  code?: OutlineValidationCode;
  /** 通过校验时，根据嵌套关系算出的层级（1 起） */
  level?: number;
}

/** 范围内包含多少既有分组（严格包含该范围的组越多，层级越深） */
export function countContaining(outlines: DimensionOutline[], start: number, end: number): number {
  let n = 0;
  for (let i = 0; i < outlines.length; i++) {
    const o = outlines[i]!;
    if (o.start <= start && end <= o.end) n++;
  }
  return n;
}

/** 两个闭区间是否嵌套（严格包含或不相交）——不产生部分重叠 */
function isNestedPair(aS: number, aE: number, bS: number, bE: number): boolean {
  // a contains b
  if (aS <= bS && bE <= aE) return true;
  // b contains a
  if (bS <= aS && aE <= bE) return true;
  // disjoint
  if (aE < bS || bE < aS) return true;
  // 部分重叠
  return false;
}

/**
 * 校验一个新分组（start/end 为 0-based 闭区间）是否可在既有分组集合上创建。
 * 规则：
 *   - start <= end
 *   - 至少连续 2 个维度
 *   - 与既有分组必须完全不相交，禁止部分重叠与嵌套（仅支持一层分组）
 *   - 层级恒为 1（countContaining 必须为 0）
 */
export function validateGroup(
  existing: DimensionOutline[],
  start: number,
  end: number,
): OutlineValidationResult {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return { ok: false, code: 'outlineInvalid' };
  }
  if (end - start + 1 < 2) {
    return { ok: false, code: 'outlineMinSize' };
  }
  for (let i = 0; i < existing.length; i++) {
    const o = existing[i]!;
    if (!isNestedPair(start, end, o.start, o.end)) {
      return { ok: false, code: 'outlineCrossing' };
    }
  }
  const level = countContaining(existing, start, end) + 1;
  if (level > MAX_OUTLINE_LEVEL) {
    return { ok: false, code: 'outlineTooDeep' };
  }
  return { ok: true, level };
}

/** 创建分组后的新集合（校验失败返回原集合，同时给出校验结果供调用方提示） */
export function addOutline(
  existing: DimensionOutline[],
  axis: 'row' | 'column',
  start: number,
  end: number,
  id: string,
  opts?: { collapsed?: boolean },
): { outlines: DimensionOutline[]; validation: OutlineValidationResult } {
  const v = validateGroup(existing, start, end);
  if (!v.ok || v.level === undefined) {
    return { outlines: existing, validation: v };
  }
  const next = existing.concat({
    id,
    axis,
    start,
    end,
    level: v.level,
    collapsed: opts?.collapsed ?? false,
  });
  return { outlines: next, validation: v };
}

/** 设置某个分组的折叠状态 */
export function setOutlineCollapsed(
  outlines: DimensionOutline[],
  id: string,
  collapsed: boolean,
): DimensionOutline[] {
  let changed = false;
  const next = outlines.map((o) => {
    if (o.id === id && o.collapsed !== collapsed) {
      changed = true;
      return { ...o, collapsed };
    }
    return o;
  });
  return changed ? next : outlines;
}

/** 删除某个分组（返回新集合） */
export function removeOutline(outlines: DimensionOutline[], id: string): DimensionOutline[] {
  return outlines.filter((o) => o.id !== id);
}

/** 清除全部（某方向）分组 */
export function clearOutlines(): DimensionOutline[] {
  return [];
}

/** 插入 count 个维度到 index 处后，调整既有分组范围（完全遵循 Range 插入语义） */
export function addOutlineForInsert(
  outlines: DimensionOutline[],
  index: number,
  count: number,
): DimensionOutline[] {
  return outlines.map((o) => {
    if (o.start >= index) {
      return { ...o, start: o.start + count, end: o.end + count };
    }
    if (o.end < index) return o;
    return { ...o, end: o.end + count };
  });
}

/** 删除 [index, index+count-1] 这段维度后，调整既有分组；空组自动移除 */
export function addOutlineForDelete(
  outlines: DimensionOutline[],
  index: number,
  count: number,
): DimensionOutline[] {
  const result: DimensionOutline[] = [];
  for (const o of outlines) {
    const s = o.start;
    const e = o.end;
    let ns: number;
    let ne: number;
    if (e < index) {
      ns = s;
      ne = e;
    } else if (s > index + count - 1) {
      ns = s - count;
      ne = e - count;
    } else {
      ns = s < index ? s : index;
      ne = e > index + count - 1 ? e - count : index - 1;
      if (ne < ns) continue; // 整个分组被删除
    }
    result.push({ ...o, start: ns, end: ne });
  }
  return result;
}

/**
 * 根据嵌套关系重建每个分组的 level：
 * level = (严格包含该分组的其它分组数量) + 1
 * 注意：必须排除自身，否则每个分组都会被自己计数导致层级 +1。
 */
export function recomputeOutlineLevels(outlines: DimensionOutline[]): DimensionOutline[] {
  return outlines.map((o) => {
    let n = 0;
    for (let k = 0; k < outlines.length; k++) {
      const p = outlines[k]!;
      if (p === o) continue;
      if (p.start <= o.start && o.end <= p.end) n++;
    }
    return { ...o, level: n + 1 };
  });
}

/**
 * 维度可见性索引。
 *  - levels[i]   : 维度 i 所处的 outline 层级（0 = 不在任何分组内）
 *  - hidden[i]   : 维度 i 是否被某个「已折叠分组」包含（不可见）
 *  - maxLevel    : 当前分组最深层级（≥1）；无分组为 0
 */
export interface OutlineIndex {
  levels: number[];
  hidden: boolean[];
  maxLevel: number;
}

/** 构建线性维度（行/列）的 outline 索引。count = 维度总数 */
export function buildOutlineIndex(outlines: DimensionOutline[], count: number): OutlineIndex {
  const levels = new Array<number>(count).fill(0);
  const hidden = new Array<boolean>(count).fill(false);
  let maxLevel = 0;
  for (let i = 0; i < outlines.length; i++) {
    const o = outlines[i]!;
    const s = Math.max(0, o.start);
    const e = Math.min(count - 1, o.end);
    if (s > e) continue;
    for (let d = s; d <= e; d++) {
      levels[d]!++;
      if (o.collapsed) hidden[d] = true;
    }
    if (s <= e && o.level > maxLevel) maxLevel = o.level;
  }
  return { levels, hidden, maxLevel };
}

/** 维度 i 所处的 outline 层级（无分组为 0） */
export function outlineLevelAt(outlines: DimensionOutline[], i: number): number {
  let n = 0;
  for (let k = 0; k < outlines.length; k++) {
    const o = outlines[k]!;
    if (o.start <= i && i <= o.end) n++;
  }
  return n;
}

/** 维度 i 是否被某个已折叠分组包含（不可见） */
export function isOutlineCollapsedAt(outlines: DimensionOutline[], i: number): boolean {
  for (let k = 0; k < outlines.length; k++) {
    const o = outlines[k]!;
    if (o.collapsed && o.start <= i && i <= o.end) return true;
  }
  return false;
}

/** 是否已存在跨过该分组 cell 的既有分组（按 cell 命中） */
export function hasOutlineInRange(outlines: DimensionOutline[], start: number, end: number): boolean {
  for (const o of outlines) {
    if (o.end < start || o.start > end) continue;
    return true;
  }
  return false;
}

/** 生成稳定唯一分组 ID（避免与既有 ID 冲突） */
export function genOutlineId(existing: DimensionOutline[], axis: 'row' | 'column'): string {
  const prefix = axis === 'row' ? 'row-outline' : 'col-outline';
  const used = new Set(existing.map((o) => o.id));
  let n = 1;
  while (used.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}
