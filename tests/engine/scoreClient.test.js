import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createLeaderboardCache } from '../../client/src/leaderboardCache.js';

const time = Date.parse('2026-10-28T12:00:00Z');
const board = label => ({ period: 'daily', rankingDay: '2026-10-28', leaders: [label] });
function harness() {
  const requests = [];
  const context = vm.createContext({ URLSearchParams,
    createLeaderboardCache: (load, options) => createLeaderboardCache(load, { ...options, now: () => time }),
    recordApiTiming() {},
    requestFirebaseApi(path, options) {
      return new Promise((resolve, reject) => requests.push({ path, options, resolve, reject }));
    }
  });
  const source = readFileSync(new URL('../../client/src/scoreClient.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/export /g, '');
  vm.runInContext(source, context);
  return { requests, client: context };
}

test('POST의 일간 결과를 재사용해 게임 종료 후 GET 요청을 없앤다', async () => {
  const { requests, client } = harness();
  const submitted = client.submitScore({ score: 100 });
  requests[0].resolve({ ok: true, leaderboard: board('accepted') });
  await submitted;
  const result = await client.fetchLeaderboard();
  assert.equal(result.leaders[0], 'accepted');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/scores');
});

test('이전 백엔드 응답/계산 실패/POST 실패는 평소 GET 경로로 복구한다', async () => {
  for (const outcome of [{ ok: true }, { ok: true, leaderboard: null }, new Error('offline')]) {
    const { requests, client } = harness();
    const submitted = client.submitScore({ score: 100 });
    if (outcome instanceof Error) {
      requests[0].reject(outcome);
      await assert.rejects(submitted, /offline/);
    } else { requests[0].resolve(outcome); await submitted; }
    assert.equal(client.peekLeaderboard(), null);
    const fetched = client.fetchLeaderboard();
    await Promise.resolve();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].path, '/api/leaderboard?period=daily');
    requests[1].resolve(board('fresh'));
    assert.equal((await fetched).leaders[0], 'fresh');
  }
});

test('오래된 제출 완료가 최신 결과를 덮지 않고 필요한 갱신만 다시 요청한다', async () => {
  const { requests, client } = harness();
  const older = client.submitScore({ score: 10 });
  const newer = client.submitScore({ score: 20 });
  requests[1].resolve({ ok: true, leaderboard: board('newer') });
  await newer;
  assert.equal((await client.fetchLeaderboard()).leaders[0], 'newer');
  requests[0].resolve({ ok: true, leaderboard: board('older') });
  await older;
  assert.equal(client.peekLeaderboard(), null, 'a late commit may require a fresh combined snapshot');
  const refreshed = client.fetchLeaderboard();
  await Promise.resolve();
  requests[2].resolve(board('both'));
  assert.equal((await refreshed).leaders[0], 'both');
  assert.equal(requests.length, 3);
});

test('제출 전 진행하던 GET이 늦게 끝나도 제출 결과를 캐시에서 교체하지 않는다', async () => {
  const { requests, client } = harness();
  const before = client.fetchLeaderboard();
  await Promise.resolve();
  const submitted = client.submitScore({ score: 20 });
  requests[1].resolve({ ok: true, leaderboard: board('accepted') });
  await submitted;
  requests[0].resolve(board('old'));
  assert.equal((await before).leaders[0], 'accepted', 'the original waiter receives the new snapshot');
  assert.equal((await client.fetchLeaderboard()).leaders[0], 'accepted');
  assert.equal(requests.length, 2);
});
