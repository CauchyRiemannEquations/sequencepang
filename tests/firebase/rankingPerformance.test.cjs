const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCombinedRateLimiter } = require('../../functions/src/rateLimit');
const { createSingleFlight } = require('../../functions/src/singleFlight');
const { loadPeriodDocs } = require('../../functions/src/scoreRoutes');
const { getCurrentRankingDayInfo, getCurrentRankingWeekInfo, RANKING_SEASON_ID } = require('../../functions/src/constants');
const { createRequestTiming } = require('../../functions/src/requestTiming');
const { EventEmitter } = require('node:events');

test('IP·UID 제한을 한 트랜잭션으로 확인하며 UID 거절도 기존처럼 IP 한도를 소비한다', async () => {
  const counts = new Map();
  let transactions = 0;
  let getAllCalls = 0;
  let writes = 0;
  let time = 60000;
  const firestore = { collection: () => ({ doc: id => ({ id }) }), runTransaction: async task => {
    transactions += 1;
    return task({ getAll: async (...refs) => {
      getAllCalls += 1;
      return refs.map(ref => ({ exists: counts.has(ref.id), data: () => ({ count: counts.get(ref.id) }) }));
    }, set: (ref, data) => { counts.set(ref.id, data.count); writes += 1; assert.equal(data.expiresAt.toMillis(), time + 120000); } });
  } };
  const limiter = createCombinedRateLimiter([
    { windowMs: 60000, max: 3, keyPrefix: 'ip', subjectType: 'ip' },
    { windowMs: 60000, max: 2, keyPrefix: 'uid' }
  ], { getFirestore: () => firestore, now: () => time });
  const response = { status(code) { this.code = code; return this; }, json() {} };
  let nextCalls = 0;
  const request = uid => limiter({ ip: 'shared-ip', auth: { uid } }, response, error => { assert.ifError(error); nextCalls += 1; });
  await request('alice'); await request('alice'); await request('alice');
  assert.equal(response.code, 429); assert.equal(writes, 5); assert.equal(nextCalls, 2);
  await request('bob'); await request('charlie');
  assert.equal(writes, 5); assert.equal(nextCalls, 2); assert.equal(transactions, 5); assert.equal(getAllCalls, 5);
  time += 60000; await request('alice'); assert.equal(nextCalls, 3);
});

test('동시 캐시 미적중은 revision별 한 번만 재생성하고 실패 후 다시 시도한다', async () => {
  const flights = createSingleFlight();
  let resolve;
  let calls = 0;
  const first = flights.run('daily:revision-1', () => { calls += 1; return new Promise(done => { resolve = done; }); });
  const shared = flights.run('daily:revision-1', () => assert.fail('duplicate read'));
  assert.equal(shared.promise, first.promise); assert.equal(shared.shared, true);
  await Promise.resolve();
  const newer = flights.run('daily:revision-2', async () => 'new-score');
  assert.equal(await newer.promise, 'new-score');
  resolve('old-score'); assert.equal(await first.promise, 'old-score'); assert.equal(calls, 1);
  await assert.rejects(flights.run('weekly:1', async () => { throw Error('offline'); }).promise, /offline/);
  assert.equal(await flights.run('weekly:1', async () => 'retried').promise, 'retried');
});

test('일간·주간의 기본/레거시 쿼리를 병렬 시작하고 기존 병합 결과를 유지한다', async () => {
  const day = getCurrentRankingDayInfo(); const week = getCurrentRankingWeekInfo();
  const record = id => ({ id, data: () => ({ nickname: id, score: 10, mode: 'timeAttack',
    rankingSeason: RANKING_SEASON_ID, rankingDay: day.rankingDay, rankingWeek: week.rankingWeek }) });
  for (const period of ['daily', 'weekly']) {
    const resolvers = [];
    function query() {
      return { where: () => query(), orderBy: () => query(), limit: () => query(),
        get: () => new Promise(resolve => resolvers.push(resolve)) };
    }
    const loading = loadPeriodDocs(query(), period, RANKING_SEASON_ID, day, week);
    assert.equal(resolvers.length, 2, 'both database requests start before either resolves');
    resolvers[1]({ docs: [record('duplicate'), record('legacy')] });
    resolvers[0]({ docs: [record('duplicate'), record('indexed')] });
    assert.deepEqual((await loading).map(doc => doc.id), ['duplicate', 'indexed', 'legacy']);
  }
});

test('서버 계측은 구간을 헤더와 로그에 기록하고 식별 정보를 포함하지 않는다', async () => {
  let time = 0;
  const logs = [];
  const middleware = createRequestTiming({ now: () => time, log: (...row) => logs.push(row) });
  const req = { originalUrl: '/api/leaderboard?period=daily', app: { locals: { moduleLoadMs: 12 } } };
  const res = new EventEmitter(); res.statusCode = 200;
  const headers = {};
  res.set = (key, value) => { headers[key] = value; };
  res.json = data => data;
  middleware(req, res, () => {});
  await req.timing.measure('auth_verify', async () => { time += 4; });
  await req.timing.measure('firestore_cache_read', async () => { time += 20; });
  req.timing.set('cache', 'firestore-hit'); res.json({ leaders: [] }); res.emit('finish');
  assert.match(headers['Server-Timing'], /auth_verify;dur=4.0/);
  assert.match(headers['Server-Timing'], /server_total;dur=24.0/);
  assert.match(headers['Server-Timing'], /instance_first_request;desc="true"/);
  assert.equal(logs[0][1].cache, 'firestore-hit');
});

test('인덱스가 없으면 기존 fallback·레거시 병합을 유지하고 실패 원인을 계측한다', async () => {
  const day = getCurrentRankingDayInfo(); const week = getCurrentRankingWeekInfo();
  const doc = { id: 'legacy', data: () => ({ nickname: '학생', score: 100, mode: 'timeAttack',
    createdAt: new Date(day.dayStartUtcMs + 1000) }) };
  const details = {};
  function query(indexed = false) {
    return { where: () => query(true), orderBy: () => query(indexed), limit: () => query(indexed),
      get: async () => { if (indexed) throw Object.assign(Error('missing index'), { code: 9 }); return { docs: [doc] }; } };
  }
  const timing = { measure: (_name, task) => task(), set: (key, value) => { details[key] = value; } };
  const result = await loadPeriodDocs(query(), 'daily', RANKING_SEASON_ID, day, week, timing);
  assert.deepEqual(result.map(value => value.id), ['legacy']);
  assert.equal(details.indexFallback, true);
});
