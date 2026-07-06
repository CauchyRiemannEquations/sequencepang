const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { registerSocketHandlers } = require('./socketHandlers');
const { scoreRouter } = require('./scoreRoutes');

const app = express();
const frontendRedirectUrl = process.env.FRONTEND_REDIRECT_URL;
const frontendOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const devOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];
const allowedOrigins = [...new Set([...frontendOrigins, ...devOrigins])];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Socket.IO origin is not allowed.'));
    },
    methods: ['GET', 'POST']
  }
});

registerSocketHandlers(io);

const clientDistPath = path.join(__dirname, '../client/dist');

app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;

  if (!requestOrigin && frontendOrigins.length === 0) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (isAllowedOrigin(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin || frontendOrigins[0] || devOrigins[0]);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});
app.use('/api', scoreRouter);

if (frontendRedirectUrl) {
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      res.sendStatus(404);
      return;
    }

    const targetUrl = new URL(req.originalUrl, frontendRedirectUrl);
    res.redirect(302, targetUrl.toString());
  });
} else {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 수열팡 서버 실행 중: http://localhost:${PORT}`);
});
