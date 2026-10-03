const express = require('express');
const { createRateLimiter } = require('./rateLimit');
const { RoomError, joinRoom, leaveRoom, startRoom } = require('./roomService');

const roomRouter = express.Router();
const limiter = createRateLimiter({ windowMs: 60000, max: 30, keyPrefix: 'rooms' });
for (const [path, handler] of [['join', joinRoom], ['leave', leaveRoom], ['start', startRoom]]) {
  roomRouter.post(`/rooms/${path}`, limiter, async (req, res) => {
    try {
      return res.json(await handler({ uid: req.auth.uid, roomId: req.body?.roomId,
        nickname: req.body?.nickname, create: req.body?.create === true }));
    } catch (error) {
      if (error instanceof RoomError) return res.status(400).json({ error: error.message });
      console.error('멀티플레이 요청 실패:', error.message);
      return res.status(503).json({ error: '방에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.' });
    }
  });
}

module.exports = { roomRouter };
