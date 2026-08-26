import { t } from './constants';

// ============ Number Format（数字格式）============
// 独立、可扩展的 Excel / Univer 风格数字格式引擎。
// 设计原则：
// - 只负责「显示」，绝不修改 Cell.value（Cell.value 始终是 string）。
// - 解析结果按格式代码缓存，避免 Canvas 每帧重复解析（性能）。
// - 不依赖 Vue，纯函数，便于测试与复用。

// 相关 i18n 文本统一放在 constants.ts 的 i18n 表中（以 nf* 为前缀）。

// 「格式…」菜单项的特殊值（不会作为真实格式代码保存）
export const NF_CUSTOM = '__nf_custom__';
// 选区格式不一致时的特殊标记
export const NF_MIXED = '\u0001';
// 常规（General）对应的格式代码：空串。没有 numberFormat 属性 = 常规。
// 存储层：不存储/删除属性即常规，与空串语义一致。
// 显示层：formatNumber 的 General 分支做"自动格式化"（见 formatGeneral）。
export const NF_GENERAL = '';
// 文本（Text）对应的格式代码
export const NF_TEXT = '@';
/**
 * formatNumber 的特殊返回值：表示"当前格式+数值组合在 Excel 语义下非法"，
 * 例如 date 格式 序列号<0/≥2958466、duration 格式 序列号<0。
 * 渲染端必须把该字符串按列宽替换为连续 '#' 填充（不显示此标识符本身）。
 */
export const NF_INVALID_VALUE = '__NF_INVALID__';
/** Excel 1900 日期系统最大合法序列号（对应 9999-12-31）。超过或为负 → 整格 ###。 */
export const EXCEL_DATE_MAX_SERIAL = 2958465;
/** Excel 1900 日期系统最小合法序列号（0 = 1900-01-00，作为下界兜底，实际 UI 一般从 1 开始）。 */
export const EXCEL_DATE_MIN_SERIAL = 0;

/** 判断格式代码是否为 General（含空串、undefined、'General'、'GENERAL' 等） */
export function isGeneralFormat(format: string | undefined | null): boolean {
  if (format == null || format === '') return true;
  return format.toUpperCase() === 'GENERAL';
}

export type NFKind = 'general' | 'text' | 'number' | 'date' | 'duration';

export interface NFSection {
  /** 是否含有数字占位符（0/#/?）；无占位符的区段视为纯文本字面量 */
  hasDigits: boolean;
  /** 小数最大位数（0/#/? 的总数） */
  decimals: number;
  /** 强制小数位数（0 的个数，决定尾随 0 的数量） */
  minDecimals: number;
  /** 整数部分强制最少位数（0 的个数） */
  minIntDigits: number;
  /** 是否使用千位分隔符 */
  thousands: boolean;
  /** 缩放倍数（百分比为 100） */
  scale: number;
  /** 科学计数法 */
  scientific: boolean;
  /** 数字前的字面量（货币符号等） */
  prefix: string;
  /** 数字后的字面量（如 %） */
  suffix: string;
  /** 区段颜色（[Red] 等，渲染层可忽略） */
  color?: string;
}

export type NFDateTokenType
  = | 'literal'
    | 'year'
    | 'month'
    | 'monthName'
    | 'day'
    | 'weekday'
    | 'hour'
    | 'minute'
    | 'second'
    | 'ampm';

export interface NFToken {
  type: NFDateTokenType;
  /** literal 类型的原始文本 */
  text?: string;
  /** 占位符长度（如 yyyy → 4） */
  len: number;
}

export interface NFParsed {
  kind: NFKind;
  /** 数值区段（number 类型使用；可能含正/负/零/文本多个区段） */
  sections: NFSection[];
  /** 日期/时间/持续时间的 token 序列 */
  tokens: NFToken[];
  /** 是否为持续时间（含 [h]/[mm]/[ss]） */
  isDuration: boolean;
  raw: string;
}

export interface NFOption {
  label: string;
  value: string;
}

// ============ 工具函数 ============
function getCurrencySymbol(locale: string): string {
  return locale === 'zh-CN' ? '¥' : '$';
}

/** 移除 Excel 对齐/填充占位符：*（重复填充）、_(x)（占位一个字符宽度） */
function stripAlignHints(s: string): string {
  return s.replace(/\*/g, '').replace(/_.|_\b/g, '');
}

/** 移除引号，保留引号内真实文本（如 "年" → 年） */
function unquote(s: string): string {
  return s.replace(/"([^"]*)"/g, '$1');
}

// ============ 数值区段解析 ============
function parseNumSection(raw: string): NFSection {
  let s = raw;
  let color: string | undefined;
  const colorMatch = s.match(/^\[([^\]]+)\]/);
  if (colorMatch) {
    color = colorMatch[1]!.toLowerCase();
    s = s.slice(colorMatch[0].length);
  }
  s = stripAlignHints(s);

  const isSci = /E[+-]/i.test(s);
  const isPct = s.includes('%');

  const firstIdx = s.search(/[0#?]/);

  // 无数字占位符：整段为字面量（如会计专用的 $ "-" 或 "N/A"）
  if (firstIdx === -1) {
    return {
      hasDigits: false, decimals: 0, minDecimals: 0, minIntDigits: 0,
      thousands: false, scale: isPct ? 100 : 1, scientific: false,
      prefix: s, suffix: '', color,
    };
  }

  // % 不作为数字占位符，落入 suffix（放大 100 倍由 scale 负责）
  let lastIdx = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i]!;
    if (ch === '0' || ch === '#' || ch === '?' || ch === 'E') {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx < 0) lastIdx = firstIdx;

  const prefix = firstIdx > 0 ? s.slice(0, firstIdx) : '';
  const suffix = lastIdx < s.length - 1 ? s.slice(lastIdx + 1) : '';
  const core = s.slice(firstIdx, lastIdx + 1);

  const hasDigits = /[0#?]/.test(core);

  const thousands = core.includes(',');
  const coreNoComma = core.replace(/,/g, '');
  // 科学计数法：小数位仅取尾数（E 之前），避免把指数占位符计入
  let mantissa = coreNoComma;
  if (isSci) {
    const eIdx = mantissa.search(/E/i);
    if (eIdx >= 0) mantissa = mantissa.slice(0, eIdx);
  }
  const dotIdx = mantissa.indexOf('.');
  const intPart = dotIdx >= 0 ? mantissa.slice(0, dotIdx) : mantissa;
  const fracPart = dotIdx >= 0 ? mantissa.slice(dotIdx + 1) : '';

  const decimals = (fracPart.match(/[0#?]/g) || []).length;
  const minDecimals = (fracPart.match(/0/g) || []).length;
  const minIntDigits = (intPart.match(/0/g) || []).length;

  return {
    hasDigits,
    decimals,
    minDecimals,
    minIntDigits,
    thousands,
    scale: isPct ? 100 : 1,
    scientific: isSci,
    prefix,
    suffix,
    color,
  };
}

// ============ 日期/时间 token 解析 ============
function tokenizeDate(str: string): { tokens: NFToken[]; isDuration: boolean } {
  const tokens: NFToken[] = [];
  let isDuration = false;
  const re = /\[h\]|\[mm\]|\[ss\]|yyyy|yy|y|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|am\/pm|"[^"]*"|\/|-|:|\s+|[^\s]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const t = m[0];
    switch (t) {
      case '[h]':
        isDuration = true;
        tokens.push({ type: 'hour', len: 0 });
        break;
      case '[mm]':
        isDuration = true;
        tokens.push({ type: 'minute', len: 2 });
        break;
      case '[ss]':
        isDuration = true;
        tokens.push({ type: 'second', len: 2 });
        break;
      case 'yyyy':
        tokens.push({ type: 'year', len: 4 });
        break;
      case 'yy': case 'y':
        tokens.push({ type: 'year', len: 2 });
        break;
      case 'mmmm':
        // 持续时间上下文（[h]/[mm]/[ss]）中 m 系 token 一律为分钟，否则为月份
        tokens.push(isDuration ? { type: 'minute', len: 4 } : { type: 'monthName', len: 4 });
        break;
      case 'mmm':
        tokens.push(isDuration ? { type: 'minute', len: 3 } : { type: 'monthName', len: 3 });
        break;
      case 'mm':
        tokens.push(isDuration ? { type: 'minute', len: 2 } : { type: 'month', len: 2 });
        break;
      case 'm':
        tokens.push(isDuration ? { type: 'minute', len: 1 } : { type: 'month', len: 1 });
        break;
      case 'dddd':
        tokens.push({ type: 'weekday', len: 4 });
        break;
      case 'ddd':
        tokens.push({ type: 'weekday', len: 3 });
        break;
      case 'dd':
        tokens.push({ type: 'day', len: 2 });
        break;
      case 'd':
        tokens.push({ type: 'day', len: 1 });
        break;
      case 'hh':
        tokens.push({ type: 'hour', len: 2 });
        break;
      case 'h':
        tokens.push({ type: 'hour', len: 1 });
        break;
      case 'ss':
        tokens.push({ type: 'second', len: 2 });
        break;
      case 's':
        tokens.push({ type: 'second', len: 1 });
        break;
      case 'AM/PM': case 'am/pm':
        tokens.push({ type: 'ampm', len: 2 });
        break;
      default:
        if (t.startsWith('"')) tokens.push({ type: 'literal', text: unquote(t), len: 0 });
        else tokens.push({ type: 'literal', text: t, len: 0 });
    }
  }
  return { tokens, isDuration };
}

// ============ 主解析（含缓存） ============
const _parseCache = new Map<string, NFParsed>();

function doParse(format: string): NFParsed {
  // 日期/时间/持续时间判定：含年/日/时/秒/周标识，或 [h] 持续时间。
  // 先移除 [Red]/[Blue] 等颜色修饰符与 [>100] 等条件修饰符（其内含 d/s 字母或数字，
  // 不应触发日期误判），仅保留 [h]/[mm]/[ss] 持续时间标记。
  const stripped = format.replace(/\[[^\]]*\]/gi, (m) => (/^\[(h|mm|ss)\]$/i.test(m) ? m : ''));
  const looksLikeDate = /[ydhs]/.test(stripped) || /AM\/PM/i.test(stripped) || /\[h\]/i.test(stripped);
  if (looksLikeDate) {
    const firstSection = format.split(';')[0] ?? format;
    const { tokens, isDuration } = tokenizeDate(firstSection);
    return { kind: isDuration ? 'duration' : 'date', sections: [], tokens, isDuration, raw: format };
  }

  const parts = format.split(';');
  const sections = parts.map((p) => parseNumSection(p));
  return { kind: 'number', sections, tokens: [], isDuration: false, raw: format };
}

export function parseNumberFormat(format: string): NFParsed {
  const cached = _parseCache.get(format);
  if (cached) return cached;
  const parsed = doParse(format);
  _parseCache.set(format, parsed);
  return parsed;
}

/** 清空解析缓存（主要用于测试/资源释放） */
export function clearNumberFormatCache(): void {
  _parseCache.clear();
}

// ============ 数值格式化 ============
/**
 * 按 0/#/? 占位符格式化非科学计数的数字。
 * —— 使用 Intl.NumberFormat 代替手写 String(abs).split('.')：
 *    Number.toString 对 abs ≥ 1e+21 / < 1e-6 会强制输出科学计数字符串（如 1.1111111111111111e+24），
 *    直接 split('.') 会得到错误的 intPart 和带 'e' 的 fracPart，显示成"小写 e + 16 位小数"的垃圾字符串。
 *    Intl.NumberFormat 的 format() 始终按"完整十进制"输出（大数不转科学计数），正好匹配 Excel 的 #,##0.00 / 0 / #,##0 等格式。
 */
function formatFixed(
  n: number,
  decimals: number,
  minDecimals: number,
  thousands: boolean,
  minIntDigits: number,
): string {
  const factor = Math.pow(10, decimals);
  const rounded = Math.round((n + Number.EPSILON) * factor) / factor;
  const neg = rounded < 0;
  const abs = Math.abs(rounded);

  // 1) 先用 Intl.NumberFormat 得到完整整数形式 + 精确小数位 + 千分位 + minIntDigits（这里 maximumFractionDigits = decimals 刚好对应 0/#/? 的"允许最多小数位"）
  const nf = new Intl.NumberFormat('en-US', {
    useGrouping: thousands,
    minimumIntegerDigits: minIntDigits,
    minimumFractionDigits: decimals,       // 先按"最多小数位"全部补 0 到 decimals 位
    maximumFractionDigits: decimals,
  });
  let s = nf.format(abs);
  // 2) 若 minDecimals < decimals（存在 # 占位允许去尾 0），去掉多余尾随 0，保留至少 minDecimals 位
  if (minDecimals < decimals && decimals > 0) {
    // 分离整数部分与小数部分（Intl.NumberFormat en-US 的小数分隔符一定是 '.'）
    const dotIdx = s.indexOf('.');
    if (dotIdx >= 0) {
      const intP = s.substring(0, dotIdx);
      let fracP = s.substring(dotIdx + 1);
      fracP = fracP.replace(/0+$/, '');
      if (fracP.length < minDecimals) fracP = fracP + '0'.repeat(minDecimals - fracP.length);
      s = fracP ? `${intP}.${fracP}` : intP;
    }
  }
  const sign = neg ? '-' : '';
  return `${sign}${s}`;
}

function formatScientific(n: number, decimals: number): string {
  if (n === 0) return (decimals > 0 ? '0.' + '0'.repeat(decimals) : '0') + 'E+00';
  const exp = Math.floor(Math.log10(Math.abs(n)));
  const mantissa = n / Math.pow(10, exp);
  const mStr = formatFixed(mantissa, decimals, decimals, false, 1);
  const eStr = (exp >= 0 ? '+' : '-') + String(Math.abs(exp)).padStart(2, '0');
  return `${mStr}E${eStr}`;
}

function formatSection(num: number, sign: string, sec: NFSection): string {
  if (!sec.hasDigits) {
    // 纯文本区段（如会计专用的 "-"）
    return unquote(sec.prefix + sec.suffix);
  }
  const scaled = sec.scale === 100 ? num * 100 : num;
  const numStr = sec.scientific
    ? formatScientific(scaled, sec.decimals)
    : formatFixed(scaled, sec.decimals, sec.minDecimals, sec.thousands, sec.minIntDigits);
  return sign + sec.prefix + numStr + sec.suffix;
}

function formatNumeric(value: number, parsed: NFParsed): string {
  const secs = parsed.sections;
  if (secs.length === 0) return String(value);

  let section: NFSection;
  let num: number;
  let sign = '';

  if (value > 0) {
    section = secs[0]!;
    num = value;
  } else if (value < 0) {
    if (secs[1]) {
      section = secs[1];
      num = -value;
    } else {
      section = secs[0]!;
      num = -value;
      sign = '-';
    }
  } else {
    section = secs[2] ?? secs[0]!;
    num = 0;
  }

  return formatSection(num, sign, section);
}

// ============ 日期/时间格式化 ============
// Excel 1900 日期系统：序列号 1 = 1900-01-01；常用 Unix 偏移为 25569 天。
// 用 UTC 构造，避免本地时区偏移导致日期错位。
function serialToDate(serial: number): Date {
  return new Date((serial - 25569) * 86400000);
}

const MONTH_NAMES_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const MONTH_SHORT_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEKDAY_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0');
}

function formatDateTokens(date: Date, tokens: NFToken[], locale: string, serial: number): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1-12
  const day = date.getUTCDate();
  const weekday = date.getUTCDay(); // 0-6
  const isZh = locale === 'zh-CN';

  let out = '';
  let afterHour = false;
  for (const tk of tokens) {
    switch (tk.type) {
      case 'literal':
        out += tk.text ?? '';
        break;
      case 'year':
        out += tk.len >= 4 ? String(year) : String(year % 100).padStart(2, '0');
        break;
      case 'month':
        out += pad(afterHour ? date.getUTCMinutes() : month, tk.len);
        break;
      case 'monthName':
        out += tk.len >= 4
          ? (isZh ? MONTH_NAMES_ZH[month - 1] : MONTH_NAMES_EN[month - 1])
          : (isZh ? MONTH_SHORT_ZH[month - 1] : MONTH_SHORT_EN[month - 1]);
        break;
      case 'day':
        out += pad(day, tk.len);
        break;
      case 'weekday':
        out += tk.len >= 4
          ? (isZh ? WEEKDAY_ZH[weekday] : WEEKDAY_EN[weekday])
          : (isZh ? WEEKDAY_ZH[weekday]!.slice(2) : WEEKDAY_EN[weekday]!.slice(0, 3));
        break;
      case 'hour': {
        let h = date.getUTCHours();
        if (tk.len === 0) {
          // [h] 持续时间：总小时数，可超过 24
          const totalSec = Math.floor(serial * 86400);
          h = Math.floor(totalSec / 3600);
        }
        out += String(h);
        afterHour = true;
        break;
      }
      case 'minute':
        out += pad(date.getUTCMinutes(), tk.len);
        break;
      case 'second':
        out += pad(date.getUTCSeconds(), tk.len);
        break;
      case 'ampm': {
        const h = date.getUTCHours();
        out += h < 12 ? (isZh ? '上午' : 'AM') : (isZh ? '下午' : 'PM');
        break;
      }
    }
  }
  return out;
}

function formatDuration(serial: number, tokens: NFToken[]): string {
  const totalSec = Math.floor(serial * 86400);
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  let out = '';
  for (const tk of tokens) {
    switch (tk.type) {
      case 'literal':
        out += tk.text ?? '';
        break;
      case 'hour':
        out += String(hh);
        break;
      case 'minute':
        out += pad(mm, tk.len || 2);
        break;
      case 'second':
        out += pad(ss, tk.len || 2);
        break;
      default:
        out += '';
    }
  }
  return out;
}

// ============ General 自动格式化 ============
/**
 * General 格式：不主动规定显示格式，由 Formatter 根据内容自动决定。
 * - 纯数字：按自然形式显示（超大/超小用科学计数法，便于阅读）
 * - 非数字：原样显示
 * 这是"自动格式化"入口，科学计数法严格按 Excel 风格：
 *  - 大写 E
 *  - 有效数字位数限制在 9 位以内（避免 .toExponential() 原始输出 16 位小数，失去科学计数可读性）
 *  - 指数部分为负数时显示为 E-##、正数时显示为 E+##（带正号 + 最少 2 位，前导 0）
 */
function formatGeneral(value: string): string {
  if (value === '') return value;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') {
    const abs = Math.abs(num);
    // 超大/超小数字 → 科学计数法（阈值对齐 Excel General：绝对值 ≥ 1e15 或 < 1e-9）
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
      return formatScientific(num, 9);
    }
    // 数字的自然形式：保留原始字符串（用户输入什么就显示什么）
    return value;
  }
  // 非数字：原样显示
  return value;
}

// ============ 顶层入口 ============
/**
 * 将单元格原始字符串值按格式代码格式化为显示文本。
 * 绝不修改传入的 value。
 */
export function formatNumber(
  value: string,
  format: string | undefined | null,
  locale: string,
): string {
  if (isGeneralFormat(format)) return formatGeneral(value);
  if (format == null || format === NF_TEXT) return value;

  const parsed = parseNumberFormat(format);

  if (parsed.kind === 'date' || parsed.kind === 'duration') {
    const serial = Number(value);
    if (!isFinite(serial)) return value; // 非数值 → 回退原始字符串
    // 非法值：date 超出 [0, 2958465]；duration < 0（持续时间不能负，除非自定义了负号文本区段，当前实现不支持负 duration）
    if (parsed.kind === 'date') {
      if (serial < EXCEL_DATE_MIN_SERIAL || serial > EXCEL_DATE_MAX_SERIAL) return NF_INVALID_VALUE;
    } else if (serial < 0) {
      return NF_INVALID_VALUE;
    }
    return parsed.kind === 'duration'
      ? formatDuration(serial, parsed.tokens)
      : formatDateTokens(serialToDate(serial), parsed.tokens, locale, serial);
  }

  const num = Number(value);
  if (isNaN(num)) return value; // 非数值 → 回退原始字符串

  return formatNumeric(num, parsed);
}

// ============ 预设 / 对话框辅助 ============
export type NFDialogCategory
  = | 'general' | 'number' | 'currency' | 'currencyRounded' | 'accounting'
    | 'financial' | 'percent' | 'scientific' | 'date' | 'time' | 'dateTime'
    | 'duration' | 'text' | 'custom';

export const NF_DIALOG_CATEGORIES: NFDialogCategory[] = [
  'general', 'text', 'number', 'percent', 'scientific', 'accounting',
  'financial', 'currency', 'currencyRounded', 'date', 'time', 'dateTime',
  'duration', 'custom',
];

/**
 * 判断单元格在「未指定水平对齐」时，是否应该按「数值」默认右对齐显示。
 * 规则（与 Excel 对齐语义保持一致，仅用于显示，不写入存储）：
 *   1. 格式代码为 '@'（文本）→ 否，保持左对齐
 *   2. 常规格式（含空串 / undefined / 'General'）：对原始 value 做 Number() 解析，
 *      能解析为有限数字且非空字符串 → 视为数值 → 右对齐
 *   3. 显式设置为数值类格式（number/currency/currencyRounded/accounting/financial/
 *      percent/scientific 以及 custom 中分类属于数值 kind 并含数字占位符）→ 右对齐
 *   4. 日期、时间、日期时间、持续时间 → 不算数值（按 Excel 默认左对齐或居中，这里保持左对齐默认）
 *   5. 其他 custom 中无法判断的 → 回退左对齐
 */
export function shouldAlignRightByDefault(
  value: string,
  format: string | undefined | null,
): boolean {
  if (format === NF_TEXT || format === '@') return false;
  if (isGeneralFormat(format)) {
    if (value == null || value === '' || value.trim() === '') return false;
    const n = Number(value);
    return !Number.isNaN(n) && Number.isFinite(n);
  }
  const parsed = parseNumberFormat(format!);
  if (parsed.kind === 'number' && hasDigitPlaceholder(parsed)) return true;
  return false;
}

/** 在 parsed.sections 中是否含有至少一个数字占位符（0/#/?） */
function hasDigitPlaceholder(parsed: NFParsed): boolean {
  return parsed.sections.some((sec) => sec.hasDigits);
}

/**
 * 当前格式在列宽不足时，是否按 Excel 规则替换为连续 '#' 填充：
 * - General / 文本 '@' / 未设置 → 不会（General 自动科学计数或允许裁切；文本就是原样裁切）
 * - date / duration 类格式 → 是
 * - number 类格式且含有数字占位符 → 是
 * - 纯文本区段的自定义 number（如"前缀"无 0/#/?）→ 按纯文本，不需要 #
 */
export function isFormatOverflowsToHashes(format: string | undefined | null): boolean {
  if (format == null) return false;
  if (isGeneralFormat(format)) return false;
  if (format === NF_TEXT || format === '@') return false;
  const p = parseNumberFormat(format);
  if (p.kind === 'date' || p.kind === 'duration') return true;
  if (p.kind === 'number' && hasDigitPlaceholder(p)) return true;
  return false;
}

/**
 * 对给定 (value, format) 快速判断是否是 Excel 语义下的"非法值"（需要渲染为 # 填充）。
 * 主要用于渲染端直接复用，避免再次 parseNumberFormat。
 */
export function isInvalidDisplayValue(
  value: string,
  format: string | undefined | null,
): boolean {
  if (format == null) return false;
  if (isGeneralFormat(format)) return false;
  if (format === NF_TEXT || format === '@') return false;
  const p = parseNumberFormat(format);
  const serial = Number(value);
  if (!Number.isFinite(serial)) return false;
  if (p.kind === 'date') return serial < EXCEL_DATE_MIN_SERIAL || serial > EXCEL_DATE_MAX_SERIAL;
  if (p.kind === 'duration') return serial < 0;
  return false;
}

// ============ 小数位数调整（增加/减少小数位按钮） ============

/** 最大小数位数（与数字格式对话框一致：0–30） */
export const NF_MAX_DECIMALS = 30;
/** 最小小数位数 */
export const NF_MIN_DECIMALS = 0;

/** 判断原始值是否可解析为有限数字（常规格式下的"数值"语义） */
export function isNumericValue(value: string): boolean {
  if (value == null || value === '' || value.trim() === '') return false;
  const n = Number(value);
  return !Number.isNaN(n) && Number.isFinite(n);
}

/**
 * 判断某单元格（格式 + 值）的小数位数是否可调整：
 * - 文本 / 日期 / 时间 / 持续时间 → 不支持
 * - 数值类格式（含数字占位符）→ 支持（与单元格内容无关）
 * - 常规 → 仅当值可解析为数字时支持（识别为数字格式）
 */
export function isDecimalsAdjustable(
  format: string | undefined | null,
  value: string,
): boolean {
  if (format == null || format === NF_MIXED) return isNumericValue(value);
  if (isGeneralFormat(format)) return isNumericValue(value);
  if (format === NF_TEXT) return false;
  const parsed = parseNumberFormat(format);
  if (parsed.kind === 'date' || parsed.kind === 'duration') return false;
  return parsed.sections.some((sec) => sec.hasDigits);
}

/**
 * 获取单元格当前有效小数位数：
 * - 常规（含值为数值的常规）→ 0；文本/日期类 → -1（不支持）
 * - 数值类 → 第一个含数字占位符区段的 decimals（最大允许小数位）
 */
export function getEffectiveDecimals(
  format: string | undefined | null,
  value: string,
): number {
  if (!isDecimalsAdjustable(format, value)) return -1;
  if (format == null || format === NF_MIXED || isGeneralFormat(format)) return 0;
  const parsed = parseNumberFormat(format);
  const sec = parsed.sections.find((s) => s.hasDigits);
  return sec ? sec.decimals : -1;
}

/**
 * 在原始区段字符串上调整小数占位符数量，保留前后缀、颜色区段、千分位、科学计数等结构。
 * 无数字占位符的纯文本区段（如会计的 ¥"-"）原样返回。
 */
function adjustSectionDecimals(raw: string, target: number): string {
  // 跳过括号修饰部分（颜色 [Red] / 条件 [>100] / 货币 [$¥-409]），只在其后的占位符核心上操作，
  // 避免把条件表达式中的数字误当作占位符。
  let coreStart = 0;
  const bracketRe = /\[[^\]]*\]/g;
  let bm: RegExpExecArray | null;
  while ((bm = bracketRe.exec(raw)) !== null) {
    if (/^\[(h|mm|ss)\]$/i.test(bm[0])) break; // 持续时间标记不属于数值格式，停止跳过
    coreStart = bm.index + bm[0].length;
  }
  const bracketPart = raw.slice(0, coreStart);
  const rest = raw.slice(coreStart);

  const firstIdx = rest.search(/[0#?]/);
  if (firstIdx === -1) return raw;
  let lastIdx = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    const ch = rest[i]!;
    if (ch === '0' || ch === '#' || ch === '?' || ch === 'E') {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx < firstIdx) return raw;

  const core = rest.slice(firstIdx, lastIdx + 1);
  // 科学计数：只调整尾数部分（E 之前），指数占位符不动
  const eIdx = core.search(/E[+-]/i);
  const mantissa = eIdx >= 0 ? core.slice(0, eIdx) : core;
  const dotIdx = mantissa.indexOf('.');
  const fracPlaceholders = dotIdx >= 0 ? (mantissa.slice(dotIdx + 1).match(/[0#?]/g) || []).length : 0;

  if (fracPlaceholders === target) return raw;

  let newMantissa: string;
  if (dotIdx < 0) {
    // 无小数点：目标 > 0 时补充 ".000..."；目标 = 0 时保持原样（实际不会进入此分支，因 frac=0=target 已提前返回）
    newMantissa = target > 0 ? mantissa + '.' + '0'.repeat(target) : mantissa;
  } else if (target > fracPlaceholders) {
    // 增加：在现有小数占位符后追加 '0'
    newMantissa = mantissa + '0'.repeat(target - fracPlaceholders);
  } else {
    // 减少：从尾部移除多余的小数占位符（0/#/?）
    let remove = fracPlaceholders - target;
    const chars = mantissa.split('');
    for (let i = chars.length - 1; i >= 0 && remove > 0; i--) {
      const ch = chars[i];
      if (ch === '0' || ch === '#' || ch === '?') {
        chars.splice(i, 1);
        remove--;
      }
    }
    newMantissa = chars.join('');
    // 小数位归零时移除悬空的小数点（兼容 "." 前无整数占位符的罕见形式则不处理）
    if (target === 0 && newMantissa.endsWith('.')) {
      newMantissa = newMantissa.slice(0, -1);
    }
  }

  const newCore = newMantissa + (eIdx >= 0 ? core.slice(eIdx) : '');
  return bracketPart + rest.slice(0, firstIdx) + newCore + rest.slice(lastIdx + 1);
}

/**
 * 将格式代码调整为指定的小数位数，返回新代码；不支持或越界时返回 null。
 * - 常规格式：生成纯数值格式（'0' 或 '0.000...'）
 * - 文本 / 日期 / 时间 / 持续时间：不支持 → null
 * - 数值类（含百分比/货币/会计/财务/科学计数/多区段自定义）：逐区段调整，纯文本区段保留
 */
export function adjustNumberFormatDecimals(
  format: string | undefined | null,
  target: number,
): string | null {
  if (!Number.isInteger(target) || target < NF_MIN_DECIMALS || target > NF_MAX_DECIMALS) return null;
  if (format === NF_MIXED) return null;
  if (format == null || isGeneralFormat(format)) {
    return target > 0 ? '0.' + '0'.repeat(target) : '0';
  }
  if (format === NF_TEXT) return null;
  const parsed = parseNumberFormat(format);
  if (parsed.kind === 'date' || parsed.kind === 'duration') return null;
  if (!parsed.sections.some((sec) => sec.hasDigits)) return null;
  return format.split(';').map((sec) => adjustSectionDecimals(sec, target)).join(';');
}

/** 常见货币符号集（与对话框一致） */
const NF_CURRENCY_SYMBOLS = ['¥', '$', '€', '£'];

/**
 * 将任意格式代码归类映射为工具栏下拉的预设值，用于回显：
 * 增减小数位、对话框改符号/日期/自定义代码等产生的代码不在预设列表中，
 * 按分类归到对应预设（分类规则与对话框 detectFromCode 一致），无法识别时返回 NF_CUSTOM。
 * 注意：仅用于显示，不得用于替代真实格式代码存储。
 */
export function normalizeNumberFormatForDisplay(
  format: string | undefined | null,
  locale: string,
): string {
  if (format == null || format === NF_MIXED) return format ?? NF_GENERAL;
  if (isGeneralFormat(format)) return NF_GENERAL;
  if (format === NF_TEXT || format === '@') return NF_TEXT;

  const sym = getCurrencySymbol(locale);
  const datePreset = locale === 'zh-CN' ? 'yyyy"年"m"月"d"日"' : 'm/d/yyyy';
  const dateTimePreset = locale === 'zh-CN' ? 'yyyy"年"m"月"d"日" h:mm:ss' : 'm/d/yyyy h:mm:ss';
  const accountingPreset = `${sym}#,##0.00;(${sym}#,##0.00);${sym}"-"`;
  const financialPreset = '#,##0.00;[Red](#,##0.00)';

  // 精确命中预设 → 原样返回（下拉高亮对应项）
  const presets = buildNumberFormatPresets(locale);
  if (presets.some((o) => o.value === format)) return format;

  // 持续时间/日期判定前先移除 [Red]/[>100] 等修饰符（其内含 d 等字母，避免日期误判），仅保留 [h]/[mm]/[ss]
  const stripped = format.replace(/\[[^\]]*\]/gi, (m) => (/^\[(h|mm|ss)\]$/i.test(m) ? m : ''));
  if (/\[(h|mm|ss)\]/i.test(stripped) && !/[yd]/i.test(stripped)) return '[h]:mm:ss';
  const hasDateMark = /[yd]/i.test(stripped);
  const hasTimeMark = /h|s|AM\/PM/i.test(stripped);
  if (hasDateMark && hasTimeMark) return dateTimePreset;
  if (hasDateMark || /AM\/PM/i.test(stripped)) return datePreset;
  if (hasTimeMark) return 'h:mm:ss';
  if (format.includes('%')) return '0.00%';
  if (/E[+-]/i.test(format)) return '0.00E+00';
  if (format.includes('[Red](')) return financialPreset;
  const curSym = NF_CURRENCY_SYMBOLS.find((c) => format.startsWith(c));
  if (curSym) {
    if (format.includes('(')) return accountingPreset;
    return /\.\d/.test(format.slice(curSym.length)) ? sym + '#,##0.00' : sym + '#,##0';
  }
  // 含数字占位符的数值类（含非默认小数位）→ 数值预设；其余无法识别 → 自定义
  const parsed = parseNumberFormat(format);
  if (parsed.kind === 'number' && parsed.sections.some((sec) => sec.hasDigits)) return '#,##0.00';
  return NF_CUSTOM;
}

// ============ 日期/时间字符串自动识别（常规单元格） ============

/** 日期/时间字符串解析结果：Excel 序列号 + 建议套用的格式代码 */
export interface DateTimeParseResult {
  serial: number;
  format: string;
}

/** 某年某月的天数（UTC 构造，不受本地时区影响） */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * 日期 → Excel 1900 系统序列号（与 serialToDate 互逆）。
 * 1900-01-01 ~ 02-28 区间减 1，对齐 Excel 的 1900 虚构闰年（1900-02-29 = 60）。
 */
function dateToSerial(y: number, m: number, d: number): number {
  const days = Date.UTC(y, m - 1, d) / 86400000 + 25569;
  return days <= 60 ? days - 1 : days;
}

/**
 * 对常规单元格的输入做常见日期/时间/日期时间字符串自动识别（对齐 Excel 输入语义）：
 * - 日期：yyyy-m-d、yyyy/m/d、yyyy年m月d日、m-d / m/d（年份补当前年）
 * - 时间：h:mm、h:mm:ss
 * - 日期时间：上述日期 + 空格或 T + 时间
 * 识别成功返回序列号 + 建议格式代码（跟随 locale）；不识别返回 null。
 * 纯数字与公式不会命中；月/日/时/分/秒越界、日期不存在（如 2023-2-29）均不识别。
 */
export function parseDateTimeInput(
  input: string,
  locale: string,
  now: Date = new Date(),
): DateTimeParseResult | null {
  const str = input.trim();
  if (!str || str.startsWith('=') || isNumericValue(str)) return null;

  const dateFmt = locale === 'zh-CN' ? 'yyyy"年"m"月"d"日"' : 'm/d/yyyy';
  const dateTimeFmt = locale === 'zh-CN' ? 'yyyy"年"m"月"d"日" h:mm:ss' : 'm/d/yyyy h:mm:ss';
  const timeFmt = 'h:mm:ss';

  // 时间部分：h:mm(:ss)，时 0-23、分/秒 0-59 → 天的小数部分
  function parseTime(t: string): number | null {
    const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    const sec = m[3] !== undefined ? Number(m[3]) : 0;
    if (h > 23 || mi > 59 || sec > 59) return null;
    return (h * 3600 + mi * 60 + sec) / 86400;
  }

  // 日期部分 → 整数序列号；不识别/越界返回 null
  function parseDate(ds: string): number | null {
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(ds);
    let y: number;
    let mo: number;
    let d: number;
    if (m) {
      y = Number(m[1]);
      mo = Number(m[2]);
      d = Number(m[3]);
    } else if ((m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(ds))) {
      y = Number(m[1]);
      mo = Number(m[2]);
      d = Number(m[3]);
    } else if ((m = /^(\d{1,2})[-/](\d{1,2})$/.exec(ds))) {
      y = now.getUTCFullYear();
      mo = Number(m[1]);
      d = Number(m[2]);
    } else {
      return null;
    }
    if (y < 1900 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    const serial = dateToSerial(y, mo, d);
    return serial >= EXCEL_DATE_MIN_SERIAL && serial <= EXCEL_DATE_MAX_SERIAL ? serial : null;
  }

  // 1) 纯时间：12:30 / 12:30:45
  const tf = parseTime(str);
  if (tf !== null) return { serial: tf, format: timeFmt };

  // 2) 日期 + 时间（空格或 T 分隔）：2026-08-25 12:30 / 2026年8月25日 12:30:45 等
  const dtm = /^(.+?)[T ](\d{1,2}:\d{1,2}(?::\d{1,2})?)$/.exec(str);
  if (dtm) {
    const dSerial = parseDate(dtm[1]!.trim());
    const frac = parseTime(dtm[2]!);
    if (dSerial !== null && frac !== null) {
      return { serial: dSerial + frac, format: dateTimeFmt };
    }
  }

  // 3) 纯日期：2026-08-25 / 2026年8月25日 / 8-25（补当前年）
  const dSerial = parseDate(str);
  if (dSerial !== null) return { serial: dSerial, format: dateFmt };

  return null;
}

// ============ 数字文本自动识别（常规单元格） ============

/** 数字文本（带千分位/百分比/货币符号）解析结果：数值 + 建议套用的格式代码 */
export interface NumericTextParseResult {
  /** 解析后的数值（百分比已 ÷100，使其作为序列值正确显示百分比） */
  num: number;
  /** 建议套用的格式代码，如 '0.00%' / '#,##0' / '¥#,##0.00' */
  format: string;
}

/**
 * 对常规单元格输入做常见"数字文本"自动识别（对齐 Excel 输入语义）：
 * - 带半角千分位逗号的数字：1,234 / 1,234.56 → 数值并套用 #,##0[.00] 格式
 * - 百分比：100% / 3.14% / 1,234.5% → 数值（÷100）并套用 0[.00]% 格式
 * - 货币符号前缀：$1,234.56 / ¥1,234 → 数值并套用「符号#,##0[.00]」格式
 * 仅当字符串含有逗号 / 百分号 / 货币符号时才识别；纯数字（如 "3.14"）不命中，保持常规，
 * 避免覆盖用户无需格式的普通数值。公式、日期/时间文本、无法解析的内容均不命中。
 */
export function parseNumericText(
  input: string,
  locale: string,
): NumericTextParseResult | null {
  const str = input.trim();
  if (!str || str.startsWith('=')) return null;
  const hasSpecial = str.includes(',') || str.includes('%')
    || NF_CURRENCY_SYMBOLS.some((c) => str.startsWith(c));
  if (!hasSpecial) return null;
  // 日期/时间文本优先（避免 "1,2" 之类被误判时与日期逻辑冲突；此处与 setCellValue 调用顺序一致再保险）
  if (parseDateTimeInput(str, locale)) return null;

  // 剥离货币符号前缀
  const cur = NF_CURRENCY_SYMBOLS.find((c) => str.startsWith(c));
  const body = cur ? str.slice(cur.length).trim() : str;
  if (!body) return null;

  // 千分位组（至少一组逗号）或普通数字，可选小数，可选百分号（允许百分号前有一个空格）
  const m =
    /^([+-]?)(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?(%?)$/.exec(body)
    || /^([+-]?)(\d+)(?:\.(\d+))?(%?)$/.exec(body);
  if (!m) return null;

  const sign = m[1] === '-' ? -1 : 1;
  const intStr = m[2]!.replace(/,/g, '');
  const frac = m[3];
  const isPercent = (m[4] ?? '') === '%';
  const decimals = frac ? frac.length : 0;
  const magnitude = Number(intStr + (frac ? '.' + frac : ''));
  if (!Number.isFinite(magnitude)) return null;

  const hasComma = body.includes(',');
  const intPart = hasComma ? '#,##0' : '0';
  const fracPart = decimals > 0 ? '.' + '0'.repeat(decimals) : '';
  const format = (cur ?? '') + intPart + fracPart + (isPercent ? '%' : '');

  let num = magnitude * sign;
  if (isPercent) num = num / 100;
  // 去除浮点噪声（如 3.14/100 = 0.031400000000000004），保持存储值整洁且展示不受影响
  num = Math.round(num * 1e12) / 1e12;

  return { num, format };
}

/** 根据分类 + 小数位数 + 千位分隔符生成格式代码 */
export function buildNumberFormatCode(
  locale: string,
  category: NFDialogCategory,
  decimals: number,
  thousands: boolean,
): string {
  const sym = getCurrencySymbol(locale);
  const intPart = thousands ? '#,##0' : '0';
  const frac = decimals > 0 ? '.' + '0'.repeat(decimals) : '';
  const base = intPart + frac;

  switch (category) {
    case 'general': return '';
    case 'text': return NF_TEXT;
    case 'custom': return ''; // custom 直接由用户写入 customCode，不从控件生成
    case 'number': return base;
    case 'percent': return base + '%';
    case 'scientific': return '0.' + '0'.repeat(decimals) + 'E+00';
    case 'currency': return sym + base;
    case 'currencyRounded': return sym + (thousands ? '#,##0' : '0'); // 强制取整
    case 'accounting':
      return `${sym}${base};(${sym}${base});${sym}"-"`;
    case 'financial':
      return `${base};[Red](${base})`;
    case 'date':
      return locale === 'zh-CN' ? 'yyyy"年"m"月"d"日"' : 'm/d/yyyy';
    case 'time':
      return 'h:mm:ss';
    case 'dateTime':
      return locale === 'zh-CN'
        ? 'yyyy"年"m"月"d"日" h:mm:ss'
        : 'm/d/yyyy h:mm:ss';
    case 'duration':
      return '[h]:mm:ss';
    default:
      return '';
  }
}

/** 构造工具栏下拉框的选项（含「其他数字格式…」自定义项） */
export function buildNumberFormatPresets(locale: string): NFOption[] {
  const sym = getCurrencySymbol(locale);
  const opts: NFOption[] = [
    { label: t(locale, 'nfGeneral'), value: NF_GENERAL },
    { label: t(locale, 'nfText'), value: NF_TEXT },
    { label: t(locale, 'nfNumber'), value: '#,##0.00' },
    { label: t(locale, 'nfPercent'), value: '0.00%' },
    { label: t(locale, 'nfScientific'), value: '0.00E+00' },
    { label: t(locale, 'nfAccounting'), value: `${sym}#,##0.00;(${sym}#,##0.00);${sym}"-"` },
    { label: t(locale, 'nfFinancial'), value: `#,##0.00;[Red](#,##0.00)` },
    { label: t(locale, 'nfCurrency'), value: sym + '#,##0.00' },
    { label: t(locale, 'nfCurrencyRounded'), value: sym + '#,##0' },
    { label: t(locale, 'nfDate'), value: locale === 'zh-CN' ? 'yyyy"年"m"月"d"日"' : 'm/d/yyyy' },
    { label: t(locale, 'nfTime'), value: 'h:mm:ss' },
    { label: t(locale, 'nfDateTime'), value: locale === 'zh-CN' ? 'yyyy"年"m"月"d"日" h:mm:ss' : 'm/d/yyyy h:mm:ss' },
    { label: t(locale, 'nfDuration'), value: '[h]:mm:ss' },
    { label: t(locale, 'nfCustom'), value: NF_CUSTOM },
  ];
  return opts;
}
