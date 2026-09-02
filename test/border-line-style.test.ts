import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ref, type Ref } from 'vue';
import { createCoreState, type CoreState } from '../src/components/spreader/composables/core-state';
import { createUndoStyles } from '../src/components/spreader/composables/undo-styles';
import { createSheetsOps } from '../src/components/spreader/composables/sheets-ops';
import { createBordersMerge } from '../src/components/spreader/composables/borders-merge';
import type { BorderSideKey } from '../src/components/spreader/core/border-color';
import { resolveSharedBorder } from '../src/components/spreader/core/border-resolve';
import { normalizeBorderLineStyle, type BorderLineStyle } from '../src/components/spreader/core/border-style';
import type { SheetState, SheetModelData, BorderStyle, BorderSide } from '../src/components/spreader/core/types';

// ============ 全栈测试辅助（与 border-color-integration 同款） ============
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
      conditionalFormats: [], dataValidations: [], rowOutlines: [], columnOutlines: [], notes: {},
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

  const bm = createBordersMerge(s, us);
  return { s, us, bm };
}

// ============ 读取辅助 ============
function sideColor(s: CoreState, col: number, row: number, side: BorderSideKey): string | undefined {
  const m = s.findMerge(col, row);
  const key = m ? m.anchor : s.cellKey(col, row);
  const cell = s.cells[key];
  return s.getCellBorderSide(cell, side)?.color;
}
function sideWidth(s: CoreState, col: number, row: number, side: BorderSideKey): number | undefined {
  const m = s.findMerge(col, row);
  const key = m ? m.anchor : s.cellKey(col, row);
  const cell = s.cells[key];
  return s.getCellBorderSide(cell, side)?.width;
}
/** 读取某坐标某条边的线型（旧数据缺省 solid） */
function sideLineStyle(s: CoreState, col: number, row: number, side: BorderSideKey): BorderLineStyle {
  const m = s.findMerge(col, row);
  const key = m ? m.anchor : s.cellKey(col, row);
  const cell = s.cells[key];
  return normalizeBorderLineStyle(s.getCellBorderSide(cell, side)?.style);
}
/** 读取原始 style 字段（用于验证 solid 时字段是否被删除） */
function sideRawStyle(s: CoreState, col: number, row: number, side: BorderSideKey): string | undefined {
  const m = s.findMerge(col, row);
  const key = m ? m.anchor : s.cellKey(col, row);
  const cell = s.cells[key];
  return s.getCellBorderSide(cell, side)?.style;
}

function select(s: CoreState, c1: number, r1: number, c2: number, r2: number) {
  s.selectRange(c1, r1, c2, r2);
}

// ============ 公共边解析辅助（复刻渲染器 drawBorders） ============
function resolvedTopStyle(s: CoreState, col: number, row: number): BorderLineStyle {
  const above = s.getCellBorderSide(s.cells[s.cellKey(col, row - 1)], 'bottom');
  const own = s.getCellBorderSide(s.cells[s.cellKey(col, row)], 'top');
  return normalizeBorderLineStyle(resolveSharedBorder(above, own)?.style);
}
function resolvedLeftStyle(s: CoreState, col: number, row: number): BorderLineStyle {
  const left = s.getCellBorderSide(s.cells[s.cellKey(col - 1, row)], 'right');
  const own = s.getCellBorderSide(s.cells[s.cellKey(col, row)], 'left');
  return normalizeBorderLineStyle(resolveSharedBorder(left, own)?.style);
}
function resolvedLeftColor(s: CoreState, col: number, row: number): string | undefined {
  const left = s.getCellBorderSide(s.cells[s.cellKey(col - 1, row)], 'right');
  const own = s.getCellBorderSide(s.cells[s.cellKey(col, row)], 'left');
  return resolveSharedBorder(left, own)?.color;
}
function resolvedTopColor(s: CoreState, col: number, row: number): string | undefined {
  const above = s.getCellBorderSide(s.cells[s.cellKey(col, row - 1)], 'bottom');
  const own = s.getCellBorderSide(s.cells[s.cellKey(col, row)], 'top');
  return resolveSharedBorder(above, own)?.color;
}

/** 写入一条「旧数据」边框（不带 owner），模拟相邻单元格在选区操作之前已存在的 border */
function setLegacySide(s: CoreState, col: number, row: number, side: BorderSideKey, border: BorderSide | undefined): void {
  const b: BorderStyle = {};
  if (border) b[side] = border;
  const bid = s.registerBorder(b);
  const key = s.cellKey(col, row);
  const cell = s.cells[key] ?? { value: '' };
  const oldStyle = s.resolveStyle(cell) ?? {};
  const st = { ...oldStyle };
  if (bid === 0) delete st.borderId;
  else st.borderId = bid;
  const styleId = s.registerStyle(st);
  s.cells[key] = { value: cell.value ?? '', styleId: styleId || undefined };
}

/** 一次性写入一个单元格的完整旧数据边框（多侧），避免逐侧 setLegacySide 互相覆盖 */
function setLegacyBorders(s: CoreState, col: number, row: number, border: BorderStyle): void {
  const bid = s.registerBorder(border);
  const key = s.cellKey(col, row);
  const cell = s.cells[key] ?? { value: '' };
  const oldStyle = s.resolveStyle(cell) ?? {};
  const st = { ...oldStyle };
  if (bid === 0) delete st.borderId;
  else st.borderId = bid;
  const styleId = s.registerStyle(st);
  s.cells[key] = { value: cell.value ?? '', styleId: styleId || undefined };
}

// ============ 测试 ============

test('线型：单边改线型不影响颜色，且不创建不存在的边', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  bm.onBorderChange('top'); // 默认实线
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'solid');
  assert.equal(sideRawStyle(s, 0, 0, 'top'), undefined, 'solid 不应残留 style 字段');

  bm.onBorderLineStyleChange('dashed');
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'dashed');
  assert.equal(sideRawStyle(s, 0, 0, 'top'), 'dashed');
  // bottom 不应被创建
  assert.equal(sideColor(s, 0, 0, 'bottom'), undefined);
  assert.equal(sideWidth(s, 0, 0, 'bottom'), undefined);
});

test('线型：多选区 outer 各格外框边均改线型', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 1); // A1:A2
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('outer');
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'solid');
  assert.equal(sideLineStyle(s, 0, 1, 'bottom'), 'solid');

  bm.onBorderLineStyleChange('dotted');
  // 外框四条边全部变点线
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'dotted');
  assert.equal(sideLineStyle(s, 0, 1, 'bottom'), 'dotted');
  assert.equal(sideLineStyle(s, 0, 0, 'left'), 'dotted');
  assert.equal(sideLineStyle(s, 0, 1, 'right'), 'dotted');
  // 内部共享边未被 outer 命中
  assert.equal(sideWidth(s, 0, 0, 'bottom'), undefined);
});

test('线型：改线型不覆盖已有颜色（解耦）', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('all'); // 四边红、实线
  assert.equal(sideColor(s, 0, 0, 'top'), '#ff0000');
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'solid');

  bm.onBorderLineStyleChange('dashed');
  // 四边线型变虚线
  for (const side of ['top', 'right', 'bottom', 'left'] as BorderSideKey[]) {
    assert.equal(sideLineStyle(s, 0, 0, side), 'dashed', `${side} 应虚线`);
    assert.equal(sideColor(s, 0, 0, side), '#ff0000', `${side} 颜色应保留红`);
    assert.equal(sideWidth(s, 0, 0, side), 1, `${side} 线宽应保留 1`);
  }
});

test('线型：相邻公共边 + 应用虚线 → 本次操作边（带 owner）优先', () => {
  const { s, bm } = fullStack();
  setLegacySide(s, 2, 1, 'bottom', { width: 1, color: '#0a0' }); // 相邻上方旧 border（绿、solid、无 owner）
  select(s, 2, 2, 4, 4);
  bm.cachedBorderLineStyle.value = 'dashed'; // 预设默认线型
  bm.cachedBorderColor.value = '#ff0000'; // 预设笔刷色
  bm.onBorderChange('top'); // 选区顶行上边框（虚线红）
  assert.equal(resolvedTopStyle(s, 3, 2), 'dashed', '渲染应为选区虚线，而非旧 solid');
  assert.equal(resolvedTopColor(s, 3, 2), '#ff0000', '选区上边框颜色应随笔刷色');
  assert.equal(sideRawStyle(s, 3, 2, 'top'), 'dashed');
  assert.equal(s.getCellBorderSide(s.cells[s.cellKey(3, 2)], 'top')?.owner, true, '选区操作边应带 owner');
});

test('线型：合并单元格沿 anchor 存储改线型', () => {
  const { s, bm } = fullStack();
  select(s, 2, 2, 3, 3);
  bm.mergeCells(); // anchor (2,2)
  select(s, 2, 2, 3, 3);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('outer'); // 仅 anchor 存边框
  assert.equal(sideLineStyle(s, 2, 2, 'top'), 'solid');
  assert.equal(sideLineStyle(s, 3, 3, 'top'), 'solid'); // 经重定向

  select(s, 2, 2, 3, 3);
  bm.onBorderLineStyleChange('dashed'); // 沿 anchor 改线型
  assert.equal(sideLineStyle(s, 2, 2, 'top'), 'dashed'); // anchor 直接
  assert.equal(sideLineStyle(s, 3, 3, 'top'), 'dashed'); // 经重定向
  assert.equal(sideColor(s, 2, 2, 'top'), '#ff0000', '合并外框颜色仍保留');
});

test('线型：撤销/重做保留线型状态', () => {
  const { s, us, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  bm.onBorderChange('all'); // 快照 #1：四边（solid）
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'solid');

  bm.onBorderLineStyleChange('dashed'); // 快照 #2：四边虚线
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'dashed');

  us.undo(); // 撤销改线型
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'solid');
  assert.equal(sideRawStyle(s, 0, 0, 'top'), undefined, '回到 solid 后不应残留 style 字段');

  us.redo(); // 重做改线型
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'dashed');
});

test('线型：复制格式（styleId 携带线型）', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  bm.cachedBorderLineStyle.value = 'dashed';
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('all');
  const srcStyleId = s.cells[s.cellKey(0, 0)]?.styleId;
  assert.ok(srcStyleId && srcStyleId > 0, '源格应有样式');

  // 将同一 styleId 应用到 B1（复制/格式刷的底层机制即复制 styleId）
  const keyB = s.cellKey(1, 0);
  s.cells[keyB] = { value: '', styleId: srcStyleId };
  assert.equal(sideLineStyle(s, 1, 0, 'top'), 'dashed');
  assert.equal(sideLineStyle(s, 1, 0, 'left'), 'dashed');
  assert.equal(sideColor(s, 1, 0, 'top'), '#ff0000');
});

test('线型：颜色与线型独立修改（两种顺序）', () => {
  const { s, bm } = fullStack();

  // 顺序 A：先色后线型
  select(s, 0, 0, 0, 0);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('all');
  bm.onBorderLineStyleChange('dashed');
  assert.equal(sideColor(s, 0, 0, 'top'), '#ff0000');
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'dashed');

  // 顺序 B：先线型后色（另选一格）
  select(s, 2, 0, 2, 0);
  bm.cachedBorderLineStyle.value = 'dotted';
  bm.cachedBorderColor.value = '';
  bm.onBorderChange('all'); // 点线、自动色
  assert.equal(sideLineStyle(s, 2, 0, 'top'), 'dotted');
  assert.equal(sideColor(s, 2, 0, 'top'), undefined);
  bm.cachedBorderColor.value = '#0000ff';
  bm.onBorderColorChange('#0000ff'); // 改色不应动线型
  assert.equal(sideLineStyle(s, 2, 0, 'top'), 'dotted', '改色后线型仍为点线');
  assert.equal(sideColor(s, 2, 0, 'top'), '#0000ff');
});

test('线型：选线型不创建不存在的边框（需求 5）', () => {
  const { s, bm } = fullStack();
  select(s, 2, 2, 2, 2);
  // 该格无任何边框
  const before = Object.keys(s.cells).length;
  bm.onBorderLineStyleChange('dashed'); // 不应创建任何边框/cell
  assert.equal(Object.keys(s.cells).length, before);
  assert.equal(s.cells[s.cellKey(2, 2)], undefined);
  // 但默认线型已更新
  assert.equal(bm.cachedBorderLineStyle.value, 'dashed');
});

test('线型：默认线型应用到后续绘制操作（需求 4）', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  // 先选点线（此时无边框，仅更新默认线型）
  bm.onBorderLineStyleChange('dotted');
  assert.equal(bm.cachedBorderLineStyle.value, 'dotted');
  // 随后点「上边框」：新创建的边应带点线
  select(s, 0, 0, 0, 0);
  bm.onBorderChange('top');
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'dotted');
  assert.equal(sideRawStyle(s, 0, 0, 'top'), 'dotted');
});

test('线型：solid 回退会删除 style 字段（旧数据兼容）', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  bm.onBorderChange('all');
  bm.onBorderLineStyleChange('dashed');
  assert.equal(sideRawStyle(s, 0, 0, 'top'), 'dashed');
  // 改回实线：style 字段应被删除，而不是写成 'solid'
  bm.onBorderLineStyleChange('solid');
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'solid');
  assert.equal(sideRawStyle(s, 0, 0, 'top'), undefined, 'solid 不应残留 style 字段');
});

test('旧数据：缺省 solid；selBorderLineStyle 行为正确', () => {
  const { s, bm } = fullStack();
  // 写入一条旧数据边框（无 style 字段）
  setLegacySide(s, 0, 0, 'top', { width: 1, color: '#0a0' });
  assert.equal(sideRawStyle(s, 0, 0, 'top'), undefined, '旧数据无 style 字段');
  assert.equal(sideLineStyle(s, 0, 0, 'top'), 'solid', '旧数据按 solid 处理');

  // 仅单边有边框：selBorderLineStyle 应反映现存边的统一 solid
  select(s, 0, 0, 0, 0);
  assert.equal(bm.selBorderLineStyle.value, 'solid', '单边 solid 应高亮 solid');

  // 不同线型混在多个已存在边上 → 混合返回 ''
  setLegacyBorders(s, 0, 0, {
    top: { width: 1, color: '#0a0' }, // 无 style → solid
    left: { width: 1, color: '#0a0', style: 'dashed' },
  });
  select(s, 0, 0, 0, 0);
  assert.equal(bm.selBorderLineStyle.value, '', 'top(solid) 与 left(dashed) 混合应返回空');
});

test('线型：相邻旧 border 无 owner，本次虚线操作仍优先（线型与颜色解耦）', () => {
  const { s, bm } = fullStack();
  setLegacySide(s, 1, 2, 'right', { width: 1, color: '#0a0', style: 'dotted' }); // 相邻左侧点线绿
  select(s, 2, 2, 4, 4);
  bm.cachedBorderLineStyle.value = 'dashed';
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('left');
  // 选区左边框为虚线红（本次操作），而非相邻点线绿
  assert.equal(resolvedLeftStyle(s, 2, 2), 'dashed');
  assert.equal(resolvedLeftColor(s, 2, 2), '#ff0000', '选区左边框应含笔刷红色');
  assert.equal(s.getCellBorderSide(s.cells[s.cellKey(2, 2)], 'left')?.owner, true);
});
