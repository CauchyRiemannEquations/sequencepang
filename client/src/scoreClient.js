import { requestFirebaseApi } from './firebase.js';
import { createLeaderboardCache } from './leaderboardCache.js';

const leaderboardCache = createLeaderboardCache(period => {
  const params = new URLSearchParams({ period });
  return requestFirebaseApi(`/api/leaderboard?${params}`);
});

export async function submitScore(scoreData) {
  leaderboardCache.invalidate();
  try {
    return await requestFirebaseApi('/api/scores', { body: scoreData });
  } finally {
    leaderboardCache.invalidate();
  }
}
export function createGameSession(nickname = '', playerId = null) {
  return requestFirebaseApi('/api/game-session', { body: { nickname, playerId } });
}
export function fetchYesterdayTop() { return requestFirebaseApi('/api/yesterday-top'); }
export function fetchLeaderboard(period = 'daily') {
  return leaderboardCache.fetch(period);
}
