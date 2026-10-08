import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiRequest } from '../../client/src/apiTiming.js';
import { createLeaderboardCache } from '../../client/src/leaderboardCache.js';

test('첫 조회의 인증·토큰·HTTP·디코딩 시간과 반복 조회 무요청을 구분한다', async () => {
  let time = 0;
  let calls = 0;
  const timings = [];
  const request = createApiRequest({
    now: () => time, record: sample => timings.push(sample), getBaseUrl: () => 'https://example.test',
    ensureUser: async () => { time += 40; return { getIdToken: async () => { time += 10; return 'secret'; } }; },
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.equal(options.headers.Authorization, 'Bearer secret');
      assert.equal(options.headers['Content-Type'], undefined);
      time += 80;
      return { ok: true, status: 200, headers: new Headers({ 'Server-Timing': 'auth_verify;dur=2, firestore_scores;dur=40' }),
        json: async () => { time += 5; return { leaders: [] }; } };
    }
  });
  const cache = createLeaderboardCache(period => request(`/api/leaderboard?period=${period}`),
    { now: () => time, onTiming: sample => timings.push(sample) });
  const first = await cache.fetch('daily');
  assert.deepEqual(timings[0], { kind: 'api', period: 'daily', authReadyMs: 40, tokenMs: 10, httpMs: 80,
    decodeMs: 5, totalMs: 135, status: 200, serverTiming: 'auth_verify;dur=2, firestore_scores;dur=40' });
  assert.equal(await cache.fetch('daily'), first);
  assert.equal(calls, 1);
  assert.deepEqual(timings.at(-1), { kind: 'client-hit', period: 'daily', totalMs: 0 });
  assert.ok(!JSON.stringify(timings).includes('secret'));
});

test('실패 진단을 남기고 실패 응답은 캐시하지 않으며 기록 오류는 요청을 깨지 않는다', async () => {
  const rows = [];
  const request = createApiRequest({ ensureUser: async () => ({ getIdToken: async () => 'token' }),
    getBaseUrl: () => 'https://example.test', record: sample => { rows.push(sample); throw Error('diagnostics'); },
    fetchImpl: async () => ({ ok: false, status: 429, headers: new Headers(), json: async () => ({ error: '제한' }) }) });
  const cache = createLeaderboardCache(() => request('/api/leaderboard?period=daily'));
  await assert.rejects(cache.fetch(), /제한/);
  await assert.rejects(cache.fetch(), /제한/);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 429);
});

test('POST JSON·keepalive·인증은 그대로 유지하고 랭킹 외 요청은 진단에 수집하지 않는다', async () => {
  const rows = [];
  const request = createApiRequest({ ensureUser: async () => ({ getIdToken: async () => 'token' }),
    getBaseUrl: () => 'https://example.test', record: sample => rows.push(sample),
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, 'POST'); assert.equal(options.keepalive, true);
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.deepEqual(JSON.parse(options.body), { score: 100 });
      return { ok: true, status: 201, headers: new Headers(), json: async () => ({ ok: true }) };
    } });
  await request('/api/scores', { body: { score: 100 }, keepalive: true });
  assert.equal(rows.length, 0);
});
