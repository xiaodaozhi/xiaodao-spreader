import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalFormula, computeCellValue, getEvalCache } from '../src/components/spreader/core/formula';
import type { CellData } from '../src/components/spreader/core/types';

type CellMap = Record<string, CellData>;

let counter = 0;

/** 以唯一目标单元格求值一条公式，data 中的单元格以 A1 风格提供；每次清空全局求值缓存以隔离测试 */
function run(formula: string, data: Record<string, string> = {}): unknown {
  getEvalCache().clear();
  const col = 100 + (counter++ % 50);
  const row = 100 + (counter++ % 50);
  const cells: CellMap = {};
  for (const [ref, value] of Object.entries(data)) {
    const m = ref.match(/^([A-Z]+)(\d+)$/)!;
    const c = m[1]!.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const r = parseInt(m[2]!, 10) - 1;
    cells[`${c},${r}`] = { value };
  }
  cells[`${col},${row}`] = { value: formula };
  return evalFormula(`${col},${row}`, cells, 200, 200);
}

function refToKey(ref: string): string {
  const m = ref.match(/^([A-Z]+)(\d+)$/)!;
  const c = m[1]!.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const r = parseInt(m[2]!, 10) - 1;
  return `${c},${r}`;
}

test('BUG: 顶层算术表达式（=10-2）不再显示 #ERROR', () => {
  assert.equal(run('=10-2'), 8);
  // 四则运算与括号
  assert.equal(run('=2*3+1'), 7);
  assert.equal(run('=(10-2)*2'), 16);
  // 单元格引用参与运算
  assert.equal(run('=A1+B1', { A1: '10', B1: '5' }), 15);
  // 直接引用单元格
  assert.equal(run('=A1', { A1: '42' }), 42);
});

test('MAX / MIN 求值', () => {
  const data = { A1: '3', A2: '7', A3: '1', A4: '9', A5: '4' };
  assert.equal(run('=MAX(A1:A5)', data), 9);
  assert.equal(run('=MIN(A1:A5)', data), 1);
});

test('SIN', () => {
  assert.equal(run('=SIN(0)'), 0);
  assert.ok(Math.abs(Number(run('=SIN(3.141592653589793/2)')) - 1) < 1e-9);
});

test('SUMIF 按条件求和', () => {
  const data = { A1: '1', A2: '2', A3: '3', B1: '10', B2: '20', B3: '30' };
  // 条件列 A>1，对 B 列求和：20+30=50
  assert.equal(run('=SUMIF(A1:A3, ">1", B1:B3)', data), 50);
  // 等值条件：A=2 时对应 B=20
  assert.equal(run('=SUMIF(A1:A3, 2, B1:B3)', data), 20);
  // 文本条件
  const t = { A1: 'x', A2: 'y', A3: 'x', B1: '1', B2: '2', B3: '3' };
  assert.equal(run('=SUMIF(A1:A3, "x", B1:B3)', t), 4);
});

test('PMT 贷款每期还款额', () => {
  const r = 0.06 / 12;
  const nper = 12;
  const pv = 100000;
  // 修正后的正确公式：分子需乘以 rate（分母等价于 (pow-1)/rate）
  const expected = -(0 + pv * Math.pow(1 + r, nper)) * r / ((1 + r * 0) * (Math.pow(1 + r, nper) - 1));
  assert.ok(Math.abs(Number(run('=PMT(0.06/12, 12, 100000)')) - expected) < 1e-6);
  // 用户反馈的真实用例：应等于 Excel 的 -536.82
  assert.ok(Math.abs(Number(run('=PMT(0.05/12, 360, 100000)')) - (-536.82)) < 1e-2);
  // 利率为 0 的特殊分支
  assert.ok(Math.abs(Number(run('=PMT(0, 12, 1200)')) - (-100)) < 1e-9);
});

test('STDEV 样本标准差', () => {
  // 1,2,3 的样本标准差 = sqrt(((1-2)^2+(2-2)^2+(3-2)^2)/2) = 1
  const data = { A1: '1', A2: '2', A3: '3' };
  assert.equal(run('=STDEV(A1:A3)', data), 1);
});

test('computeCellValue 顶层算术返回字符串数字而非 #ERROR', () => {
  getEvalCache().clear();
  const cells: CellMap = { [refToKey('A1')]: { value: '=10-2' } };
  assert.equal(computeCellValue(0, 0, cells, 20, 50), '8');
  // 未支持函数仍返回 #ERROR
  getEvalCache().clear();
  const cells2: CellMap = { [refToKey('A1')]: { value: '=FOO(1)' } };
  assert.equal(computeCellValue(0, 0, cells2, 20, 50), '#ERROR');
});
