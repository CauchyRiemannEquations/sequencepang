const crypto = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { getScoreFirestore } = require('./firestore');

function createRateLimiter({ windowMs, max, keyPrefix, subjectType = 'uid' }) {
  return async (req, res, next) => {
    try {
      const now = Date.now();
      const windowId = Math.floor(now / windowMs);
      const subject = subjectType === 'ip' ? (req.ip || 'unknown') : (req.auth?.uid || req.ip || 'unknown');
      const digest = crypto.createHash('sha256').update(subject).digest('hex');
      const firestore = getScoreFirestore();
      const reference = firestore.collection('request_limits').doc(`${keyPrefix}_${windowId}_${digest}`);
      const allowed = await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        const count = snapshot.exists ? snapshot.data().count : 0;
        if (count >= max) return false;
        transaction.set(reference, { count: count + 1, expiresAt: Timestamp.fromMillis((windowId + 2) * windowMs) });
        return true;
      });
      if (!allowed) return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
      return next();
    } catch (error) { return next(error); }
  };
}

module.exports = { createRateLimiter };
