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

test('드래그 중 상태와 손 뗄 때 판정이 100% 일치 (같은 classifyChain 사용)', () => {
  // 드래그를 한 타일씩 확장하며 판정한 마지막 상태 == 손 뗄 때의 최종 판정
  const chains = [
    [1, 2, 3, 4],
    [2, 4, 8, 16],
    [4, 6, 9],
    [9, 6, 4],
    [5, 5, 5, 5],
    [1, 2, 5],
    [3, 6, 9, 13],
    [7, 5, 3, 1],
    [1, 3, 9, 12]
  ];
  // 리팩터 전 evaluateSequence의 성공 조건(isAP || isGP)을 독립 구현한 참조 판정
  function isValidByLegacyRule(values) {
    const len = values.length;
    if (len < 3) return false;
    let isAP = true;
    const diff = values[1] - values[0];
    for (let i = 1; i < len - 1; i++) {
      if (values[i + 1] - values[i] !== diff) { isAP = false; break; }
    }
    let isGP = true;
    const ratio = values[1] / values[0];
    for (let i = 1; i < len - 1; i++) {
      if (Math.abs((values[i + 1] / values[i]) - ratio) > 1e-9) { isGP = false; break; }
    }
    return isAP || isGP;
  }

  for (const values of chains) {
    let liveState = null;
    for (let len = 1; len <= values.length; len++) {
      liveState = classifyChain(values.slice(0, len)).state;
    }
    const releaseState = classifyChain(values).state;
    assert.equal(liveState, releaseState, values.join(','));
    // 손 뗄 때 성공 조건(리팩터 전 isAP||isGP)과 실시간 valid 상태의 동치
    assert.equal(releaseState === 'valid', isValidByLegacyRule(values), values.join(','));
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
