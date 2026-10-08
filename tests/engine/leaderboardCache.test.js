import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLeaderboardCache } from '../../client/src/leaderboardCache.js';

test('15초보다 느린 첫 응답도 도착 후 15초 동안 재사용한다', async () => {
  let time = Date.parse('2026-10-08T12:00:00Z');
  let calls = 0;
  const cache = createLeaderboardCache(async () => { calls += 1; time += 20000; return { id: calls }; }, { now: () => time });
  const first = await cache.fetch();
  time += 14999;
  assert.equal(await cache.fetch(), first);
  assert.equal(calls, 1);
  time += 1;
  assert.notEqual(await cache.fetch(), first);
  assert.equal(calls, 2);
});

test('반복 조회는 재사용하고 기간별로 분리하며 15초 뒤 갱신한다', async () => {
  let time = Date.parse('2026-10-07T12:00:00Z');
  const calls = [];
  const cache = createLeaderboardCache(async period => {
    calls.push(period);
    return { period, leaders: [calls.length] };
  }, { now: () => time });
  const daily = await cache.fetch();
  assert.equal(await cache.fetch(), daily);
  assert.equal((await cache.fetch('weekly')).period, 'weekly');
  assert.equal(await cache.fetch('invalid'), daily);
  assert.deepEqual(calls, ['daily', 'weekly']);
  time += 15000;
  assert.notEqual(await cache.fetch(), daily);
  assert.deepEqual(calls, ['daily', 'weekly', 'daily']);
});

test('동시 요청을 하나로 합치고 실패 후에는 다시 요청한다', async () => {
  let calls = 0;
  let resolve;
  const cache = createLeaderboardCache(() => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error('offline'));
    return new Promise(done => { resolve = done; });
  });
  await assert.rejects(cache.fetch(), /offline/);
  const first = cache.fetch();
  assert.equal(cache.fetch(), first);
  await Promise.resolve();
  resolve({ leaders: [] });
  await first;
  assert.equal(calls, 2);
});

test('KST 자정과 월요일 경계를 넘으면 캐시를 재사용하지 않는다', async () => {
  let time = Date.parse('2026-10-11T14:59:59Z');
  let calls = 0;
  const cache = createLeaderboardCache(async () => ({ id: ++calls }), { now: () => time });
  await cache.fetch('daily');
  await cache.fetch('weekly');
  time += 1000;
  await cache.fetch('daily');
  await cache.fetch('weekly');
  assert.equal(calls, 4);
});

test('점수 제출 뒤 늦게 도착한 이전 응답이 새 캐시를 덮어쓰지 않는다', async () => {
  const resolvers = [];
  const cache = createLeaderboardCache(() => new Promise(resolve => resolvers.push(resolve)));
  const beforeSubmit = cache.fetch();
  await Promise.resolve();
  cache.invalidate();
  const afterSubmit = cache.fetch();
  await Promise.resolve();
  resolvers[1]({ leaders: ['new'] });
  const fresh = await afterSubmit;
  resolvers[0]({ leaders: ['old'] });
  await beforeSubmit;
  assert.equal(await cache.fetch(), fresh);
});
