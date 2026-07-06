const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getScoreFirestore } = require('./firestore');
const {
  ALLOWED_SCORE_MODES,
  MAX_ACCEPTED_COMBO,
  SCORE_VERSION,
  RANKING_RESET_AT_MS,
  RANKING_SEASON_ID,
  RANKING_LEGACY_SEASON_ID
} = require('./constants');
const {
  issueGameSession,
  reserveGameSession,
  completeGameSession,
  releaseGameSession
} = require('./gameSessionStore');

const scoreRouter = express.Router();
const RESERVED_NICKNAMES = new Set(['null', 'undefined', 'nan', 'anonymous', 'guest']);
const SESSION_ERROR_MESSAGE = '점수 기록을 확인할 수 없습니다.';
const ANALYTICS_FIELDS = [
  'clearCount',
  'feverClearCount',
  'repeatedPathCount',
  'repeatedValuePatternCount',
  'maxChainLength'
];

function normalizeNickname(value) {
  if (typeof value !== 'string') return null;
  const nickname = value.trim();
  const length = Array.from(nickname).length;
  if (length < 1 || length > 10) return null;
  if (RESERVED_NICKNAMES.has(nickname.toLowerCase())) return null;
  return nickname;
}

function isValidScore(score) {
  return Number.isSafeInteger(score) && score >= 0;
}

function getRankingSeason(now = Date.now()) {
  return now >= RANKING_RESET_AT_MS ? RANKING_SEASON_ID : RANKING_LEGACY_SEASON_ID;
}

function validateScorePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: '올바른 점수 데이터가 필요합니다.', reason: 'invalid_payload' };
  }

  const nickname = normalizeNickname(payload.nickname);
  if (!nickname) {
    return { error: '닉네임을 확인해주세요.', reason: 'invalid_nickname' };
  }

  if (!isValidScore(payload.score)) {
    return { error: '점수 값이 올바르지 않습니다.', reason: 'invalid_score' };
  }

  if (!Number.isSafeInteger(payload.maxCombo)
    || payload.maxCombo < 0
    || payload.maxCombo > MAX_ACCEPTED_COMBO) {
    return { error: '최대 콤보 값이 올바르지 않습니다.', reason: 'invalid_max_combo' };
  }

  if (!ALLOWED_SCORE_MODES.has(payload.mode)) {
    return { error: '허용되지 않은 게임 모드입니다.', reason: 'invalid_mode' };
  }

  if (!Number.isSafeInteger(payload.playDurationMs) || payload.playDurationMs <= 0) {
    return { error: SESSION_ERROR_MESSAGE, reason: 'invalid_play_duration' };
  }

  const analytics = {};
  for (const field of ANALYTICS_FIELDS) {
    const value = payload[field];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      return { error: '플레이 분석 값이 올바르지 않습니다.', reason: `invalid_${field}` };
    }
    analytics[field] = value ?? 0;
  }

  return {
    value: {
      nickname,
      score: payload.score,
      maxCombo: payload.maxCombo,
      mode: payload.mode,
      gameSessionId: payload.gameSessionId,
      sessionToken: payload.sessionToken,
      playDurationMs: payload.playDurationMs,
      ...analytics
    }
  };
}

function firestoreUnavailable(res) {
  return res.status(503).json({ error: '랭킹 서버가 아직 설정되지 않았습니다.' });
}

async function recordSuspiciousScore(firestore, payload, reason) {
  if (!firestore) return;
  try {
    await firestore.collection('suspicious_scores').add({
      nickname: typeof payload?.nickname === 'string' ? payload.nickname.trim().slice(0, 50) : null,
      score: Number.isSafeInteger(payload?.score) ? payload.score : null,
      maxCombo: Number.isSafeInteger(payload?.maxCombo) ? payload.maxCombo : null,
      reason,
      playDurationMs: Number.isSafeInteger(payload?.playDurationMs) ? payload.playDurationMs : null,
      createdAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('의심 점수 기록 실패:', error.message);
  }
}

scoreRouter.post('/game-session', (_req, res) => {
  return res.status(201).json(issueGameSession());
});

scoreRouter.post('/scores', async (req, res) => {
  const validation = validateScorePayload(req.body);
  if (validation.error) {
    const firestore = getScoreFirestore();
    await recordSuspiciousScore(firestore, req.body, validation.reason);
    return res.status(400).json({ error: validation.error });
  }

  const sessionResult = reserveGameSession(validation.value);
  if (sessionResult.error) {
    const firestore = getScoreFirestore();
    await recordSuspiciousScore(firestore, req.body, sessionResult.error);
    return res.status(400).json({ error: SESSION_ERROR_MESSAGE });
  }

  const firestore = getScoreFirestore();
  if (!firestore) {
    releaseGameSession(validation.value.gameSessionId);
    return firestoreUnavailable(res);
  }

  try {
    const { gameSessionId, sessionToken, ...scoreData } = validation.value;
    const document = await firestore.collection('scores').add({
      ...scoreData,
      rankingSeason: getRankingSeason(),
      createdAt: FieldValue.serverTimestamp(),
      version: SCORE_VERSION
    });
    completeGameSession(gameSessionId);
    return res.status(201).json({ ok: true, id: document.id });
  } catch (error) {
    releaseGameSession(validation.value.gameSessionId);
    console.error('점수 저장 실패:', error.message);
    return res.status(500).json({ error: '점수를 저장하지 못했습니다.' });
  }
});

scoreRouter.get('/leaderboard', async (_req, res) => {
  const firestore = getScoreFirestore();
  if (!firestore) return firestoreUnavailable(res);

  try {
    const rankingSeason = getRankingSeason();
    const scoresCollection = firestore.collection('scores');
    const snapshot = rankingSeason === RANKING_LEGACY_SEASON_ID
      ? await scoresCollection.orderBy('score', 'desc').limit(100).get()
      : await scoresCollection.where('rankingSeason', '==', rankingSeason).get();

    const leaders = snapshot.docs
      .map(document => document.data())
      .filter(data => normalizeNickname(data.nickname)
        && isValidScore(data.score)
        && data.mode === 'timeAttack')
      .sort((left, right) => right.score - left.score)
      .slice(0, 30)
      .map(data => ({
        nickname: normalizeNickname(data.nickname),
        score: data.score,
        maxCombo: Number.isSafeInteger(data.maxCombo) && data.maxCombo >= 0 ? data.maxCombo : 0,
        mode: data.mode,
        createdAt: data.createdAt?.toDate?.().toISOString() || null
      }));

    res.set('Cache-Control', 'no-store');
    return res.json({ leaders, rankingSeason });
  } catch (error) {
    console.error('랭킹 조회 실패:', error.message);
    return res.status(500).json({ error: '랭킹을 불러오지 못했습니다.' });
  }
});

module.exports = {
  scoreRouter,
  normalizeNickname,
  isValidScore,
  getRankingSeason,
  validateScorePayload
};
