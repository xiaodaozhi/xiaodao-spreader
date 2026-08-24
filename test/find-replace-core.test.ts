import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellMatches,
  replaceFirst,
  replaceAllOccurrences,
  scanSheetCells,
  escapeRegExp,
} from '../src/components/spreader/core/find-replace-core';
import type { SelectionRange } from '../src/components/spreader/core/types';

const key = (c: number, r: number) => `${c},${r}`;

test('cellMatches 默认不区分大小写、非完整匹配', () => {
  assert.equal(cellMatches('ABC123', 'abc', false, false), true);
  assert.equal(cellMatches('ABC123', 'abc', true, false), false);
  assert.equal(cellMatches('ABC123', 'abc', false, true), false);
  assert.equal(cellMatches('abc', 'abc', false, true), true);
  assert.equal(cellMatches('xabcx', 'abc', false, true), false);
  assert.equal(cellMatches('', 'abc', false, false), false);
  assert.equal(cellMatches('abc', '', false, false), false);
});

test('replaceFirst 仅替换首个匹配', () => {
  assert.equal(replaceFirst('abc abc abc', 'abc', 'X', false), 'X abc abc');
  assert.equal(replaceFirst('ABC abc', 'abc', 'X', true), 'ABC X');
  assert.equal(replaceFirst('no match', 'abc', 'X', false), 'no match');
  // 替换文本含 $ 不应被当作分组引用
  assert.equal(replaceFirst('a.b', '.', '$1', false), 'a$1b');
});

test('replaceAllOccurrences 替换所有匹配（大小写不敏感用函数避免 $ 问题）', () => {
  assert.equal(replaceAllOccurrences('abc ABC aBc', 'abc', 'X', false), 'X X X');
  assert.equal(replaceAllOccurrences('abc abc', 'abc', 'X', true), 'X X');
  assert.equal(replaceAllOccurrences('a.b a.b', '.', '$1', false), 'a$1b a$1b');
  assert.equal(replaceAllOccurrences('nomatch', 'abc', 'X', false), 'nomatch');
});

test('scanSheetCells 整表扫描基于原始 value', () => {
  const cells = {
    '0,0': { value: 'hello' },
    '1,0': { value: 'HELLO world' },
    '2,0': { value: '=SUM(A1)' },
    '0,1': { value: 'no' },
  };
  const res = scanSheetCells(cells, 0, key, 'hello', false, false);
  assert.deepEqual(
    res.map((r) => `${r.col},${r.row}`).sort(),
    ['0,0', '1,0'].sort(),
  );
});

test('scanSheetCells 选区范围（当前选区）', () => {
  const cells: Record<string, { value: string }> = {};
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) cells[key(c, r)] = { value: `v${c}${r}` };
  }
  const range: SelectionRange = { startCol: 1, startRow: 1, endCol: 2, endRow: 2 };
  const res = scanSheetCells(cells, 0, key, 'v11', false, false, range);
  assert.deepEqual(res, [{ sheetIndex: 0, col: 1, row: 1 }]);
  // 范围外不应命中
  const res2 = scanSheetCells(cells, 0, key, 'v00', false, false, range);
  assert.equal(res2.length, 0);
});

test('escapeRegExp 转义正则元字符', () => {
  assert.equal(escapeRegExp('a.b*c'), 'a\\.b\\*c');
});
