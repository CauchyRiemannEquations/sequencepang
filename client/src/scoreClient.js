const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

function buildApiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || '랭킹 서버 요청에 실패했습니다.');
  }
  return body;
}

export function submitScore(scoreData) {
  return requestJson(buildApiUrl('/api/scores'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(scoreData)
  });
}

export function createGameSession() {
  return requestJson(buildApiUrl('/api/game-session'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
}

export function fetchLeaderboard() {
  return requestJson(buildApiUrl('/api/leaderboard'));
}
