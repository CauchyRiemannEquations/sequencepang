const express = require('express');
const { getAuth } = require('firebase-admin/auth');
const { getScoreFirestore } = require('./firestore');
const { createRateLimiter } = require('./rateLimit');
const { scoreRouter } = require('./scoreRoutes');
const { roomRouter } = require('./roomRoutes');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

function allowedOrigin(origin) {
  if (!origin) return true;
  const origins = (process.env.FRONTEND_ORIGINS || 'https://sequencepang.vercel.app').split(',').map(v => v.trim());
  if (process.env.FUNCTIONS_EMULATOR === 'true') origins.push('http://localhost:5173', 'http://127.0.0.1:5173');
  return origins.includes(origin);
}

app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (!allowedOrigin(origin)) return res.status(403).json({ error: '허용되지 않은 요청입니다.' });
  if (origin) { res.set('Access-Control-Allow-Origin', origin); res.vary('Origin'); }
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.set('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});
app.use(express.json({ limit: '16kb' }));
app.get('/health', (_req, res) => res.json({ ok: true, backend: 'firebase', scoreVersion: '1.4.0' }));
app.use('/api', async (req, res, next) => {
  const token = req.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });
  try {
    getScoreFirestore(); // Initializes the default Admin app.
    req.auth = await getAuth().verifyIdToken(token);
    return next();
  } catch { return res.status(401).json({ error: '인증을 확인하지 못했습니다. 다시 연결해주세요.' }); }
});
app.use('/api', createRateLimiter({ windowMs: 60000, max: 600, keyPrefix: 'api-ip', subjectType: 'ip' }));
app.use('/api', createRateLimiter({ windowMs: 60000, max: 120, keyPrefix: 'api' }));
app.use('/api', scoreRouter);
app.use('/api', roomRouter);
app.use((_req, res) => res.status(404).json({ error: '요청을 찾을 수 없습니다.' }));
app.use((error, _req, res, _next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '요청이 너무 큽니다.' });
  if (error instanceof SyntaxError) return res.status(400).json({ error: '올바른 JSON이 필요합니다.' });
  console.error('API 요청 실패:', error.message);
  return res.status(503).json({ error: '서버 요청에 실패했습니다. 잠시 후 다시 시도해주세요.' });
});

module.exports = { app, allowedOrigin };
