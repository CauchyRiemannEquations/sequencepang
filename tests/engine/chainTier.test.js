import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getChainTier, getCrossCells } from '../../client/src/engine/chainTier.js';

test('getChainTier: 길이 경계 3/4/5/6/7/8', () => {
  assert.equal(getChainTier(3, false), 'none');
  assert.equal(getChainTier(4, false), 'fever');
  assert.equal(getChainTier(5, false), 'super');
  assert.equal(getChainTier(6, false), 'cross');
  assert.equal(getChainTier(7, false), 'full');
  assert.equal(getChainTier(8, false), 'full');
});

test('getChainTier: allSame이면 길이와 무관하게 none', () => {
  for (const len of [4, 5, 6, 7, 10]) {
    assert.equal(getChainTier(len, true), 'none');
  }
});

test('getCrossCells: 행+열 자기 자신 제외 10칸', () => {
  const cells = getCrossCells({ row: 2, col: 3 }, 6);
  assert.equal(cells.length, 10);
  assert.ok(!cells.some(cell => cell.row === 2 && cell.col === 3));
  for (const cell of cells) {
    assert.ok(cell.row === 2 || cell.col === 3);
    assert.ok(cell.row >= 0 && cell.row < 6 && cell.col >= 0 && cell.col < 6);
  }
  // 중복 없음
  const keys = new Set(cells.map(cell => `${cell.row}:${cell.col}`));
  assert.equal(keys.size, 10);
});

test('getCrossCells: 모서리 칸에서도 10칸', () => {
  assert.equal(getCrossCells({ row: 0, col: 0 }, 6).length, 10);
  assert.equal(getCrossCells({ row: 5, col: 5 }, 6).length, 10);
});
