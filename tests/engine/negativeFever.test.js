import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEVER_TYPES, SUPER_FEVER_TYPES } from '../../client/src/gameConstants.js';
import { createBoard, collapseAndRefill } from '../../client/src/engine/board.js';
import { createNegativeFeverValues, rollNegativeFeverValue } from '../../client/src/engine/negativeFever.js';
import { createRng } from '../../client/src/engine/rng.js';
import { classifyChain } from '../../client/src/engine/sequence.js';
import { createFeverTile, getDisplayValue } from '../../client/src/engine/tiles.js';

test('± is available in the normal four-tile fever draw', () => {
  const tile = createFeverTile({ feverTypes: FEVER_TYPES, pool: { min: 1, max: 9 }, rng: () => 0.99 });
  assert.equal(tile.feverType, 'negative');
  assert.equal(tile.feverTier, 'normal');
  assert.equal(getDisplayValue(tile), '±');
  assert.ok(!SUPER_FEVER_TYPES.some(entry => entry.type === tile.feverType));
});

test('every tap opens an adjacent mixed-sign sequence through the tapped cell', () => {
  const rng = createRng(137);
  const kinds = new Set();
  for (const max of [9, 12]) {
    const board = createBoard(6, () => ({ type: 'normal', baseValue: 1 + Math.floor(rng() * max), isStar: rng() < 0.1 }));
    const snapshot = structuredClone(board);
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 6; col++) {
        const negativeValues = createNegativeFeverValues(board, { row, col }, rng);
        const fever = { active: true, type: 'negative', negativeValues };
        const lines = [board[row], board.map(cells => cells[col])];
        const positions = [col, row];
        let hasSequence = false;
        lines.forEach((line, axis) => {
          for (let start = 0; start <= line.length - 3; start++) {
            if (positions[axis] < start || positions[axis] > start + 2) continue;
            const values = line.slice(start, start + 3).map(tile => getDisplayValue(tile, fever));
            const chain = classifyChain(values);
            if (Math.min(...values) < 0 && Math.max(...values) > 0 && chain.state === 'valid') {
              hasSequence = true;
              kinds.add(chain.kind);
            }
          }
        });
        assert.ok(hasSequence, `missing sequence at ${row},${col}`);
      }
    }
    assert.deepEqual(board, snapshot);
  }
  assert.deepEqual(kinds, new Set(['AP', 'GP']));
});

test('gravity carries signed values and stars, while expiry restores all base numbers', () => {
  const board = createBoard(6, (row, col) => ({ type: 'normal', baseValue: 3, isStar: row === 0 && col === 0 }));
  const negativeValues = createNegativeFeverValues(board, { row: 5, col: 5 }, () => 0.2);
  const fever = { active: true, type: 'negative', negativeValues };
  const refill = () => {
    const tile = { type: 'normal', baseValue: 7 };
    negativeValues.set(tile, rollNegativeFeverValue(tile.baseValue, () => 0.01));
    return tile;
  };
  const { board: next } = collapseAndRefill(board, [{ row: 1, col: 0 }], refill);
  assert.equal(next[1][0], board[0][0]);
  assert.equal(next[1][0].isStar, true);
  assert.equal(getDisplayValue(next[1][0], fever), -3);
  assert.equal(getDisplayValue(next[0][0], fever), 0);
  for (const tile of next.flat()) assert.equal(getDisplayValue(tile, null), tile.baseValue);
});
