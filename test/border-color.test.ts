import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BORDER_COLOR,
  DARK_BORDER_COLOR,
  normalizeBorderColor,
  sameBorderColor,
  resolveBorderColor,
  hasBorderLine,
  withBorderColor,
  withBorderWidth,
  forEachBorderTarget,
  planBorderColorChanges,
  buildAllSidesBorder,
  resolveSelectionBorderColor,
  type BorderSideKey,
} from '../src/components/spreader/core/border-color';
import type { BorderType } from '../src/components/spreader/core/border-icon';
import type { SelectionRange, BorderSide, BorderStyle } from '../src/components/spreader/core/types';

// ============ 测试辅助 ============
type Store = {
  get: (col: number, row: number, side: BorderSideKey) => BorderSide | undefined;
  set: (col: number, row: number, side: BorderSideKey, v: BorderSide | undefined) => void;
  store: Record<string, BorderStyle>;
};

function makeStore(initial?: Record<string, BorderStyle>): Store {
  const store: Record<string, BorderStyle> = {};
  const src = initial ?? {};
  for (const k in src) store[k] = JSON.parse(JSON.stringify(src[k]!));
  return {
    get(col, row, side) {
      return store[`${col},${row}`]?.[side];
    },
    set(col, row, side, v) {
      const key = `${col},${row}`;
      if (!store[key]) store[key] = {};
      if (v) store[key]![side] = v;
      else delete store[key]![side];
    },
    store,
  };
}

/** 带合并重映射的 getSide：把 (mCol,mRow) 区域统一重定向到 anchor */
function mergeGetSide(
  base: Store,
  anchor: { col: number; row: number },
  range: { startCol: number; startRow: number; endCol: number; endRow: number },
): (col: number, row: number, side: BorderSideKey) => BorderSide | undefined {
  return (col, row, side) => {
    const inMerge = col >= range.startCol && col <= range.endCol && row >= range.startRow && row <= range.endRow;
    const c = inMerge ? anchor.col : col;
    const r = inMerge ? anchor.row : row;
    return base.get(c, r, side);
  };
}

// ============ 颜色基础 ============
test('normalizeBorderColor: 空/空白/非字符串 → undefined（自动色）', () => {
  assert.equal(normalizeBorderColor(''), undefined);
  assert.equal(normalizeBorderColor('   '), undefined);
  assert.equal(normalizeBorderColor(undefined), undefined);
  assert.equal(normalizeBorderColor(null), undefined);
  assert.equal(normalizeBorderColor('#ABC'), '#ABC');
});

test('sameBorderColor: 大小写不敏感；空与 undefined 视为同一自动值', () => {
  assert.equal(sameBorderColor('#FFF', '#fff'), true);
  assert.equal(sameBorderColor('', undefined), true);
  assert.equal(sameBorderColor(undefined, ''), true);
  assert.equal(sameBorderColor('#f00', '#0f0'), false);
});

test('resolveBorderColor: 自动 → 主题默认色（light #444 / dark #aaa）', () => {
  assert.equal(resolveBorderColor(undefined), DEFAULT_BORDER_COLOR);
  assert.equal(resolveBorderColor(undefined, 'light'), DEFAULT_BORDER_COLOR);
  assert.equal(resolveBorderColor(undefined, 'dark'), DARK_BORDER_COLOR);
  assert.equal(resolveBorderColor('#abc'), '#abc');
  assert.equal(resolveBorderColor('#abc', 'dark'), '#abc');
});

test('hasBorderLine: 仅 width>0 视为有边框', () => {
  assert.equal(hasBorderLine(undefined), false);
  assert.equal(hasBorderLine({ width: 0 }), false);
  assert.equal(hasBorderLine({ width: 1 }), true);
  assert.equal(hasBorderLine({ width: 1, color: '#f00' }), true);
});

// ============ 单边派生：颜色与线型解耦 ============
test('withBorderColor: 仅替换 color，保留 width/style；空串删除 color', () => {
  const side: BorderSide = { width: 2, color: '#f00', style: 'dashed' };
  const next = withBorderColor(side, '#00f');
  assert.deepEqual(next, { width: 2, color: '#00f', style: 'dashed' });
  const cleared = withBorderColor(side, '');
  assert.deepEqual(cleared, { width: 2, style: 'dashed' }); // color 被删除
  assert.equal('color' in cleared, false);
});

test('withBorderWidth: 保留已有 color；新边才用 fallback；无 fallback 则不写 color', () => {
  // 已有颜色 → 保留
  const existing: BorderSide = { width: 1, color: '#f00' };
  assert.deepEqual(withBorderWidth(existing, 2, '#00f'), { width: 2, color: '#f00' });

  // 新建边（undefined）且无 fallback → 无 color
  assert.deepEqual(withBorderWidth(undefined, 1, undefined), { width: 1 });

  // 新建边且有 fallback → 用 fallback
  assert.deepEqual(withBorderWidth(undefined, 1, '#0f0'), { width: 1, color: '#0f0' });

  // 已有边但无 color + fallback → 用 fallback（补齐默认色）
  assert.deepEqual(withBorderWidth({ width: 1 }, 1, '#0f0'), { width: 1, color: '#0f0' });
});

// ============ 作用边枚举 ============
test("forEachBorderTarget: 'all' 覆盖选区每格四条边", () => {
  const hits: string[] = [];
  forEachBorderTarget('all', { startCol: 0, startRow: 0, endCol: 1, endRow: 1 }, ({ col, row, side }) => {
    hits.push(`${col},${row},${side}`);
  });
  assert.equal(hits.length, 16); // 2x2 x 4 边
});

test("forEachBorderTarget: 'outer' 仅外轮廓四边", () => {
  const hits: string[] = [];
  forEachBorderTarget('outer', { startCol: 0, startRow: 0, endCol: 1, endRow: 1 }, ({ col, row, side }) => {
    hits.push(`${col},${row},${side}`);
  });
  // 2*top + 2*bottom + 2*left + 2*right
  assert.equal(hits.length, 8);
  assert.ok(hits.includes('0,0,top') && hits.includes('1,1,bottom') && hits.includes('0,0,left') && hits.includes('1,0,right'));
  assert.ok(!hits.includes('0,1,top')); // 内部行上边不算外框
});

test("forEachBorderTarget: 单边只命中选区边界上的那条边", () => {
  const hits: string[] = [];
  forEachBorderTarget('top', { startCol: 0, startRow: 0, endCol: 2, endRow: 3 }, ({ col, row, side }) => {
    hits.push(`${col},${row},${side}`);
  });
  assert.equal(hits.length, 3); // 仅第 0 行三列
  assert.ok(hits.every((h) => h.endsWith(',top')));
  assert.ok(!hits.some((h) => h.startsWith('0,1,')));
});

test("forEachBorderTarget: 'none' 不产生任何作用边", () => {
  let n = 0;
  forEachBorderTarget('none', { startCol: 0, startRow: 0, endCol: 2, endRow: 2 }, () => { n++; });
  assert.equal(n, 0);
});

test('forEachBorderTarget: 合并单元格经 getSide 重定向到 anchor（不在此展开）', () => {
  const base = makeStore({ '0,0': { top: { width: 1 }, left: { width: 1 } } });
  const get = mergeGetSide(base, { col: 0, row: 0 }, { startCol: 0, startRow: 0, endCol: 1, endRow: 1 });
  // 选整个合并区域，读取 (1,1) 的 top 应重定向到 anchor(0,0).top
  assert.deepEqual(get(1, 1, 'top'), { width: 1 });
});

// ============ 改色计划：不创建新边框、不产生无效写入、每条边独立 ============
test('planBorderColorChanges: 只命中已存在边框，绝不创建新边框', () => {
  const base = makeStore({
    '0,0': { top: { width: 1, color: '#f00' }, right: { width: 1, color: '#f00' } },
  });
  const writes = planBorderColorChanges(
    'all',
    { startCol: 0, startRow: 0, endCol: 0, endRow: 0 },
    '#00f',
    (c, r, s) => base.get(c, r, s),
  );
  // 只有 top / right（已存在），bottom / left 不存在 → 不创建
  assert.equal(writes.length, 2);
  const sides = writes.map((w) => w.side).sort();
  assert.deepEqual(sides, ['right', 'top']);
});

test('planBorderColorChanges: 颜色无变化时不产生写入', () => {
  const base = makeStore({ '0,0': { top: { width: 1, color: '#f00' } } });
  const writes = planBorderColorChanges(
    'all',
    { startCol: 0, startRow: 0, endCol: 0, endRow: 0 },
    '#f00',
    (c, r, s) => base.get(c, r, s),
  );
  assert.equal(writes.length, 0);
});

test('planBorderColorChanges: 不同颜色共享边，每格各改各的，互不覆盖', () => {
  // A(0,0).right 与 B(1,0).left 是同一视觉共享边，但各自独立存储
  const base = makeStore({
    '0,0': { right: { width: 1, color: '#f00' } },
    '1,0': { left: { width: 1, color: '#00f' } },
  });
  const get = (c: number, r: number, s: BorderSideKey) => base.get(c, r, s);
  // 选 A 一格并改色为绿
  const writesA = planBorderColorChanges(
    'all',
    { startCol: 0, startRow: 0, endCol: 0, endRow: 0 },
    '#0f0',
    get,
  );
  for (const w of writesA) base.set(w.col, w.row, w.side, w.next);
  // A.right 变绿，B.left 仍蓝（未被触及）
  assert.equal(base.get(0, 0, 'right')?.color, '#0f0');
  assert.equal(base.get(1, 0, 'left')?.color, '#00f');
});

test('planBorderColorChanges: 仅写入「当前作用边」，不会越界改写相邻格', () => {
  const base = makeStore({
    '0,0': { top: { width: 1, color: '#f00' }, bottom: { width: 1, color: '#f00' } },
    '0,1': { top: { width: 1, color: '#f00' } }, // 与 (0,0).bottom 共享的边
  });
  // 仅选 (0,0) 的 'top' 改色
  const writes = planBorderColorChanges(
    'top',
    { startCol: 0, startRow: 0, endCol: 0, endRow: 0 },
    '#abc',
    (c, r, s) => base.get(c, r, s),
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.side, 'top');
  // 应用后：(0,1).top 不应被改动
  for (const w of writes) base.set(w.col, w.row, w.side, w.next);
  assert.equal(base.get(0, 1, 'top')?.color, '#f00');
});

// ============ 整格替换保留已有颜色 ============
test('buildAllSidesBorder: 逐边保留已有颜色，仅改 width', () => {
  const base = makeStore({
    '0,0': { top: { width: 1, color: '#f00' }, left: { width: 2, color: '#00f' } },
  });
  const border = buildAllSidesBorder(0, 0, 1, '#default', (c, r, s) => base.get(c, r, s));
  assert.equal(border.top?.color, '#f00');
  assert.equal(border.left?.color, '#00f');
  assert.equal(border.top?.width, 1); // 本就存在的边 width 不变
  assert.equal(border.right?.color, '#default'); // 新建边用 fallback
  assert.equal(border.right?.width, 1);
});

// ============ 选区统一颜色解析 ============
test('resolveSelectionBorderColor: 全部一致 → 返回该色', () => {
  const base = makeStore({
    '0,0': { top: { width: 1, color: '#f00' }, bottom: { width: 1, color: '#f00' } },
    '1,0': { left: { width: 1, color: '#f00' } },
  });
  const color = resolveSelectionBorderColor(
    'all',
    { startCol: 0, startRow: 0, endCol: 1, endRow: 0 },
    (c, r, s) => base.get(c, r, s),
  );
  assert.equal(color, '#f00');
});

test('resolveSelectionBorderColor: 颜色混合 → undefined（UI 按未选中处理）', () => {
  const base = makeStore({
    '0,0': { top: { width: 1, color: '#f00' } },
    '1,0': { top: { width: 1, color: '#00f' } },
  });
  assert.equal(
    resolveSelectionBorderColor('all', { startCol: 0, startRow: 0, endCol: 1, endRow: 0 }, (c, r, s) => base.get(c, r, s)),
    undefined,
  );
});

test('resolveSelectionBorderColor: 作用域内无边框 → undefined（自动）', () => {
  const base = makeStore({});
  assert.equal(
    resolveSelectionBorderColor('all', { startCol: 0, startRow: 0, endCol: 1, endRow: 1 }, (c, r, s) => base.get(c, r, s)),
    undefined,
  );
});
