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

test('제출 응답으로 채운 일간 랭킹은 추가 요청 없이 표시하고 15초 후 갱신한다', async () => {
  let time = Date.parse('2026-10-28T12:00:00Z');
  let requests = 0;
  const payload = { period: 'daily', rankingDay: '2026-10-28', leaders: ['accepted'] };
  const cache = createLeaderboardCache(async () => { requests += 1; return { ...payload, leaders: ['updated'] }; }, { now: () => time });
  assert.equal(cache.prime('daily', payload), true);
  assert.equal(cache.peek().payload, payload);
  assert.equal(cache.peek().stale, false);
  assert.equal(await cache.fetch(), payload);
  assert.equal(requests, 0);
  time += 15000;
  assert.equal(cache.peek().stale, true);
  assert.equal(cache.peek().payload, payload, 'peek preserves display only, not freshness');
  assert.equal(requests, 0);
  await cache.fetch();
  assert.equal(requests, 1);
});

test('이전 세대, 다른 기간, KST 전날의 제출 응답은 캐시에 넣지 않는다', () => {
  const time = Date.parse('2026-10-28T15:00:00Z');
  const cache = createLeaderboardCache(async () => {}, { now: () => time });
  const payload = { period: 'daily', rankingDay: '2026-10-29', leaders: [] };
  const previous = cache.invalidate();
  cache.invalidate();
  assert.equal(cache.prime('daily', payload, previous), false);
  assert.equal(cache.prime('daily', { ...payload, rankingDay: '2026-10-28' }), false);
  assert.equal(cache.prime('daily', { ...payload, period: 'weekly' }), false);
  assert.equal(cache.prime('daily', { ...payload, leaders: null }), false);
  assert.equal(cache.peek(), null);
});

test('prime 이전의 지연된 조회가 제출 결과를 덮어쓰지 않는다', async () => {
  const time = Date.parse('2026-10-28T12:00:00Z');
  let resolve;
  const cache = createLeaderboardCache(() => new Promise(done => { resolve = done; }), { now: () => time });
  const oldRequest = cache.fetch();
  await Promise.resolve();
  const accepted = { period: 'daily', rankingDay: '2026-10-28', leaders: ['accepted'] };
  assert.equal(cache.prime('daily', accepted), true);
  resolve({ ...accepted, leaders: ['old'] });
  assert.equal(await oldRequest, accepted, 'waiting consumers also receive the accepted snapshot');
  assert.equal(await cache.fetch(), accepted);
});

test('KST 자정 뒤에는 이전 결과를 반환하지 않고 한 번만 새 날짜를 조회한다', async () => {
  let time = Date.parse('2026-10-28T14:59:59Z');
  let resolve, calls = 0;
  const today = { period: 'daily', rankingDay: '2026-10-29', leaders: ['today'] };
  const cache = createLeaderboardCache(() => {
    calls += 1;
    return calls === 1 ? new Promise(done => { resolve = done; }) : today;
  }, { now: () => time });
  const request = cache.fetch();
  await Promise.resolve();
  time += 1000;
  resolve({ period: 'daily', rankingDay: '2026-10-28', leaders: ['yesterday'] });
  assert.equal(await request, today);
  assert.equal(cache.peek().payload, today);
  assert.equal(calls, 2);
  assert.equal(cache.prime('daily', { period: 'daily', rankingDay: '2026-10-28', leaders: [] }), false);
});

test('서버가 계속 잘못된 날짜를 주어도 두 요청 뒤 종료하고 반복 조회하지 않는다', async () => {
  let calls = 0;
  const cache = createLeaderboardCache(async () => {
    calls += 1;
    return { period: 'daily', rankingDay: '2026-10-27', leaders: ['wrong-day'] };
  }, { now: () => Date.parse('2026-10-28T12:00:00Z') });
  await assert.rejects(cache.fetch(), /랭킹이 변경/);
  assert.equal(calls, 2);
  assert.equal(cache.peek(), null);
});

test('이전 세대의 대기자는 이미 진행 중인 현재 조회에 합류한다', async () => {
  const resolvers = [];
  const cache = createLeaderboardCache(() => new Promise(resolve => resolvers.push(resolve)));
  const old = cache.fetch(); await Promise.resolve();
  cache.invalidate();
  const current = cache.fetch(); await Promise.resolve();
  resolvers[0]({ leaders: ['old'] });
  await Promise.resolve();
  resolvers[1]({ leaders: ['current'] });
  assert.equal(await old, await current);
  assert.equal(resolvers.length, 2, 'joining an existing request creates no third GET');
});

test('이전 요청의 실패도 primed 결과를 숨기거나 추가 GET을 만들지 않는다', async () => {
  let reject, calls = 0;
  const cache = createLeaderboardCache(() => {
    calls += 1;
    return new Promise((_resolve, fail) => { reject = fail; });
  }, { now: () => Date.parse('2026-10-28T12:00:00Z') });
  const old = cache.fetch(); await Promise.resolve();
  const accepted = { period: 'daily', rankingDay: '2026-10-28', leaders: ['accepted'] };
  cache.prime('daily', accepted);
  reject(new Error('old request offline'));
  assert.equal(await old, accepted);
  assert.equal(calls, 1);
});
