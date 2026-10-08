// Controlled comparison against a checkout of the pre-change commit.
// Real Express/routes, injected Firestore latency. No production requests/writes.
// node scripts/benchmark-ranking.cjs [path-to-baseline-checkout]
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

async function probe(root) {
  const load = createRequire(path.resolve(root, 'functions/package.json'));
  const constants = load('./src/constants');
  const day = constants.getCurrentRankingDayInfo(); const week = constants.getCurrentRankingWeekInfo();
  const rows = new Map();
  const delayMs = 25;
  const sleep = () => new Promise(resolve => setTimeout(resolve, delayMs));
  const counts = { documentReads: 0, documentWrites: 0, scoreQueries: 0, transactions: 0 };
  for (let i = 0; i < 40; i += 1) rows.set(`scores/player-${i}`, {
    nickname: `학생${i}`, score: 10000 - i, mode: 'timeAttack', createdAt: new Date(day.dayStartUtcMs + i),
    ...(i % 2 ? {} : { rankingSeason: constants.RANKING_SEASON_ID, rankingDay: day.rankingDay, rankingWeek: week.rankingWeek })
  });
  rows.set('ranking_state/current', { revision: 1 });
  function snapshot(key) { return { exists: rows.has(key), data: () => rows.get(key) }; }
  const firestore = {
    collection(name) {
      function query(filters = [], limit = Infinity) {
        return { doc(id) { const key = `${name}/${id}`;
          return { key, get: async () => { await sleep(); counts.documentReads += 1; return snapshot(key); },
            set: async data => { await sleep(); counts.documentWrites += 1; rows.set(key, data); } }; },
          where(field, op, value) { assert.equal(op, '=='); return query([...filters, [field, value]], limit); },
          orderBy() { return query(filters, limit); }, limit(value) { return query(filters, value); },
          async get() {
            await sleep(); counts.scoreQueries += 1;
            const docs = [...rows].filter(([key, data]) => key.startsWith(`${name}/`) && filters.every(([field, value]) => data[field] === value))
              .sort((a, b) => b[1].score - a[1].score).slice(0, limit).map(([key, data]) => ({ id: key.split('/')[1], data: () => data }));
            counts.documentReads += Math.max(docs.length, 1); return { docs };
          } };
      }
      return query();
    },
    async runTransaction(task) {
      counts.transactions += 1;
      const writes = [];
      const result = await task({
        get: async ref => { await sleep(); counts.documentReads += 1; return snapshot(ref.key); },
        getAll: async (...refs) => { await sleep(); counts.documentReads += refs.length; return refs.map(ref => snapshot(ref.key)); },
        set: (ref, data) => writes.push([ref.key, data])
      });
      await sleep();
      for (const [key, data] of writes) { counts.documentWrites += 1; rows.set(key, data); }
      return result;
    }
  };
  const storePath = load.resolve('./src/firestore'); const store = load(storePath);
  require.cache[storePath].exports = { ...store, getScoreFirestore: () => firestore };
  const authPath = load.resolve('firebase-admin/auth'); const auth = load(authPath);
  require.cache[authPath].exports = { ...auth, getAuth: () => ({ verifyIdToken: async () => ({ uid: 'benchmark' }) }) };
  const { app } = load('./src/app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/leaderboard?period=daily`;
  const { createLeaderboardCache } = await import(path.resolve(root, 'client/src/leaderboardCache.js'));
  let httpRequests = 0;
  async function request() {
    httpRequests += 1;
    const response = await fetch(url, { headers: { Authorization: 'Bearer test-only' } });
    assert.equal(response.status, 200); return response.json();
  }
  const cache = createLeaderboardCache(request);
  async function timed(task) { const start = performance.now(); const payload = await task(); return { elapsedMs: +(performance.now() - start).toFixed(1), payload }; }
  try {
    const first = await timed(() => cache.fetch());
    const firstCounts = { ...counts };
    const repeat = await timed(() => cache.fetch());
    assert.equal(repeat.payload, first.payload); assert.deepEqual(counts, firstCounts); assert.equal(httpRequests, 1);
    const serverHit = await timed(request);
    assert.deepEqual(serverHit.payload, first.payload);
    const hitCounts = Object.fromEntries(Object.keys(counts).map(key => [key, counts[key] - firstCounts[key]]));
    // Three simultaneous cold misses use unique UIDs/IP counters in real use.
    // This fake transaction implementation is only for query fan-out counts.
    for (const key of [...rows.keys()]) if (key.startsWith('leaderboard_cache/')) rows.delete(key);
    const beforeFanout = counts.scoreQueries;
    const responses = await Promise.all([request(), request(), request()]);
    responses.forEach(payload => assert.deepEqual(payload, first.payload));
    return { injectedFirestoreRpcMs: delayMs, firstMs: first.elapsedMs, repeatClientMs: repeat.elapsedMs,
      repeatServerMs: serverHit.elapsedMs, firstCounts, serverHitCounts: hitCounts,
      threeConcurrentMissScoreQueries: counts.scoreQueries - beforeFanout, leaders: first.payload.leaders };
  } finally { await new Promise(resolve => server.close(resolve)); }
}

if (process.argv[2] === '--worker') {
  probe(process.argv[3]).then(result => console.log(`RESULT ${JSON.stringify(result)}`)).catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const roots = { current: path.resolve(__dirname, '..'), ...(process.argv[2] ? { baseline: path.resolve(process.argv[2]) } : {}) };
  const results = {};
  for (const [name, root] of Object.entries(roots)) {
    const worker = spawnSync(process.execPath, [__filename, '--worker', root], { encoding: 'utf8', timeout: 20000 });
    assert.equal(worker.status, 0, worker.stderr || worker.stdout);
    const line = worker.stdout.split('\n').find(line => line.startsWith('RESULT '));
    results[name] = JSON.parse(line.slice(7));
  }
  if (results.baseline) {
    assert.deepEqual(results.current.leaders, results.baseline.leaders);
    assert.ok(results.current.firstMs < results.baseline.firstMs);
    assert.equal(results.current.firstCounts.documentReads, results.baseline.firstCounts.documentReads);
    assert.equal(results.current.threeConcurrentMissScoreQueries, 2);
    assert.equal(results.baseline.threeConcurrentMissScoreQueries, 6);
  }
  for (const result of Object.values(results)) delete result.leaders;
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/ranking-controlled-benchmark.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
