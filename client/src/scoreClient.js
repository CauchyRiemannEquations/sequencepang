import { requestFirebaseApi } from './firebase.js';
import { createLeaderboardCache } from './leaderboardCache.js';
import { recordApiTiming } from './apiTiming.js';

const leaderboardCache = createLeaderboardCache(period => {
  const params = new URLSearchParams({ period });
  return requestFirebaseApi(`/api/leaderboard?${params}`);
}, { onTiming: recordApiTiming });

let latestSubmission = 0;
export async function submitScore(scoreData) {
  const submission = ++latestSubmission;
  leaderboardCache.invalidate();
  let response;
  try {
    response = await requestFirebaseApi('/api/scores', { body: scoreData });
    return response;
  } finally {
    const generation = leaderboardCache.invalidate();
    // Even a superseded request may have committed a score, so invalidate on
    // completion, but only the latest submission can supply the next snapshot.
    if (submission === latestSubmission) {
      leaderboardCache.prime('daily', response?.leaderboard, generation);
    }
  }
}
export function createGameSession(nickname = '', playerId = null) {
  return requestFirebaseApi('/api/game-session', { body: { nickname, playerId } });
}
export function fetchYesterdayTop() { return requestFirebaseApi('/api/yesterday-top'); }
export function fetchLeaderboard(period = 'daily') {
  return leaderboardCache.fetch(period);
}

export function peekLeaderboard(period = 'daily') {
  return leaderboardCache.peek(period);
}
