import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ref, type Ref } from 'vue';
import { createCoreState, type CoreState } from '../src/components/spreader/composables/core-state';
import { createUndoStyles } from '../src/components/spreader/composables/undo-styles';
import { createSheetsOps } from '../src/components/spreader/composables/sheets-ops';
import { createBordersMerge } from '../src/components/spreader/composables/borders-merge';
import type { BorderSideKey } from '../src/components/spreader/core/border-color';
import { resolveSharedBorder } from '../src/components/spreader/core/border-resolve';
import type { SheetState, SheetModelData, BorderStyle, BorderSide } from '../src/components/spreader/core/types';

// ============ 全栈测试辅助（core-state + undo-styles + sheets-ops + borders-merge） ============
function fullStack(colCount = 26, rowCount = 200) {
  const s = createCoreState(
    { colCount, rowCount },
    { colCount, rowCount, theme: 'light', locale: 'zh-CN' },
  );

  // 占位 sheetsCtx（spreader.vue 同款模式）
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

  // 替换占位为真实引用（saveSheet 会把 s.cells 同步进撤销快照）
  sheetsCtx.sheets = sheetsOps.sheets;
  sheetsCtx.activeSheetIndex = sheetsOps.activeSheetIndex;
  sheetsCtx.saveSheet = sheetsOps.saveSheet;
  sheetsCtx.loadSheet = sheetsOps.loadSheet;
  sheetsCtx.mkSheet = sheetsOps.mkSheet;

  const bm = createBordersMerge(s, us);
  return { s, us, bm };
}

/** 读取某坐标某条边的颜色（合并区重定向到 anchor），与渲染/解析共用同一重定向规则 */
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

function select(s: CoreState, c1: number, r1: number, c2: number, r2: number) {
  s.selectRange(c1, r1, c2, r2);
}

// =================================================================
test('边框颜色：单边 + 上色，且不创建原本不存在的边', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  bm.onBorderChange('top'); // 默认色（自动）
  assert.equal(sideWidth(s, 0, 0, 'top'), 1);
  assert.equal(sideColor(s, 0, 0, 'top'), undefined); // 自动

  bm.onBorderColorChange('#ff0000');
  assert.equal(sideColor(s, 0, 0, 'top'), '#ff0000');
  // bottom 不应被创建
  assert.equal(sideColor(s, 0, 0, 'bottom'), undefined);
});

test('边框颜色：点击边框类型按钮用当前笔刷色覆盖对应边（Excel 行为）', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  bm.cachedBorderColor.value = '#00ff00';
  bm.onBorderChange('all'); // 四边绿
  assert.equal(sideColor(s, 0, 0, 'top'), '#00ff00');
  assert.equal(sideWidth(s, 0, 0, 'top'), 1);

  // 改笔刷色为红，再点 thickOuter：对应四边被覆盖为红（线型变 2）
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('thickOuter');
  assert.equal(sideColor(s, 0, 0, 'top'), '#ff0000'); // 被当前笔刷色覆盖
  assert.equal(sideWidth(s, 0, 0, 'top'), 2); // 线型同步变
});

test('边框颜色：相邻共享边不同颜色，改一侧不覆盖另一侧', () => {
  const { s, bm } = fullStack();
  // A1 红，B1 蓝（各自 all）
  select(s, 0, 0, 0, 0);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('all');
  select(s, 1, 0, 1, 0);
  bm.cachedBorderColor.value = '#0000ff';
  bm.onBorderChange('all');
  assert.equal(sideColor(s, 0, 0, 'right'), '#ff0000');
  assert.equal(sideColor(s, 1, 0, 'left'), '#0000ff'); // 共享边另一侧

  // 仅选 A1 改色为绿
  select(s, 0, 0, 0, 0);
  bm.cachedBorderColor.value = '#008000';
  bm.onBorderColorChange('#008000');
  assert.equal(sideColor(s, 0, 0, 'right'), '#008000'); // A 改了
  assert.equal(sideColor(s, 1, 0, 'left'), '#0000ff'); // B 没被改
});

test('边框颜色：多选区（2 行）outer 各格独立上色', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 1); // A1:A2
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('outer');
  // 外框：A1.top / A2.bottom / A1.left / A2.left / A1.right / A2.right
  assert.equal(sideColor(s, 0, 0, 'top'), '#ff0000');
  assert.equal(sideColor(s, 0, 1, 'bottom'), '#ff0000');
  assert.equal(sideColor(s, 0, 0, 'left'), '#ff0000');
  assert.equal(sideColor(s, 0, 1, 'right'), '#ff0000');

  // 改色为蓝：仅外框边变化，内部共享边 (A1.bottom / A2.top) 不在 outer 作用域，保持原样
  bm.onBorderColorChange('#0000ff');
  assert.equal(sideColor(s, 0, 0, 'top'), '#0000ff');
  assert.equal(sideColor(s, 0, 1, 'bottom'), '#0000ff');
  assert.equal(sideColor(s, 0, 0, 'bottom'), undefined); // 内部边原本就不存在
});

test('边框颜色：合并单元格沿 anchor 存储，改色后锚点各边生效', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 1, 1);
  bm.mergeCells();
  const m = s.findMerge(1, 1);
  assert.ok(m, '应存在合并区域');

  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('outer'); // 仅 anchor 存边框
  assert.equal(sideColor(s, 0, 0, 'top'), '#ff0000'); // anchor 直接
  assert.equal(sideColor(s, 1, 1, 'top'), '#ff0000'); // 经重定向

  select(s, 0, 0, 1, 1);
  bm.cachedBorderColor.value = '#008000';
  bm.onBorderColorChange('#008000'); // 沿 anchor 改色
  assert.equal(sideColor(s, 0, 0, 'top'), '#008000');
  assert.equal(sideColor(s, 1, 1, 'top'), '#008000');
});

test('边框颜色：撤销/重做保留颜色状态', () => {
  const { s, us, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  bm.onBorderChange('all'); // 快照 #1：四边（自动色）
  assert.equal(sideColor(s, 0, 0, 'top'), undefined);
  assert.equal(sideWidth(s, 0, 0, 'top'), 1);

  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderColorChange('#ff0000'); // 快照 #2：四边红
  assert.equal(sideColor(s, 0, 0, 'top'), '#ff0000');

  us.undo(); // 撤销改色
  assert.equal(sideColor(s, 0, 0, 'top'), undefined); // 回到自动色
  assert.equal(sideWidth(s, 0, 0, 'top'), 1); // 线型仍在

  us.redo(); // 重做改色
  assert.equal(sideColor(s, 0, 0, 'top'), '#ff0000');
});

test('边框颜色：复制格式（styleId 携带颜色）', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('all');
  const srcStyleId = s.cells[s.cellKey(0, 0)]?.styleId;
  assert.ok(srcStyleId && srcStyleId > 0, '源格应有样式');

  // 将同一 styleId 应用到 B1（复制/格式刷的底层机制即复制 styleId）
  const keyB = s.cellKey(1, 0);
  s.cells[keyB] = { value: '', styleId: srcStyleId };
  assert.equal(sideColor(s, 1, 0, 'top'), '#ff0000');
  assert.equal(sideColor(s, 1, 0, 'left'), '#ff0000');
});

test('边框颜色：选色不创建不存在的边框', () => {
  const { s, bm } = fullStack();
  select(s, 2, 2, 2, 2);
  bm.onBorderChange('none'); // 清空（cachedBorder='none'，cell 被删除）
  assert.equal(s.cells[s.cellKey(2, 2)], undefined);

  // 手动把作用边框类型设为 'all'（模拟用户先选了「所有框线」但 cell 当前无边框）
  bm.cachedBorder.value = 'all';
  const before = Object.keys(s.cells).length;
  bm.onBorderColorChange('#123456'); // 不应创建任何边框/cell
  assert.equal(Object.keys(s.cells).length, before);
  assert.equal(s.cells[s.cellKey(2, 2)], undefined);
});

// ============ 回归：示例单元格已带边框但 pen=none（直接选中、未选过边框类型） ============
test('边框颜色：pen 为 none 仍给已存在的边框改色（修复示例单元格失效）', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 1, 1);
  bm.onBorderChange('all'); // 创建四边边框（默认自动色）
  // 模拟「选中已带边框的示例单元格，但尚未选过边框类型」：pen 复位为 none
  bm.cachedBorder.value = 'none';
  assert.equal(sideColor(s, 0, 0, 'top'), undefined); // 自动色（color 缺失）

  // 此时挑颜色：应作用于选区内所有已存在的边（不再被 short-circuit 跳过）
  select(s, 0, 0, 1, 1);
  bm.onBorderColorChange('#e60000');
  // 2x2 区块四角外框 + 内部边（'all' 逐格四边）均被重新上色
  assert.equal(sideColor(s, 0, 0, 'top'), '#e60000');
  assert.equal(sideColor(s, 0, 0, 'bottom'), '#e60000'); // 内部共享边同样上色
  assert.equal(sideColor(s, 1, 1, 'right'), '#e60000');
  assert.equal(sideColor(s, 0, 1, 'left'), '#e60000');
  // 选区之外不受影响
  assert.equal(sideColor(s, 2, 2, 'top'), undefined);
});

// ============ 回归：点击边框类型按钮用当前笔刷色覆盖已有边（Excel 行为） ============
test('边框颜色：点击边框项用当前笔刷色覆盖已有边（已有色 ≠ 笔刷色）', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  // 先用绿色画上边框
  bm.cachedBorderColor.value = '#00ff00';
  bm.onBorderChange('top');
  assert.equal(sideColor(s, 0, 0, 'top'), '#00ff00');
  // 改笔刷色为红（不重画），点「上边框」：应覆盖为红（而非保留绿）
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('top');
  assert.equal(sideColor(s, 0, 0, 'top'), '#ff0000', '应覆盖为当前笔刷色红');
  assert.equal(sideWidth(s, 0, 0, 'top'), 1);
});

test('边框颜色：自动笔刷色时点边框项覆盖为默认（无 color 字段）', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  bm.cachedBorderColor.value = '#123456';
  bm.onBorderChange('top');
  assert.equal(sideColor(s, 0, 0, 'top'), '#123456');
  // 笔刷色复位为自动，再点「上边框」：覆盖为自动（默认色渲染）
  bm.cachedBorderColor.value = '';
  bm.onBorderChange('top');
  assert.equal(sideColor(s, 0, 0, 'top'), undefined, '自动笔刷色应清掉 color 字段');
  assert.equal(sideWidth(s, 0, 0, 'top'), 1);
});

test('selBorderColor：pen 为 none 时仍反映选区统一边框颜色', () => {
  const { s, bm } = fullStack();
  select(s, 0, 0, 0, 0);
  bm.cachedBorderColor.value = '#123abc';
  bm.onBorderChange('all'); // 四边同色
  bm.cachedBorder.value = 'none'; // pen 复位
  assert.equal(bm.selBorderColor.value, '#123abc'); // 色板高亮应显示现有统一色
});

// ============ 修复：选区边框被相邻单元格旧 border 覆盖（req: owner 优先级） ============

/**
 * 写入一条「旧数据」边框（不带 owner），模拟相邻单元格在选区操作之前已存在的 border。
 * 不触碰相邻单元格的对向边，验证「不强制同步两侧数据」。
 */
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

/** 清除某格某条旧边（用于「相邻单元格取消边框」场景） */
function clearLegacySide(s: CoreState, col: number, row: number, side: BorderSideKey): void {
  const key = s.cellKey(col, row);
  const cell = s.cells[key];
  if (!cell) return;
  const oldStyle = s.resolveStyle(cell) ?? {};
  const oldBid = oldStyle.borderId ?? 0;
  const old = oldBid > 0 ? s.resolveBorder(oldBid) : {};
  const nb: BorderStyle = {};
  for (const k of ['top', 'right', 'bottom', 'left'] as BorderSideKey[]) {
    if (k !== side && old[k]) nb[k] = old[k];
  }
  const newBid = s.registerBorder(nb);
  const newStyle = { ...oldStyle };
  if (newBid === 0) delete newStyle.borderId;
  else newStyle.borderId = newBid;
  const newStyleId = s.registerStyle(newStyle);
  s.cells[key] = { value: cell.value ?? '', styleId: newStyleId || undefined };
}

/** 复刻渲染器 drawBorders 对公共边的解析调用，返回最终绘制颜色（owner 优先级生效处） */
function resolvedTopColor(s: CoreState, col: number, row: number): string | undefined {
  const above = s.getCellBorderSide(s.cells[s.cellKey(col, row - 1)], 'bottom');
  const own = s.getCellBorderSide(s.cells[s.cellKey(col, row)], 'top');
  return resolveSharedBorder(above, own)?.color;
}
function resolvedLeftColor(s: CoreState, col: number, row: number): string | undefined {
  const left = s.getCellBorderSide(s.cells[s.cellKey(col - 1, row)], 'right');
  const own = s.getCellBorderSide(s.cells[s.cellKey(col, row)], 'left');
  return resolveSharedBorder(left, own)?.color;
}
function resolvedBottomColor(s: CoreState, col: number, row: number): string | undefined {
  const own = s.getCellBorderSide(s.cells[s.cellKey(col, row)], 'bottom');
  const below = s.getCellBorderSide(s.cells[s.cellKey(col, row + 1)], 'top');
  return resolveSharedBorder(own, below)?.color;
}
function resolvedRightColor(s: CoreState, col: number, row: number): string | undefined {
  const own = s.getCellBorderSide(s.cells[s.cellKey(col, row)], 'right');
  const right = s.getCellBorderSide(s.cells[s.cellKey(col + 1, row)], 'left');
  return resolveSharedBorder(own, right)?.color;
}

test('修复：上方已有边框 + 设置选区上边框颜色 → 选区上边框优先', () => {
  const { s, bm } = fullStack();
  setLegacySide(s, 2, 1, 'bottom', { width: 1, color: '#0a0' }); // 相邻上方旧 border（绿，无 owner）
  select(s, 2, 2, 4, 4);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('top'); // 选区顶行上边框（红）
  assert.equal(resolvedTopColor(s, 3, 2), '#ff0000'); // 渲染应为选区红，而非旧绿
  assert.equal(sideColor(s, 3, 2, 'top'), '#ff0000');
  assert.equal(sideColor(s, 3, 2, 'top') !== undefined && (s.getCellBorderSide(s.cells[s.cellKey(3, 2)], 'top')?.owner), true, '选区操作边应带 owner');
});

test('修复：左侧已有边框 + 设置选区左边框颜色 → 选区左边框优先', () => {
  const { s, bm } = fullStack();
  setLegacySide(s, 1, 2, 'right', { width: 1, color: '#0a0' }); // 相邻左侧旧 border（绿）
  select(s, 2, 2, 4, 4);
  bm.cachedBorderColor.value = '#0000ff';
  bm.onBorderChange('left');
  assert.equal(resolvedLeftColor(s, 2, 2), '#0000ff');
});

test('修复：左侧/上方已有不同颜色且不同线型 → 本次操作边（更细）仍优先', () => {
  const { s, bm } = fullStack();
  setLegacySide(s, 2, 1, 'bottom', { width: 2, color: '#0a0' }); // 相邻上方粗绿旧 border
  select(s, 2, 2, 4, 4);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('top'); // 选区细红（width 1）
  const resolved = resolveSharedBorder(
    s.getCellBorderSide(s.cells[s.cellKey(3, 1)], 'bottom'),
    s.getCellBorderSide(s.cells[s.cellKey(3, 2)], 'top'),
  );
  assert.equal(resolved?.color, '#ff0000');
  assert.equal(resolved?.width, 1); // 使用选区边线宽
});

test('修复：同时设置选区外框颜色 → 四边均优先于相邻旧 border', () => {
  const { s, bm } = fullStack();
  setLegacySide(s, 2, 1, 'bottom', { width: 1, color: '#0a0' }); // 上
  setLegacySide(s, 1, 2, 'right', { width: 1, color: '#0a0' }); // 左
  setLegacySide(s, 2, 5, 'top', { width: 1, color: '#0a0' }); // 下
  setLegacySide(s, 5, 2, 'left', { width: 1, color: '#0a0' }); // 右
  select(s, 2, 2, 4, 4);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('outer');
  assert.equal(resolvedTopColor(s, 3, 2), '#ff0000');
  assert.equal(resolvedLeftColor(s, 2, 2), '#ff0000');
  assert.equal(resolvedBottomColor(s, 3, 4), '#ff0000');
  assert.equal(resolvedRightColor(s, 4, 3), '#ff0000');
});

test('修复：相邻单元格取消边框 → 选区边框仍显示，且未同步相邻数据', () => {
  const { s, bm } = fullStack();
  setLegacySide(s, 2, 1, 'bottom', { width: 1, color: '#0a0' });
  select(s, 2, 2, 4, 4);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('top');
  assert.equal(resolvedTopColor(s, 3, 2), '#ff0000');
  // 取消相邻上方单元格的 bottom（仅清旧边，不触碰选区边）
  clearLegacySide(s, 2, 1, 'bottom');
  assert.equal(resolvedTopColor(s, 3, 2), '#ff0000'); // 选区边仍显示
  assert.equal(sideColor(s, 3, 2, 'top'), '#ff0000'); // 选区数据未动
  assert.equal(sideColor(s, 2, 1, 'bottom'), undefined); // 相邻边确实被清除
});

test('修复：合并单元格 + 选区外框覆盖相邻旧 border', () => {
  const { s, bm } = fullStack();
  setLegacySide(s, 2, 1, 'bottom', { width: 1, color: '#0a0' }); // 合并区上方旧 border
  select(s, 2, 2, 3, 3);
  bm.mergeCells(); // anchor (2,2)
  select(s, 2, 2, 3, 3);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('outer');
  // 合并外框沿 anchor 存储，且带 owner → 解析时优先于相邻旧 border
  assert.equal(sideColor(s, 2, 2, 'top'), '#ff0000');
  assert.equal(s.getCellBorderSide(s.cells[s.cellKey(2, 2)], 'top')?.owner, true);
  assert.equal(resolvedTopColor(s, 2, 2), '#ff0000');
});

test('修复：撤销/重做 还原选区边框优先级', () => {
  const { s, us, bm } = fullStack();
  setLegacySide(s, 2, 1, 'bottom', { width: 1, color: '#0a0' });
  setLegacySide(s, 3, 1, 'bottom', { width: 1, color: '#0a0' });
  setLegacySide(s, 4, 1, 'bottom', { width: 1, color: '#0a0' });
  select(s, 2, 2, 4, 4);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('top');
  assert.equal(resolvedTopColor(s, 3, 2), '#ff0000');
  us.undo(); // 撤销选区操作 → 回到相邻旧 border
  assert.equal(resolvedTopColor(s, 3, 2), '#0a0');
  us.redo(); // 重做 → 选区边再次优先
  assert.equal(resolvedTopColor(s, 3, 2), '#ff0000');
});

test('修复：取消选区 / JSON 往返（重新加载）后，owner 仍驱动正确渲染', () => {
  const { s, bm } = fullStack();
  setLegacySide(s, 2, 1, 'bottom', { width: 1, color: '#0a0' });
  setLegacySide(s, 3, 1, 'bottom', { width: 1, color: '#0a0' });
  setLegacySide(s, 4, 1, 'bottom', { width: 1, color: '#0a0' });
  select(s, 2, 2, 4, 4);
  bm.cachedBorderColor.value = '#ff0000';
  bm.onBorderChange('top');
  assert.equal(resolvedTopColor(s, 3, 2), '#ff0000');

  // 取消选区：渲染结果应完全由持久化数据（owner）决定，不依赖临时 Canvas/选区状态
  s.selection.value = null;
  assert.equal(resolvedTopColor(s, 3, 2), '#ff0000');

  // 模拟「重新加载数据」：边框对象经 JSON 序列化/反序列化（owner 一并持久化）
  const reloadedOwn = JSON.parse(JSON.stringify(s.getCellBorderSide(s.cells[s.cellKey(3, 2)], 'top')));
  const reloadedAbove = JSON.parse(JSON.stringify(s.getCellBorderSide(s.cells[s.cellKey(3, 1)], 'bottom')));
  assert.equal(reloadedOwn.owner, true, 'owner 应随边框持久化');
  assert.equal(resolveSharedBorder(reloadedAbove, reloadedOwn)?.color, '#ff0000');
});

test('回归：选区外普通公共边（两侧均无 owner）→ 沿用既有渲染，行为不变', () => {
  const { s } = fullStack();
  // 两侧皆为旧数据（无 owner）：仅顶部单元格有 top，左侧有 bottom（模拟历史文档）
  setLegacySide(s, 2, 2, 'top', { width: 1, color: '#abcd' });
  setLegacySide(s, 2, 1, 'bottom', { width: 1, color: '#0a0' });
  // 两侧都无 owner → 沿用既有 first 优先（上方 bottom 优先），颜色不变
  assert.equal(resolvedTopColor(s, 2, 2), '#0a0');
});
