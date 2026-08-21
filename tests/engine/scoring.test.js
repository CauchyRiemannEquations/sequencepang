import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getComboBonus,
  computePoints,
  getPathSignature,
  classifyRepeat,
  pushHistory
} from '../../client/src/engine/scoring.js';

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('./parityVectors.json', import.meta.url)), 'utf8')
);

// gameConstants.js의 현재 값과 동일 — 엔진은 상수를 주입받는다
const REPEAT_MULTIPLIERS = {
  pathScoreMultiplier: 0.2,
  patternScoreMultiplier: 0.5,
  pathTimeMultiplier: 0,
  patternTimeMultiplier: 0.5
};

test('computePoints 패리티 벡터', () => {
  for (const vector of vectors.scoreCases) {
    const points = computePoints({
      len: vector.len,
      combo: vector.combo,
      repeatMultiplier: vector.repeatMultiplier ?? 1,
      feverMultiplier: vector.feverMultiplier ?? 1,
      lastSpurtMultiplier: vector.lastSpurtMultiplier ?? 1
    });
    assert.equal(points, vector.expected, vector.name);
  }
});

test('getComboBonus: combo 1 이하는 0', () => {
  assert.equal(getComboBonus(0), 0);
  assert.equal(getComboBonus(1), 0);
  assert.ok(Math.abs(getComboBonus(2) - 104) < 1e-9);
  assert.ok(Math.abs(getComboBonus(3) - 232) < 1e-9);
});

test('getPathSignature: 정방향/역방향 동일 서명', () => {
  for (const vector of vectors.pathSignatureCases) {
    const forwardCells = vector.forward.map(([row, col]) => ({ row, col }));
    const reverseCells = vector.reverse.map(([row, col]) => ({ row, col }));
    assert.equal(getPathSignature(forwardCells), vector.expected, vector.name);
    assert.equal(getPathSignature(reverseCells), vector.expected, vector.name);
  }
});

test('classifyRepeat: 반복 경로 > 반복 패턴 > 신규 순서로 판정', () => {
  const cells = [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }];
  const otherCells = [{ row: 5, col: 0 }, { row: 5, col: 1 }, { row: 5, col: 2 }];
  const values = [1, 2, 3];

  const history = [];
  assert.equal(classifyRepeat(history, cells, values, REPEAT_MULTIPLIERS).type, 'new');

  pushHistory(history, {
    pathSignature: getPathSignature(cells),
    valueSignature: values.join(',')
  }, 5);

  const pathRepeat = classifyRepeat(history, cells, values, REPEAT_MULTIPLIERS);
  assert.equal(pathRepeat.type, 'path');
  assert.equal(pathRepeat.scoreMultiplier, 0.2);
  assert.equal(pathRepeat.timeMultiplier, 0);

  // 역방향으로 그어도 같은 경로로 취급
  const reversed = [...cells].reverse();
  assert.equal(classifyRepeat(history, reversed, [3, 2, 1], REPEAT_MULTIPLIERS).type, 'path');

  // 다른 경로·같은 값 패턴 → pattern
  const patternRepeat = classifyRepeat(history, otherCells, values, REPEAT_MULTIPLIERS);
  assert.equal(patternRepeat.type, 'pattern');
  assert.equal(patternRepeat.scoreMultiplier, 0.5);
  assert.equal(patternRepeat.timeMultiplier, 0.5);

  // 다른 경로·다른 값 → new
  assert.equal(classifyRepeat(history, otherCells, [2, 4, 6], REPEAT_MULTIPLIERS).type, 'new');
});

test('pushHistory: limit 초과 시 가장 오래된 항목 제거', () => {
  const history = [];
  for (let i = 0; i < 7; i++) {
    pushHistory(history, { pathSignature: `p${i}`, valueSignature: `v${i}` }, 5);
  }
  assert.equal(history.length, 5);
  assert.equal(history[0].pathSignature, 'p2');
  assert.equal(history[4].pathSignature, 'p6');
});
