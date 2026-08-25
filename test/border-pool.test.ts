import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BorderPool,
  getCellBorderSide,
  getCellBorder,
  setCellBorderSide,
  setCellBorder,
  clearCellBorder,
  migrateBordersInStyles,
  cleanupMergeInternalBorders,
} from '../src/components/spreader/core/border-pool';
import type { BorderStyle, BorderSide, CellData, CellStyle } from '../src/components/spreader/core/types';

// ============ BorderPool 基础 ============

test('BorderPool 初始化 borders[0] 为空边框', () => {
  const pool = new BorderPool();
  assert.deepEqual(pool.get(0), {});
  assert.deepEqual(pool.getBorders(), [{}]);
});

test('BorderPool.getId 去重：相同边框复用同一 id', () => {
  const pool = new BorderPool();
  const border: BorderStyle = { top: { width: 1, color: '#f00' } };
  const id1 = pool.getId(border);
  const id2 = pool.getId({ top: { width: 1, color: '#f00' } });
  assert.equal(id1, id2);
  assert.ok(id1 > 0);
});

test('BorderPool.getId 属性顺序不同但内容相同 → 复用', () => {
  const pool = new BorderPool();
  const id1 = pool.getId({ top: { width: 1 }, bottom: { width: 2 } });
  const id2 = pool.getId({ bottom: { width: 2 }, top: { width: 1 } });
  assert.equal(id1, id2);
});

test('BorderPool.getId 空边框返回 0', () => {
  const pool = new BorderPool();
  assert.equal(pool.getId({}), 0);
  assert.equal(pool.getId({ top: undefined, bottom: undefined }), 0);
});

test('BorderPool.get 返回冻结对象（不可变）', () => {
  const pool = new BorderPool();
  const id = pool.getId({ top: { width: 1, color: '#f00' } });
  const border = pool.get(id);
  assert.ok(Object.isFrozen(border));
  // 尝试修改不应影响池中数据
  assert.throws(() => {
    (border as BorderStyle).top = { width: 99 };
  });
});

test('BorderPool.get 无效 id 返回空边框', () => {
  const pool = new BorderPool();
  assert.deepEqual(pool.get(999), {});
});

test('BorderPool 构造时从已有 borders 恢复', () => {
  const existing: BorderStyle[] = [{}, { top: { width: 1 } }, { bottom: { width: 2 } }];
  const pool = new BorderPool(existing);
  assert.equal(pool.getBorders().length, 3);
  // 已有边框应能去重复用
  const id = pool.getId({ top: { width: 1 } });
  assert.equal(id, 1);
});

// ============ compactBorders GC ============

test('compactBorders 删除未引用的边框', () => {
  const pool = new BorderPool();
  const idA = pool.getId({ top: { width: 1 } });
  const idB = pool.getId({ bottom: { width: 2 } });
  const idC = pool.getId({ left: { width: 3 } });
  assert.ok(pool.getBorders().length === 4); // [{}] + A + B + C

  // 只引用 A 和 C
  const styles: CellStyle[] = [{}, { borderId: idA }, { borderId: idC }];
  const newBorders = pool.compactBorders(styles);
  // borders[0] + A + C = 3
  assert.equal(newBorders.length, 3);
  // id 被重新映射
  assert.equal(styles[1]!.borderId, 1);
  assert.equal(styles[2]!.borderId, 2);
});

test('compactBorders 保留 borders[0]', () => {
  const pool = new BorderPool();
  pool.getId({ top: { width: 1 } });
  const styles: CellStyle[] = [{}]; // 只引用默认
  const newBorders = pool.compactBorders(styles);
  assert.equal(newBorders.length, 1);
  assert.deepEqual(newBorders[0], {});
});

// ============ getBorders / setBorders 快照 ============

test('getBorders/setBorders 往返一致', () => {
  const pool = new BorderPool();
  pool.getId({ top: { width: 1 } });
  pool.getId({ bottom: { width: 2, color: '#f00' } });
  const snapshot = pool.getBorders();

  const pool2 = new BorderPool();
  pool2.setBorders(snapshot);
  assert.deepEqual(pool2.getBorders(), snapshot);
});

// ============ 辅助函数：读取 ============

function makeStylesAndPool(): { styles: CellStyle[]; pool: BorderPool; registerStyle: (s: CellStyle) => number } {
  const pool = new BorderPool();
  const styles: CellStyle[] = [{}];
  const styleIndex = new Map<string, number>();
  styleIndex.set('{}', 0);
  const registerStyle = (s: CellStyle) => {
    const key = JSON.stringify(Object.keys(s).sort().reduce((o, k) => { (o as any)[k] = (s as any)[k]; return o; }, {}));
    const existing = styleIndex.get(key);
    if (existing !== undefined) return existing;
    styles.push(s);
    const id = styles.length - 1;
    styleIndex.set(key, id);
    return id;
  };
  return { styles, pool, registerStyle };
}

test('getCellBorderSide 读取单元格某侧边框', () => {
  const { styles, pool } = makeStylesAndPool();
  const borderId = pool.getId({ top: { width: 1, color: '#f00' }, bottom: { width: 2 } });
  styles.push({ borderId });
  const cell: CellData = { value: '', styleId: 1 };
  assert.deepEqual(getCellBorderSide(cell, 'top', styles, pool), { width: 1, color: '#f00' });
  assert.deepEqual(getCellBorderSide(cell, 'bottom', styles, pool), { width: 2 });
  assert.equal(getCellBorderSide(cell, 'left', styles, pool), undefined);
});

test('getCellBorderSide 无 cell / 无 borderId → undefined', () => {
  const { styles, pool } = makeStylesAndPool();
  assert.equal(getCellBorderSide(undefined, 'top', styles, pool), undefined);
  const cell: CellData = { value: '', styleId: 0 };
  assert.equal(getCellBorderSide(cell, 'top', styles, pool), undefined);
});

// ============ 辅助函数：写入 ============

test('setCellBorderSide 设置单边不影响其他边', () => {
  const { styles, pool, registerStyle } = makeStylesAndPool();
  const cell: CellData = { value: 'x' };
  setCellBorderSide(cell, 'top', { width: 1, color: '#f00' }, styles, pool, registerStyle);
  assert.deepEqual(getCellBorderSide(cell, 'top', styles, pool), { width: 1, color: '#f00' });
  assert.equal(getCellBorderSide(cell, 'bottom', styles, pool), undefined);

  // 再设置 bottom
  setCellBorderSide(cell, 'bottom', { width: 2 }, styles, pool, registerStyle);
  assert.deepEqual(getCellBorderSide(cell, 'top', styles, pool), { width: 1, color: '#f00' });
  assert.deepEqual(getCellBorderSide(cell, 'bottom', styles, pool), { width: 2 });
});

test('setCellBorderSide 清除某边（传 undefined）', () => {
  const { styles, pool, registerStyle } = makeStylesAndPool();
  const cell: CellData = { value: 'x' };
  setCellBorderSide(cell, 'top', { width: 1 }, styles, pool, registerStyle);
  setCellBorderSide(cell, 'top', undefined, styles, pool, registerStyle);
  assert.equal(getCellBorderSide(cell, 'top', styles, pool), undefined);
});

test('setCellBorder 设置四边', () => {
  const { styles, pool, registerStyle } = makeStylesAndPool();
  const cell: CellData = { value: 'x' };
  const border: BorderStyle = {
    top: { width: 1 },
    right: { width: 1 },
    bottom: { width: 1 },
    left: { width: 1 },
  };
  setCellBorder(cell, border, styles, pool, registerStyle);
  assert.deepEqual(getCellBorder(cell, styles, pool), border);
});

test('clearCellBorder 清除所有边框', () => {
  const { styles, pool, registerStyle } = makeStylesAndPool();
  const cell: CellData = { value: 'x' };
  setCellBorder(cell, { top: { width: 1 }, bottom: { width: 2 } }, styles, pool, registerStyle);
  clearCellBorder(cell, styles, registerStyle);
  assert.equal(getCellBorder(cell, styles, pool), undefined);
});

test('setCellBorderSide 修改单边不影响共享相同 borderId 的其他单元格', () => {
  const { styles, pool, registerStyle } = makeStylesAndPool();
  const cellA: CellData = { value: 'a' };
  const cellB: CellData = { value: 'b' };
  // 两个单元格设置相同边框
  setCellBorderSide(cellA, 'top', { width: 1 }, styles, pool, registerStyle);
  setCellBorderSide(cellB, 'top', { width: 1 }, styles, pool, registerStyle);
  assert.equal(cellA.styleId, cellB.styleId); // 共享同一 style
  // 修改 A 的 bottom
  setCellBorderSide(cellA, 'bottom', { width: 2 }, styles, pool, registerStyle);
  // B 不应受影响
  assert.equal(getCellBorderSide(cellB, 'bottom', styles, pool), undefined);
  assert.deepEqual(getCellBorderSide(cellA, 'bottom', styles, pool), { width: 2 });
});

// ============ 迁移 ============

test('migrateBordersInStyles 迁移旧版边框属性', () => {
  const oldStyles: CellStyle[] = [
    {},
    { borderTopWidth: 1, borderBottomWidth: 2, borderColor: '#f00', fontSize: 12 },
    { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#0f0' },
    { fontSize: 14 }, // 无边框
  ];
  const { styles, borders } = migrateBordersInStyles(oldStyles);

  // 旧属性被清除
  assert.equal(styles[1]!.borderTopWidth, undefined);
  assert.equal(styles[1]!.borderColor, undefined);
  // fontSize 保留
  assert.equal(styles[1]!.fontSize, 12);
  assert.equal(styles[3]!.fontSize, 14);
  // borderId 被设置
  assert.ok(styles[1]!.borderId! > 0);
  assert.ok(styles[2]!.borderId! > 0);
  // 无边框样式不设 borderId
  assert.equal(styles[3]!.borderId, undefined);

  // borders 数组包含迁移后的边框
  const pool = new BorderPool(borders);
  const b1 = pool.get(styles[1]!.borderId!);
  assert.deepEqual(b1.top, { width: 1, color: '#f00' });
  assert.deepEqual(b1.bottom, { width: 2, color: '#f00' });
});

test('migrateBordersInStyles 去重相同边框', () => {
  const oldStyles: CellStyle[] = [
    { borderTopWidth: 1, borderColor: '#f00' },
    { borderTopWidth: 1, borderColor: '#f00' },
  ];
  const { styles, borders } = migrateBordersInStyles(oldStyles);
  // 两个相同边框应复用同一 borderId
  assert.equal(styles[0]!.borderId, styles[1]!.borderId);
  // borders = [{}] + 1 个去重后的边框
  assert.equal(borders.length, 2);
});

// ============ cleanupMergeInternalBorders ============

test('cleanupMergeInternalBorders 清除 merge 内部非 anchor 的边框', () => {
  const { styles, pool, registerStyle } = makeStylesAndPool();
  const cellKey = (c: number, r: number) => `${c},${r}`;
  const cells: Record<string, CellData> = {};
  // anchor (0,0) 有边框
  const anchorCell: CellData = { value: 'a' };
  setCellBorderSide(anchorCell, 'top', { width: 1 }, styles, pool, registerStyle);
  cells['0,0'] = anchorCell;
  // 内部 (1,0) 也有边框（应被清除）
  const innerCell: CellData = { value: 'b' };
  setCellBorderSide(innerCell, 'top', { width: 1 }, styles, pool, registerStyle);
  cells['1,0'] = innerCell;

  const merges = { '0,0': { startCol: 0, startRow: 0, endCol: 1, endRow: 0 } };
  cleanupMergeInternalBorders(cells, merges, styles, pool, cellKey, registerStyle);

  // anchor 边框保留
  assert.deepEqual(getCellBorderSide(cells['0,0'], 'top', styles, pool), { width: 1 });
  // 内部边框被清除
  assert.equal(getCellBorderSide(cells['1,0'], 'top', styles, pool), undefined);
});
