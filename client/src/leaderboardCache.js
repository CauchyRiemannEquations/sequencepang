// Reopening a ranking should not repeat authentication and database requests.
// Keep this in memory only; KST midnight and score submissions invalidate it.
export function createLeaderboardCache(load, { ttlMs = 15000, now = Date.now, onTiming = () => {} } = {}) {
  const results = new Map();
  const pending = new Map();
  let generation = 0;
  const normalizePeriod = period => ['daily', 'weekly', 'season'].includes(period) ? period : 'daily';
  const rankingDay = timestamp => new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const cacheKey = (period, timestamp) => `${normalizePeriod(period)}:${rankingDay(timestamp)}`;

  function invalidate() {
    generation += 1;
    results.clear();
    pending.clear();
    return generation;
  }

  // A submitted score already computes this snapshot on the server. Reuse it
  // without a second HTTP request, but never reuse yesterday's delayed response.
  function prime(period, payload, expectedGeneration = generation) {
    const normalized = normalizePeriod(period);
    const timestamp = now();
    if (expectedGeneration !== generation || payload?.period !== normalized
      || payload.rankingDay !== rankingDay(timestamp) || !Array.isArray(payload.leaders)) return false;
    invalidate(); // A pre-prime request must not replace the accepted score snapshot.
    results.set(cacheKey(normalized, timestamp), { payload, expiresAt: timestamp + ttlMs });
    return true;
  }

  // Expired same-day data is display-only while fetch() revalidates. This does
  // not extend its TTL, start polling, or turn an expired entry into a cache hit.
  function peek(period = 'daily') {
    const timestamp = now();
    const cached = results.get(cacheKey(period, timestamp));
    if (!cached) return null;
    return { payload: cached.payload, stale: timestamp >= cached.expiresAt };
  }

  function fetchCurrent(period, canRetry) {
    const normalized = normalizePeriod(period);
    const requestedAt = now();
    const key = cacheKey(normalized, requestedAt);
    const cached = results.get(key);
    function report(kind) {
      try { onTiming({ kind, period: normalized, totalMs: now() - requestedAt }); } catch { /* Diagnostics only. */ }
    }
    if (cached && requestedAt < cached.expiresAt) {
      report('client-hit');
      return Promise.resolve(cached.payload);
    }
    if (pending.has(key)) {
      pending.get(key).then(() => report('client-shared'), () => report('client-shared'));
      return pending.get(key);
    }
    const requestGeneration = generation;
    function isObsolete() {
      return requestGeneration !== generation || key !== cacheKey(normalized, now());
    }
    function recoverCurrent() {
      const timestamp = now();
      const currentKey = cacheKey(normalized, timestamp);
      const current = results.get(currentKey);
      if (current && timestamp < current.expiresAt) return current.payload;
      const currentRequest = pending.get(currentKey);
      if (currentRequest && currentRequest !== request) return currentRequest;
      if (!canRetry) throw new Error('랭킹이 변경되었습니다. 다시 확인해주세요.');
      // Never join this obsolete request itself. One replacement is enough;
      // repeated wrong-day responses or invalidations must not cause a loop.
      if (pending.get(key) === request) pending.delete(key);
      return fetchCurrent(normalized, false);
    }
    const request = Promise.resolve().then(() => load(normalized)).then(payload => {
      const completedAt = now();
      if (isObsolete() || (payload?.rankingDay && payload.rankingDay !== rankingDay(completedAt))) {
        return recoverCurrent();
      }
      results.set(key, { payload, expiresAt: completedAt + ttlMs });
      return payload;
    }, error => {
      // A failed pre-submit/pre-midnight request must not hide a newer snapshot.
      if (isObsolete()) return recoverCurrent();
      throw error;
    }).finally(() => {
      report('client-miss');
      if (pending.get(key) === request) pending.delete(key);
    });
    pending.set(key, request);
    return request;
  }

  function fetch(period = 'daily') { return fetchCurrent(period, true); }

  return { fetch, invalidate, prime, peek };
}
