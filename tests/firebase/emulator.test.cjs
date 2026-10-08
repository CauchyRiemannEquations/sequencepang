const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const functionsRequire = createRequire(require.resolve('../../functions/package.json'));
const { initializeApp: initAdmin, getApps } = functionsRequire('firebase-admin/app');
const { getFirestore, Timestamp } = functionsRequire('firebase-admin/firestore');
const { getDatabase } = functionsRequire('firebase-admin/database');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInAnonymously } = require('firebase/auth');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { issueGameSession, commitSessionScore } = require('../../functions/src/gameSessionStore');
const { joinRoom, leaveRoom, startRoom, cleanupExpiredState, reconcilePresence } = require('../../functions/src/roomService');
const { getCurrentRankingDayInfo, getCurrentRankingWeekInfo, RANKING_SEASON_ID } = require('../../functions/src/constants');
const { createCombinedRateLimiter } = require('../../functions/src/rateLimit');
const PROJECT = 'demo-sequencepang';
const API = `http://127.0.0.1:5001/${PROJECT}/us-central1/api`;
let firestore, database, rules;
const clientApps = [];

async function user() {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-api-key', appId: '1:123:web:demo' }, `test-${clientApps.length}`);
  clientApps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const result = await signInAnonymously(auth);
  return { uid: result.user.uid, token: await result.user.getIdToken() };
}
async function api(actor, route, body) {
  const response = await fetch(`${API}${route}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json(), timing: response.headers.get('Server-Timing') };
}
async function waitFor(check, label, timeout = 12000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`timeout: ${label}`);
}
const payload = session => ({ ...session, nickname: '교사', playerId: 'legacy-browser-id',
  score: 1000, maxCombo: 4, mode: 'timeAttack', playDurationMs: 33000 });
async function sessionFor(actor) {
  const session = await issueGameSession({ uid: actor.uid, nickname: '교사', playerId: 'legacy-browser-id' }, firestore);
  await firestore.collection('game_sessions').doc(session.gameSessionId).update({ startedAt: Timestamp.fromMillis(Date.now() - 33000) });
  return session;
}
async function admittedRoom(id = 'ABCDEF', alice = 'alice', bob = 'bob') {
  await joinRoom({ uid: alice, roomId: id, nickname: 'Alice' }, database);
  await joinRoom({ uid: bob, roomId: id, nickname: 'Bob' }, database);
  await database.ref(`rooms/${id}/players/${alice}/connections/adminTab`).set(true);
  await database.ref(`rooms/${id}/players/${bob}/connections/adminTab`).set(true);
  await reconcilePresence(id, database);
  return id;
}

before(async () => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    assert.ok(process.env[key]?.startsWith('127.0.0.1:'), `${key}: local Emulator only`);
  }
  const admin = getApps()[0] || initAdmin({ projectId: PROJECT, databaseURL: `https://${PROJECT}.firebaseio.com` });
  firestore = getFirestore(admin); database = getDatabase(admin);
  rules = await initializeTestEnvironment({ projectId: PROJECT,
    database: { host: '127.0.0.1', port: 9000, rules: fs.readFileSync('database.rules.json', 'utf8') },
    firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8') } });
  await rules.clearFirestore(); await database.ref('rooms').remove();
});
after(async () => {
  await rules?.cleanup();
  await Promise.all(clientApps.map(app => deleteApp(app)));
  database?.goOffline();
});

test('HTTP Function authenticates Anonymous Auth and issues a persistent hashed session', async () => {
  const actor = await user();
  const response = await api(actor, '/api/game-session', { nickname: '교사', playerId: 'legacy-browser-id' });
  assert.equal(response.status, 201);
  const saved = (await firestore.collection('game_sessions').doc(response.data.gameSessionId).get()).data();
  assert.equal(saved.uid, actor.uid); assert.ok(saved.tokenHash); assert.equal(saved.sessionToken, undefined);
  assert.equal((await fetch(`${API}/api/leaderboard`)).status, 401);
  const preflight = await fetch(`${API}/api/scores`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
  assert.equal(preflight.status, 204); assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  assert.equal(preflight.headers.get('access-control-max-age'), '600');
  assert.match(preflight.headers.get('access-control-expose-headers'), /Server-Timing/);
  assert.equal((await fetch(`${API}/health`, { headers: { Origin: 'https://attacker.example' } })).status, 403);
});

test('랭킹 미적중·서버 캐시 적중을 계측하고 새 점수 revision은 다른 사용자에게도 반영한다', async () => {
  const actor = await user();
  const other = await user();
  // Start with an empty cache without touching scores or ranking revision.
  const cached = await firestore.collection('leaderboard_cache').get();
  await Promise.all(cached.docs.map(doc => doc.ref.delete()));
  const first = await api(actor, '/api/leaderboard?period=daily');
  assert.equal(first.status, 200);
  assert.match(first.timing, /leaderboard_cache;desc="miss"/);
  assert.match(first.timing, /auth_verify;dur=/);
  assert.match(first.timing, /firestore_rate_limit;dur=/);
  assert.match(first.timing, /firestore_scores;dur=/);
  assert.match(first.timing, /firestore_legacy;dur=/);
  const repeat = await api(other, '/api/leaderboard?period=daily');
  assert.deepEqual(repeat.data, first.data);
  assert.match(repeat.timing, /leaderboard_cache;desc="firestore-hit"/);
  assert.ok(!repeat.timing.includes('firestore_scores;'));
  const session = await sessionFor(actor);
  const submitted = await api(actor, '/api/scores', { ...payload(session), score: 1234 });
  assert.equal(submitted.status, 201);
  const fresh = await api(other, '/api/leaderboard?period=daily');
  assert.match(fresh.timing, /leaderboard_cache;desc="miss"/);
  assert.equal(fresh.data.leaders[0].score, 1234);
});

test('cross-process session consumption: four simultaneous submissions create exactly one score', async () => {
  const actor = await user(); const session = await sessionFor(actor);
  const results = await Promise.all(Array.from({ length: 4 }, () => api(actor, '/api/scores', payload(session))));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal(results.filter(r => r.status === 400).length, 3);
  const stored = await firestore.collection('scores').doc(session.gameSessionId).get();
  assert.ok(stored.exists); assert.equal(stored.data().version, '1.4.0');
  assert.equal(stored.data().playerId, 'legacy-browser-id');
  assert.equal((await firestore.collection('game_sessions').doc(session.gameSessionId).get()).data().status, 'used');
});

test('통합 요청 제한은 동시 트랜잭션과 다른 인스턴스에서도 IP·UID 한도를 유지한다', async () => {
  const time = Date.now();
  const limits = [
    { windowMs: 60000, max: 3, keyPrefix: `test-ip-${time}`, subjectType: 'ip' },
    { windowMs: 60000, max: 2, keyPrefix: `test-uid-${time}` }
  ];
  const firstInstance = createCombinedRateLimiter(limits, { getFirestore: () => firestore, now: () => time });
  const otherInstance = createCombinedRateLimiter(limits, { getFirestore: () => firestore, now: () => time });
  async function invoke(limiter, uid) {
    let status = 200;
    const response = { status(code) { status = code; return this; }, json() {} };
    await limiter({ ip: 'test-ip', auth: { uid } }, response, error => assert.ifError(error));
    return status;
  }
  assert.deepEqual(await Promise.all([invoke(firstInstance, 'alice'), invoke(otherInstance, 'alice')]), [200, 200]);
  assert.equal(await invoke(otherInstance, 'alice'), 429);
  assert.equal(await invoke(firstInstance, 'bob'), 429, 'UID-rejected retry has consumed the final IP allowance');
  const counters = (await firestore.collection('request_limits').get()).docs.filter(doc => doc.id.startsWith(`test-ip-${time}_`) || doc.id.startsWith(`test-uid-${time}_`));
  assert.deepEqual(counters.map(doc => doc.data().count).sort(), [2, 3]);
});

test('invalid token, owner, elapsed time, expiry and combo are rejected and logged', async () => {
  const actor = await user(); const other = await user();
  const cases = [
    ['invalid_token', { sessionToken: 'incorrect' }],
    ['implausible_play_duration', { playDurationMs: 100000 }],
    ['invalid_max_combo', { maxCombo: 10001 }]
  ];
  for (const [reason, overrides] of cases) {
    const session = await sessionFor(actor);
    assert.equal((await api(actor, '/api/scores', { ...payload(session), ...overrides })).status, 400);
    assert.ok((await firestore.collection('suspicious_scores').where('reason', '==', reason).get()).size);
  }
  const owned = await sessionFor(actor);
  assert.equal((await api(other, '/api/scores', payload(owned))).status, 400);
  const expired = await sessionFor(actor);
  await firestore.collection('game_sessions').doc(expired.gameSessionId).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
  assert.equal((await api(actor, '/api/scores', payload(expired))).status, 400);
  for (const reason of ['wrong_session_owner','expired_session']) assert.ok((await firestore.collection('suspicious_scores').where('reason','==',reason).get()).size);
});

test('failed transaction does not consume a session', async () => {
  const actor = await user(); const session = await sessionFor(actor);
  const input = { ...payload(session), uid: actor.uid };
  await assert.rejects(() => commitSessionScore(input, { score: undefined }, firestore));
  assert.equal((await firestore.collection('game_sessions').doc(session.gameSessionId).get()).data().status, 'active');
  assert.equal((await api(actor, '/api/scores', payload(session))).status, 201);
});

test('legacy daily/weekly/yesterday data, player dedupe and TOP 30 cutoff remain compatible', async () => {
  const actor = await user(); const day = getCurrentRankingDayInfo(); const week = getCurrentRankingWeekInfo();
  const batch = firestore.batch();
  for (let i = 0; i < 35; i++) batch.set(firestore.collection('scores').doc(`legacy-${i}`), {
    nickname: `학생${i}`, score: 100000 - i * 1000, maxCombo: 2, mode: 'timeAttack', playerId: `old-${i}`,
    createdAt: Timestamp.fromMillis(day.dayStartUtcMs + 1000 + i)
  });
  batch.set(firestore.collection('scores').doc('yesterday'), { nickname: '어제왕', score: 200000, maxCombo: 1,
    mode: 'timeAttack', createdAt: Timestamp.fromMillis(day.dayStartUtcMs - 1000) });
  await batch.commit();
  const today = await api(actor, '/api/leaderboard?period=daily');
  assert.equal(today.status, 200); assert.equal(today.data.leaders.length, 30);
  assert.equal(today.data.leaders[0].nickname, '학생0');
  const weekly = await api(actor, '/api/leaderboard?period=weekly');
  assert.equal(weekly.status, 200); assert.equal(weekly.data.rankingWeek, week.rankingWeek);
  assert.equal((await api(actor, '/api/yesterday-top')).data.top.nickname, '어제왕');
  const session = await sessionFor(actor);
  const submitted = await api(actor, '/api/scores', payload(session));
  assert.equal(submitted.status, 201); assert.equal(submitted.data.dailyRank.rank, 36);
  assert.equal(submitted.data.dailyRank.top30Cutoff, 71000);
  assert.equal((await firestore.collection('scores').doc('legacy-0').get()).data().rankingSeason, undefined);
});

test('server enforces duplicate nicknames and concurrent capacity limits atomically', async () => {
  await joinRoom({ uid: 'cap-host', roomId: 'CAPAAA', nickname: 'Host' }, database);
  await assert.rejects(() => joinRoom({ uid: 'duplicate', roomId: 'CAPAAA', nickname: 'host' }, database), /이미 사용/);
  const roomRef = database.ref('rooms/CAPAAA');
  const room = (await roomRef.once('value')).val();
  for (let i = 1; i < 29; i++) room.players[`cap-${i}`] = { ...room.players['cap-host'], nickname: `P${i}`, nicknameKey: `p${i}` };
  await roomRef.set(room);
  const outcomes = await Promise.allSettled([joinRoom({ uid: 'last-a', roomId: 'CAPAAA', nickname: 'LastA' }, database),
    joinRoom({ uid: 'last-b', roomId: 'CAPAAA', nickname: 'LastB' }, database)]);
  assert.equal(outcomes.filter(v => v.status === 'fulfilled').length, 1);
  assert.equal(Object.keys((await roomRef.once('value')).val().players).length, 30);
});

test('host-only start resets each round score and preserves highest score', async () => {
  await admittedRoom('STARTA');
  await database.ref('rooms/STARTA/players/alice/highestScore').set(777);
  await assert.rejects(() => startRoom({ uid: 'bob', roomId: 'STARTA' }, database), /방장만/);
  const started = await startRoom({ uid: 'alice', roomId: 'STARTA' }, database);
  const room = (await database.ref('rooms/STARTA').once('value')).val();
  assert.ok(started.startsAt > Date.now()); assert.equal(room.roundId, started.roundId);
  assert.equal(room.players.alice.highestScore, 777); assert.equal(room.players.alice.score, 0);
  await assert.rejects(() => joinRoom({ uid: 'late', roomId: 'STARTA', nickname: 'Late' }, database), /이미 게임/);
});

test('RTDB rules allow own presence and score; deny strangers, room mutations and cross-player writes', async () => {
  await admittedRoom('RULESA');
  await startRoom({ uid: 'alice', roomId: 'RULESA' }, database);
  await database.ref('rooms/RULESA/startsAt').set(Date.now() - 1);
  const own = rules.authenticatedContext('alice').database();
  const stranger = rules.authenticatedContext('eve').database();
  await assertSucceeds(own.ref('rooms/RULESA').once('value'));
  await assertFails(stranger.ref('rooms/RULESA').once('value'));
  await assertFails(own.ref('rooms').once('value'));
  await assertFails(own.ref('rooms/RULESA/hostUid').set('alice'));
  await assertFails(own.ref('rooms/RULESA/isStarted').set(false));
  await assertFails(own.ref('rooms/RULESA/players/bob/score').set(999));
  await assertFails(own.ref('rooms/RULESA/players/alice/nickname').set('Changed'));
  await assertFails(stranger.ref('rooms/RULESA/players/eve').set({ nickname: 'Eve' }));
  const player = own.ref('rooms/RULESA/players/alice');
  await assertSucceeds(player.child('connections/tab-test').set(true));
  await assertSucceeds(player.update({ score: 100, highestScore: 100, lastScoreAt: { '.sv': 'timestamp' } }));
  await assertFails(player.update({ score: 90, lastScoreAt: { '.sv': 'timestamp' } }));
  await assertFails(player.update({ score: 100.5, highestScore: 100.5, lastScoreAt: { '.sv': 'timestamp' } }));
  await assertFails(player.child('score').remove());
  await assertFails(player.update({ score: 1000, highestScore: 1000, scoreRoundId: 'old-round', lastScoreAt: { '.sv': 'timestamp' } }));
  await assertFails(player.child('highestScore').set(9999999));
  await assertFails(player.update({ score: 200, highestScore: 200, lastScoreAt: { '.sv': 'timestamp' } }));
});

test('Firestore rules deny browser access to rankings, suspicious records and sessions', async () => {
  const db = rules.authenticatedContext('alice').firestore();
  for (const collection of ['scores','suspicious_scores','game_sessions','request_limits']) {
    await assertFails(db.collection(collection).doc('forged').set({ score: 1 }));
    await assertFails(db.collection(collection).get());
  }
});

test('real onDisconnect triggers host delegation, reconnect grace and multiple-tab presence', async () => {
  await joinRoom({ uid: 'presence-a', roomId: 'PRESAA', nickname: 'Alice' }, database);
  await joinRoom({ uid: 'presence-b', roomId: 'PRESAA', nickname: 'Bob' }, database);
  const a = rules.authenticatedContext('presence-a').database();
  const b = rules.authenticatedContext('presence-b').database();
  const aPresence = a.ref('rooms/PRESAA/players/presence-a/connections/tab1');
  await aPresence.onDisconnect().remove(); await aPresence.set(true);
  await b.ref('rooms/PRESAA/players/presence-b/connections/tab1').set(true);
  await waitFor(async () => (await database.ref('rooms/PRESAA/players/presence-a/connected').once('value')).val() === true, 'presence trigger online');
  a.goOffline();
  await waitFor(async () => (await database.ref('rooms/PRESAA/hostUid').once('value')).val() === 'presence-b', 'host delegation');
  assert.ok((await database.ref('rooms/PRESAA/players/presence-a').once('value')).exists());
  a.goOnline(); await aPresence.onDisconnect().remove(); await aPresence.set(true);
  await waitFor(async () => (await database.ref('rooms/PRESAA/players/presence-a/connected').once('value')).val() === true, 'reconnect');
  assert.equal((await database.ref('rooms/PRESAA/hostUid').once('value')).val(), 'presence-b');
  await a.ref('rooms/PRESAA/players/presence-a/connections/tab2').set(true);
  await aPresence.remove();
  await reconcilePresence('PRESAA', database);
  assert.equal((await database.ref('rooms/PRESAA/players/presence-a/connected').once('value')).val(), true);
});

test('explicit leave delegates host and deletes empty rooms; cleanup touches no scores', async () => {
  await admittedRoom('LEAVEA');
  await leaveRoom({ uid: 'alice', roomId: 'LEAVEA' }, database);
  assert.equal((await database.ref('rooms/LEAVEA/hostUid').once('value')).val(), 'bob');
  await leaveRoom({ uid: 'bob', roomId: 'LEAVEA' }, database);
  assert.equal((await database.ref('rooms/LEAVEA').once('value')).exists(), false);
  await joinRoom({ uid: 'never-connected', roomId: 'STALEA', nickname: 'Stale' }, database);
  const before = (await firestore.collection('scores').get()).size;
  await cleanupExpiredState(database, firestore, Date.now() + 60000);
  assert.equal((await database.ref('rooms/STALEA').once('value')).exists(), false);
  assert.equal((await firestore.collection('scores').get()).size, before);
});
