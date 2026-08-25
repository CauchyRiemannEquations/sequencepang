import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createTilePool,
  createNormalTile,
  createFeverTile,
  pickWeighted,
  getDisplayValue
} from '../../client/src/engine/tiles.js';
import { createRng } from '../../client/src/engine/rng.js';

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('./parityVectors.json', import.meta.url)), 'utf8')
);

test('createNormalTile: 풀 범위 준수 (일반/하이퍼/빅넘버/음수 풀 주입)', () => {
  const rng = createRng(1);
  const pools = [
    createTilePool({ min: 1, max: 9 }),
    createTilePool({ min: 1, max: 12 }),
    createTilePool({ min: 10, max: 19 }),
    // 향후 음수 피버 대비: 풀 주입만으로 동작해야 한다
    createTilePool({ min: -9, max: 9 })
  ];
  for (const pool of pools) {
    for (let i = 0; i < 200; i++) {
      const tile = createNormalTile(pool, rng);
      assert.equal(tile.type, 'normal');
      assert.ok(Number.isInteger(tile.baseValue));
      assert.ok(tile.baseValue >= pool.min && tile.baseValue <= pool.max, `${tile.baseValue} in [${pool.min},${pool.max}]`);
    }
  }
});

test('createRng: 같은 시드는 같은 수열', () => {
  const a = createRng(123);
  const b = createRng(123);
  for (let i = 0; i < 20; i++) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
  }
});

test('pickWeighted: 가중치 0인 항목은 선택되지 않음', () => {
  const rng = createRng(5);
  const entries = [
    { type: 'a', weight: 0 },
    { type: 'b', weight: 1 }
  ];
  for (let i = 0; i < 100; i++) {
    assert.equal(pickWeighted(entries, rng).type, 'b');
  }
});

test('createFeverTile: 티어·타입 필드 구성', () => {
  const rng = createRng(3);
  const pool = createTilePool({ min: 1, max: 9 });
  const feverTypes = [{ type: 'add', amount: 2, label: '+2', weight: 1 }];
  const tile = createFeverTile({ tier: 'super', feverTypes, pool, rng });
  assert.equal(tile.type, 'fever');
  assert.equal(tile.feverTier, 'super');
  assert.equal(tile.feverType, 'add');
  assert.equal(tile.feverAmount, 2);
  assert.equal(tile.feverLabel, '+2');
  assert.ok(tile.baseValue >= 1 && tile.baseValue <= 9);
});

test('getDisplayValue 패리티 벡터 (add/multiply 변환)', () => {
  for (const vector of vectors.feverDisplayCases) {
    const tile = { baseValue: vector.baseValue, type: 'normal' };
    const fever = { active: true, type: vector.feverType, amount: vector.amount };
    assert.equal(getDisplayValue(tile, fever), vector.expected, vector.name);
  }
});

test('getDisplayValue: 피버 비활성은 원본, 피버 타일은 라벨', () => {
  const tile = { baseValue: 7, type: 'normal' };
  assert.equal(getDisplayValue(tile, null), 7);
  assert.equal(getDisplayValue(tile, { active: false, type: 'add', amount: 2 }), 7);
  const feverTile = { baseValue: 4, type: 'fever', feverLabel: '×2' };
  assert.equal(getDisplayValue(feverTile, { active: true, type: 'multiply', amount: 2 }), '×2');
  assert.equal(getDisplayValue(null), '');
});
