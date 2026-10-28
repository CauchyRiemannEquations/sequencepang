// DOM-control regression harness; complements the real Chromium checks in tests/browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createLeaderboardCache } from '../../client/src/leaderboardCache.js';

function harness() {
  let time = Date.parse('2026-10-28T12:00:00Z');
  const requests = [];
  const nodes = new Map();
  function node(id = '') {
    let children = [];
    return { id, textContent: '', dataset: {}, open: true,
      set innerHTML(_value) { children = []; },
      appendChild(child) { children.push(child); },
      get children() { return children; },
      setAttribute() {}, classList: { add() {}, remove() {} },
      close() { this.open = false; }, showModal() { this.open = true; }
    };
  }
  for (const id of ['ranking-title', 'ranking-desc', 'ranking-period-meta', 'btn-ranking-daily',
    'btn-ranking-weekly', 'main-ranking-list', 'ranking-overlay']) nodes.set(id, node(id));
  nodes.get('btn-ranking-daily').dataset.period = 'daily';
  nodes.get('btn-ranking-weekly').dataset.period = 'weekly';
  const cache = createLeaderboardCache(period => new Promise((resolve, reject) => requests.push({ method: 'GET', period, resolve, reject })), { now: () => time });
  const context = vm.createContext({
    URLSearchParams, createLeaderboardCache: () => cache, recordApiTiming() {},
    requestFirebaseApi(path) {
      assert.equal(path, '/api/scores');
      return new Promise((resolve, reject) => requests.push({ method: 'POST', resolve, reject }));
    },
    document: { getElementById: id => nodes.get(id), createElement: () => node(), activeElement: null },
    fetchLeaderboard: period => cache.fetch(period), peekLeaderboard: period => cache.peek(period),
    formatWeekRange: value => value,
    renderGlobalLeaderboard(list, leaders) {
      list.innerHTML = '';
      leaders.forEach(name => { const item = node(); item.textContent = name; list.appendChild(item); });
    }
  });
  const clientSource = readFileSync(new URL('../../client/src/scoreClient.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/export /g, '');
  vm.runInContext(clientSource, context);
  const source = readFileSync(new URL('../../client/src/rankingHome.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export function', 'function');
  vm.runInContext(source, context);
  const board = (period, label) => ({ period, rankingDay: new Date(time + 9*60*60*1000).toISOString().slice(0, 10),
    rankingWeekStart: '2026-10-26', leaders: [label] });
  return { requests, nodes, context, board, cache,
    seed(period, name) { cache.prime(period, board(period, name)); },
    advance(ms) { time += ms; },
    list: () => nodes.get('main-ranking-list').children.map(item => item.textContent).join('|'),
    meta: () => nodes.get('ranking-period-meta').textContent,
    load: period => context.loadMainRanking(period)
  };
}

test('홈 랭킹은 만료 기록을 동기적으로 보이고 반복 클릭 갱신은 한 번만 한다', async () => {
  const h = harness(); h.seed('daily', 'cached'); h.advance(15000);
  const first = h.load('daily');
  assert.equal(h.list(), 'cached'); assert.match(h.meta(), /업데이트 중/);
  const second = h.load('daily'); await Promise.resolve();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(h.board('daily', 'fresh'));
  await Promise.all([first, second]);
  assert.equal(h.list(), 'fresh'); assert.doesNotMatch(h.meta(), /업데이트/);
  await h.load('daily'); assert.equal(h.requests.length, 1);
});

test('다른 탭의 늦은 응답은 현재 탭을 덮지 않는다', async () => {
  const h = harness(); h.seed('daily', 'cached'); h.advance(15000);
  const daily = h.load('daily'); await Promise.resolve();
  const weekly = h.load('weekly'); await Promise.resolve();
  assert.match(h.list(), /불러오는 중/);
  h.requests[0].resolve(h.board('daily', 'old-day')); await daily;
  assert.match(h.nodes.get('ranking-title').textContent, /주간/);
  assert.doesNotMatch(h.list(), /old-day/);
  h.requests[1].resolve(h.board('weekly', 'fresh-week')); await weekly;
  assert.equal(h.list(), 'fresh-week');
});

test('닫힌 창의 결과를 적용하지 않고 재열기에는 진행 중 요청을 재사용한다', async () => {
  const h = harness(); const first = h.load('daily'); await Promise.resolve();
  h.context.closeRankingOverlay();
  h.requests[0].resolve(h.board('daily', 'while-closed')); await first;
  assert.match(h.list(), /불러오는 중/);
  h.context.openRankingOverlay(); await Promise.resolve();
  assert.equal(h.list(), 'while-closed'); assert.equal(h.requests.length, 1);
  h.advance(15000); const refresh = h.load('daily'); await Promise.resolve();
  h.context.closeRankingOverlay(); h.context.openRankingOverlay(); await Promise.resolve();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(h.board('daily', 'reopened')); await refresh;
  await Promise.resolve();
  assert.equal(h.list(), 'reopened');
});

test('실패한 갱신은 이전 기록임을 알리고 자정 후에는 그 기록을 보여주지 않는다', async () => {
  const h = harness(); h.seed('daily', 'cached'); h.advance(15000);
  const first = h.load('daily'); await Promise.resolve();
  h.requests[0].reject(new Error('offline')); await first;
  assert.equal(h.list(), 'cached'); assert.match(h.meta(), /업데이트 실패.*이전 기록 표시/);
  h.advance(3 * 60 * 60 * 1000);
  const nextDay = h.load('daily'); await Promise.resolve();
  assert.match(h.list(), /불러오는 중/); assert.doesNotMatch(h.list(), /cached/);
  h.requests[1].resolve(h.board('daily', 'new-day')); await nextDay;
  assert.equal(h.list(), 'new-day');
});


test('홈 GET 대기 중 제출이 완료되면 이전 GET 대신 제출 결과를 DOM에 표시한다', async () => {
  const h = harness();
  const submitted = h.context.submitScore({ score: 20 });
  const displayed = h.load('daily');
  await Promise.resolve();
  assert.equal(h.requests[0].method, 'POST');
  assert.equal(h.requests[1].method, 'GET');
  h.requests[0].resolve({ ok: true, leaderboard: h.board('daily', 'accepted-score') });
  await submitted;
  h.requests[1].resolve(h.board('daily', 'old-score'));
  await displayed;
  assert.equal(h.list(), 'accepted-score');
  assert.equal(h.cache.peek().payload.leaders[0], 'accepted-score');
  assert.equal(h.requests.length, 2, 'POST + old GET only; no duplicate GET after prime');
});

test('자정을 건너 완료된 GET은 전날 기록을 그리지 않고 새 날짜 응답만 표시한다', async () => {
  const h = harness();
  const oldBoard = h.board('daily', 'yesterday');
  const displayed = h.load('daily'); await Promise.resolve();
  h.advance(3 * 60 * 60 * 1000);
  h.requests[0].resolve(oldBoard);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests.length, 2);
  assert.doesNotMatch(h.list(), /yesterday/);
  h.requests[1].resolve(h.board('daily', 'today'));
  await displayed;
  assert.equal(h.list(), 'today');
  assert.match(h.meta(), /2026-10-29/);
});

test('자정 이후 재조회 실패 시 전날의 표시용 캐시를 복원하지 않는다', async () => {
  const h = harness(); h.seed('daily', 'yesterday'); h.advance(15000);
  const displayed = h.load('daily'); await Promise.resolve();
  assert.equal(h.list(), 'yesterday');
  const oldBoard = h.board('daily', 'yesterday');
  h.advance(3 * 60 * 60 * 1000);
  h.requests[0].resolve(oldBoard);
  await new Promise(resolve => setImmediate(resolve));
  h.requests[1].reject(new Error('offline'));
  await displayed;
  assert.doesNotMatch(h.list(), /yesterday/);
  assert.match(h.list(), /offline/);
  assert.equal(h.requests.length, 2);
});
