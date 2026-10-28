const express = require('express');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getScoreFirestore } = require('./firestore');
const {
  ALLOWED_SCORE_MODES,
  MAX_ACCEPTED_SCORE,
  MAX_ACCEPTED_COMBO,
  SCORE_VERSION,
  RANKING_RESET_AT_MS,
  RANKING_SEASON_ID,
  RANKING_LEGACY_SEASON_ID,
  DAY_MS,
  getCurrentRankingDayInfo,
  getCurrentRankingWeekInfo
} = require('./constants');
const {
  issueGameSession,
  commitSessionScore
} = require('./gameSessionStore');
const { createRateLimiter } = require('./rateLimit');
const { isProfaneNickname } = require('./profanityFilter');
const { measure } = require('./requestTiming');
const { createSingleFlight } = require('./singleFlight');
const { createRankingSnapshotCache } = require('./rankingSnapshotCache');
const { recordRead } = require('./readMetrics');
const supplementCaches = new WeakMap();
const leaderboardRequests = createSingleFlight();

const PROFANE_NICKNAME_MESSAGE = '사용할 수 없는 닉네임입니다.';

// 한 게임이 최소 30초 이상이므로 분당 20회는 정상 플레이에 넉넉한 값
const writeRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20, keyPrefix: 'score-write' });

const scoreRouter = express.Router();
const RESERVED_NICKNAMES = new Set(['null', 'undefined', 'nan', 'anonymous', 'guest']);
const SESSION_ERROR_MESSAGE = '점수 기록을 확인할 수 없습니다.';
const LEADERBOARD_LIMIT = 300;
const LEADERBOARD_RESPONSE_LIMIT = 30;
// Out-of-band admin edits may omit revision: never keep them stale indefinitely.
const LEADERBOARD_MAX_AGE_MS = 5 * 60 * 1000;
const LEADERBOARD_LEGACY_SUPPLEMENT_LIMIT = 1200;
// Preserve the full compatibility scan while excluding unused session/analytics
// fields from transfer and decoding. These cover filtering, sorting and dedupe.
const LEADERBOARD_FIELDS = ['nickname', 'score', 'maxCombo', 'mode', 'playerId',
  'createdAt', 'rankingSeason', 'rankingDay', 'rankingWeek'];
const ANALYTICS_FIELDS = [
  'clearCount',
  'feverClearCount',
  'repeatedPathCount',
  'repeatedValuePatternCount',
  'crossPangCount',
  'fullPangCount',
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

// 중복 제거(플레이어당 최고점 1개)까지 끝난 전체 순위 배열을 반환
function buildRankedEntries(documents) {
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

  return Array.from(bestByNickname.values());
}

function buildLeadersFromDocs(documents) {
  return buildRankedEntries(documents)
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

async function getCachedLeaderboard(firestore, cacheKey, timing) {
  try {
    const [state, cached] = await Promise.all([
      readRevision(firestore, timing),
      firestore.collection('leaderboard_cache').doc(cacheKey).get().then(snapshot => {
        recordRead(timing, 'cache', 1); return snapshot;
      })
    ]);
    const revision = state;
    const data = cached.data();
    return { revision, payload: data?.revision === revision && (data.freshUntil || data.expiresAt)?.toMillis?.() > Date.now() ? data.payload : null };
  } catch (error) {
    console.warn('랭킹 캐시 조회 실패:', error.message);
    return { revision: null, payload: null };
  }
}

function getRankingFreshUntil(now = Date.now()) {
  return (Math.floor(now / LEADERBOARD_MAX_AGE_MS) + 1) * LEADERBOARD_MAX_AGE_MS;
}

async function setCachedLeaderboard(firestore, cacheKey, payload, revision, freshUntilMs = getRankingFreshUntil(), timing) {
  if (!Number.isSafeInteger(revision) || revision < 0) return;
  try {
    const reference = firestore.collection('leaderboard_cache').doc(cacheKey);
    // A slower old revision/window must not evict a newer completed rebuild.
    // This adds one document read per attempt only on publication, not cache hits.
    await firestore.runTransaction(async transaction => {
      const existing = await transaction.get(reference);
      recordRead(timing, 'cachePublication', 1);
      timing?.add?.('cachePublicationAttempts', 1);
      const current = existing.data();
      const currentFreshUntil = (current?.freshUntil || current?.expiresAt)?.toMillis?.() || 0;
      if (current?.revision > revision || (current?.revision === revision && currentFreshUntil >= freshUntilMs)) return;
      transaction.set(reference, { revision, payload,
        freshUntil: Timestamp.fromMillis(freshUntilMs),
        // Old/rollback readers only understand expiresAt. Keep that bound equal
        // to freshness; never expose a longer retention TTL under the same key.
        expiresAt: Timestamp.fromMillis(freshUntilMs) });
    });
  } catch (error) { console.warn('랭킹 캐시 저장 실패:', error.message); }
}

function isFirestoreIndexError(error) {
  const errorCode = String(error?.code || '');
  const errorMessage = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return errorCode === '9' || errorMessage.includes('failed-precondition') || errorMessage.includes('index');
}

function filterLeaderboardDocsByPeriod(documents, period, rankingSeason, dayInfo, weekInfo) {
  return documents.filter(document => matchesPeriodRecord(document.data(), period, rankingSeason, dayInfo, weekInfo));
}

async function readRevision(firestore, timing) {
  const state = await firestore.collection('ranking_state').doc('current').get();
  recordRead(timing, 'revision', 1);
  const revision = state.data()?.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid ranking revision');
  return revision;
}

function makeLeaderboardPayload(documents, period, rankingSeason, dayInfo, weekInfo) {
  return {
    leaders: buildLeadersFromDocs(documents), period, rankingSeason,
    rankingDay: dayInfo.rankingDay, rankingWeek: weekInfo.rankingWeek,
    rankingWeekStart: weekInfo.rankingWeekStart
  };
}

async function readScoreQuery(query, timing, category) {
  const snapshot = await query.get();
  recordRead(timing, category, snapshot.docs.length, { query: true });
  return snapshot;
}

async function fetchLeaderboardSnapshot(scoresCollection, period, rankingSeason, dayInfo, weekInfo, timing, loadSupplement) {
  try {
    if (period === 'daily') {
      return await readScoreQuery(scoresCollection
        .where('rankingSeason', '==', rankingSeason)
        .where('rankingDay', '==', dayInfo.rankingDay)
        .where('mode', '==', 'timeAttack')
        .orderBy('score', 'desc')
        .limit(LEADERBOARD_LIMIT), timing, 'scores');
    }

    if (period === 'weekly') {
      return await readScoreQuery(scoresCollection
        .where('rankingSeason', '==', rankingSeason)
        .where('rankingWeek', '==', weekInfo.rankingWeek)
        .where('mode', '==', 'timeAttack')
        .orderBy('score', 'desc')
        .limit(LEADERBOARD_LIMIT), timing, 'scores');
    }

    if (rankingSeason === RANKING_LEGACY_SEASON_ID) {
      return await readScoreQuery(scoresCollection
        .where('mode', '==', 'timeAttack')
        .orderBy('score', 'desc')
        .limit(LEADERBOARD_LIMIT), timing, 'scores');
    }

    return await readScoreQuery(scoresCollection
      .where('rankingSeason', '==', rankingSeason)
      .where('mode', '==', 'timeAttack')
      .orderBy('score', 'desc')
      .limit(LEADERBOARD_LIMIT), timing, 'scores');
  } catch (error) {
    if (!isFirestoreIndexError(error)) {
      throw error;
    }

    console.warn('랭킹 인덱스 쿼리 실패, fallback 조회로 전환:', error.message);
    timing?.set('indexFallback', true);

    // The compatibility query has exactly the same global top-1200 coverage.
    // Reuse it instead of issuing a second identical scan after an index failure.
    const fallbackSnapshot = await loadSupplement();

    const filteredDocs = fallbackSnapshot.docs.filter(document => {
      const data = document.data();
      return matchesPeriodRecord(data, period, rankingSeason, dayInfo, weekInfo);
    });

    return { docs: filteredDocs };
  }
}

// 기간별 랭킹 대상 문서 전체 로딩 (기본 쿼리 + 레거시 보충 병합)
async function loadPeriodDocs(scoresCollection, period, rankingSeason, dayInfo, weekInfo, timing, { firestore, revision } = {}) {
  let supplementPromise;
  function loadSupplement() {
    if (!supplementPromise) {
      const task = () => measure(timing, 'firestore_legacy', () => readScoreQuery(scoresCollection
        .orderBy('score', 'desc').limit(LEADERBOARD_LEGACY_SUPPLEMENT_LIMIT)
        .select(...LEADERBOARD_FIELDS), timing, 'legacy'));
      if (firestore && Number.isSafeInteger(revision)) {
        if (!supplementCaches.has(firestore)) supplementCaches.set(firestore, createRankingSnapshotCache());
        const cached = supplementCaches.get(firestore).load(revision, task);
        timing?.set('legacyCache', cached.source);
        supplementPromise = cached.promise;
      } else supplementPromise = task();
    }
    return supplementPromise;
  }
  // Same indexed 300 + global 1200 coverage, period rules and merge order as before.
  const [snapshot, supplementSnapshot] = await Promise.all([
    measure(timing, 'firestore_scores', () => fetchLeaderboardSnapshot(scoresCollection, period, rankingSeason, dayInfo, weekInfo, timing, loadSupplement)),
    period === 'daily' || period === 'weekly' ? loadSupplement() : null
  ]);
  timing?.set('scoreDocumentsReturned', snapshot.docs.length);
  timing?.set('legacyDocumentsReturned', supplementSnapshot?.docs.length || 0);
  const mergedDocs = new Map(snapshot.docs.map(document => [document.id, document]));
  if (supplementSnapshot) {
    for (const document of filterLeaderboardDocsByPeriod(supplementSnapshot.docs, period, rankingSeason, dayInfo, weekInfo)) {
      if (!mergedDocs.has(document.id)) mergedDocs.set(document.id, document);
    }
  }
  return Array.from(mergedDocs.values());
}

// 방금 저장한 점수의 오늘 순위 계산 (실패해도 저장 자체에는 영향 없음)
async function computeDailyResult(firestore, scoreData, timing) {
  const now = Date.now();
  const freshUntilMs = getRankingFreshUntil(now);
  const dayInfo = getCurrentRankingDayInfo(now);
  const weekInfo = getCurrentRankingWeekInfo(now);
  const rankingSeason = getRankingSeason(now);
  // Read after the score transaction. A racing newer write will have a different
  // revision and cannot treat this snapshot as its fresh cache.
  const revision = await readRevision(firestore, timing);
  const docs = await loadPeriodDocs(firestore.collection('scores'), 'daily', rankingSeason, dayInfo, weekInfo, timing, { firestore, revision });
  const leaderboard = makeLeaderboardPayload(docs, 'daily', rankingSeason, dayInfo, weekInfo);
  await setCachedLeaderboard(firestore, buildLeaderboardCacheKey('daily', rankingSeason, dayInfo, weekInfo), leaderboard, revision, freshUntilMs, timing);
  const entries = buildRankedEntries(docs);

  const submittedPlayerIdentity = scoreData.playerId ? `player:${scoreData.playerId}` : null;
  const submittedNicknameIdentity = getNicknameIdentity(scoreData);
  const index = entries.findIndex(data => {
    const playerIdentity = getPlayerIdentity(data);
    if (submittedPlayerIdentity && playerIdentity) {
      return playerIdentity === submittedPlayerIdentity;
    }
    return getNicknameIdentity(data) === submittedNicknameIdentity;
  });

  const cutoffEntry = entries[LEADERBOARD_RESPONSE_LIMIT - 1];
  return { leaderboard, dailyRank: index === -1 ? null : {
    rank: index + 1,
    totalPlayers: entries.length,
    top30Cutoff: cutoffEntry ? cutoffEntry.score : null
  } };
}

async function computeDailyRank(firestore, scoreData, timing) {
  return (await computeDailyResult(firestore, scoreData, timing)).dailyRank;
}

// 어제의 1등 (지나간 날짜의 기록은 불변이므로 날짜 단위로 캐시)
const yesterdayTopCache = new WeakMap();
const yesterdayRequests = new WeakMap();
async function loadYesterdayTop(firestore, timing) {
  const now = Date.now();
  const freshUntilMs = getRankingFreshUntil(now);
  const yesterdayMs = now - DAY_MS;
  const dayInfo = getCurrentRankingDayInfo(yesterdayMs);
  const weekInfo = getCurrentRankingWeekInfo(yesterdayMs);
  const rankingSeason = getRankingSeason(yesterdayMs);
  const cacheKey = `yesterday:${rankingSeason}:${dayInfo.rankingDay}`;
  const memory = yesterdayTopCache.get(firestore);
  if (memory?.key === cacheKey && memory.freshUntilMs > now) { timing?.set('cache', 'memory-hit'); return memory.payload; }
  // Persist only the tiny public result so cold instances avoid a full scan.
  // Bound it too: late midnight commits/admin corrections may change yesterday.
  const reference = firestore.collection('leaderboard_cache').doc(cacheKey);
  let data;
  try {
    const stored = await reference.get();
    recordRead(timing, 'cache', 1);
    data = stored.data();
  } catch (error) { console.warn('어제의 1등 캐시 조회 실패:', error.message); }
  if (data?.payload?.rankingDay === dayInfo.rankingDay && data.freshUntil?.toMillis?.() > now) {
    timing?.set('cache', 'firestore-hit');
    yesterdayTopCache.set(firestore, { key: cacheKey, payload: data.payload, freshUntilMs: data.freshUntil.toMillis() });
    return data.payload;
  }
  if (!yesterdayRequests.has(firestore)) yesterdayRequests.set(firestore, createSingleFlight());
  const flight = yesterdayRequests.get(firestore).run(`${cacheKey}:${freshUntilMs}`, async () => {
    const revision = await readRevision(firestore, timing);
    const docs = await loadPeriodDocs(firestore.collection('scores'), 'daily', rankingSeason, dayInfo, weekInfo, timing, { firestore, revision });
    const topEntry = buildRankedEntries(docs)[0] || null;
    const payload = { rankingDay: dayInfo.rankingDay,
      top: topEntry ? { nickname: normalizeNickname(topEntry.nickname), score: topEntry.score } : null };
    try { await reference.set({ payload, freshUntil: Timestamp.fromMillis(freshUntilMs), expiresAt: Timestamp.fromMillis(freshUntilMs) }); }
    catch (error) { console.warn('어제의 1등 캐시 저장 실패:', error.message); }
    yesterdayTopCache.set(firestore, { key: cacheKey, payload, freshUntilMs });
    return payload;
  });
  timing?.set('cache', flight.shared ? 'shared-miss' : 'miss');
  return flight.promise;
}

function validateScorePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: '올바른 점수 데이터가 필요합니다.', reason: 'invalid_payload' };
  }

  const nickname = normalizeNickname(payload.nickname);
  if (!nickname) {
    return { error: '닉네임을 확인해주세요.', reason: 'invalid_nickname' };
  }

  if (isProfaneNickname(nickname)) {
    return { error: PROFANE_NICKNAME_MESSAGE, reason: 'profane_nickname' };
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

scoreRouter.post('/game-session', writeRateLimiter, async (req, res) => {
  const requestedNickname = typeof req.body?.nickname === 'string' ? req.body.nickname : '';
  const nickname = normalizeNickname(requestedNickname);
  if (!nickname) return res.status(400).json({ error: '닉네임을 확인해주세요.' });
  if (isProfaneNickname(nickname)) {
    return res.status(400).json({ error: PROFANE_NICKNAME_MESSAGE });
  }
  const playerId = typeof req.body?.playerId === 'string' && req.body.playerId.trim()
    ? req.body.playerId.trim().slice(0, 120) : null;
  try {
    return res.status(201).json(await issueGameSession({ uid: req.auth.uid, nickname, playerId }));
  } catch (error) {
    console.error('세션 발급 실패:', error.message);
    return res.status(503).json({ error: '게임 세션을 시작하지 못했습니다.' });
  }
});

scoreRouter.post('/scores', writeRateLimiter, async (req, res) => {
  const validation = validateScorePayload(req.body);
  if (validation.error) {
    const firestore = getScoreFirestore();
    await recordSuspiciousScore(firestore, req.body, validation.reason);
    return res.status(400).json({ error: validation.error });
  }

  const firestore = getScoreFirestore();
  if (!firestore) {
    return firestoreUnavailable(res);
  }

  try {
    const { gameSessionId, sessionToken, ...scoreData } = validation.value;
    const dayInfo = getCurrentRankingDayInfo();
    const weekInfo = getCurrentRankingWeekInfo();
    const result = await commitSessionScore({ ...validation.value, uid: req.auth.uid }, {
      ...scoreData,
      authUid: req.auth.uid,
      rankingSeason: getRankingSeason(),
      rankingDay: dayInfo.rankingDay,
      rankingWeek: weekInfo.rankingWeek,
      rankingWeekStart: weekInfo.rankingWeekStart,
      createdAt: FieldValue.serverTimestamp(),
      version: SCORE_VERSION
    }, firestore, req.timing);
    if (result.error) {
      await recordSuspiciousScore(firestore, req.body, result.error);
      return res.status(400).json({ error: SESSION_ERROR_MESSAGE });
    }

    let dailyRank = null;
    let leaderboard = null;
    try {
      ({ dailyRank, leaderboard } = await computeDailyResult(firestore, scoreData, req.timing));
    } catch (rankError) {
      console.warn('일간 순위 계산 실패:', rankError.message);
    }

    return res.status(201).json({ ok: true, id: result.id, dailyRank, leaderboard });
  } catch (error) {
    console.error('점수 저장 실패:', error.message);
    return res.status(500).json({ error: '점수를 저장하지 못했습니다.' });
  }
});

scoreRouter.get('/yesterday-top', async (req, res) => {
  const firestore = getScoreFirestore();
  if (!firestore) return firestoreUnavailable(res);

  try {
    const payload = await loadYesterdayTop(firestore, req.timing);
    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (error) {
    console.error('어제의 1등 조회 실패:', error.message);
    return res.status(500).json({ error: '어제의 1등을 불러오지 못했습니다.' });
  }
});

scoreRouter.get('/leaderboard', async (req, res) => {
  const firestore = getScoreFirestore();
  if (!firestore) return firestoreUnavailable(res);

  try {
    const requestedPeriod = typeof req.query.period === 'string' ? req.query.period : '';
    const period = ['daily', 'weekly', 'season'].includes(requestedPeriod) ? requestedPeriod : 'daily';
    const now = Date.now();
    const freshUntilMs = getRankingFreshUntil(now);
    const rankingSeason = getRankingSeason(now);
    const dayInfo = getCurrentRankingDayInfo(now);
    const weekInfo = getCurrentRankingWeekInfo(now);
    const cacheKey = buildLeaderboardCacheKey(period, rankingSeason, dayInfo, weekInfo);
    // The score transaction increments a shared revision, invalidating all instances.
    const cacheState = await measure(req.timing, 'firestore_cache_read', () => getCachedLeaderboard(firestore, cacheKey, req.timing));
    const cachedPayload = cacheState.payload;

    if (cachedPayload) {
      req.timing?.set('cache', 'firestore-hit');
      res.set('Cache-Control', 'no-store');
      return res.json(cachedPayload);
    }

    // Revision is part of the key: a post-submit request must not join work
    // started before that score was saved, even on a different instance.
    const flightKey = cacheState.revision === null ? Symbol(cacheKey) : `${cacheKey}:${cacheState.revision}:${freshUntilMs}`;
    const flight = leaderboardRequests.run(flightKey, async () => {
      const leaderboardDocs = await loadPeriodDocs(firestore.collection('scores'), period, rankingSeason, dayInfo, weekInfo, req.timing, { firestore, revision: cacheState.revision });
      const payload = makeLeaderboardPayload(leaderboardDocs, period, rankingSeason, dayInfo, weekInfo);
      await measure(req.timing, 'firestore_cache_write', () => setCachedLeaderboard(firestore, cacheKey, payload, cacheState.revision, freshUntilMs, req.timing));
      return payload;
    });
    req.timing?.set('cache', flight.shared ? 'shared-miss' : 'miss');
    const payload = await measure(req.timing, 'leaderboard_rebuild_wait', () => flight.promise);
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
  validateScorePayload, buildRankedEntries, computeDailyRank, computeDailyResult, loadYesterdayTop, loadPeriodDocs, recordSuspiciousScore, getCachedLeaderboard, setCachedLeaderboard, buildLeaderboardCacheKey, getRankingFreshUntil
};
