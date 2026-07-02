const crypto = require('crypto');
const {
  GAME_SESSION_TTL_MS,
  GAME_SESSION_DURATION_TOLERANCE_MS
} = require('./constants');

const gameSessions = new Map();

function removeExpiredSessions(now = Date.now()) {
  for (const [gameSessionId, session] of gameSessions) {
    if (now - session.startedAt > GAME_SESSION_TTL_MS) {
      gameSessions.delete(gameSessionId);
    }
  }
}

function issueGameSession() {
  const startedAt = Date.now();
  const gameSessionId = crypto.randomUUID();
  const sessionToken = crypto.randomBytes(32).toString('base64url');

  removeExpiredSessions(startedAt);
  gameSessions.set(gameSessionId, {
    sessionToken,
    startedAt,
    status: 'active'
  });

  return {
    gameSessionId,
    sessionToken,
    startedAt: new Date(startedAt).toISOString()
  };
}

function tokensMatch(expected, received) {
  if (typeof received !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function reserveGameSession({ gameSessionId, sessionToken, playDurationMs }) {
  if (typeof gameSessionId !== 'string' || !gameSessionId) {
    return { error: 'missing_session' };
  }

  const session = gameSessions.get(gameSessionId);
  if (!session) return { error: 'unknown_session' };
  if (!tokensMatch(session.sessionToken, sessionToken)) return { error: 'invalid_token' };

  const elapsedMs = Date.now() - session.startedAt;
  if (elapsedMs > GAME_SESSION_TTL_MS) {
    gameSessions.delete(gameSessionId);
    return { error: 'expired_session' };
  }
  if (session.status !== 'active') return { error: 'reused_session' };
  if (!Number.isSafeInteger(playDurationMs) || playDurationMs <= 0) {
    return { error: 'invalid_play_duration' };
  }
  if (playDurationMs > elapsedMs + GAME_SESSION_DURATION_TOLERANCE_MS
    || elapsedMs - playDurationMs > GAME_SESSION_DURATION_TOLERANCE_MS) {
    return { error: 'implausible_play_duration' };
  }

  session.status = 'submitting';
  return { session };
}

function completeGameSession(gameSessionId) {
  const session = gameSessions.get(gameSessionId);
  if (session) session.status = 'used';
}

function releaseGameSession(gameSessionId) {
  const session = gameSessions.get(gameSessionId);
  if (session?.status === 'submitting') session.status = 'active';
}

module.exports = {
  gameSessions,
  issueGameSession,
  reserveGameSession,
  completeGameSession,
  releaseGameSession,
  removeExpiredSessions
};
