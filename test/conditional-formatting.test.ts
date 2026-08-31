import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ref, type Ref } from 'vue';
import {
  evaluateCondition,
  resolveConditionalFormatting,
  applyCfFormat,
  computeRuleValueStats,
  cellInRanges,
  ruleAnchor,
  genRuleId,
  CfValueCache,
  type CFContext,
} from '../src/components/spreader/core/conditional-formatting';
import { evalFormulaCondition } from '../src/components/spreader/core/formula';
import { createCoreState, type CoreState } from '../src/components/spreader/composables/core-state';
import { createUndoStyles } from '../src/components/spreader/composables/undo-styles';
import { createSheetsOps } from '../src/components/spreader/composables/sheets-ops';
import type {
  ConditionalFormattingRule,
  ConditionalFormattingFormat,
  CellData,
  SheetModelData,
  SheetState,
  SelectionRange,
} from '../src/components/spreader/core/types';

// ============ 测试辅助 ============

/** 'A1' 风格引用 → '0,0' 风格 key */
function refToKey(ref: string): string {
  const m = ref.match(/^([A-Z]+)(\d+)$/i)!;
  const c = m[1]!.toUpperCase().split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const r = parseInt(m[2]!, 10) - 1;
  return `${c},${r}`;
}

/** 以 A1 风格键值构造纯引擎求值上下文（值为原始字符串） */
function mkCtx(vals: Record<string, string>): CFContext {
  const cells: Record<string, CellData> = {};
  for (const [ref, v] of Object.entries(vals)) cells[refToKey(ref)] = { value: v };
  return {
    cells,
    colCount: 26,
    rowCount: 200,
    getCellValue: (c, r) => cells[`${c},${r}`]?.value ?? '',
  };
}

function range(startCol: number, startRow: number, endCol: number, endRow: number): SelectionRange {
  return { startCol, startRow, endCol, endRow };
}

function mkRule(partial: Partial<ConditionalFormattingRule> & { condition: ConditionalFormattingRule['condition'] }): ConditionalFormattingRule {
  return {
    id: partial.id ?? 'r1',
    condition: partial.condition,
    format: partial.format ?? { backgroundColor: '#FFC7CE' },
    ranges: partial.ranges ?? [range(0, 0, 4, 9)],
    priority: partial.priority ?? 1,
    stopIfTrue: partial.stopIfTrue ?? false,
    enabled: partial.enabled ?? true,
  };
}

function freshState(colCount = 26, rowCount = 200): CoreState {
  return createCoreState(
    { colCount, rowCount },
    { colCount, rowCount, theme: 'light', locale: 'zh-CN' },
  );
}

/** 全栈辅助（core-state + undo-styles + sheets-ops），与 freeze-panes.test.ts 同款模式 */
function fullStack(colCount = 26, rowCount = 200) {
  const s = createCoreState(
    { colCount, rowCount },
    { colCount, rowCount, theme: 'light', locale: 'zh-CN' },
  );
  const sheetsCtx: {
    sheets: Ref<SheetState[]>;
    activeSheetIndex: Ref<number>;
    saveSheet: () => void;
    loadSheet: (i: number) => void;
    mkSheet: (name: string, dims?: { colCount?: number; rowCount?: number }) => SheetState;
  } = {
    sheets: ref<SheetState[]>([]),
    activeSheetIndex: ref(0),
    saveSheet: () => {},
    loadSheet: (_i: number) => {},
    mkSheet: (name: string) => ({
      id: '', name, cells: {}, merges: {}, styles: [{}], borders: [{}],
      selection: null, activeCell: { col: 0, row: 0 },
      scrollX: 0, scrollY: 0, colWidths: [], rowHeights: [],
      colCount: 0, rowCount: 0, freeze: { rows: 0, cols: 0 }, filter: null,
      conditionalFormats: [], dataValidations: [], rowOutlines: [], columnOutlines: [],
    }),
  };
  const us = createUndoStyles(s, sheetsCtx);
  const modelData = ref<SheetModelData[]>([]);
  const lastEmittedDataRef = { value: '' };
  const sheetsOps = createSheetsOps(s, us, modelData, undefined, lastEmittedDataRef);
  sheetsCtx.sheets = sheetsOps.sheets;
  sheetsCtx.activeSheetIndex = sheetsOps.activeSheetIndex;
  sheetsCtx.saveSheet = sheetsOps.saveSheet;
  sheetsCtx.loadSheet = sheetsOps.loadSheet;
  sheetsCtx.mkSheet = sheetsOps.mkSheet;
  return { s, us, sheetsOps, modelData };
}

// =================================================================
// 一、cellIs：数值比较语义
// =================================================================

test('cellIs greaterThan 为真正数值比较（"100" > "99" 为 true，字符串比较会得出相反结果）', () => {
  const ctx = mkCtx({ A1: '100' });
  const cond = { type: 'cellIs', operator: 'greaterThan', value: '99' } as const;
  assert.equal(evaluateCondition(cond, 0, 0, ctx, { col: 0, row: 0 }), true);
});

test('cellIs greaterThan 边界：等于阈值不命中', () => {
  const ctx = mkCtx({ A1: '99' });
  const cond = { type: 'cellIs', operator: 'greaterThan', value: '99' } as const;
  assert.equal(evaluateCondition(cond, 0, 0, ctx, { col: 0, row: 0 }), false);
});

test('cellIs greaterThanOrEqual / lessThan / lessThanOrEqual 数值语义', () => {
  const ctx = mkCtx({ A1: '10' });
  assert.equal(evaluateCondition({ type: 'cellIs', operator: 'greaterThanOrEqual', value: '10' }, 0, 0, ctx, { col: 0, row: 0 }), true);
  assert.equal(evaluateCondition({ type: 'cellIs', operator: 'lessThan', value: '10.5' }, 0, 0, ctx, { col: 0, row: 0 }), true);
  assert.equal(evaluateCondition({ type: 'cellIs', operator: 'lessThanOrEqual', value: '9.999' }, 0, 0, ctx, { col: 0, row: 0 }), false);
});

test('cellIs between 含两端边界', () => {
  const ctx = mkCtx({ A1: '10', A2: '20', A3: '9.99', A4: '20.01' });
  const cond = { type: 'cellIs', operator: 'between', value: '10', value2: '20' } as const;
  assert.equal(evaluateCondition(cond, 0, 0, ctx, { col: 0, row: 0 }), true);
  assert.equal(evaluateCondition(cond, 0, 1, ctx, { col: 0, row: 0 }), true);
  assert.equal(evaluateCondition(cond, 0, 2, ctx, { col: 0, row: 0 }), false);
  assert.equal(evaluateCondition(cond, 0, 3, ctx, { col: 0, row: 0 }), false);
});

test('cellIs between 的 value/value2 顺序颠倒仍然成立（自动 min/max）', () => {
  const ctx = mkCtx({ A1: '15' });
  const cond = { type: 'cellIs', operator: 'between', value: '20', value2: '10' } as const;
  assert.equal(evaluateCondition(cond, 0, 0, ctx, { col: 0, row: 0 }), true);
});

test('cellIs notBetween', () => {
  const ctx = mkCtx({ A1: '5', A2: '15' });
  const cond = { type: 'cellIs', operator: 'notBetween', value: '10', value2: '20' } as const;
  assert.equal(evaluateCondition(cond, 0, 0, ctx, { col: 0, row: 0 }), true);
  assert.equal(evaluateCondition(cond, 0, 1, ctx, { col: 0, row: 0 }), false);
});

test('cellIs equal 数值等价（"10" 等于 "10.0"），非数值退化为字符串比较', () => {
  const ctx = mkCtx({ A1: '10', A2: 'foo' });
  assert.equal(evaluateCondition({ type: 'cellIs', operator: 'equal', value: '10.0' }, 0, 0, ctx, { col: 0, row: 0 }), true);
  assert.equal(evaluateCondition({ type: 'cellIs', operator: 'equal', value: 'foo' }, 0, 1, ctx, { col: 0, row: 0 }), true);
  assert.equal(evaluateCondition({ type: 'cellIs', operator: 'notEqual', value: 'foo' }, 0, 1, ctx, { col: 0, row: 0 }), false);
});

test('cellIs 数值比较兼容千分位输入（"1,000" > "999"）', () => {
  const ctx = mkCtx({ A1: '1000' });
  const cond = { type: 'cellIs', operator: 'greaterThan', value: '999' } as const;
  assert.equal(evaluateCondition(cond, 0, 0, ctx, { col: 0, row: 0 }), true);
  const ctx2 = mkCtx({ A1: '1000' });
  assert.equal(evaluateCondition({ type: 'cellIs', operator: 'equal', value: '1,000' }, 0, 0, ctx2, { col: 0, row: 0 }), true);
});

test('cellIs 数值比较对文本单元格不命中（不抛错）', () => {
  const ctx = mkCtx({ A1: 'abc' });
  assert.equal(evaluateCondition({ type: 'cellIs', operator: 'greaterThan', value: '5' }, 0, 0, ctx, { col: 0, row: 0 }), false);
  assert.equal(evaluateCondition({ type: 'cellIs', operator: 'lessThan', value: '5' }, 0, 0, ctx, { col: 0, row: 0 }), false);
});

// =================================================================
// 二、文本 / 空白 / 重复 / 唯一
// =================================================================

test('textContains 大小写不敏感', () => {
  const ctx = mkCtx({ A1: 'Hello World' });
  assert.equal(evaluateCondition({ type: 'textContains', value: 'world' }, 0, 0, ctx, { col: 0, row: 0 }), true);
  assert.equal(evaluateCondition({ type: 'textContains', value: 'xyz' }, 0, 0, ctx, { col: 0, row: 0 }), false);
});

test('textNotContains', () => {
  const ctx = mkCtx({ A1: 'Hello' });
  assert.equal(evaluateCondition({ type: 'textNotContains', value: 'xyz' }, 0, 0, ctx, { col: 0, row: 0 }), true);
  assert.equal(evaluateCondition({ type: 'textNotContains', value: 'hello' }, 0, 0, ctx, { col: 0, row: 0 }), false);
});

test('blank / notBlank', () => {
  const ctx = mkCtx({ A1: 'x' }); // A2 不存在 → 空白
  assert.equal(evaluateCondition({ type: 'blank' }, 0, 0, ctx, { col: 0, row: 0 }), false);
  assert.equal(evaluateCondition({ type: 'blank' }, 0, 1, ctx, { col: 0, row: 0 }), true);
  assert.equal(evaluateCondition({ type: 'notBlank' }, 0, 0, ctx, { col: 0, row: 0 }), true);
  assert.equal(evaluateCondition({ type: 'notBlank' }, 0, 1, ctx, { col: 0, row: 0 }), false);
});

test('duplicate：范围内出现次数 > 1 命中；空白不参与统计', () => {
  const ctx = mkCtx({ A1: 'x', A2: 'x', A3: 'y', A4: '' });
  const rule = mkRule({ condition: { type: 'duplicate' }, ranges: [range(0, 0, 0, 3)] });
  const stats = computeRuleValueStats(rule, ctx);
  assert.equal(stats.get('x'), 2);
  assert.equal(stats.get('y'), 1);
  assert.equal(stats.has(''), false);
  assert.equal(evaluateCondition(rule.condition, 0, 0, ctx, { col: 0, row: 0 }, stats), true);
  assert.equal(evaluateCondition(rule.condition, 0, 2, ctx, { col: 0, row: 0 }, stats), false);
  assert.equal(evaluateCondition(rule.condition, 0, 3, ctx, { col: 0, row: 0 }, stats), false);
});

test('unique：范围内恰好出现一次命中', () => {
  const ctx = mkCtx({ A1: 'x', A2: 'x', A3: 'y' });
  const rule = mkRule({ condition: { type: 'unique' }, ranges: [range(0, 0, 0, 2)] });
  const stats = computeRuleValueStats(rule, ctx);
  assert.equal(evaluateCondition(rule.condition, 0, 2, ctx, { col: 0, row: 0 }, stats), true);
  assert.equal(evaluateCondition(rule.condition, 0, 0, ctx, { col: 0, row: 0 }, stats), false);
});

test('duplicate 统计作用域限定在规则 Range 内：范围外的相同值不计入', () => {
  const ctx = mkCtx({ A1: 'x', B1: 'x' }); // A1 在范围外(A 列 0 行在范围内？不，range 是 A2:A3)
  const rule = mkRule({ condition: { type: 'duplicate' }, ranges: [range(0, 1, 0, 2)] });
  const stats = computeRuleValueStats(rule, ctx);
  assert.equal(stats.size, 0); // A2/A3 均为空
  // 把 A2 也设为 x：A1（范围外）不参与，A2 仅一次 → 非 duplicate
  const ctx2 = mkCtx({ A1: 'x', A2: 'x', B1: 'x' });
  const stats2 = computeRuleValueStats(rule, ctx2);
  assert.equal(stats2.get('x'), 1);
  assert.equal(evaluateCondition(rule.condition, 0, 1, ctx2, { col: 0, row: 1 }, stats2), false);
});

test('多 Range 规则：跨 ranges 的值合并统计', () => {
  const ctx = mkCtx({ A1: 'x', C1: 'x' });
  const rule = mkRule({ condition: { type: 'duplicate' }, ranges: [range(0, 0, 0, 0), range(2, 0, 2, 0)] });
  const stats = computeRuleValueStats(rule, ctx);
  assert.equal(stats.get('x'), 2);
});

// =================================================================
// 三、公式条件（相对/绝对引用、基准=范围左上角）
// =================================================================

test('evalFormulaCondition：顶层比较运算符返回正确布尔值', () => {
  const ctx = mkCtx({ A1: '150', A2: '50' });
  const cells = ctx.cells;
  assert.equal(evalFormulaCondition('A1>100', cells, 26, 200), true);
  assert.equal(evalFormulaCondition('A2>100', cells, 26, 200), false);
  // 前导 '=' 被剥离
  assert.equal(evalFormulaCondition('=A1>100', cells, 26, 200), true);
  // <> 运算符
  assert.equal(evalFormulaCondition('A1<>150', cells, 26, 200), false);
});

test('evalFormulaCondition：标量真值语义（非 0 数字/非空字符串为真）', () => {
  const ctx = mkCtx({ A1: '0', A2: 'text', A3: '' });
  const cells = ctx.cells;
  assert.equal(evalFormulaCondition('A1', cells, 26, 200), false);
  assert.equal(evalFormulaCondition('A2', cells, 26, 200), true);
  assert.equal(evalFormulaCondition('A3', cells, 26, 200), false);
});

test('evalFormulaCondition：非法表达式不抛错、返回 false', () => {
  const ctx = mkCtx({});
  assert.equal(evalFormulaCondition('(((', ctx.cells, 26, 200), false);
  assert.equal(evalFormulaCondition('1/0>0', ctx.cells, 26, 200), false);
});

test('公式条件：相对引用以规则范围左上角为基准逐格平移', () => {
  // 规则作用于 B2:B4（col=1, rows=1..3），公式 "B2>100"
  // 对 B3 求值时应平移为 "B3>100"
  const ctx = mkCtx({ B2: '50', B3: '150', B4: '50' });
  const rule = mkRule({
    condition: { type: 'formula', formula: 'B2>100' },
    ranges: [range(1, 1, 1, 3)],
  });
  assert.equal(evaluateCondition(rule.condition, 1, 1, ctx, { col: 1, row: 1 }), false);
  assert.equal(evaluateCondition(rule.condition, 1, 2, ctx, { col: 1, row: 1 }), true);
  assert.equal(evaluateCondition(rule.condition, 1, 3, ctx, { col: 1, row: 1 }), false);
});

test('公式条件：$ 绝对引用不随单元格平移', () => {
  // 规则作用于 B2:B4，公式 "$B$2>100"：所有格子都以 B2 为准
  const ctx = mkCtx({ B2: '150', B3: '50', B4: '50' });
  const rule = mkRule({
    condition: { type: 'formula', formula: '$B$2>100' },
    ranges: [range(1, 1, 1, 3)],
  });
  const anchor = ruleAnchor(rule);
  assert.equal(evaluateCondition(rule.condition, 1, 1, ctx, anchor), true);
  assert.equal(evaluateCondition(rule.condition, 1, 2, ctx, anchor), true);
  assert.equal(evaluateCondition(rule.condition, 1, 3, ctx, anchor), true);
});

test('公式条件：前导 "=" 被容忍（Excel 输入习惯）', () => {
  const ctx = mkCtx({ B2: '150' });
  const cond = { type: 'formula', formula: '=B2>100' } as const;
  assert.equal(evaluateCondition(cond, 1, 1, ctx, { col: 1, row: 1 }), true);
});

test('公式条件：整行/整列引用模式（$A1 混合引用按行平移）', () => {
  // 公式 "$A1>100"：列固定 A，行随格子平移
  const ctx = mkCtx({ A1: '150', A2: '50' });
  const rule = mkRule({
    condition: { type: 'formula', formula: '$A1>100' },
    ranges: [range(1, 0, 1, 1)], // B1:B2
  });
  const anchor = ruleAnchor(rule); // {col:1, row:0}
  // B1 (row 0)：$A1 → A1=150 → true
  assert.equal(evaluateCondition(rule.condition, 1, 0, ctx, anchor), true);
  // B2 (row 1)：$A1 平移为 $A2 → A2=50 → false
  assert.equal(evaluateCondition(rule.condition, 1, 1, ctx, anchor), false);
});

// =================================================================
// 四、优先级、stopIfTrue、启用开关
// =================================================================

test('priority 越小优先级越高：属性冲突时高优先级获胜', () => {
  const ctx = mkCtx({ A1: '200' });
  const rules = [
    mkRule({
      id: 'low', priority: 2,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { color: '#0000FF', backgroundColor: '#0000FF' },
      ranges: [range(0, 0, 0, 0)],
    }),
    mkRule({
      id: 'high', priority: 1,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { color: '#FF0000' },
      ranges: [range(0, 0, 0, 0)],
    }),
  ];
  const merged = resolveConditionalFormatting(0, 0, rules, ctx);
  assert.ok(merged);
  assert.equal(merged!.color, '#FF0000'); // 高优先级获胜
  assert.equal(merged!.backgroundColor, '#0000FF'); // 低优先级补充未设置属性
});

test('stopIfTrue：命中后阻止低优先级规则继续合成', () => {
  const ctx = mkCtx({ A1: '200' });
  const rules = [
    mkRule({
      id: 'stop', priority: 1, stopIfTrue: true,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { color: '#FF0000' },
      ranges: [range(0, 0, 0, 0)],
    }),
    mkRule({
      id: 'blocked', priority: 2,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { backgroundColor: '#0000FF' },
      ranges: [range(0, 0, 0, 0)],
    }),
  ];
  const merged = resolveConditionalFormatting(0, 0, rules, ctx);
  assert.ok(merged);
  assert.equal(merged!.color, '#FF0000');
  assert.equal(merged!.backgroundColor, undefined); // 被阻断
});

test('stopIfTrue 只在规则命中时生效：未命中不阻断后续规则', () => {
  const ctx = mkCtx({ A1: '50' });
  const rules = [
    mkRule({
      id: 'miss', priority: 1, stopIfTrue: true,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' }, // 不命中
      format: { color: '#FF0000' },
      ranges: [range(0, 0, 0, 0)],
    }),
    mkRule({
      id: 'later', priority: 2,
      condition: { type: 'cellIs', operator: 'lessThan', value: '100' }, // 命中
      format: { backgroundColor: '#0000FF' },
      ranges: [range(0, 0, 0, 0)],
    }),
  ];
  const merged = resolveConditionalFormatting(0, 0, rules, ctx);
  assert.ok(merged);
  assert.equal(merged!.backgroundColor, '#0000FF');
});

test('enabled=false 的规则不参与求值', () => {
  const ctx = mkCtx({ A1: '200' });
  const rules = [
    mkRule({
      enabled: false,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { color: '#FF0000' },
      ranges: [range(0, 0, 0, 0)],
    }),
  ];
  assert.equal(resolveConditionalFormatting(0, 0, rules, ctx), null);
});

test('范围外的单元格返回 null（即使条件会命中）', () => {
  const ctx = mkCtx({ A1: '200', C3: '200' });
  const rules = [
    mkRule({
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      ranges: [range(0, 0, 0, 0)], // 仅 A1
    }),
  ];
  assert.ok(resolveConditionalFormatting(0, 0, rules, ctx));
  assert.equal(resolveConditionalFormatting(2, 2, rules, ctx), null);
});

test('无规则 / 全不命中返回 null', () => {
  const ctx = mkCtx({ A1: '5' });
  assert.equal(resolveConditionalFormatting(0, 0, [], ctx), null);
  const rules = [mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '100' }, ranges: [range(0, 0, 0, 0)] })];
  assert.equal(resolveConditionalFormatting(0, 0, rules, ctx), null);
});

// =================================================================
// 五、样式合成（applyCfFormat）
// =================================================================

test('applyCfFormat：CF 覆盖基础样式对应属性，未设置属性保持基础值', () => {
  const base = { backgroundColor: '#fff', color: '#000', fontWeight: '', fontStyle: '', underline: '', strikethrough: '' };
  const out = applyCfFormat(base, { backgroundColor: '#FFC7CE', fontWeight: 'bold' });
  assert.equal(out.backgroundColor, '#FFC7CE');
  assert.equal(out.fontWeight, 'bold');
  assert.equal(out.color, '#000'); // CF 未设置 → 保持
});

test('applyCfFormat：显式空串清除基础样式（如清除加粗）', () => {
  const base = { backgroundColor: '#fff', color: '#000', fontWeight: 'bold', fontStyle: '', underline: '', strikethrough: '' };
  const out = applyCfFormat(base, { fontWeight: '' });
  assert.equal(out.fontWeight, '');
});

test('applyCfFormat：cf 为 null 时原样返回基础样式', () => {
  const base = { backgroundColor: '#fff', color: '#000' };
  const out = applyCfFormat(base, null);
  assert.deepEqual(out, { ...base, fontWeight: undefined, fontStyle: undefined, underline: undefined, strikethrough: undefined });
});

// =================================================================
// 六、工具函数与缓存
// =================================================================

test('cellInRanges：含边界、支持多 range', () => {
  const ranges = [range(0, 0, 1, 2), range(5, 5, 5, 5)];
  assert.equal(cellInRanges(ranges, 0, 0), true);
  assert.equal(cellInRanges(ranges, 1, 2), true);
  assert.equal(cellInRanges(ranges, 2, 0), false);
  assert.equal(cellInRanges(ranges, 5, 5), true);
  assert.equal(cellInRanges(ranges, 5, 6), false);
});

test('ruleAnchor：取所有 ranges 的最小 startCol/startRow', () => {
  const rule = mkRule({ condition: { type: 'blank' }, ranges: [range(3, 5, 4, 9), range(1, 8, 2, 12)] });
  assert.deepEqual(ruleAnchor(rule), { col: 1, row: 5 });
});

test('ruleAnchor：空 ranges 回退 (0,0)', () => {
  const rule = mkRule({ condition: { type: 'blank' }, ranges: [] });
  assert.deepEqual(ruleAnchor(rule), { col: 0, row: 0 });
});

test('genRuleId：生成非空且互不相同的 id', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) ids.add(genRuleId());
  assert.equal(ids.size, 100);
  assert.ok([...ids][0]!.startsWith('cf_'));
});

test('CfValueCache：get/set/invalidate（单规则与全量）', () => {
  const cache = new CfValueCache();
  const stats = new Map([['x', 2]]);
  cache.set('r1', stats);
  cache.set('r2', new Map());
  assert.equal(cache.get('r1'), stats);
  cache.invalidate('r1');
  assert.equal(cache.get('r1'), undefined);
  assert.ok(cache.get('r2'));
  cache.invalidate();
  assert.equal(cache.get('r2'), undefined);
});

test('resolveConditionalFormatting 使用缓存避免重复统计 duplicate', () => {
  const ctx = mkCtx({ A1: 'x', A2: 'x' });
  const rule = mkRule({ condition: { type: 'duplicate' }, ranges: [range(0, 0, 0, 1)] });
  const cache = new CfValueCache();
  const m1 = resolveConditionalFormatting(0, 0, [rule], ctx, cache);
  assert.ok(m1);
  const stats = cache.get(rule.id);
  assert.ok(stats);
  // 命中缓存的第二次求值结果一致
  const m2 = resolveConditionalFormatting(0, 0, [rule], ctx, cache);
  assert.ok(m2);
});

// =================================================================
// 七、core-state 集成：动态求值与「不写回 style」
// =================================================================

test('addConditionalFormatRule：空 id 时自动生成稳定 id', () => {
  const s = freshState();
  s.addConditionalFormatRule(mkRule({ id: '', condition: { type: 'cellIs', operator: 'greaterThan', value: '10' } }));
  assert.equal(s.conditionalFormats.length, 1);
  assert.ok(s.conditionalFormats[0]!.id.length > 0);
});

test('resolveConditionalFormat：值变化后动态重算（greaterThan）', () => {
  const s = freshState();
  s.setCellValue(0, 0, '50');
  s.addConditionalFormatRule(mkRule({
    condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
    ranges: [range(0, 0, 0, 0)],
  }));
  assert.equal(s.resolveConditionalFormat(0, 0), null);
  s.setCellValue(0, 0, '150');
  const hit = s.resolveConditionalFormat(0, 0);
  assert.ok(hit);
  assert.equal(hit!.backgroundColor, '#FFC7CE');
});

test('duplicate 规则：值变化后统计缓存失效并重算', () => {
  const s = freshState();
  s.setCellValue(0, 0, 'x');
  s.setCellValue(0, 1, 'x');
  s.setCellValue(0, 2, 'y');
  s.addConditionalFormatRule(mkRule({
    condition: { type: 'duplicate' },
    ranges: [range(0, 0, 0, 2)],
  }));
  assert.ok(s.resolveConditionalFormat(0, 0)); // x 出现 2 次
  // 改 A2 为 z：x 只剩 1 次 → A1 不再命中
  s.setCellValue(0, 1, 'z');
  assert.equal(s.resolveConditionalFormat(0, 0), null);
});

test('公式单元格参与条件求值（CF 使用计算后的显示值）', () => {
  const s = freshState();
  s.setCellValue(0, 0, '50'); // A1
  s.setCellValue(1, 0, '=A1*2'); // B1 = 100
  s.addConditionalFormatRule(mkRule({
    condition: { type: 'cellIs', operator: 'greaterThanOrEqual', value: '100' },
    ranges: [range(1, 0, 1, 0)],
  }));
  assert.ok(s.resolveConditionalFormat(1, 0));
  // A1 变化 → B1 联动 → CF 动态重算
  s.setCellValue(0, 0, '10'); // B1 = 20
  assert.equal(s.resolveConditionalFormat(1, 0), null);
});

test('CF 不写回 cell.style / styleId（纯渲染层合成）', () => {
  const s = freshState();
  s.setCellValue(0, 0, '150');
  const stylesBefore = s.styles.length;
  s.addConditionalFormatRule(mkRule({
    condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
    format: { backgroundColor: '#FFC7CE', fontWeight: 'bold' },
    ranges: [range(0, 0, 0, 0)],
  }));
  const hit = s.resolveConditionalFormat(0, 0);
  assert.ok(hit);
  // 命中后单元格数据不变：无 styleId、样式池长度不变
  assert.equal(s.cells['0,0']!.styleId, undefined);
  assert.equal(s.styles.length, stylesBefore);
  const resolved = s.resolveStyle(s.cells['0,0']);
  assert.notEqual(resolved?.backgroundColor, '#FFC7CE');
});

test('updateConditionalFormatRule：按 id 打补丁', () => {
  const s = freshState();
  s.addConditionalFormatRule(mkRule({ id: 'r1', condition: { type: 'cellIs', operator: 'greaterThan', value: '100' }, ranges: [range(0, 0, 0, 0)] }));
  s.updateConditionalFormatRule('r1', { condition: { type: 'cellIs', operator: 'lessThan', value: '100' } });
  s.setCellValue(0, 0, '50');
  assert.ok(s.resolveConditionalFormat(0, 0)); // 50 < 100 命中
});

test('removeConditionalFormatRule：删除后不再命中', () => {
  const s = freshState();
  s.setCellValue(0, 0, '150');
  s.addConditionalFormatRule(mkRule({ id: 'r1', condition: { type: 'cellIs', operator: 'greaterThan', value: '100' }, ranges: [range(0, 0, 0, 0)] }));
  assert.ok(s.resolveConditionalFormat(0, 0));
  s.removeConditionalFormatRule('r1');
  assert.equal(s.conditionalFormats.length, 0);
  assert.equal(s.resolveConditionalFormat(0, 0), null);
});

test('moveConditionalFormatRule：交换相邻优先级', () => {
  const s = freshState();
  s.setCellValue(0, 0, '200');
  s.addConditionalFormatRule(mkRule({ id: 'r1', priority: 1, condition: { type: 'cellIs', operator: 'greaterThan', value: '100' }, format: { color: '#FF0000' }, ranges: [range(0, 0, 0, 0)] }));
  s.addConditionalFormatRule(mkRule({ id: 'r2', priority: 2, condition: { type: 'cellIs', operator: 'greaterThan', value: '100' }, format: { color: '#0000FF' }, ranges: [range(0, 0, 0, 0)] }));
  let merged = s.resolveConditionalFormat(0, 0);
  assert.equal(merged!.color, '#FF0000'); // r1 优先级高
  s.moveConditionalFormatRule('r2', 'up'); // r2 与 r1 交换
  merged = s.resolveConditionalFormat(0, 0);
  assert.equal(merged!.color, '#0000FF'); // 现在 r2 优先级高
});

test('clearConditionalFormats("sheet")：清空全部规则', () => {
  const s = freshState();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'blank' } }));
  s.addConditionalFormatRule(mkRule({ condition: { type: 'notBlank' } }));
  s.clearConditionalFormats('sheet');
  assert.equal(s.conditionalFormats.length, 0);
});

test('clearConditionalFormats("selection")：仅裁剪与选区相交的范围，整规则移除后不留空壳', () => {
  const s = freshState();
  s.addConditionalFormatRule(mkRule({ id: 'r1', condition: { type: 'blank' }, ranges: [range(0, 0, 2, 2)] }));
  s.addConditionalFormatRule(mkRule({ id: 'r2', condition: { type: 'blank' }, ranges: [range(5, 5, 6, 6)] }));
  s.selection.value = range(0, 0, 1, 1); // 清除 A1:B2
  s.clearConditionalFormats('selection');
  assert.equal(s.conditionalFormats.length, 1);
  assert.equal(s.conditionalFormats[0]!.id, 'r2');
});

// =================================================================
// 八、全栈集成：行/列增删的动态 Range、序列化、撤销重做
// =================================================================

test('插入行：范围整体下移（startRow >= 插入点）', () => {
  const { s, sheetsOps } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '10' }, ranges: [range(0, 1, 2, 5)] }));
  sheetsOps.insertRows(0, 0); // 顶部插入 1 行
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(0, 2, 2, 6));
});

test('插入行：范围跨越插入点时仅放大 endRow', () => {
  const { s, sheetsOps } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '10' }, ranges: [range(0, 1, 2, 5)] }));
  sheetsOps.insertRows(3, 3); // 范围中间插入 1 行
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(0, 1, 2, 6));
});

test('插入行：范围完全在插入点上方则不变', () => {
  const { s, sheetsOps } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '10' }, ranges: [range(0, 1, 2, 3)] }));
  sheetsOps.insertRows(5, 5);
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(0, 1, 2, 3));
});

test('删除行：范围上方删除则整体上移', () => {
  const { s, sheetsOps } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '10' }, ranges: [range(0, 2, 2, 6)] }));
  sheetsOps.deleteRows(0, 1); // 删除上方 2 行
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(0, 0, 2, 4));
});

test('删除行：范围与删除带部分重叠则裁剪', () => {
  const { s, sheetsOps } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '10' }, ranges: [range(0, 2, 2, 6)] }));
  sheetsOps.deleteRows(4, 5); // 删除范围内的 2 行
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(0, 2, 2, 4));
});

test('删除行：范围整段被删则规则一并移除', () => {
  const { s, sheetsOps } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '10' }, ranges: [range(0, 2, 2, 6)] }));
  sheetsOps.deleteRows(2, 6);
  assert.equal(s.conditionalFormats.length, 0);
});

test('插入/删除列：范围随列平移与裁剪', () => {
  const { s, sheetsOps } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '10' }, ranges: [range(1, 0, 3, 5)] }));
  sheetsOps.insertCols(0, 0); // A 列前插入 1 列
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(2, 0, 4, 5));
  sheetsOps.deleteCols(0, 0); // 删除新插入的列
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(1, 0, 3, 5));
  sheetsOps.deleteCols(2, 3); // 删除范围内的 2 列
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(1, 0, 1, 5));
});

test('增删行列后规则仍按新坐标命中（值随行移动，CF 跟随数据）', () => {
  const { s, sheetsOps } = fullStack();
  s.setCellValue(0, 3, '150'); // A4
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '100' }, ranges: [range(0, 3, 0, 3)] }));
  assert.ok(s.resolveConditionalFormat(0, 3));
  sheetsOps.insertRows(0, 0); // 值移到 A5，范围同步下移
  assert.equal(s.getCellValue(0, 4), '150');
  assert.ok(s.resolveConditionalFormat(0, 4));
  assert.equal(s.resolveConditionalFormat(0, 3), null);
});

test('序列化：emitModelData 输出 conditionalFormats（含 id/ranges）', () => {
  const { s, modelData } = fullStack();
  s.addConditionalFormatRule(mkRule({
    id: 'cf_test_1',
    condition: { type: 'cellIs', operator: 'between', value: '10', value2: '20' },
    ranges: [range(0, 0, 2, 9)],
  }));
  s.emitModelData!();
  const smd = modelData.value[0]!;
  assert.ok(smd.conditionalFormats);
  assert.equal(smd.conditionalFormats!.length, 1);
  assert.equal(smd.conditionalFormats![0]!.id, 'cf_test_1');
  assert.deepEqual(smd.conditionalFormats![0]!.ranges, [range(0, 0, 2, 9)]);
  assert.deepEqual(smd.conditionalFormats![0]!.condition, { type: 'cellIs', operator: 'between', value: '10', value2: '20' });
});

test('序列化：无规则时不输出 conditionalFormats 字段（旧数据兼容）', () => {
  const { s, modelData } = fullStack();
  s.emitModelData!();
  assert.equal(modelData.value[0]!.conditionalFormats, undefined);
});

test('撤销/重做：规则增删可撤销恢复', () => {
  const { s, us } = fullStack();
  s.addConditionalFormatRule(mkRule({ id: 'r1', condition: { type: 'cellIs', operator: 'greaterThan', value: '100' }, ranges: [range(0, 0, 0, 0)] }));
  assert.equal(s.conditionalFormats.length, 1);
  s.removeConditionalFormatRule('r1');
  assert.equal(s.conditionalFormats.length, 0);
  us.undo();
  assert.equal(s.conditionalFormats.length, 1);
  assert.equal(s.conditionalFormats[0]!.id, 'r1');
  us.redo();
  assert.equal(s.conditionalFormats.length, 0);
});

test('撤销/重做：clearConditionalFormats 可撤销', () => {
  const { s, us } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'blank' } }));
  s.addConditionalFormatRule(mkRule({ condition: { type: 'notBlank' } }));
  s.clearConditionalFormats('sheet');
  assert.equal(s.conditionalFormats.length, 0);
  us.undo();
  assert.equal(s.conditionalFormats.length, 2);
});

test('规则列表为空时 resolveConditionalFormat 快速返回 null', () => {
  const s = freshState();
  assert.equal(s.resolveConditionalFormat(0, 0), null);
});

// =================================================================
// 九、样式合成扩展：fontWeight / fontStyle / underline / strikethrough 合成与显式清除
// =================================================================

test('applyCfFormat：underline 已存在基础值时，CF 覆盖为新值；显式空串清除', () => {
  const base = { underline: 'underline', strikethrough: 'line-through', fontStyle: 'italic', fontWeight: 'bold' };
  const out = applyCfFormat(base, { underline: '', strikethrough: 'line-through' });
  assert.equal(out.underline, ''); // CF 空串 → 清除
  assert.equal(out.strikethrough, 'line-through'); // CF 命中 → 覆盖为相同值（仍保持清除语义允许）
  // 未设置：字体属性保持
  assert.equal(out.fontStyle, 'italic');
  assert.equal(out.fontWeight, 'bold');
});

test('applyCfFormat：fontWeight/fontStyle 由 CF 设置，覆盖基础值（渲染层 fontWeight/fontStyle 合成回归）', () => {
  const base = { fontWeight: '', fontStyle: '', underline: '', strikethrough: '' };
  const out = applyCfFormat(base, { fontWeight: 'bold', fontStyle: 'italic', underline: 'underline', strikethrough: 'line-through' });
  assert.equal(out.fontWeight, 'bold');
  assert.equal(out.fontStyle, 'italic');
  assert.equal(out.underline, 'underline');
  assert.equal(out.strikethrough, 'line-through');
});

test('resolveConditionalFormatting：多规则逐字段合并（fontWeight/fontStyle/underline/strikethrough 互不干扰）', () => {
  const ctx = mkCtx({ A1: '200' });
  const rules = [
    mkRule({
      id: 'high', priority: 1,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { fontWeight: 'bold', color: '#FF0000' },
      ranges: [range(0, 0, 0, 0)],
    }),
    mkRule({
      id: 'low', priority: 2,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { fontStyle: 'italic', underline: 'underline', backgroundColor: '#FFC7CE' },
      ranges: [range(0, 0, 0, 0)],
    }),
  ];
  const merged = resolveConditionalFormatting(0, 0, rules, ctx);
  assert.ok(merged);
  assert.equal(merged!.fontWeight, 'bold');   // 高优先级保留
  assert.equal(merged!.color, '#FF0000');     // 高优先级保留
  assert.equal(merged!.fontStyle, 'italic');  // 低优先级补充
  assert.equal(merged!.underline, 'underline');
  assert.equal(merged!.backgroundColor, '#FFC7CE');
});

test('resolveConditionalFormatting：显式空串阻止低优先级填充（例如高优清除加粗）', () => {
  const ctx = mkCtx({ A1: '200' });
  const rules: ConditionalFormattingRule[] = [
    mkRule({
      id: 'high', priority: 1,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { fontWeight: '' }, // 显式清除加粗
      ranges: [range(0, 0, 0, 0)],
    }),
    mkRule({
      id: 'low', priority: 2,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { fontWeight: 'bold' },
      ranges: [range(0, 0, 0, 0)],
    }),
  ];
  const merged = resolveConditionalFormatting(0, 0, rules, ctx);
  assert.ok(merged);
  assert.equal(merged!.fontWeight, ''); // 高优先级的显式 '' 应保留，而不是被低优先级 'bold' 覆盖
});

// =================================================================
// 十、引擎边缘语义：组合场景、多 range 选择清理、多规则交错
// =================================================================

test('selection 清理：多 range 规则部分裁剪后保留非重叠子 range', () => {
  const s = freshState();
  s.addConditionalFormatRule(mkRule({
    id: 'r1', condition: { type: 'blank' },
    ranges: [range(0, 0, 0, 2), range(2, 0, 2, 2), range(4, 0, 4, 2)], // A、C、E 各 3 行
  }));
  s.selection.value = range(0, 0, 2, 2); // 清除 A-C 列：命中 r1 的 A、C 两个 range
  s.clearConditionalFormats('selection');
  assert.equal(s.conditionalFormats.length, 1);
  // 只保留未相交的 E 列 range
  assert.deepEqual(s.conditionalFormats[0]!.ranges, [range(4, 0, 4, 2)]);
});

test('优先级排序：rules 乱序传入时 resolveConditionalFormatting 会先按 priority 升序', () => {
  const ctx = mkCtx({ A1: '200' });
  const rules: ConditionalFormattingRule[] = [
    mkRule({
      id: 'L', priority: 3, condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { color: '#0000FF' }, ranges: [range(0, 0, 0, 0)],
    }),
    mkRule({
      id: 'H', priority: 1, condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { color: '#FF0000' }, ranges: [range(0, 0, 0, 0)],
    }),
    mkRule({
      id: 'M', priority: 2, condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { color: '#00FF00' }, ranges: [range(0, 0, 0, 0)],
    }),
  ];
  const merged = resolveConditionalFormatting(0, 0, rules, ctx);
  assert.equal(merged!.color, '#FF0000'); // priority=1 的 H 获胜
});

test('组合：启用=false 与 stopIfTrue 不冲突（禁用规则不触发停止）', () => {
  const ctx = mkCtx({ A1: '200' });
  const rules: ConditionalFormattingRule[] = [
    mkRule({
      id: 'disabled', priority: 1, enabled: false, stopIfTrue: true,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { color: '#FF0000' }, ranges: [range(0, 0, 0, 0)],
    }),
    mkRule({
      id: 'works', priority: 2,
      condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
      format: { backgroundColor: '#FFC7CE' }, ranges: [range(0, 0, 0, 0)],
    }),
  ];
  const merged = resolveConditionalFormatting(0, 0, rules, ctx);
  assert.ok(merged);
  assert.equal(merged!.color, undefined); // disabled 被跳过
  assert.equal(merged!.backgroundColor, '#FFC7CE'); // works 正常生效
});

test('空 format 规则：condition 命中但 format 为空，返回空对象（与 Excel 一致：不改变渲染但仍触发 stopIfTrue）', () => {
  const ctx = mkCtx({ A1: '200' });
  const rule: ConditionalFormattingRule = mkRule({
    condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
    format: {},
    ranges: [range(0, 0, 0, 0)],
    stopIfTrue: true,
  });
  const next = mkRule({
    id: 'r2', priority: 2,
    condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
    format: { backgroundColor: '#0000FF' },
    ranges: [range(0, 0, 0, 0)],
  });
  const merged = resolveConditionalFormatting(0, 0, [rule, next], ctx);
  assert.deepEqual(merged, {}); // 只返回空对象，下一规则被 stopIfTrue 阻断
});

// =================================================================
// 十一、批量增删行/列（多行多列）
// =================================================================

test('插入多行：规则范围按插入条数整体下移', () => {
  const { s, sheetsOps } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '10' }, ranges: [range(0, 5, 2, 9)] }));
  sheetsOps.insertRows(1, 3); // 在第 1 行前插入 3 行（插入带 rows 1-3）
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(0, 8, 2, 12));
});

test('插入多列：规则范围按插入条数整体右移', () => {
  const { s, sheetsOps } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '10' }, ranges: [range(3, 0, 5, 4)] }));
  sheetsOps.insertCols(0, 2); // 在前 3 列前插入 3 列（cols 0-2 前插入 3 条，col 3-5 右移 3）
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(6, 0, 8, 4));
});

test('删除多行：上方删除带按条数整体上移', () => {
  const { s, sheetsOps } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '10' }, ranges: [range(0, 5, 0, 9)] }));
  sheetsOps.deleteRows(0, 2); // 删除 row 0-2（共 3 行）
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(0, 2, 0, 6));
});

test('删除多行：范围部分被删除时裁剪 + 下方上移', () => {
  const { s, sheetsOps } = fullStack();
  s.addConditionalFormatRule(mkRule({ condition: { type: 'cellIs', operator: 'greaterThan', value: '10' }, ranges: [range(0, 2, 0, 8)] }));
  sheetsOps.deleteRows(4, 6); // 删除 row 4-6（共 3 行），跨越范围中段
  assert.deepEqual(s.conditionalFormats[0]!.ranges[0], range(0, 2, 0, 5));
});

// =================================================================
// 十二、CF 缓存失效强度 + 公式依赖跨格联动（防御式回归）
// =================================================================

test('setCellValue 触发 CF 缓存失效：多次修改后 duplicate 统计始终一致', () => {
  const s = freshState();
  s.setCellValue(0, 0, 'a');
  s.setCellValue(0, 1, 'b');
  s.setCellValue(0, 2, 'c');
  s.addConditionalFormatRule(mkRule({
    condition: { type: 'duplicate' },
    ranges: [range(0, 0, 0, 2)],
    format: { backgroundColor: '#FFC7CE' },
  }));
  // 首次求值：每个值只出现一次 → 均不命中
  assert.equal(s.resolveConditionalFormat(0, 0), null);
  assert.equal(s.resolveConditionalFormat(0, 1), null);
  assert.equal(s.resolveConditionalFormat(0, 2), null);
  // 改 B1=b：b 出现两次
  s.setCellValue(0, 0, 'b');
  assert.ok(s.resolveConditionalFormat(0, 0));
  assert.ok(s.resolveConditionalFormat(0, 1));
  assert.equal(s.resolveConditionalFormat(0, 2), null);
  // 再改 C1=b：三列重复
  s.setCellValue(0, 2, 'b');
  assert.ok(s.resolveConditionalFormat(0, 0));
  assert.ok(s.resolveConditionalFormat(0, 1));
  assert.ok(s.resolveConditionalFormat(0, 2));
  // 再把三列各写回不同值：全部不命中
  s.setCellValue(0, 0, '1');
  s.setCellValue(0, 1, '2');
  s.setCellValue(0, 2, '3');
  assert.equal(s.resolveConditionalFormat(0, 0), null);
  assert.equal(s.resolveConditionalFormat(0, 1), null);
  assert.equal(s.resolveConditionalFormat(0, 2), null);
});

test('公式单元格被引用变化后，cellIs + resolveConditionalFormat 自动重算（不依赖手动失效）', () => {
  const s = freshState();
  s.setCellValue(0, 0, '2'); // A1
  s.setCellValue(1, 0, '=A1*50'); // B1 = 100
  s.addConditionalFormatRule(mkRule({
    condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
    ranges: [range(1, 0, 1, 0)],
  }));
  assert.equal(s.resolveConditionalFormat(1, 0), null); // =100 不大于
  s.setCellValue(0, 0, '3'); // B1 = 150
  assert.ok(s.resolveConditionalFormat(1, 0));
  s.setCellValue(0, 0, '1'); // B1 = 50
  assert.equal(s.resolveConditionalFormat(1, 0), null);
});

// =================================================================
// 十三、合并单元格渲染层的 CF 合成（锚点单元格承担整区域的文本属性合成）
// =================================================================

test('合并单元格：条件格式作用于锚点，resolveConditionalFormat 返回合成格式', () => {
  const { s, sheetsOps } = fullStack();
  void sheetsOps;
  // A1:B2 合并（手动写入 merges；锚点只有 A1 有值，渲染层绘制所有非锚点均以 (aC,aR) 为基准取 CF）
  s.setCellValue(0, 0, '150');
  s.cells['1,0'] = { value: '' };
  s.cells['0,1'] = { value: '' };
  s.cells['1,1'] = { value: '' };
  s.merges['0,0'] = range(0, 0, 1, 1) as any;
  s.addConditionalFormatRule(mkRule({
    condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
    ranges: [range(0, 0, 1, 1)],
    format: {
      backgroundColor: '#FFC7CE', color: '#9C0006',
      fontWeight: 'bold', fontStyle: 'italic', underline: 'underline', strikethrough: 'line-through',
    },
  }));
  const cf = s.resolveConditionalFormat(0, 0);
  assert.ok(cf);
  assert.equal(cf.backgroundColor, '#FFC7CE');
  assert.equal(cf.color, '#9C0006');
  assert.equal(cf.fontWeight, 'bold');
  assert.equal(cf.fontStyle, 'italic');
  assert.equal(cf.underline, 'underline');
  assert.equal(cf.strikethrough, 'line-through');
});

test('合并单元格：仅锚点持有值，但规则范围覆盖合并整体时锚点命中', () => {
  const { s } = fullStack();
  s.setCellValue(0, 0, '50');
  s.merges['0,0'] = range(0, 0, 2, 1) as any; // A1:C2 合并
  s.addConditionalFormatRule(mkRule({
    condition: { type: 'cellIs', operator: 'lessThan', value: '100' },
    ranges: [range(0, 0, 2, 1)],
    format: { backgroundColor: '#C6EFCE' },
  }));
  // 渲染层对合并块使用锚点 (aC, aR) 取 CF；锚点必须命中
  const anchorCf = s.resolveConditionalFormat(0, 0);
  assert.ok(anchorCf);
  assert.equal(anchorCf.backgroundColor, '#C6EFCE');
});

// =================================================================
// 十四、增删行列后规则的公式条件引用（Excel 语义：规则应用范围跟随行列增删平移/裁剪）
// =================================================================

test('插入列后规则范围右移，原数据处的 CF 仍跟随并命中', () => {
  const { s, sheetsOps } = fullStack();
  s.setCellValue(1, 2, '200'); // B3
  s.addConditionalFormatRule(mkRule({
    condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
    ranges: [range(1, 2, 1, 2)],
  }));
  assert.ok(s.resolveConditionalFormat(1, 2));
  sheetsOps.insertCols(0, 0); // 前面插入一列 → 规则向右扩展，B 列变 C 列
  // 原 B3 的值根据 insertCols 会被移动到 C3
  assert.equal(s.getCellValue(2, 2), '200');
  assert.ok(s.resolveConditionalFormat(2, 2));
});

// =================================================================
// 十五、多 Sheet 序列化：保存/切换后规则能恢复并继续生效
// =================================================================

test('多 Sheet：保存后切换 Sheet，conditionalFormats 持久化与恢复', () => {
  const { s, us, sheetsOps, modelData } = fullStack();
  void us; void modelData;
  s.setCellValue(0, 0, '150');
  s.addConditionalFormatRule(mkRule({
    id: 'sheet1_cf',
    condition: { type: 'cellIs', operator: 'greaterThan', value: '100' },
    ranges: [range(0, 0, 0, 0)],
    format: { backgroundColor: '#FFC7CE' },
  }));
  assert.equal(sheetsOps.sheets.value.length, 1);
  // 保存 Sheet1 再新建 Sheet2、切换
  sheetsOps.saveSheet();
  sheetsOps.addSheet('Sheet2');
  sheetsOps.loadSheet(1);
  assert.equal(s.conditionalFormats.length, 0); // Sheet2 无规则
  // 回到 Sheet1：规则恢复
  sheetsOps.loadSheet(0);
  assert.equal(s.conditionalFormats.length, 1);
  assert.equal(s.conditionalFormats[0]!.id, 'sheet1_cf');
  assert.ok(s.resolveConditionalFormat(0, 0));
});

// =================================================================
// 十六、公式条件的边界 / 组合：嵌套比较、= 前导与多格引用联动
// =================================================================

test('公式条件：IF 函数返回标量 + = 前导；引用多格 A1/B1 都能被解析', () => {
  const ctx = mkCtx({ A1: '150', B1: '50' });
  // A1>100 为真 → IF 取真分支 A1*2 = 300（非 0 → truthy）
  const rule = mkRule({
    condition: { type: 'formula', formula: '=IF(A1>100, A1*2, 0)' },
    ranges: [range(0, 0, 0, 0)],
  });
  assert.equal(evaluateCondition(rule.condition, 0, 0, ctx, ruleAnchor(rule)), true);
  // 真分支 0 → falsy；B1=50<100 为真 → 返回 0
  const rule2 = mkRule({
    condition: { type: 'formula', formula: 'IF(B1<100, 0, 1)' },
    ranges: [range(1, 0, 1, 0)],
  });
  assert.equal(evaluateCondition(rule2.condition, 1, 0, ctx, ruleAnchor(rule2)), false);
  // 比较表达式：$A$1+$B$1 算术和 200 > 100 → true（验证绝对引用 $ 被 tokenizer 正确识别）
  const rule3 = mkRule({
    condition: { type: 'formula', formula: '$A$1+$B$1>100' },
    ranges: [range(0, 0, 0, 0)],
  });
  assert.equal(evaluateCondition(rule3.condition, 0, 0, ctx, ruleAnchor(rule3)), true);
});

test('公式条件：列绝对引用 B$2 向下平移不改变行号', () => {
  // 规则作用于 B2:B4，公式 "=B$2>100"：行号固定为 2，对 B2/B3/B4 都以 B2 为准
  const ctx = mkCtx({ B2: '150', B3: '50', B4: '50' });
  const rule = mkRule({
    condition: { type: 'formula', formula: '=B$2>100' },
    ranges: [range(1, 1, 1, 3)],
  });
  const anchor = ruleAnchor(rule);
  assert.equal(evaluateCondition(rule.condition, 1, 1, ctx, anchor), true);
  assert.equal(evaluateCondition(rule.condition, 1, 2, ctx, anchor), true);
  assert.equal(evaluateCondition(rule.condition, 1, 3, ctx, anchor), true);
});
