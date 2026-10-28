// Per-instance reuse is only an optimization. Callers must first read the shared
// score revision; never use this cache as a replacement for cross-instance invalidation.
function createRankingSnapshotCache({ now = Date.now, ttlMs = 5 * 60 * 1000, maxEntries = 4 } = {}) {
  const values = new Map();
  const pending = new Map();
  function load(revision, task) {
    if (!Number.isSafeInteger(revision) || revision < 0) return { promise: Promise.resolve().then(task), source: 'uncached' };
    const boundary = (Math.floor(now() / ttlMs) + 1) * ttlMs;
    const key = `${revision}:${boundary}`;
    const cached = values.get(key);
    if (cached && cached.expiresAt > now()) return { promise: Promise.resolve(cached.value), source: 'memory-hit' };
    if (pending.has(key)) return { promise: pending.get(key), source: 'shared' };
    const expiresAt = boundary;
    const promise = Promise.resolve().then(task).then(value => {
      values.set(key, { value, expiresAt });
      while (values.size > maxEntries) values.delete(values.keys().next().value);
      return value;
    }).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
    pending.set(key, promise);
    return { promise, source: 'miss' };
  }
  return { load };
}
module.exports = { createRankingSnapshotCache };
