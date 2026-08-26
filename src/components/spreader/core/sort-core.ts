// ============ 列排序核心（纯函数，无 Vue 依赖） ============
// - 排序只比较与产出置换结果，绝不修改 Cell.value（始终为 string）。
// - 比较键解析顺序：空白 → 数字（含日期序列值）→ 日期/时间字符串 → 文本。
// - 类型次序参考 Excel：数字/日期 < 文本；空值无论升序降序始终置底。
// - 复用 number-format 的 isNumericValue / parseDateTimeInput，保持与输入识别一致。

import { isNumericValue, parseDateTimeInput, parseNumberFormat, formatNumber, isGeneralFormat, NF_TEXT } from './number-format';

export type SortOrder = 'asc' | 'desc';

export type SortKeyKind = 'blank' | 'number' | 'text';

/** 排序比较键：临时解析结果，不回写到单元格 */
export interface SortKey {
  kind: SortKeyKind;
  /** kind === 'number' 时的数值（日期/时间为序列值） */
  num?: number;
  /** kind === 'text' 时的原始文本 */
  text?: string;
}

/** 类型排序权重：数字/日期 < 文本（空白单独处理，始终置底） */
function kindRank(kind: SortKeyKind): number {
  return kind === 'number' ? 0 : 1;
}

/**
 * 将原始值解析为排序比较键。
 * - 空串/纯空白 → blank
 * - 可解析为有限数字（含日期序列值）→ number
 * - 可被 parseDateTimeInput 识别的日期/时间字符串 → number（序列值）
 * - 其余 → text（保留原文用于本地化比较）
 */
export function parseSortKey(value: string | null | undefined, locale: string): SortKey {
  if (value == null || value.trim() === '') return { kind: 'blank' };
  if (isNumericValue(value)) return { kind: 'number', num: Number(value) };
  const dt = parseDateTimeInput(value, locale);
  if (dt) return { kind: 'number', num: dt.serial };
  return { kind: 'text', text: value };
}

/**
 * 按「展示内容」解析排序比较键（扩展版，支持所有类型单元格）：
 * - 显式文本格式（'@'）→ 文本键 = 原始内容（展示即原文）
 * - 常规（General）：数值 → 数值键；日期/时间文本 → 数值键（序列值）；其余 → 文本键 = 展示串
 * - 日期/持续时间格式 → 数值键 = 序列值（展示即该序列值）
 * - 数值类格式（数字/百分比/货币等）→ 数值键 = 数值 × 格式缩放（百分比 ÷100 已体现在展示数值中，
 *   这里乘回 scale 使「100%」按其展示数值 100 参与排序，而非存储值 1）
 * - 上述任何类型若格式与值不匹配（如数值格式下是非数字）→ 文本键 = 展示串
 * 与 parseSortKey 的区别：parseSortKey 只看存储原始值（常规下纯数字才算数字），本函数结合单元格
 * 数字格式还原「所见即所排」的语义，满足按展示内容排序的需求。
 */
export function parseSortKeyByDisplay(
  value: string | null | undefined,
  format: string | undefined | null,
  locale: string,
): SortKey {
  if (value == null || value.trim() === '') return { kind: 'blank' };
  const nf = format ?? '';

  // 显式文本格式：展示即原文
  if (nf === NF_TEXT || nf === '@') {
    return { kind: 'text', text: value };
  }
  // 常规：复用写入时的识别逻辑（数值 / 日期 → 数值键；其余 → 文本键按展示串）
  if (isGeneralFormat(nf)) {
    if (isNumericValue(value)) return { kind: 'number', num: Number(value) };
    const dt = parseDateTimeInput(value, locale);
    if (dt) return { kind: 'number', num: dt.serial };
    return { kind: 'text', text: formatNumber(value, nf, locale) };
  }

  // 显式格式：先按 kind 决定数值语义
  const parsed = parseNumberFormat(nf);
  if (parsed.kind === 'date' || parsed.kind === 'duration') {
    const serial = Number(value);
    if (Number.isFinite(serial)) return { kind: 'number', num: serial };
    return { kind: 'text', text: formatNumber(value, nf, locale) };
  }
  if (parsed.kind === 'number') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      // 乘回格式缩放（百分比 scale=100），使展示数值参与排序，而非存储值
      const scale = parsed.sections.find((sec) => sec.hasDigits)?.scale ?? 1;
      return { kind: 'number', num: n * scale };
    }
    return { kind: 'text', text: formatNumber(value, nf, locale) };
  }
  // 兜底（理论上不可达）：按展示串作为文本
  return { kind: 'text', text: formatNumber(value, nf, locale) };
}

/**
 * 比较两个排序键（均非 blank）：
 * - 升序：数字/日期 在前，文本在后；同类内按数值/本地化文本比较
 * - 降序：类型次序反转，同类内逆序
 */
export function compareSortKeys(a: SortKey, b: SortKey, order: SortOrder, locale: string): number {
  // 空值无论升序降序始终置底
  if (a.kind === 'blank' || b.kind === 'blank') {
    if (a.kind === 'blank' && b.kind === 'blank') return 0;
    return a.kind === 'blank' ? 1 : -1;
  }
  const ra = kindRank(a.kind);
  const rb = kindRank(b.kind);
  if (ra !== rb) {
    return order === 'asc' ? ra - rb : rb - ra;
  }
  let cmp: number;
  if (a.kind === 'number') {
    cmp = (a.num ?? 0) - (b.num ?? 0);
  } else {
    cmp = (a.text ?? '').localeCompare(b.text ?? '', locale, { numeric: true });
  }
  return order === 'asc' ? cmp : -cmp;
}

/**
 * 对各行比较键做稳定排序，返回置换数组：
 * 结果中 order[i] = 排序后第 i 行应取的原始行下标（以原始下标做 tie-breaker）。
 */
export function buildSortedRowOrder(keys: SortKey[], order: SortOrder, locale: string): number[] {
  const idx = keys.map((_, i) => i);
  idx.sort((ia, ib) => {
    const cmp = compareSortKeys(keys[ia]!, keys[ib]!, order, locale);
    return cmp !== 0 ? cmp : ia - ib;
  });
  return idx;
}

/**
 * 表头启发式识别（项目无表头数据模型，对齐 Excel 按列排序时的推断）：
 * 首行非空且为纯文本，其余行中至少有一个可解析为数字/日期 → 视首行为表头。
 */
export function looksLikeHeader(keys: SortKey[]): boolean {
  if (keys.length < 2) return false;
  if (keys[0]!.kind !== 'text') return false;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i]!.kind === 'number') return true;
  }
  return false;
}
