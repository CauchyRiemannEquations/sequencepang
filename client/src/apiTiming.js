const samples = [];
const clock = () => performance.now();

export function recordApiTiming(sample) {
  samples.push(Object.freeze(sample));
  if (samples.length > 30) samples.shift();
  // DevTools User Timing; no user identifiers, tokens, payloads or telemetry upload.
  if (typeof performance.measure === 'function') {
    if (performance.getEntriesByName('sequencepang:ranking').length >= 30) {
      performance.clearMeasures('sequencepang:ranking');
    }
    performance.measure('sequencepang:ranking', { start: 0, duration: sample.totalMs, detail: sample });
  }
}
export function getApiTimingSamples() { return [...samples]; }

// Dependency injection keeps measured auth/token/network boundaries testable.
export function createApiRequest({ ensureUser, getBaseUrl, fetchImpl = fetch,
  now = clock, record = recordApiTiming }) {
  return async (path, { body, method = body === undefined ? 'GET' : 'POST', keepalive = false } = {}) => {
    const startedAt = now();
    const ranking = path.startsWith('/api/leaderboard?');
    const timing = { kind: 'api', period: ranking ? new URLSearchParams(path.split('?')[1]).get('period') : undefined,
      authReadyMs: 0, tokenMs: 0, httpMs: 0, decodeMs: 0, serverTiming: null, status: null };
    let cursor = startedAt;
    let phase = 'authReadyMs';
    try {
      const user = await ensureUser();
      timing.authReadyMs = now() - cursor;
      cursor = now();
      phase = 'tokenMs';
      const token = await user.getIdToken();
      timing.tokenMs = now() - cursor;
      cursor = now();
      phase = 'httpMs';
      const response = await fetchImpl(`${getBaseUrl()}${path}`, {
        method, keepalive,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      timing.httpMs = now() - cursor;
      timing.status = response.status;
      timing.serverTiming = response.headers?.get('Server-Timing') || null;
      cursor = now();
      phase = 'decodeMs';
      const result = await response.json().catch(() => ({}));
      timing.decodeMs = now() - cursor;
      phase = null;
      if (!response.ok) throw new Error(result.error || '게임 서버 요청에 실패했습니다.');
      return result;
    } finally {
      if (phase) timing[phase] = now() - cursor;
      if (ranking) {
        timing.totalMs = now() - startedAt;
        // Diagnostics must never fail an otherwise successful game request.
        try { record(timing); } catch { /* User Timing may be unavailable. */ }
      }
    }
  };
}
