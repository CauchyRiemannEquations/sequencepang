const STATIC_FRONTEND_HOST_PATTERNS = [/\.vercel\.app$/i, /\.pages\.dev$/i];
const DEFAULT_API_BASE_URL = 'https://sequencepang.onrender.com';

function resolveApiBaseUrl() {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, '');
  }

  const currentHostname = window.location.hostname;
  if (STATIC_FRONTEND_HOST_PATTERNS.some(pattern => pattern.test(currentHostname))) {
    return DEFAULT_API_BASE_URL;
  }

  return '';
}

const API_BASE_URL = resolveApiBaseUrl();

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

export function fetchYesterdayTop() {
  return requestJson(buildApiUrl('/api/yesterday-top'));
}

export function fetchLeaderboard(period = 'daily') {
  const params = new URLSearchParams({
    period: ['daily', 'weekly', 'season'].includes(period) ? period : 'daily'
  });
  return requestJson(buildApiUrl(`/api/leaderboard?${params.toString()}`));
}
