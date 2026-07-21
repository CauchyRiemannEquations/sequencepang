const buckets = new Map();
const BUCKET_CLEANUP_INTERVAL_MS = 60 * 1000;
const BUCKET_MAX_AGE_MS = 5 * 60 * 1000;

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStartedAt > BUCKET_MAX_AGE_MS) {
      buckets.delete(key);
    }
  }
}, BUCKET_CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();

function createRateLimiter({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${req.ip || 'unknown'}`;
    let bucket = buckets.get(key);

    if (!bucket || now - bucket.windowStartedAt >= windowMs) {
      bucket = { windowStartedAt: now, count: 0 };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
    }

    next();
  };
}

module.exports = {
  createRateLimiter
};
