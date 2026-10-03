const crypto = require('node:crypto');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getScoreFirestore } = require('./firestore');
const { GAME_SESSION_TTL_MS, GAME_SESSION_DURATION_TOLERANCE_MS } = require('./constants');

const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
function tokensMatch(hash, token) {
  if (typeof token !== 'string' || token.length > 256 || typeof hash !== 'string') return false;
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(tokenHash(token), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function issueGameSession({ uid, nickname, playerId = null }, firestore = getScoreFirestore()) {
  const now = Date.now();
  const gameSessionId = crypto.randomUUID();
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  await firestore.collection('game_sessions').doc(gameSessionId).create({
    uid, nickname, playerId, tokenHash: tokenHash(sessionToken), status: 'active',
    startedAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + GAME_SESSION_TTL_MS)
  });
  return { gameSessionId, sessionToken, startedAt: new Date(now).toISOString() };
}

function validateSession(session, { uid, gameSessionId, sessionToken, playDurationMs, nickname, playerId }, now) {
  if (!session) return 'unknown_session';
  if (session.uid !== uid) return 'wrong_session_owner';
  if (!tokensMatch(session.tokenHash, sessionToken)) return 'invalid_token';
  const elapsed = now - session.startedAt.toMillis();
  if (now >= session.expiresAt.toMillis() || elapsed > GAME_SESSION_TTL_MS) return 'expired_session';
  if (session.status !== 'active') return 'reused_session';
  if (session.nickname !== nickname || session.playerId !== playerId) return 'session_identity_mismatch';
  if (!Number.isSafeInteger(playDurationMs) || playDurationMs <= 0) return 'invalid_play_duration';
  if (playDurationMs > elapsed + GAME_SESSION_DURATION_TOLERANCE_MS
    || elapsed - playDurationMs > GAME_SESSION_DURATION_TOLERANCE_MS) return 'implausible_play_duration';
  return null;
}

async function commitSessionScore(input, scoreRecord, firestore = getScoreFirestore()) {
  if (typeof input.gameSessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.gameSessionId)) {
    return { error: 'missing_session' };
  }
  const sessionRef = firestore.collection('game_sessions').doc(input.gameSessionId);
  const scoreRef = firestore.collection('scores').doc(input.gameSessionId);
  return firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(sessionRef);
    const error = validateSession(snapshot.exists ? snapshot.data() : null, input, Date.now());
    if (error) return { error };
    transaction.create(scoreRef, scoreRecord);
    transaction.set(firestore.collection('ranking_state').doc('current'), { revision: FieldValue.increment(1) }, { merge: true });
    transaction.update(sessionRef, { status: 'used', scoreId: scoreRef.id });
    return { id: scoreRef.id };
  });
}

module.exports = { issueGameSession, commitSessionScore, validateSession, tokensMatch };
