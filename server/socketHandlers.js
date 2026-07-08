const { MAX_ROOM_PLAYERS } = require('./constants');
const {
  rooms,
  getRoom,
  ensureRoom,
  deleteRoom,
  getSortedLeaderboard,
  getLobbyPlayers,
  throttleRoom
} = require('./roomStore');

function registerSocketHandlers(io) {
  function broadcastLobbyUpdate(roomId) {
    const room = getRoom(roomId);
    if (!room) return;

    io.to(roomId).emit('lobbyUpdate', {
      players: getLobbyPlayers(roomId),
      hostId: room.hostId
    });
  }

  function broadcastLeaderboard(roomId) {
    throttleRoom(roomId, () => {
      io.to(roomId).emit('leaderboardUpdate', getSortedLeaderboard(roomId));
    });
  }

  io.on('connection', socket => {
    console.log(`플레이어 접속: ${socket.id}`);

    socket.on('joinRoom', ({ roomId, nickname }) => {
      if (!roomId || !nickname) {
        return socket.emit('errorMsg', '방 코드와 닉네임을 정확히 입력해주세요!');
      }

      const cleanRoomId = roomId.trim().toUpperCase();
      const cleanNickname = nickname.trim().slice(0, 10);

      if (!cleanRoomId || !cleanNickname) {
        return socket.emit('errorMsg', '방 코드 또는 닉네임 형식이 올바르지 않습니다.');
      }

      const room = ensureRoom(cleanRoomId, socket.id);

      if (room.isStarted) {
        return socket.emit('errorMsg', '이미 게임이 시작되어 대기실에 입장할 수 없습니다.');
      }

      if (Object.keys(room.players).length >= MAX_ROOM_PLAYERS) {
        return socket.emit('errorMsg', `이 방은 최대 ${MAX_ROOM_PLAYERS}명까지만 입장할 수 있습니다.`);
      }

      const isDuplicate = Object.values(room.players).some(
        player => player.nickname.toLocaleLowerCase() === cleanNickname.toLocaleLowerCase()
      );

      if (isDuplicate) {
        return socket.emit('errorMsg', '이미 사용 중인 닉네임입니다. 다른 이름을 사용해주세요.');
      }

      socket.roomId = cleanRoomId;
      socket.nickname = cleanNickname;
      socket.join(cleanRoomId);

      room.players[socket.id] = {
        nickname: cleanNickname,
        score: 0,
        highestScore: 0,
        joinedAt: Date.now()
      };

      console.log(`[${cleanRoomId}] 방에 [${cleanNickname}](${socket.id}) 입장 완료`);

      socket.emit('roomJoined', { roomId: cleanRoomId, nickname: cleanNickname });
      broadcastLobbyUpdate(cleanRoomId);
      io.to(cleanRoomId).emit('leaderboardUpdate', getSortedLeaderboard(cleanRoomId));
    });

    socket.on('startGame', () => {
      const { roomId } = socket;
      const room = roomId ? getRoom(roomId) : null;
      if (!room) return;

      if (room.hostId !== socket.id) {
        return socket.emit('errorMsg', '방장만 게임을 시작할 수 있습니다!');
      }

      room.isStarted = true;
      room.mode = 'timeAttack';
      Object.values(room.players).forEach(player => {
        player.score = 0;
      });
      console.log(`[${roomId}] 방 게임 시작 신호 수신! 모든 플레이어 동시 가동`);
      io.to(roomId).emit('leaderboardUpdate', getSortedLeaderboard(roomId));
      io.to(roomId).emit('gameStart');
    });

    socket.on('updateScore', ({ score }) => {
      const { roomId } = socket;
      const room = roomId ? getRoom(roomId) : null;

      if (!room || !room.isStarted || !room.players[socket.id]) return;
      if (!Number.isSafeInteger(score) || score < 0) return;

      const player = room.players[socket.id];
      player.score = score;
      if (player.score > (player.highestScore || 0)) {
        player.highestScore = player.score;
      }

      broadcastLeaderboard(roomId);
    });

    socket.on('requestLobbyUpdate', () => {
      const { roomId } = socket;
      if (roomId && rooms[roomId]) {
        broadcastLobbyUpdate(roomId);
      }
    });

    socket.on('disconnect', () => {
      const { roomId, nickname } = socket;
      const room = roomId ? getRoom(roomId) : null;

      if (!room || !room.players[socket.id]) return;

      delete room.players[socket.id];
      console.log(`[${roomId}] 방에서 [${nickname}] 접속 종료`);

      if (Object.keys(room.players).length === 0) {
        deleteRoom(roomId);
        return;
      }

      if (room.hostId === socket.id) {
        const remaining = Object.entries(room.players).sort(
          (a, b) => a[1].joinedAt - b[1].joinedAt
        );
        if (remaining.length > 0) {
          room.hostId = remaining[0][0];
          console.log(`👑 [${roomId}] 방장 자동 위임 -> [${remaining[0][1].nickname}]`);
        }
      }

      broadcastLobbyUpdate(roomId);
      broadcastLeaderboard(roomId);
    });
  });
}

module.exports = {
  registerSocketHandlers
};
