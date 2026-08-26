import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colToLabel, labelToCol } from '../src/components/spreader/core/utils';

test('colToLabel: 基础 A-Z', () => {
  assert.equal(colToLabel(0), 'A');
  assert.equal(colToLabel(1), 'B');
  assert.equal(colToLabel(25), 'Z');
});

test('colToLabel: 越过 Z 的双字母列', () => {
  assert.equal(colToLabel(26), 'AA');
  assert.equal(colToLabel(27), 'AB');
  assert.equal(colToLabel(51), 'AZ');
  assert.equal(colToLabel(52), 'BA');
  assert.equal(colToLabel(77), 'BZ');
  assert.equal(colToLabel(701), 'ZZ');
});

test('colToLabel: 越过 ZZ 的三字母列', () => {
  assert.equal(colToLabel(702), 'AAA');
  assert.equal(colToLabel(703), 'AAB');
});

test('labelToCol: 基础 A-Z', () => {
  assert.equal(labelToCol('A'), 0);
  assert.equal(labelToCol('Z'), 25);
  assert.equal(labelToCol('a'), 0);
});

test('labelToCol: 双字母列', () => {
  assert.equal(labelToCol('AA'), 26);
  assert.equal(labelToCol('AB'), 27);
  assert.equal(labelToCol('AZ'), 51);
  assert.equal(labelToCol('BA'), 52);
  assert.equal(labelToCol('ZZ'), 701);
});

test('labelToCol: 三字母列', () => {
  assert.equal(labelToCol('AAA'), 702);
});

test('colToLabel / labelToCol 互为反函数（抽样）', () => {
  const cases = [0, 1, 25, 26, 27, 51, 52, 100, 500, 701, 702, 1000, 10000];
  for (const n of cases) {
    const lbl = colToLabel(n);
    assert.equal(labelToCol(lbl), n, `反函数失败：colToLabel(${n})=${lbl}, labelToCol(${lbl})=${labelToCol(lbl)}`);
  }
});

test('labelToCol 非法输入回退', () => {
  // 空串或非字母数字：不抛异常，按现有实现给出可预测结果（负数即视为非法）
  assert.ok(!Number.isNaN(labelToCol('')));
});
