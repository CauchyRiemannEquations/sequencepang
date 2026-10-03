import { requestFirebaseApi } from './firebase.js';

export function submitScore(scoreData) { return requestFirebaseApi('/api/scores', { body: scoreData }); }
export function createGameSession(nickname = '', playerId = null) {
  return requestFirebaseApi('/api/game-session', { body: { nickname, playerId } });
}
export function fetchYesterdayTop() { return requestFirebaseApi('/api/yesterday-top'); }
export function fetchLeaderboard(period = 'daily') {
  const params = new URLSearchParams({ period: ['daily', 'weekly', 'season'].includes(period) ? period : 'daily' });
  return requestFirebaseApi(`/api/leaderboard?${params}`);
}
