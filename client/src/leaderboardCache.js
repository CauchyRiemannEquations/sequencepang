// Reopening a ranking should not repeat authentication and database requests.
// Keep this in memory only; KST midnight and score submissions invalidate it.
export function createLeaderboardCache(load, { ttlMs = 15000, now = Date.now, onTiming = () => {} } = {}) {
  const results = new Map();
  const pending = new Map();
  let generation = 0;

  function invalidate() {
    generation += 1;
    results.clear();
    pending.clear();
  }

  function fetch(period = 'daily') {
    const normalized = ['daily', 'weekly', 'season'].includes(period) ? period : 'daily';
    const requestedAt = now();
    const day = new Date(requestedAt + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const key = `${normalized}:${day}`;
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
    const request = Promise.resolve().then(() => load(normalized)).then(payload => {
      if (requestGeneration === generation) {
        results.set(key, { payload, expiresAt: now() + ttlMs });
      }
      return payload;
    }).finally(() => {
      report('client-miss');
      if (pending.get(key) === request) pending.delete(key);
    });
    pending.set(key, request);
    return request;
  }

  return { fetch, invalidate };
}
