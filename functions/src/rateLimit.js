const crypto = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { getScoreFirestore } = require('./firestore');
const { measure } = require('./requestTiming');

function createRateLimiter(options) { return createCombinedRateLimiter([options]); }

// Read both independent counters in one transaction instead of two serial
// transactions. Limits remain shared across instances; no local-only limiter.
function createCombinedRateLimiter(limits, { getFirestore = getScoreFirestore, now = Date.now } = {}) {
  return async (req, res, next) => {
    try {
      const timestamp = now();
      const firestore = getFirestore();
      const counters = limits.map(({ windowMs, max, keyPrefix, subjectType = 'uid' }) => {
        const windowId = Math.floor(timestamp / windowMs);
        const subject = subjectType === 'ip' ? (req.ip || 'unknown') : (req.auth?.uid || req.ip || 'unknown');
        const digest = crypto.createHash('sha256').update(subject).digest('hex');
        return { reference: firestore.collection('request_limits').doc(`${keyPrefix}_${windowId}_${digest}`),
          max, expiresAt: Timestamp.fromMillis((windowId + 2) * windowMs) };
      });
      const allowed = await measure(req.timing, 'firestore_rate_limit', () => firestore.runTransaction(async transaction => {
        const snapshots = await transaction.getAll(...counters.map(counter => counter.reference));
        const counts = snapshots.map(snapshot => snapshot.exists ? snapshot.data().count : 0);
        // Preserve the old ordered accounting: a UID-rejected request still
        // consumes the IP allowance, preventing retries from bypassing it.
        for (let index = 0; index < counters.length; index += 1) {
          const counter = counters[index];
          if (counts[index] >= counter.max) return false;
          transaction.set(counter.reference, { count: counts[index] + 1, expiresAt: counter.expiresAt });
        }
        return true;
      }));
      if (!allowed) return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
      return next();
    } catch (error) { return next(error); }
  };
}

module.exports = { createRateLimiter, createCombinedRateLimiter };
