const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const functionRequire = createRequire(require.resolve('../../functions/package.json'));
const { Timestamp } = functionRequire('firebase-admin/firestore');
const {
  loadPeriodDocs, buildRankedEntries, computeDailyResult, loadYesterdayTop,
  getCachedLeaderboard, setCachedLeaderboard, buildLeaderboardCacheKey
} = require('../../functions/src/scoreRoutes');
const { createRankingSnapshotCache } = require('../../functions/src/rankingSnapshotCache');
const { getCurrentRankingDayInfo, getCurrentRankingWeekInfo, RANKING_SEASON_ID, DAY_MS } = require('../../functions/src/constants');

const FIXED_NOW = Date.parse('2026-10-28T03:00:00Z');
const FIVE_MINUTES = 300000;
function clock(t, initial = FIXED_NOW) {
  const original = Date.now;
  let time = initial;
  Date.now = () => time;
  t.after(() => { Date.now = original; });
  return { set(value) { time = value; }, advance(value) { time += value; } };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function timing() {
  const details = {};
  return { details, measure: (_name, task) => task(),
    set: (name, value) => { details[name] = value; },
    add: (name, value) => { details[name] = (details[name] || 0) + value; } };
}
function fakeFirestore(records = [], { stored = new Map(), failIndexed = false, failGlobal = 0, failLookup = 0, failWrite = 0, onQuery } = {}) {
  const rows = new Map(records.map(row => [row.id, row.value]));
  if (!stored.has('ranking_state/current')) stored.set('ranking_state/current', { revision: 1 });
  const counts = { lookups: 0, queryReadUnits: 0, indexed: 0, global: 0, writes: 0, transactions: 0 };
  let remainingGlobalFailures = failGlobal;
  let remainingLookupFailures = failLookup;
  let remainingWriteFailures = failWrite;
  let transactionTail = Promise.resolve();
  const api = {
    rows, stored, counts,
    runTransaction(task) {
      counts.transactions += 1;
      // Serialize the fake transactions, preserving read-before-write and atomic
      // single-document publication semantics without making production calls.
      const result = transactionTail.then(async () => {
        const writes = [];
        const value = await task({ get: reference => reference.get(),
          set: (reference, data) => { writes.push([reference, data]); } });
        for (const [reference, data] of writes) await reference.set(data);
        return value;
      });
      transactionTail = result.catch(() => {});
      return result;
    },
    collection(name) {
      function query(filters = [], limit = Infinity, fields) {
        return {
          doc(id) {
            const path = `${name}/${id}`;
            return { path, id,
              async get() {
                counts.lookups += 1;
                if (remainingLookupFailures-- > 0) throw new Error('transient cache lookup failure');
                const value = stored.get(path);
                return { exists: value !== undefined, data: () => value };
              },
              async set(value) {
                counts.writes += 1;
                if (remainingWriteFailures-- > 0) throw new Error('transient cache write failure');
                stored.set(path, value);
              }
            };
          },
          where(field, op, value) { assert.equal(op, '=='); return query([...filters, [field, value]], limit, fields); },
          orderBy(field, direction) { assert.equal(field, 'score'); assert.equal(direction, 'desc'); return query(filters, limit, fields); },
          limit(value) { return query(filters, value, fields); },
          select(...value) { return query(filters, limit, value); },
          async get() {
            assert.equal(name, 'scores');
            const indexed = filters.length > 0;
            counts[indexed ? 'indexed' : 'global'] += 1;
            if (indexed && failIndexed) throw Object.assign(new Error('missing index'), { code: 9 });
            if (!indexed && remainingGlobalFailures-- > 0) throw new Error('transient global read failure');
            const docs = [...rows].filter(([, data]) => filters.every(([key, value]) => data[key] === value))
              .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
              .slice(0, limit).map(([id, source]) => {
                const data = fields ? Object.fromEntries(Object.entries(source).filter(([key]) => fields.includes(key))) : { ...source };
                return { id, data: () => data };
              });
            counts.queryReadUnits += Math.max(1, docs.length);
            if (onQuery) await onQuery({ indexed, filters, docs });
            return { docs };
          }
        };
      }
      return query();
    }
  };
  return api;
}
function fixture() {
  const day = getCurrentRankingDayInfo(FIXED_NOW), week = getCurrentRankingWeekInfo(FIXED_NOW);
  const records = Array.from({ length: 1250 }, (_, i) => ({ id: `historic-${String(i).padStart(4, '0')}`, value: {
    nickname: `옛기록${i}`, playerId: `historic-${i}`, score: 100000 - i, maxCombo: 2, mode: 'timeAttack',
    createdAt: Timestamp.fromMillis(day.dayStartUtcMs - 10 * DAY_MS), rankingSeason: RANKING_SEASON_ID
  } }));
  for (let i = 0; i < 75; i += 1) records.push({ id: `today-${i}`, value: {
    nickname: `현재${Math.floor(i / 2)}`, playerId: `player-${i % 69}`, score: 1000 - Math.floor(i / 3),
    maxCombo: i, mode: 'timeAttack', createdAt: Timestamp.fromMillis(day.dayStartUtcMs + i * 1000),
    rankingSeason: RANKING_SEASON_ID, rankingDay: day.rankingDay, rankingWeek: week.rankingWeek,
    unusedAnalytics: 'not transferred'
  } });
  records.push({ id: 'legacy-in-global-window', value: { nickname: '옛형식', score: 200000, mode: 'timeAttack',
    createdAt: Timestamp.fromMillis(day.dayStartUtcMs + 100), playerId: 'legacy' } });
  records.push({ id: 'metadata-precedence', value: { nickname: '기간우선', score: 190000, mode: 'timeAttack',
    rankingSeason: RANKING_SEASON_ID, rankingDay: day.rankingDay, rankingWeek: week.rankingWeek,
    createdAt: Timestamp.fromMillis(day.dayStartUtcMs - 10 * DAY_MS) } });
  records.push({ id: 'legacy-outside-global-window', value: { nickname: '범위밖', score: 1, mode: 'timeAttack',
    createdAt: Timestamp.fromMillis(day.dayStartUtcMs + 100) } });
  return { day, week, records };
}
// Independent reconstruction of the old indexed-300 + global-1200 candidate contract.
// This deliberately does not turn compatibility into a period-bounded query.
function baselineCandidates(records, period, day, week) {
  const field = period === 'daily' ? 'rankingDay' : 'rankingWeek';
  const value = period === 'daily' ? day.rankingDay : week.rankingWeek;
  const start = period === 'daily' ? day.dayStartUtcMs : week.weekStartUtcMs;
  const end = period === 'daily' ? day.dayEndUtcMs : week.weekEndUtcMs;
  const sorted = [...records].sort((a, b) => b.value.score - a.value.score || a.id.localeCompare(b.id));
  const indexed = sorted.filter(row => row.value.rankingSeason === RANKING_SEASON_ID && row.value[field] === value && row.value.mode === 'timeAttack').slice(0, 300);
  const global = sorted.slice(0, 1200).filter(row => {
    const data = row.value;
    if (data.mode !== 'timeAttack') return false;
    if (data[field]) return data[field] === value;
    return data.createdAt.toMillis() >= start && data.createdAt.toMillis() < end;
  });
  return [...new Map([...indexed, ...global].map(row => [row.id, row])).values()];
}
function comparable(entries) {
  return entries.map(({ unusedAnalytics, ...entry }) => entry);
}

test('global supplement reuse preserves exact legacy coverage, metadata precedence, ties, dedupe and TOP30', async t => {
  clock(t);
  const { records, day, week } = fixture();
  const db = fakeFirestore(records);
  for (const period of ['daily', 'weekly']) {
    const actual = await loadPeriodDocs(db.collection('scores'), period, RANKING_SEASON_ID, day, week, undefined, { firestore: db, revision: 1 });
    const expected = baselineCandidates(records, period, day, week);
    assert.deepEqual(actual.map(doc => doc.id), expected.map(row => row.id));
    assert.ok(!actual.some(doc => doc.id === 'legacy-outside-global-window'));
    const ranked = comparable(buildRankedEntries(actual));
    assert.deepEqual(ranked, comparable(buildRankedEntries(expected.map(row => ({ data: () => row.value })))));
    assert.equal(ranked.slice(0, 30).length, 30);
    assert.equal(ranked[0].nickname, '옛형식');
    assert.equal(ranked[1].nickname, '기간우선');
  }
  assert.equal(db.counts.global, 1);
  assert.equal(db.counts.indexed, 2);
});

test('simultaneous daily/weekly share one 1200-document read, with independently counted read savings', async t => {
  clock(t);
  const { records, day, week } = fixture();
  const db = fakeFirestore(records);
  const metrics = [timing(), timing()];
  await Promise.all(['daily', 'weekly'].map((period, index) => loadPeriodDocs(db.collection('scores'), period,
    RANKING_SEASON_ID, day, week, metrics[index], { firestore: db, revision: 1 })));
  const indexedReads = ['rankingDay', 'rankingWeek'].reduce((total, field) => total + Math.min(300,
    records.filter(row => row.value.rankingSeason === RANKING_SEASON_ID && row.value[field] === (field === 'rankingDay' ? day.rankingDay : week.rankingWeek)).length), 0);
  const oldReadUnits = indexedReads + 1200 * 2;
  assert.equal(db.counts.queryReadUnits, indexedReads + 1200);
  assert.equal(oldReadUnits - db.counts.queryReadUnits, 1200);
  assert.equal(db.counts.global, 1);
  assert.equal(metrics.reduce((sum, value) => sum + (value.details.documentReadUnitsObserved || 0), 0), db.counts.queryReadUnits);
});

test('missing index reuses the same fallback supplement instead of scanning 1200 twice', async t => {
  clock(t);
  const { records, day, week } = fixture();
  const db = fakeFirestore(records, { failIndexed: true });
  const metric = timing();
  const result = await loadPeriodDocs(db.collection('scores'), 'daily', RANKING_SEASON_ID, day, week, metric, { firestore: db, revision: 1 });
  assert.equal(db.counts.global, 1);
  assert.equal(db.counts.queryReadUnits, 1200);
  assert.equal(metric.details.indexFallback, true);
  assert.deepEqual(result.map(doc => doc.id), ['legacy-in-global-window', 'metadata-precedence']);
});

test('revision changes invalidate global snapshots, 31 seconds does not, aligned five-minute boundary does', async t => {
  const time = clock(t);
  const { records, day, week } = fixture();
  const db = fakeFirestore(records);
  const load = revision => loadPeriodDocs(db.collection('scores'), 'daily', RANKING_SEASON_ID, day, week, undefined, { firestore: db, revision });
  await load(1);
  time.advance(31000); await load(1); assert.equal(db.counts.global, 1);
  await load(2); assert.equal(db.counts.global, 2);
  time.set(FIXED_NOW + FIVE_MINUTES); await load(2); assert.equal(db.counts.global, 3);
});

test('shared persisted response survives 31 seconds, reads revision every time, and rejects old revision or expired boundary', async t => {
  const time = clock(t);
  const db = fakeFirestore();
  const day = getCurrentRankingDayInfo(), week = getCurrentRankingWeekInfo();
  const key = buildLeaderboardCacheKey('daily', RANKING_SEASON_ID, day, week);
  const payload = { leaders: [], period: 'daily' };
  await setCachedLeaderboard(db, key, payload, 1);
  const stored = db.stored.get(`leaderboard_cache/${key}`);
  assert.equal(stored.freshUntil.toMillis(), FIXED_NOW + FIVE_MINUTES);
  assert.equal(stored.expiresAt.toMillis(), FIXED_NOW + FIVE_MINUTES, 'rollback readers must observe the same freshness bound');
  assert.equal(db.counts.lookups, 1, 'publication condition costs one document lookup');
  time.advance(31000);
  assert.equal((await getCachedLeaderboard(db, key)).payload, payload);
  assert.equal(db.counts.lookups, 3);
  db.stored.set('ranking_state/current', { revision: 2 });
  assert.equal((await getCachedLeaderboard(db, key)).payload, null);
  assert.equal(db.counts.lookups, 5);
  await setCachedLeaderboard(db, key, payload, 2);
  time.set(FIXED_NOW + FIVE_MINUTES);
  assert.equal((await getCachedLeaderboard(db, key)).payload, null);
});

test('KST midnight and Monday rollover use distinct period response keys', () => {
  const before = Date.parse('2026-11-01T14:59:59Z'), after = before + 1000;
  for (const period of ['daily', 'weekly']) {
    assert.notEqual(buildLeaderboardCacheKey(period, RANKING_SEASON_ID, getCurrentRankingDayInfo(before), getCurrentRankingWeekInfo(before)),
      buildLeaderboardCacheKey(period, RANKING_SEASON_ID, getCurrentRankingDayInfo(after), getCurrentRankingWeekInfo(after)));
  }
});

test('failed global snapshot never poisons the revision cache and retry performs a new read', async t => {
  clock(t);
  const { records, day, week } = fixture();
  const db = fakeFirestore(records, { failGlobal: 1 });
  const load = () => loadPeriodDocs(db.collection('scores'), 'daily', RANKING_SEASON_ID, day, week, undefined, { firestore: db, revision: 1 });
  await assert.rejects(load(), /transient global/);
  assert.ok((await load()).length > 0);
  assert.equal(db.counts.global, 2);
});

test('cache lookup/write failures fail open without inventing a cache hit and a later request retries', async t => {
  clock(t);
  const db = fakeFirestore([], { failLookup: 1, failWrite: 1 });
  const payload = { leaders: [], period: 'daily' };
  assert.deepEqual(await getCachedLeaderboard(db, 'daily'), { revision: null, payload: null });
  await setCachedLeaderboard(db, 'daily', payload, 1);
  assert.equal(db.stored.has('leaderboard_cache/daily'), false);
  await setCachedLeaderboard(db, 'daily', payload, 1);
  assert.equal((await getCachedLeaderboard(db, 'daily')).payload, payload);
  assert.equal(db.counts.writes, 2);
});

test('post-submit rank and leaderboard share the candidate scan and publish a response cache', async t => {
  clock(t);
  const { records } = fixture();
  const db = fakeFirestore(records);
  const result = await computeDailyResult(db, { nickname: '현재0', playerId: 'player-0' });
  assert.ok(result.dailyRank.rank > 0);
  assert.equal(result.leaderboard.leaders.length, 30);
  assert.equal(db.counts.global, 1);
  assert.equal(db.counts.indexed, 1);
  const key = buildLeaderboardCacheKey('daily', RANKING_SEASON_ID, getCurrentRankingDayInfo(), getCurrentRankingWeekInfo());
  const readsBefore = db.counts.queryReadUnits;
  assert.deepEqual((await getCachedLeaderboard(db, key)).payload, result.leaderboard);
  assert.equal(db.counts.queryReadUnits, readsBefore, 'subsequent response lookup does not repeat score scans');
});

test('a newer write during post-submit calculation cannot make the old revision response a cache hit', async t => {
  clock(t);
  const { records } = fixture();
  let changed = false;
  const db = fakeFirestore(records, { onQuery() {
    if (!changed) { changed = true; db.stored.set('ranking_state/current', { revision: 2 }); }
  } });
  await computeDailyResult(db, { nickname: '현재0', playerId: 'player-0' });
  const key = buildLeaderboardCacheKey('daily', RANKING_SEASON_ID, getCurrentRankingDayInfo(), getCurrentRankingWeekInfo());
  assert.equal(db.stored.get(`leaderboard_cache/${key}`).revision, 1);
  assert.deepEqual(await getCachedLeaderboard(db, key), { revision: 2, payload: null });
});

test('late publication of an old revision cannot evict the newer payload even with a later requested expiry', async t => {
  clock(t);
  const db = fakeFirestore();
  const metric = timing();
  const oldReady = deferred();
  const old = (async () => {
    await oldReady.promise;
    await setCachedLeaderboard(db, 'daily', { leaders: ['old'] }, 1, FIXED_NOW + 2 * FIVE_MINUTES, metric);
  })();
  const fresh = { leaders: ['new'] };
  await setCachedLeaderboard(db, 'daily', fresh, 2, FIXED_NOW + FIVE_MINUTES, metric);
  oldReady.resolve();
  await old;
  assert.equal(db.stored.get('leaderboard_cache/daily').payload, fresh);
  assert.equal(db.stored.get('leaderboard_cache/daily').revision, 2);
  assert.equal(db.counts.writes, 1, 'old publication reads the cache but does not overwrite it');
  assert.equal(db.counts.transactions, 2);
  assert.equal(metric.details.cachePublicationAttempts, 2);
  assert.equal(metric.details.cachePublicationReadUnits, 2);
});

test('late publication from an older freshness window cannot evict a newer same-revision payload', async t => {
  clock(t);
  const db = fakeFirestore();
  const gate = deferred();
  const old = (async () => {
    await gate.promise;
    await setCachedLeaderboard(db, 'daily', { leaders: ['old-window'] }, 7, FIXED_NOW + FIVE_MINUTES);
  })();
  const fresh = { leaders: ['new-window'] };
  await setCachedLeaderboard(db, 'daily', fresh, 7, FIXED_NOW + 2 * FIVE_MINUTES);
  gate.resolve();
  await old;
  await setCachedLeaderboard(db, 'daily', { leaders: ['same-window-late'] }, 7, FIXED_NOW + 2 * FIVE_MINUTES);
  const stored = db.stored.get('leaderboard_cache/daily');
  assert.equal(stored.payload, fresh);
  assert.equal(stored.freshUntil.toMillis(), FIXED_NOW + 2 * FIVE_MINUTES);
  assert.equal(stored.expiresAt.toMillis(), stored.freshUntil.toMillis());
  assert.equal(db.counts.writes, 1);
});

test('a slow indexed query crossing the boundary cannot extend an older reused supplement for another five minutes', async t => {
  const time = clock(t);
  const { records } = fixture();
  let crossBoundary = false;
  const db = fakeFirestore(records, { async onQuery({ indexed }) {
    if (indexed && crossBoundary) {
      await Promise.resolve(); // Let the independent cached supplement start first.
      time.set(FIXED_NOW + FIVE_MINUTES + 1000);
    }
  } });
  await computeDailyResult(db, { nickname: '현재0', playerId: 'player-0' });
  time.set(FIXED_NOW + FIVE_MINUTES - 1000);
  crossBoundary = true;
  await computeDailyResult(db, { nickname: '현재0', playerId: 'player-0' });
  const key = buildLeaderboardCacheKey('daily', RANKING_SEASON_ID, getCurrentRankingDayInfo(), getCurrentRankingWeekInfo());
  assert.equal(db.counts.global, 1, 'the old snapshot was reused while starting the second calculation');
  assert.equal(db.stored.get(`leaderboard_cache/${key}`).freshUntil.toMillis(), FIXED_NOW + FIVE_MINUTES);
  assert.equal((await getCachedLeaderboard(db, key)).payload, null, 'expired source may not become a newly fresh result');
});

test('yesterday winner persists across a simulated new instance without repeating score reads', async t => {
  clock(t);
  const records = [{ id: 'yesterday', value: { nickname: '어제우승', score: 500, mode: 'timeAttack',
    createdAt: Timestamp.fromMillis(FIXED_NOW - DAY_MS), rankingSeason: RANKING_SEASON_ID } }];
  const first = fakeFirestore(records);
  const expected = await loadYesterdayTop(first);
  assert.deepEqual(expected.top, { nickname: '어제우승', score: 500 });
  assert.equal(first.counts.global, 1);
  assert.deepEqual(await loadYesterdayTop(first), expected);
  const second = fakeFirestore(records, { stored: first.stored });
  assert.deepEqual(await loadYesterdayTop(second), expected);
  assert.equal(second.counts.lookups, 1);
  assert.equal(second.counts.global, 0);
  assert.equal(second.counts.indexed, 0);
});

test('yesterday admin correction without a revision bump refreshes both memory and persisted result after the boundary', async t => {
  const time = clock(t);
  const row = { id: 'yesterday', value: { nickname: '수정전', score: 500, mode: 'timeAttack',
    createdAt: Timestamp.fromMillis(FIXED_NOW - DAY_MS), rankingSeason: RANKING_SEASON_ID } };
  const db = fakeFirestore([row]);
  assert.equal((await loadYesterdayTop(db)).top.nickname, '수정전');
  const key = `leaderboard_cache/yesterday:${RANKING_SEASON_ID}:${getCurrentRankingDayInfo(FIXED_NOW - DAY_MS).rankingDay}`;
  assert.equal(db.stored.get(key).expiresAt.toMillis(), FIXED_NOW + FIVE_MINUTES);
  db.rows.set(row.id, { ...row.value, nickname: '수정후', score: 900 });
  time.advance(31000);
  assert.equal((await loadYesterdayTop(db)).top.nickname, '수정전', 'unchanged revision may reuse only within the documented bound');
  time.set(FIXED_NOW + FIVE_MINUTES);
  assert.deepEqual((await loadYesterdayTop(db)).top, { nickname: '수정후', score: 900 });
  assert.equal(db.counts.global, 2);
  const newInstance = fakeFirestore([{ id: row.id, value: db.rows.get(row.id) }], { stored: db.stored });
  assert.equal((await loadYesterdayTop(newInstance)).top.nickname, '수정후');
  assert.equal(newInstance.counts.global, 0);
});

test('snapshot helper isolates revisions, coalesces in-flight reads and never caches invalid revision', async () => {
  let now = 0, reads = 0;
  const cache = createRankingSnapshotCache({ now: () => now });
  const pending = deferred();
  const first = cache.load(1, () => { reads += 1; return pending.promise; });
  const second = cache.load(1, () => assert.fail('duplicate snapshot'));
  assert.equal(first.promise, second.promise);
  assert.equal(second.source, 'shared');
  await Promise.resolve(); pending.resolve('revision-one');
  assert.equal(await first.promise, 'revision-one');
  assert.equal(await cache.load(1, () => assert.fail('unexpired cache')).promise, 'revision-one');
  assert.equal(await cache.load(2, async () => 'revision-two').promise, 'revision-two');
  now = FIVE_MINUTES;
  assert.equal(await cache.load(1, async () => 'new-snapshot').promise, 'new-snapshot');
  for (const revision of [null, -1, NaN, '1']) {
    await cache.load(revision, () => { reads += 1; }).promise;
    await cache.load(revision, () => { reads += 1; }).promise;
  }
  assert.equal(reads, 9);
});

test('a snapshot load that finishes after its freshness boundary is not cached into the next window', async () => {
  let now = FIVE_MINUTES - 1;
  const cache = createRankingSnapshotCache({ now: () => now });
  const pending = deferred();
  const loading = cache.load(1, () => pending.promise);
  await Promise.resolve();
  now = FIVE_MINUTES + 1;
  pending.resolve('old-source');
  assert.equal(await loading.promise, 'old-source');
  const next = cache.load(1, async () => 'fresh-source');
  assert.equal(next.source, 'miss');
  assert.equal(await next.promise, 'fresh-source');
});

test('a same-revision request after the boundary cannot join older pending work or be overwritten by its late completion', async () => {
  let now = FIVE_MINUTES - 1000;
  let reads = 0;
  const cache = createRankingSnapshotCache({ now: () => now });
  const old = deferred();
  const fresh = deferred();
  const beforeBoundary = cache.load(7, () => { reads += 1; return old.promise; });
  await Promise.resolve();
  now = FIVE_MINUTES;
  const afterBoundary = cache.load(7, () => { reads += 1; return fresh.promise; });
  assert.notEqual(afterBoundary.promise, beforeBoundary.promise);
  assert.equal(afterBoundary.source, 'miss');
  await Promise.resolve();
  assert.equal(reads, 2, 'the new freshness window starts its own source read');
  const concurrentFresh = cache.load(7, () => assert.fail('duplicate new-window read'));
  assert.equal(concurrentFresh.promise, afterBoundary.promise);
  fresh.resolve('new-window-snapshot');
  assert.equal(await afterBoundary.promise, 'new-window-snapshot');
  old.resolve('old-window-snapshot');
  assert.equal(await beforeBoundary.promise, 'old-window-snapshot');
  const final = cache.load(7, () => assert.fail('late old completion replaced the fresh cache'));
  assert.equal(final.source, 'memory-hit');
  assert.equal(await final.promise, 'new-window-snapshot');
});
