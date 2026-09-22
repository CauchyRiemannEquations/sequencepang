import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStarTime, withStar } from '../../client/src/engine/starTime.js';
import { createBoard, collapseAndRefill } from '../../client/src/engine/board.js';
import { createNormalTile, getDisplayValue } from '../../client/src/engine/tiles.js';
import { classifyChain } from '../../client/src/engine/sequence.js';
import { computePoints } from '../../client/src/engine/scoring.js';
import { createRng } from '../../client/src/engine/rng.js';
import * as C from '../../client/src/gameConstants.js';

const settings = {
  required: C.STAR_REQUIRED, duration: C.STAR_TIME_DURATION,
  extension: C.STAR_TIME_EXTENSION, max: C.STAR_TIME_MAX
};
const emptyState = { starCount: 0, isStarTime: false, starTimeRemaining: 0 };
function activate(star, now = 0) {
  for (let i = 0; i < C.STAR_REQUIRED; i++) star.collect(true, now);
}

test('별 장식은 기존 숫자, 피버 표시값, AP/GP 판정을 보존한다', () => {
  for (const values of [[1, 2, 3], [2, 4, 8], [9, 6, 4], [5, 5, 5], [1, 2, 5]]) {
    const tiles = values.map(baseValue => withStar({ baseValue, type: 'normal' }, 1));
    assert.deepEqual(classifyChain(tiles.map(t => getDisplayValue(t))), classifyChain(values));
    for (const tile of tiles) {
      assert.equal(getDisplayValue(tile, { active: true, type: 'multiply', amount: 3 }), tile.baseValue * 3);
    }
  }
  assert.equal(withStar({ type: 'fever', baseValue: 3 }, 1).isStar, false);
});

test('별 확률 경계와 8% 생성 분포, 숫자 생성 난수열 보존', () => {
  const normalRng = createRng(12), starRng = createRng(99), controlRng = createRng(12);
  let count = 0;
  for (let i = 0; i < 10000; i++) {
    const tile = withStar(createNormalTile({ min: 1, max: 9 }, normalRng), C.STAR_SPAWN_RATE, starRng);
    assert.equal(tile.baseValue, createNormalTile({ min: 1, max: 9 }, controlRng).baseValue);
    if (tile.isStar) count++;
  }
  assert.ok(count > 700 && count < 900, `10000개 중 ${count}`);
  const tile = { type: 'normal', baseValue: 7 };
  assert.equal(withStar(tile, 0, () => 0).isStar, false);
  assert.equal(withStar(tile, .08, () => .08).isStar, false);
  assert.equal(withStar(tile, .08, () => .079).isStar, true);
});

test('일반 수열은 충전하지 않고, 별 포함 수열 다섯 번에 즉시 8초 발동', () => {
  const star = createStarTime(settings);
  assert.equal(star.collect(false, 0), null);
  assert.deepEqual(star.state, emptyState);
  for (let i = 1; i < 5; i++) {
    assert.equal(star.collect(true, i * 1000).type, 'collected');
    assert.equal(star.state.starCount, i);
    assert.equal(star.state.isStarTime, false);
  }
  assert.equal(star.collect(true, 5000).type, 'started');
  assert.deepEqual(star.state, { starCount: 0, isStarTime: true, starTimeRemaining: 8 });
});

test('활성 중 일반 수열은 시간 연장 안 함, 별은 게이지 대신 정확히 1초', () => {
  const star = createStarTime(settings);
  activate(star);
  star.collect(false, 2000);
  assert.equal(star.state.starTimeRemaining, 6);
  assert.deepEqual(star.collect(true, 2000), { type: 'extended', added: 1 });
  assert.equal(star.state.starTimeRemaining, 7);
  assert.equal(star.state.starCount, 0);
});

test('14.5초 + 별은 15초, 최대치에서 연속 획득해도 넘지 않음', () => {
  const star = createStarTime(settings);
  activate(star);
  for (let i = 0; i < 7; i++) star.collect(true, 0);
  assert.equal(star.sync(500).starTimeRemaining, 14.5);
  assert.deepEqual(star.collect(true, 500), { type: 'extended', added: .5 });
  for (let i = 0; i < 20; i++) star.collect(true, 500);
  assert.equal(star.state.starTimeRemaining, 15);
});

test('실제 경과 시간으로 종료: 지연된 틱·백그라운드 복귀도 잔여 상태 없음', () => {
  const star = createStarTime(settings);
  activate(star, 1234);
  assert.equal(star.sync(9233).isStarTime, true);
  assert.deepEqual(star.sync(9234), emptyState);
  activate(star);
  assert.deepEqual(star.sync(60000), emptyState);
});

test('종료 경계에 별 획득하면 이전 시간을 연장하지 않고 새 게이지 1개', () => {
  const star = createStarTime(settings);
  activate(star);
  assert.equal(star.collect(true, 8000).type, 'collected');
  assert.deepEqual(star.state, { ...emptyState, starCount: 1 });
});

test('게임 종료·재시작 reset은 충전과 활성 상태 모두 정리한다', () => {
  const star = createStarTime(settings);
  star.collect(true, 0);
  star.reset();
  assert.deepEqual(star.state, emptyState);
  activate(star);
  star.collect(true, 1000);
  star.reset();
  assert.deepEqual(star.sync(2000), emptyState);
  assert.equal(star.collect(true, 2000).type, 'collected');
});

test('설정 주입으로 별 개수·시간·상한 조정 가능', () => {
  const star = createStarTime({ required: 2, duration: 3, extension: 2, max: 4 });
  star.collect(true, 0);
  star.collect(true, 0);
  assert.equal(star.state.starTimeRemaining, 3);
  star.collect(true, 500);
  assert.equal(star.state.starTimeRemaining, 4);
});

test('STAR 점수는 기존 반올림 이후 정확히 2배, 종료 후 기존 점수 복귀', () => {
  const star = createStarTime(settings);
  activate(star);
  for (const len of [3, 4, 6, 7]) for (const combo of [1, 3, 12]) {
    const input = { len, combo, repeatMultiplier: .2, feverMultiplier: 1.5, lastSpurtMultiplier: 2 };
    const base = computePoints(input);
    assert.equal(computePoints({ ...input, starMultiplier: C.STAR_SCORE_MULTIPLIER }), base * 2);
  }
  star.sync(8000);
  assert.equal(computePoints({ len: 3, combo: 1, starMultiplier: star.state.isStarTime ? 2 : 1 }), 300);
});

test('중력 리필은 남은 별을 보존하고 새 타일만 새 별 속성을 받는다', () => {
  const board = createBoard(6, () => ({ type: 'normal', baseValue: 7, isStar: false }));
  const survivor = { type: 'normal', baseValue: 7, isStar: true };
  board[0][0] = survivor;
  const { board: next } = collapseAndRefill(board, [{ row: 5, col: 0 }],
    () => withStar({ type: 'normal', baseValue: 7 }, 0));
  assert.equal(next[1][0], survivor);
  assert.equal(next[0][0].isStar, false);
});
