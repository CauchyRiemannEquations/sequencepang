// Synthetic SDK-operation/read-count comparison. No ports, credentials or Firebase calls.
// Runs the real Express middleware/routes against a deterministic in-memory Firestore.
// node scripts/benchmark-ranking-reads.cjs <unmodified-baseline-checkout>
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { IncomingMessage, ServerResponse } = require('node:http');
const { Duplex } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function probe(root, scenario) {
  let time = Date.parse('2026-10-29T00:00:00Z');
  Date.now = () => time;
  const load = createRequire(path.resolve(root, 'functions/package.json'));
  const { Timestamp } = load('firebase-admin/firestore');
  const constants = load('./src/constants');
  const rows = new Map([['ranking_state/current', { revision: 1 }]]);
  // 1,300 high-scoring historical rows, five current-period scores. A miss must
  // retain the old global top-1,200 compatibility coverage, not silently trim it.
  const day = constants.getCurrentRankingDayInfo(time), week = constants.getCurrentRankingWeekInfo(time);
  for (let i = 0; i < 1300; i++) rows.set(`scores/history-${i}`, {
    nickname: `old${i}`, score: 900000 - i, mode: 'timeAttack',
    createdAt: Timestamp.fromMillis(day.dayStartUtcMs - 60 * 86400000 + i)
  });
  for (let i = 0; i < 5; i++) rows.set(`scores/current-${i}`, {
    nickname: `new${i}`, playerId: `fixture${i}`, score: 1000 - i, maxCombo: 2, mode: 'timeAttack',
    rankingSeason: constants.RANKING_SEASON_ID, rankingDay: day.rankingDay,
    rankingWeek: week.rankingWeek, createdAt: Timestamp.fromMillis(day.dayStartUtcMs + i)
  });
  const counts = { httpRequests: 0, documentReadUnits: 0, documentWrites: 0, scoreQueries: 0, legacyQueries: 0, transactions: 0 };
  const snapshot = key => ({ id: key.split('/').at(-1), exists: rows.has(key), data: () => rows.get(key) });
  function materialize(data, previous = {}) {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
      value?.constructor?.name === 'NumericIncrementTransform' ? (previous[key] || 0) + value.operand
        : value?.constructor?.name === 'ServerTimestampTransform' ? Timestamp.fromMillis(time) : value]));
  }
  const firestore = {
    collection(name) {
      function query(filters = [], limit = Infinity, fields) {
        return {
          doc(id) { const key = `${name}/${id}`; return { id, key, path: key,
            get: async () => { counts.documentReadUnits++; return snapshot(key); },
            set: async data => { counts.documentWrites++; rows.set(key, materialize(data)); },
            create: async data => { assert.ok(!rows.has(key)); counts.documentWrites++; rows.set(key, materialize(data)); }
          }; },
          where(field, op, value) { assert.equal(op, '=='); return query([...filters, [field, value]], limit, fields); },
          orderBy() { return query(filters, limit, fields); },
          limit(value) { return query(filters, value, fields); },
          select(...selected) { return query(filters, limit, selected); },
          async get() {
            counts.scoreQueries++;
            if (filters.length === 0) counts.legacyQueries++;
            const docs = [...rows].filter(([key, data]) => key.startsWith(`${name}/`) && filters.every(([field, value]) => data[field] === value))
              .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0])).slice(0, limit)
              .map(([key, data]) => ({ id: key.split('/').at(-1), data: () => fields
                ? Object.fromEntries(Object.entries(data).filter(([field]) => fields.includes(field))) : data }));
            counts.documentReadUnits += Math.max(1, docs.length); return { docs };
          }
        };
      }
      return query();
    },
    async runTransaction(task) {
      counts.transactions++;
      const writes = [];
      const result = await task({
        get: async ref => { counts.documentReadUnits++; return snapshot(ref.key); },
        getAll: async (...refs) => { counts.documentReadUnits += refs.length; return refs.map(ref => snapshot(ref.key)); },
        set: (ref, data, options) => writes.push([ref.key, data, options?.merge]),
        create: (ref, data) => { assert.ok(!rows.has(ref.key)); writes.push([ref.key, data]); },
        update: (ref, data) => { assert.ok(rows.has(ref.key)); writes.push([ref.key, data, true]); }
      });
      for (const [key, data, merge] of writes) {
        counts.documentWrites++; const previous = rows.get(key) || {};
        rows.set(key, { ...(merge ? previous : {}), ...materialize(data, previous) });
      }
      return result;
    }
  };
  const storePath = load.resolve('./src/firestore');
  require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { getScoreFirestore: () => firestore } };
  const authPath = load.resolve('firebase-admin/auth'); const auth = load(authPath);
  require.cache[authPath].exports = { ...auth, getAuth: () => ({ verifyIdToken: async () => ({ uid: 'fixture-actor' }) }) };
  const { app } = load('./src/app');
  async function request(route, body) {
    counts.httpRequests++;
    return new Promise((resolve, reject) => {
      const socket = new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } });
      socket.remoteAddress = '127.0.0.1';
      const req = new IncomingMessage(socket); req.method = body === undefined ? 'GET' : 'POST'; req.url = route;
      req.headers = { authorization: 'Bearer fixture-only' };
      if (body !== undefined) {
        const json = JSON.stringify(body); req.headers['content-type'] = 'application/json';
        req.headers['content-length'] = Buffer.byteLength(json); req.push(json);
      }
      req.push(null);
      const res = new ServerResponse(req);
      res.end = function (chunk) {
        const data = JSON.parse(String(chunk));
        res.emit('finish');
        if (res.statusCode >= 400) return reject(Error(`${res.statusCode}: ${JSON.stringify(data)}`));
        resolve(data);
      };
      app.handle(req, res, reject);
    });
  }
  const { createLeaderboardCache } = await import(pathToFileURL(path.resolve(root, 'client/src/leaderboardCache.js')));
  const cache = createLeaderboardCache(period => request(`/api/leaderboard?period=${period}`));
  const responseFingerprints = [];
  function remember(payload) { responseFingerprints.push(JSON.stringify(payload)); }
  if (scenario === 'read-heavy') {
    for (let i = 0; i < 10; i++) { remember(await cache.fetch()); time += 31000; }
  } else if (scenario === 'write-heavy') {
    for (let i = 0; i < 8; i++) {
      const session = await request('/api/game-session', { nickname: 'fixture', playerId: 'fixture-player' });
      time += 33000;
      cache.invalidate();
      const result = await request('/api/scores', { ...session, nickname: 'fixture', playerId: 'fixture-player',
        score: 2000 + i, maxCombo: 2, mode: 'timeAttack', playDurationMs: 33000 });
      const generation = cache.invalidate();
      if (cache.prime) cache.prime('daily', result.leaderboard, generation);
      remember(await cache.fetch());
      assert.equal(result.dailyRank.rank, 1);
    }
  } else if (scenario === 'period-switch') {
    remember(await cache.fetch('daily')); remember(await cache.fetch('weekly'));
  } else throw Error(`Unknown scenario ${scenario}`);
  return { counts, responseFingerprints };
}

if (process.argv[2] === '--worker') {
  probe(process.argv[3], process.argv[4]).then(result => console.log(`RESULT ${JSON.stringify(result)}`))
    .catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const baseline = process.argv[2];
  assert.ok(baseline, 'Pass an unmodified baseline checkout; no production target is accepted.');
  const result = { kind: 'synthetic SDK-operation counts, not Firebase billing or production latency', scenarios: {} };
  for (const scenario of ['read-heavy', 'write-heavy', 'period-switch']) {
    const versions = {};
    for (const [name, root] of Object.entries({ baseline: path.resolve(baseline), current: path.resolve(__dirname, '..') })) {
      const child = spawnSync(process.execPath, [__filename, '--worker', root, scenario], { encoding: 'utf8', timeout: 20000 });
      assert.equal(child.status, 0, child.stderr || child.stdout);
      const line = child.stdout.split('\n').find(value => value.startsWith('RESULT '));
      versions[name] = JSON.parse(line.slice(7));
    }
    assert.deepEqual(versions.current.responseFingerprints, versions.baseline.responseFingerprints, `${scenario}: identical public ranking payloads`);
    assert.ok(versions.current.counts.documentReadUnits < versions.baseline.counts.documentReadUnits);
    result.scenarios[scenario] = Object.fromEntries(Object.entries(versions).map(([key, value]) => [key, value.counts]));
  }
  assert.equal(result.scenarios['read-heavy'].current.legacyQueries, 1);
  assert.equal(result.scenarios['write-heavy'].current.legacyQueries, 8);
  assert.equal(result.scenarios['write-heavy'].baseline.legacyQueries, 16);
  assert.equal(result.scenarios['write-heavy'].current.httpRequests, 16);
  assert.equal(result.scenarios['write-heavy'].baseline.httpRequests, 24);
  assert.equal(result.scenarios['period-switch'].current.legacyQueries, 1);
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/ranking-read-count-comparison.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
