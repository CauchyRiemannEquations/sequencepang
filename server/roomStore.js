const { LEADERBOARD_THROTTLE_MS } = require('./constants');

const rooms = {};
const roomThrottles = {};

function getRoom(roomId) {
  return rooms[roomId];
}

function ensureRoom(roomId, hostId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      hostId,
      isStarted: false,
      mode: null,
      players: {}
    };
  }

  return rooms[roomId];
}

function deleteRoom(roomId) {
  delete rooms[roomId];
  clearRoomThrottle(roomId);
}

function getSortedLeaderboard(roomId) {
  const room = rooms[roomId];
  if (!room || !room.players) return [];

  return Object.keys(room.players).map(socketId => ({
    socketId,
    nickname: room.players[socketId].nickname,
    score: room.players[socketId].score
  })).sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.nickname.localeCompare(b.nickname);
  });
}

function getLobbyPlayers(roomId) {
  const room = rooms[roomId];
  if (!room) return [];

  return Object.entries(room.players).map(([socketId, player]) => ({
    nickname: player.nickname,
    score: player.highestScore || 0,
    isHost: socketId === room.hostId,
    joinedAt: player.joinedAt
  })).sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.joinedAt - b.joinedAt;
  });
}

function clearRoomThrottle(roomId) {
  if (roomThrottles[roomId]) {
    clearTimeout(roomThrottles[roomId]);
    delete roomThrottles[roomId];
  }
}

function throttleRoom(roomId, callback) {
  if (roomThrottles[roomId]) return;

  roomThrottles[roomId] = setTimeout(() => {
    callback();
    delete roomThrottles[roomId];
  }, LEADERBOARD_THROTTLE_MS);
}

module.exports = {
  rooms,
  getRoom,
  ensureRoom,
  deleteRoom,
  getSortedLeaderboard,
  getLobbyPlayers,
  throttleRoom,
  clearRoomThrottle
};
