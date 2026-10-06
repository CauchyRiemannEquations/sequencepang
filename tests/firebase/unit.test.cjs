const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Timestamp } = require('node:module').createRequire(require.resolve('../../functions/package.json'))('firebase-admin/firestore');
const { validateScorePayload, buildRankedEntries } = require('../../functions/src/scoreRoutes');
const { validateSession } = require('../../functions/src/gameSessionStore');
const { validateRoomInput, reconcileRoom, DISCONNECT_GRACE_MS } = require('../../functions/src/roomService');
const { getCurrentRankingDayInfo, getCurrentRankingWeekInfo } = require('../../functions/src/constants');

test('설정 없는 정적 배포는 확인된 Firebase를 사용하고 불완전하거나 다른 프로젝트의 설정은 거부', async () => {
  const { resolveFirebaseWebConfig } = await import('../../client/src/firebaseConfig.js');
  const confirmed = require('../../firebase.web-config.json');
  const defaults = resolveFirebaseWebConfig(confirmed, {});
  assert.equal(defaults.projectId, 'sequencepang');
  assert.equal(defaults.databaseURL, confirmed.databaseURL);
  const explicit = {
    VITE_FIREBASE_API_KEY: confirmed.apiKey, VITE_FIREBASE_AUTH_DOMAIN: confirmed.authDomain,
    VITE_FIREBASE_PROJECT_ID: confirmed.projectId, VITE_FIREBASE_DATABASE_URL: confirmed.databaseURL,
    VITE_FIREBASE_APP_ID: confirmed.appId
  };
  assert.deepEqual(resolveFirebaseWebConfig(confirmed, explicit), defaults);
  assert.throws(() => resolveFirebaseWebConfig(confirmed, { VITE_FIREBASE_PROJECT_ID: 'sequencepang' }));
  assert.throws(() => resolveFirebaseWebConfig(confirmed, { ...explicit, VITE_FIREBASE_PROJECT_ID: 'other-project' }));
});

test('기존 점수·콤보·분석 whitelist 검증 및 욕설 우회 차단', () => {
  const payload = { nickname: '교사', score: 100, maxCombo: 3, mode: 'timeAttack', playDurationMs: 33000, ignored: 1 };
  const result = validateScorePayload(payload);
  assert.equal(result.value.score, 100);
  assert.equal(result.value.ignored, undefined);
  for (const [field, value] of [['score', -1], ['score', 1.5], ['score', Infinity], ['maxCombo', 10001], ['clearCount', -1], ['mode', 'multi']]) {
    assert.ok(validateScorePayload({ ...payload, [field]: value }).error);
  }
  assert.equal(validateScorePayload({ ...payload, nickname: 's1h1i1t' }).reason, 'profane_nickname');
});

test('세션 token/UID/시각/신원/재사용 검증', () => {
  const now = Date.now();
  const token = 'secure-token';
  const session = { uid: 'alice', nickname: '교사', playerId: 'legacy-browser-id', status: 'active',
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    startedAt: Timestamp.fromMillis(now - 33000), expiresAt: Timestamp.fromMillis(now + 60000) };
  const input = { uid: 'alice', nickname: '교사', playerId: 'legacy-browser-id', sessionToken: token, playDurationMs: 33000 };
  assert.equal(validateSession(session, input, now), null);
  assert.equal(validateSession(session, { ...input, uid: 'bob' }, now), 'wrong_session_owner');
  assert.equal(validateSession(session, { ...input, sessionToken: 'other' }, now), 'invalid_token');
  assert.equal(validateSession({ ...session, status: 'used' }, input, now), 'reused_session');
  assert.equal(validateSession(session, { ...input, playDurationMs: 100000 }, now), 'implausible_play_duration');
  assert.equal(validateSession(session, { ...input, playerId: 'spoofed' }, now), 'session_identity_mismatch');
  assert.equal(validateSession(session, input, now + 70000), 'expired_session');
});

test('KST 자정과 월요일 주간 경계 유지', () => {
  assert.equal(getCurrentRankingDayInfo(Date.parse('2026-10-03T14:59:59Z')).rankingDay, '2026-10-03');
  assert.equal(getCurrentRankingDayInfo(Date.parse('2026-10-03T15:00:00Z')).rankingDay, '2026-10-04');
  assert.equal(getCurrentRankingWeekInfo(Date.parse('2026-10-04T15:00:00Z')).rankingWeekStart, '2026-10-05');
});

test('옛 playerId/닉네임 중복 제거와 동점 시 먼저 저장한 기록 유지', () => {
  const doc = data => ({ data: () => ({ mode: 'timeAttack', ...data }) });
  const entries = buildRankedEntries([
    doc({ nickname: 'Apple', playerId: 'old-id', score: 100, createdAt: new Date(1) }),
    doc({ nickname: 'Changed', playerId: 'old-id', score: 90, createdAt: new Date(2) }),
    doc({ nickname: 'apple', score: 80, createdAt: new Date(3) }),
    doc({ nickname: '수학', score: 100, createdAt: new Date(4) })
  ]);
  assert.deepEqual(entries.map(p => p.nickname), ['Apple', '수학']);
});

test('방 입력 검증과 연결 수 기반 방장 위임/유예 정리', () => {
  assert.throws(() => validateRoomInput('../rooms', '교사'));
  assert.throws(() => validateRoomInput('ABCDEF', '두 단어'));
  assert.equal(validateRoomInput('abcdef', 'Apple').nicknameKey, 'apple');
  const now = Date.now();
  const room = { hostUid: 'alice', expiresAt: now + 100000, players: {
    alice: { joinedAt: now - 100, connected: false, disconnectedAt: now, connections: {} },
    bob: { joinedAt: now, connected: true, connections: { tab1: true } }
  } };
  assert.equal(reconcileRoom(room, now).hostUid, 'bob');
  assert.ok(reconcileRoom(room, now + DISCONNECT_GRACE_MS + 1, true).players.bob);
  assert.equal(room.players.alice, undefined);
  room.players.bob.connections = {};
  room.players.bob.disconnectedAt = now;
  assert.equal(reconcileRoom(room, now + DISCONNECT_GRACE_MS + 1, true), null);
});
