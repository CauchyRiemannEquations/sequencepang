const MAX_ROOM_PLAYERS = 30;
const LEADERBOARD_THROTTLE_MS = 700;
const ALLOWED_SCORE_MODES = new Set(['timeAttack']);
// 정상 플레이로 도달 불가능한 수준의 여유 상한 (치팅 점수 차단용)
const MAX_ACCEPTED_SCORE = 5000000;
const MAX_ACCEPTED_COMBO = 10000;
const SCORE_VERSION = '1.2.0';
const GAME_SESSION_TTL_MS = 10 * 60 * 1000;
const GAME_SESSION_DURATION_TOLERANCE_MS = 15000;
const RANKING_RESET_AT_MS = Date.parse('2026-07-05T15:00:00.000Z');
const RANKING_SEASON_ID = '2026-07-06';
const RANKING_LEGACY_SEASON_ID = 'legacy';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function formatDateId(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getCurrentRankingDayInfo(now = Date.now()) {
  const shiftedNow = new Date(now + KST_OFFSET_MS);
  shiftedNow.setUTCHours(0, 0, 0, 0);

  const rankingDay = formatDateId(
    shiftedNow.getUTCFullYear(),
    shiftedNow.getUTCMonth() + 1,
    shiftedNow.getUTCDate()
  );

  const dayStartUtcMs = shiftedNow.getTime() - KST_OFFSET_MS;
  const dayEndUtcMs = dayStartUtcMs + DAY_MS;

  return {
    rankingDay,
    dayStartUtcMs,
    dayEndUtcMs
  };
}

function getCurrentRankingWeekInfo(now = Date.now()) {
  const shiftedNow = new Date(now + KST_OFFSET_MS);
  const dayOfWeek = shiftedNow.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;

  shiftedNow.setUTCDate(shiftedNow.getUTCDate() - daysSinceMonday);
  shiftedNow.setUTCHours(0, 0, 0, 0);

  const rankingWeekStart = formatDateId(
    shiftedNow.getUTCFullYear(),
    shiftedNow.getUTCMonth() + 1,
    shiftedNow.getUTCDate()
  );

  const weekStartUtcMs = shiftedNow.getTime() - KST_OFFSET_MS;
  const weekEndUtcMs = weekStartUtcMs + WEEK_MS;

  const thursday = new Date(shiftedNow.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + (4 - firstThursdayDay));
  const rankingWeekNumber = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / WEEK_MS);
  const rankingWeek = `${isoYear}-W${String(rankingWeekNumber).padStart(2, '0')}`;

  return {
    rankingWeek,
    rankingWeekStart,
    weekStartUtcMs,
    weekEndUtcMs
  };
}

module.exports = {
  MAX_ROOM_PLAYERS,
  LEADERBOARD_THROTTLE_MS,
  ALLOWED_SCORE_MODES,
  MAX_ACCEPTED_SCORE,
  MAX_ACCEPTED_COMBO,
  SCORE_VERSION,
  GAME_SESSION_TTL_MS,
  GAME_SESSION_DURATION_TOLERANCE_MS,
  RANKING_RESET_AT_MS,
  RANKING_SEASON_ID,
  RANKING_LEGACY_SEASON_ID,
  KST_OFFSET_MS,
  DAY_MS,
  WEEK_MS,
  getCurrentRankingDayInfo,
  getCurrentRankingWeekInfo
};
