async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || '랭킹 서버 요청에 실패했습니다.');
  }
  return body;
}

export function submitScore(scoreData) {
  return requestJson('/api/scores', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(scoreData)
  });
}

export function createGameSession() {
  return requestJson('/api/game-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
}

export function fetchLeaderboard() {
  return requestJson('/api/leaderboard');
}
