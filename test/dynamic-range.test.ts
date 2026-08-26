import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCoreState } from '../src/components/spreader/composables/core-state';
import { colToLabel, labelToCol, parseCellRef } from '../src/components/spreader/core/utils';

function freshState(colCount = 26, rowCount = 200) {
  return createCoreState(
    { colCount, rowCount },
    { colCount, rowCount, theme: 'light', locale: 'zh-CN' },
  );
}

test('初始逻辑范围取 props 默认（26/200）', () => {
  const s = freshState();
  assert.equal(s.colCount, 26);
  assert.equal(s.rowCount, 200);
  assert.equal(s.colWidths.value.length, 26);
  assert.equal(s.rowHeights.value.length, 200);
});

test('ensureCapacity 超过当前范围时扩展 dims 与尺寸数组，不创建空 Cell', () => {
  const s = freshState();
  const beforeCells = Object.keys(s.cells).length;
  s.ensureCapacity(30, 250);
  assert.ok(s.colCount >= 31, `colCount 应至少扩到 31，实际 ${s.colCount}`);
  assert.ok(s.rowCount >= 251, `rowCount 应至少扩到 251，实际 ${s.rowCount}`);
  assert.equal(s.colWidths.value.length, s.colCount);
  assert.equal(s.rowHeights.value.length, s.rowCount);
  assert.equal(Object.keys(s.cells).length, beforeCells);
});

test('ensureCapacity 不收缩范围，低于当前值时保持不变', () => {
  const s = freshState();
  s.ensureCapacity(30, 250);
  const col = s.colCount;
  const row = s.rowCount;
  s.ensureCapacity(5, 5);
  assert.equal(s.colCount, col);
  assert.equal(s.rowCount, row);
});

test('ensureCapacity 不写 cells，扩展后空白格仍为 0 条目', () => {
  const s = freshState();
  s.setCellValue(0, 0, 'A1');
  assert.equal(Object.keys(s.cells).length, 1);
  s.ensureCapacity(5000, 5000);
  assert.equal(Object.keys(s.cells).length, 1);
  // 空白格读取仍为空字符串（稀疏模型）
  assert.equal(s.getCellRaw(4999, 4999), '');
});

test('setCellValue 超出当前范围时自动扩展', () => {
  const s = freshState();
  s.setCellValue(30, 250, 'out-of-range');
  assert.ok(s.colCount > 30);
  assert.ok(s.rowCount > 250);
  assert.equal(s.getCellRaw(30, 250), 'out-of-range');
});

test('setCellValue 在最后一列/行写入时自动扩展', () => {
  const s = freshState();
  // Z 列（col 25）是默认最后一列
  s.setCellValue(25, 0, 'Z-col-value');
  assert.ok(s.colCount > 25, `写入 Z 列后 colCount 应 > 25，实际 ${s.colCount}`);
  // 第 200 行（row 199）是默认最后一行
  const s2 = freshState();
  s2.setCellValue(0, 199, 'row-200-value');
  assert.ok(s2.rowCount > 199, `写入第 200 行后 rowCount 应 > 199，实际 ${s2.rowCount}`);
});

test('hasDynamicDims 初始为 false，扩展后为 true', () => {
  const s = freshState();
  assert.equal(s.hasDynamicDims(), false);
  s.ensureCapacity(30, 10);
  assert.equal(s.hasDynamicDims(), true);
});

test('selectAll 随 colCount / rowCount 响应式更新', () => {
  const s = freshState();
  s.selectAll();
  let sel = s.selection.value!;
  assert.equal(sel.endCol, 25);
  assert.equal(sel.endRow, 199);
  s.ensureCapacity(30, 250);
  s.selectAll();
  sel = s.selection.value!;
  assert.equal(sel.endCol, s.colCount - 1);
  assert.equal(sel.endRow, s.rowCount - 1);
});

test('moveActive 在动态范围边界处正确钳制', () => {
  const s = freshState();
  s.setCellValue(50, 300, 'x');
  s.selectCell(50, 300);
  s.moveActive(1, 1);
  const ac = s.activeCell.value;
  assert.ok(ac.col <= s.colCount - 1);
  assert.ok(ac.row <= s.rowCount - 1);
});

test('parseCellRef 接受动态范围内的合法引用，拒绝越界', () => {
  const s = freshState();
  s.ensureCapacity(30, 250);
  // AA 列 = index 26，在扩展后范围内合法
  const ok = parseCellRef('AA1', s.colCount, s.rowCount);
  assert.ok(ok);
  assert.equal(ok!.col, 26);
  assert.equal(ok!.row, 0);
  // 原始 26/200 范围下 AA 越界（AA=26 >= 26）
  const bad = parseCellRef('AA1', 26, 200);
  assert.equal(bad, null);
});

test('列名在动态范围下正确渲染（colToLabel 双向一致）', () => {
  const s = freshState();
  s.ensureCapacity(702, 1000);
  assert.equal(colToLabel(s.colCount - 1), 'AAA');
  assert.equal(labelToCol('ZZ'), 701);
  assert.equal(labelToCol('AAA'), 702);
});

test('setDims 可正确设置更大或更小的逻辑范围', () => {
  const s = freshState();
  s.setDims(50, 500);
  assert.equal(s.colCount, 50);
  assert.equal(s.rowCount, 500);
  assert.equal(s.colWidths.value.length, 50);
  assert.equal(s.rowHeights.value.length, 500);
  s.setDims(10, 10);
  assert.equal(s.colCount, 10);
  assert.equal(s.rowCount, 10);
  assert.equal(s.colWidths.value.length, 10);
  assert.equal(s.rowHeights.value.length, 10);
});

test('稀疏存储：写入不相关位置不产生额外空 Cell', () => {
  const s = freshState();
  s.setCellValue(0, 0, 'A1');
  s.setCellValue(25, 199, 'Z200');
  assert.equal(Object.keys(s.cells).length, 2);
  s.ensureCapacity(1000, 1000);
  assert.equal(Object.keys(s.cells).length, 2);
});

test('动态扩展后插入列：原有数据正确移动并保留', () => {
  const s = freshState();
  // 1. 先在 Y 列（col 24）写入数据，也在 Z 列（col 25）写入数据
  s.setCellValue(24, 0, 'Y-data');
  s.setCellValue(25, 0, 'Z-data');
  assert.equal(s.getCellRaw(24, 0), 'Y-data');
  assert.equal(s.getCellRaw(25, 0), 'Z-data');

  // 2. 在 X 列（col 23）插入 1 列（模拟用户右键插入）
  // insertCols(23, 23) 意味着插入 1 列在 col 23
  const cS = 23, cE = 23;
  const n = cE - cS + 1; // = 1
  const currentColCount = s.colCount; // 26
  const minNeededCol = currentColCount - 1 + n; // 26 - 1 + 1 = 26
  // minNeededCol (26) >= currentColCount (26)，需要扩展
  s.ensureCapacity(minNeededCol, s.rowCount - 1);
  const origColCount = s.colCount; // 扩展后
  const origRowCount = s.rowCount;

  // 模拟 insertCols 的移动逻辑
  // 从最后一列开始向右移动
  for (let c = origColCount - 1; c > cE; c--) {
    for (let r = 0; r < origRowCount; r++) {
      const sk = s.cellKey(c - n, r), dk = s.cellKey(c, r);
      if (s.cells[sk]) s.cells[dk] = s.cells[sk]!;
      else s.delCell(dk);
    }
  }
  // 清空插入位置
  for (let c = cS; c <= cE; c++) {
    for (let r = 0; r < s.rowCount; r++) s.delCell(s.cellKey(c, r));
  }

  // 3. 验证：
  // X 列（col 23）应为空（新插入的空列）
  assert.equal(s.getCellRaw(23, 0), '', 'X 列应为空（新插入的空列）');
  // Y 列（col 24）应是原 X 列的数据
  assert.equal(s.getCellRaw(24, 0), '', '原 X 列位置应为空');
  // Z 列（col 25）应是原 Y 列的数据
  assert.equal(s.getCellRaw(25, 0), 'Y-data', '原 Y 列数据应移到 Z 列（col 25）');
  // 原 Z 列数据应移到 AA 列（col 26）
  assert.equal(s.getCellRaw(26, 0), 'Z-data', '原 Z 列数据应移到 AA 列（col 26）');

  // 4. 现在删除插入的 1 列，数据应回来
  const dc = 1;
  const dCS = 23, dCE = 23;
  // 删除
  for (let c = dCS; c <= dCE; c++) {
    for (let r = 0; r < s.rowCount; r++) s.delCell(s.cellKey(c, r));
  }
  // 左移
  for (let c = dCS; c < s.colCount - dc; c++) {
    for (let r = 0; r < s.rowCount; r++) {
      const sk = s.cellKey(c + dc, r), dk = s.cellKey(c, r);
      if (s.cells[sk]) {
        s.cells[dk] = s.cells[sk]!;
        s.delCell(sk);
      } else {
        s.delCell(dk);
      }
    }
  }

  // 5. 验证原数据回来了
  assert.equal(s.getCellRaw(24, 0), 'Y-data', '删除后 Y 列数据应恢复');
  assert.equal(s.getCellRaw(25, 0), 'Z-data', '删除后 Z 列数据应恢复');
});

test('insertRows 动态扩展后插入行：原有数据正确移动', () => {
  const s = freshState();
  // 在最后一行写入数据
  s.setCellValue(0, 199, 'last-row-data');
  assert.equal(s.getCellRaw(0, 199), 'last-row-data');

  // 在第 199 行（最后一行）插入 1 行
  const rS = 199, rE = 199;
  const n = rE - rS + 1; // = 1
  const currentRowCount = s.rowCount; // 200
  const minNeededRow = currentRowCount - 1 + n; // 200 - 1 + 1 = 200
  // minNeededRow (200) >= currentRowCount (200)，需要扩展
  s.ensureCapacity(s.colCount - 1, minNeededRow);
  const origRowCount = s.rowCount;
  const origColCount = s.colCount;

  // 从最后一行开始向下移动
  for (let r = origRowCount - 1; r > rE; r--) {
    for (let c = 0; c < origColCount; c++) {
      const sk = s.cellKey(c, r - n), dk = s.cellKey(c, r);
      if (s.cells[sk]) s.cells[dk] = s.cells[sk]!;
      else s.delCell(dk);
    }
  }
  // 清空插入位置
  for (let r = rS; r <= rE; r++) {
    for (let c = 0; c < s.colCount; c++) s.delCell(s.cellKey(c, r));
  }

  // 验证：原最后一行数据应移到下一行
  assert.equal(s.getCellRaw(0, 199), '', '第 199 行应为空（新插入的空行）');
  assert.equal(s.getCellRaw(0, 200), 'last-row-data', '原最后一行数据应移到第 200 行');
});
