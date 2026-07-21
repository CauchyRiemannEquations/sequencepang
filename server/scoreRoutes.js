const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getScoreFirestore } = require('./firestore');
const {
  ALLOWED_SCORE_MODES,
  MAX_ACCEPTED_SCORE,
  MAX_ACCEPTED_COMBO,
  SCORE_VERSION,
  RANKING_RESET_AT_MS,
  RANKING_SEASON_ID,
  RANKING_LEGACY_SEASON_ID,
  getCurrentRankingDayInfo,
  getCurrentRankingWeekInfo
} = require('./constants');
const {
  issueGameSession,
  reserveGameSession,
  completeGameSession,
  releaseGameSession
} = require('./gameSessionStore');
const { createRateLimiter } = require('./rateLimit');

// 한 게임이 최소 30초 이상이므로 분당 20회는 정상 플레이에 넉넉한 값
const writeRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20, keyPrefix: 'score-write' });

const scoreRouter = express.Router();
const RESERVED_NICKNAMES = new Set(['null', 'undefined', 'nan', 'anonymous', 'guest']);
const SESSION_ERROR_MESSAGE = '점수 기록을 확인할 수 없습니다.';
const LEADERBOARD_LIMIT = 300;
const LEADERBOARD_RESPONSE_LIMIT = 30;
const LEADERBOARD_CACHE_TTL_MS = 30 * 1000;
const LEADERBOARD_FALLBACK_LIMIT = 1200;
const LEADERBOARD_LEGACY_SUPPLEMENT_LIMIT = 1200;
const ANALYTICS_FIELDS = [
  'clearCount',
  'feverClearCount',
  'repeatedPathCount',
  'repeatedValuePatternCount',
  'maxChainLength'
];
const leaderboardCache = new Map();

function normalizeNickname(value) {
  if (typeof value !== 'string') return null;
  const nickname = value.trim();
  const length = Array.from(nickname).length;
  if (length < 1 || length > 10) return null;
  if (RESERVED_NICKNAMES.has(nickname.toLowerCase())) return null;
  return nickname;
}

function isValidScore(score) {
  return Number.isSafeInteger(score) && score >= 0 && score <= MAX_ACCEPTED_SCORE;
}

function getRankingSeason(now = Date.now()) {
  return now >= RANKING_RESET_AT_MS ? RANKING_SEASON_ID : RANKING_LEGACY_SEASON_ID;
}

function getCreatedAtMs(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsedValue = Date.parse(value);
  return Number.isFinite(parsedValue) ? parsedValue : Number.MAX_SAFE_INTEGER;
}

function isCurrentSeasonFallbackRecord(data, rankingSeason) {
  if (rankingSeason !== RANKING_SEASON_ID) {
    return data.rankingSeason === rankingSeason;
  }

  if (data.rankingSeason === rankingSeason) {
    return true;
  }

  if (data.rankingSeason && data.rankingSeason !== RANKING_LEGACY_SEASON_ID) {
    return false;
  }

  const createdAtMs = getCreatedAtMs(data.createdAt);
  return createdAtMs >= RANKING_RESET_AT_MS;
}

function getPlayerIdentity(data) {
  if (typeof data?.playerId !== 'string') return null;

  const trimmedPlayerId = data.playerId.trim();
  if (!trimmedPlayerId) return null;

  return `player:${trimmedPlayerId}`;
}

function getNicknameIdentity(data) {
  const nickname = normalizeNickname(data?.nickname);
  if (!nickname) return null;

  const normalizedNicknameKey = nickname
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return `nickname:${normalizedNicknameKey}`;
}

function buildLeadersFromDocs(documents) {
  const sortedScores = documents
    .map(document => document.data())
    .filter(data => {
      const nickname = normalizeNickname(data.nickname);
      return Boolean(nickname && isValidScore(data.score) && data.mode === 'timeAttack');
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return getCreatedAtMs(left.createdAt) - getCreatedAtMs(right.createdAt);
    });

  // 1차 중복 제거: 같은 브라우저/playerId는 최고점 1개만 남김
  const bestByPlayer = new Map();
  const playerDedupedScores = [];

  for (const data of sortedScores) {
    const playerIdentity = getPlayerIdentity(data);

    // playerId가 있는 기록은 playerId 기준으로 먼저 묶는다.
    if (playerIdentity) {
      if (bestByPlayer.has(playerIdentity)) continue;
      bestByPlayer.set(playerIdentity, data);
      playerDedupedScores.push(data);
      continue;
    }

    // playerId가 없는 옛 기록은 일단 통과시키고, 2차 닉네임 중복 제거에서 처리한다.
    playerDedupedScores.push(data);
  }

  // 2차 중복 제거: 같은 닉네임은 최고점 1개만 남김
  const bestByNickname = new Map();

  for (const data of playerDedupedScores) {
    const nicknameIdentity = getNicknameIdentity(data);
    if (!nicknameIdentity || bestByNickname.has(nicknameIdentity)) continue;
    bestByNickname.set(nicknameIdentity, data);
  }

  return Array.from(bestByNickname.values())
    .slice(0, LEADERBOARD_RESPONSE_LIMIT)
    .map(data => ({
      nickname: normalizeNickname(data.nickname),
      score: data.score,
      maxCombo: Number.isSafeInteger(data.maxCombo) && data.maxCombo >= 0 ? data.maxCombo : 0,
      mode: data.mode,
      createdAt: data.createdAt?.toDate?.().toISOString() || null
    }));
}

function matchesPeriodRecord(data, period, rankingSeason, dayInfo, weekInfo) {
  const nickname = normalizeNickname(data.nickname);
  if (!nickname || !isValidScore(data.score) || data.mode !== 'timeAttack') {
    return false;
  }

  if (period === 'daily') {
    if (!isCurrentSeasonFallbackRecord(data, rankingSeason)) return false;
    if (data.rankingDay === dayInfo.rankingDay) return true;
    if (data.rankingDay) return false;
    const createdAtMs = getCreatedAtMs(data.createdAt);
    return createdAtMs >= dayInfo.dayStartUtcMs && createdAtMs < dayInfo.dayEndUtcMs;
  }

  if (period === 'weekly') {
    if (!isCurrentSeasonFallbackRecord(data, rankingSeason)) return false;
    if (data.rankingWeek === weekInfo.rankingWeek) return true;
    if (data.rankingWeek) return false;
    const createdAtMs = getCreatedAtMs(data.createdAt);
    return createdAtMs >= weekInfo.weekStartUtcMs && createdAtMs < weekInfo.weekEndUtcMs;
  }

  if (rankingSeason === RANKING_LEGACY_SEASON_ID) {
    return true;
  }

  return isCurrentSeasonFallbackRecord(data, rankingSeason);
}

function buildLeaderboardCacheKey(period, rankingSeason, dayInfo, weekInfo) {
  return [
    period,
    rankingSeason,
    dayInfo?.rankingDay || '',
    weekInfo?.rankingWeek || '',
    weekInfo?.rankingWeekStart || ''
  ].join(':');
}

function getCachedLeaderboard(cacheKey) {
  const cached = leaderboardCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > LEADERBOARD_CACHE_TTL_MS) {
    leaderboardCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
}

function setCachedLeaderboard(cacheKey, payload) {
  leaderboardCache.set(cacheKey, {
    cachedAt: Date.now(),
    payload
  });
}

function clearLeaderboardCache() {
  leaderboardCache.clear();
}

function isFirestoreIndexError(error) {
  const errorCode = String(error?.code || '');
  const errorMessage = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return errorCode === '9' || errorMessage.includes('failed-precondition') || errorMessage.includes('index');
}

function filterLeaderboardDocsByPeriod(documents, period, rankingSeason, dayInfo, weekInfo) {
  return documents.filter(document => matchesPeriodRecord(document.data(), period, rankingSeason, dayInfo, weekInfo));
}

async function fetchLeaderboardSnapshot(scoresCollection, period, rankingSeason, dayInfo, weekInfo) {
  try {
    if (period === 'daily') {
      return await scoresCollection
        .where('rankingSeason', '==', rankingSeason)
        .where('rankingDay', '==', dayInfo.rankingDay)
        .where('mode', '==', 'timeAttack')
        .orderBy('score', 'desc')
        .limit(LEADERBOARD_LIMIT)
        .get();
    }

    if (period === 'weekly') {
      return await scoresCollection
        .where('rankingSeason', '==', rankingSeason)
        .where('rankingWeek', '==', weekInfo.rankingWeek)
        .where('mode', '==', 'timeAttack')
        .orderBy('score', 'desc')
        .limit(LEADERBOARD_LIMIT)
        .get();
    }

    if (rankingSeason === RANKING_LEGACY_SEASON_ID) {
      return await scoresCollection
        .where('mode', '==', 'timeAttack')
        .orderBy('score', 'desc')
        .limit(LEADERBOARD_LIMIT)
        .get();
    }

    return await scoresCollection
      .where('rankingSeason', '==', rankingSeason)
      .where('mode', '==', 'timeAttack')
      .orderBy('score', 'desc')
      .limit(LEADERBOARD_LIMIT)
      .get();
  } catch (error) {
    if (!isFirestoreIndexError(error)) {
      throw error;
    }

    console.warn('랭킹 인덱스 쿼리 실패, fallback 조회로 전환:', error.message);

    const fallbackSnapshot = await scoresCollection
      .orderBy('score', 'desc')
      .limit(LEADERBOARD_FALLBACK_LIMIT)
      .get();

    const filteredDocs = fallbackSnapshot.docs.filter(document => {
      const data = document.data();
      return matchesPeriodRecord(data, period, rankingSeason, dayInfo, weekInfo);
    });

    return { docs: filteredDocs };
  }
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
      playerId: typeof payload.playerId === 'string' && payload.playerId.trim()
        ? payload.playerId.trim().slice(0, 120)
        : null,
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

scoreRouter.post('/game-session', writeRateLimiter, (_req, res) => {
  return res.status(201).json(issueGameSession());
});

scoreRouter.post('/scores', writeRateLimiter, async (req, res) => {
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
    const dayInfo = getCurrentRankingDayInfo();
    const weekInfo = getCurrentRankingWeekInfo();
    const document = await firestore.collection('scores').add({
      ...scoreData,
      rankingSeason: getRankingSeason(),
      rankingDay: dayInfo.rankingDay,
      rankingWeek: weekInfo.rankingWeek,
      rankingWeekStart: weekInfo.rankingWeekStart,
      createdAt: FieldValue.serverTimestamp(),
      version: SCORE_VERSION
    });
    clearLeaderboardCache();
    completeGameSession(gameSessionId);
    return res.status(201).json({ ok: true, id: document.id });
  } catch (error) {
    releaseGameSession(validation.value.gameSessionId);
    console.error('점수 저장 실패:', error.message);
    return res.status(500).json({ error: '점수를 저장하지 못했습니다.' });
  }
});

scoreRouter.get('/leaderboard', async (req, res) => {
  const firestore = getScoreFirestore();
  if (!firestore) return firestoreUnavailable(res);

  try {
    const requestedPeriod = typeof req.query.period === 'string' ? req.query.period : '';
    const period = ['daily', 'weekly', 'season'].includes(requestedPeriod) ? requestedPeriod : 'daily';
    const rankingSeason = getRankingSeason();
    const dayInfo = getCurrentRankingDayInfo();
    const weekInfo = getCurrentRankingWeekInfo();
    const cacheKey = buildLeaderboardCacheKey(period, rankingSeason, dayInfo, weekInfo);
    const cachedPayload = getCachedLeaderboard(cacheKey);

    if (cachedPayload) {
      res.set('Cache-Control', 'no-store');
      return res.json(cachedPayload);
    }

    const scoresCollection = firestore.collection('scores');
    const snapshot = await fetchLeaderboardSnapshot(scoresCollection, period, rankingSeason, dayInfo, weekInfo);
    let leaderboardDocs = [...snapshot.docs];

    if (period === 'daily' || period === 'weekly') {
      const supplementSnapshot = await scoresCollection
        .orderBy('score', 'desc')
        .limit(LEADERBOARD_LEGACY_SUPPLEMENT_LIMIT)
        .get();

      const mergedDocs = new Map();
      for (const document of leaderboardDocs) {
        mergedDocs.set(document.id, document);
      }
      for (const document of filterLeaderboardDocsByPeriod(supplementSnapshot.docs, period, rankingSeason, dayInfo, weekInfo)) {
        if (!mergedDocs.has(document.id)) {
          mergedDocs.set(document.id, document);
        }
      }
      leaderboardDocs = Array.from(mergedDocs.values());
    }

    const leaders = buildLeadersFromDocs(leaderboardDocs);
    const payload = {
      leaders,
      period,
      rankingSeason,
      rankingDay: dayInfo.rankingDay,
      rankingWeek: weekInfo.rankingWeek,
      rankingWeekStart: weekInfo.rankingWeekStart
    };

    setCachedLeaderboard(cacheKey, payload);
    res.set('Cache-Control', 'no-store');
    return res.json(payload);
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
