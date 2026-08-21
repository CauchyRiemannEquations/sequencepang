import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  classifyChain,
  getTimeBonus,
  formatDifferenceValue,
  formatRatioValue,
  getGcd
} from '../../client/src/engine/sequence.js';

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('./parityVectors.json', import.meta.url)), 'utf8')
);

test('classifyChain 패리티 벡터', () => {
  for (const vector of vectors.classifyCases) {
    const result = classifyChain(vector.values);
    assert.equal(result.state, vector.state, vector.name);
    if (vector.kind !== undefined) {
      assert.equal(result.kind, vector.kind, vector.name);
    }
    if (vector.diff !== undefined) {
      assert.equal(result.diff, vector.diff, vector.name);
    }
    if (vector.ratio !== undefined) {
      assert.ok(Math.abs(result.ratio - vector.ratio) < 1e-9, vector.name);
    }
    if (vector.allSame !== undefined) {
      assert.equal(result.allSame, vector.allSame, vector.name);
    }
    if (vector.ruleLabel !== undefined) {
      assert.equal(result.ruleLabel, vector.ruleLabel, vector.name);
    }
    if (vector.ruleFraction !== undefined) {
      assert.equal(result.ruleLabel.type, 'fraction', vector.name);
      assert.equal(result.ruleLabel.numerator, vector.ruleFraction[0], vector.name);
      assert.equal(result.ruleLabel.denominator, vector.ruleFraction[1], vector.name);
    }
  }
});

test('len<3은 항상 pending', () => {
  assert.equal(classifyChain([]).state, 'pending');
  assert.equal(classifyChain([5]).state, 'pending');
  assert.equal(classifyChain([5, 7]).state, 'pending');
});

test('0·음수 입력에도 예외 없이 판정된다', () => {
  const samples = [
    [0, 0, 0, 0],
    [0, 1, 0],
    [-1, 0, 1],
    [-3, -3, -3],
    [-2, 4, -8],
    [0, 0, 5]
  ];
  for (const values of samples) {
    assert.doesNotThrow(() => classifyChain(values), values.join(','));
  }
  // 음수 등비: -2, 4, -8 → 공비 -2
  const negativeGp = classifyChain([-2, 4, -8]);
  assert.equal(negativeGp.state, 'valid');
  assert.equal(negativeGp.kind, 'GP');
});

test('valid에서 타일 하나 더해 깨지면 broken, 백트래킹하면 다시 valid', () => {
  assert.equal(classifyChain([2, 4, 6]).state, 'valid');
  assert.equal(classifyChain([2, 4, 6, 9]).state, 'broken');
  assert.equal(classifyChain([2, 4, 6]).state, 'valid');
});

test('getTimeBonus 패리티 벡터', () => {
  for (const vector of vectors.timeBonusCases) {
    const result = getTimeBonus({
      kind: vector.kind,
      diff: vector.diff,
      ratio: vector.ratio,
      allSame: vector.allSame ?? false,
      repeatTimeMultiplier: vector.repeatTimeMultiplier ?? 1
    });
    assert.ok(Math.abs(result - vector.expected) < 1e-9, `${vector.name}: ${result}`);
  }
});

test('formatDifferenceValue / formatRatioValue / getGcd', () => {
  assert.equal(formatDifferenceValue(2), '+2');
  assert.equal(formatDifferenceValue(-3), '-3');
  assert.deepEqual(formatRatioValue(8, 4), { type: 'text', value: '2' });
  assert.deepEqual(formatRatioValue(6, 4), { type: 'fraction', numerator: 3, denominator: 2 });
  assert.deepEqual(formatRatioValue(4, 6), { type: 'fraction', numerator: 2, denominator: 3 });
  assert.equal(getGcd(12, 18), 6);
  assert.equal(getGcd(7, 0), 7);
});
