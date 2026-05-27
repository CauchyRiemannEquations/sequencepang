const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 프로젝트 루트 디렉토리 자체를 정적 폴더로 지정 (index.html, melon.png 등 서빙)
app.use(express.static(__dirname));

/**
 * 실시간 방 및 점수 데이터를 관리하는 인메모리 객체
 * 구조:
 * {
 *   "ROOM123": {
 *     hostId: "socketId_AAAA",
 *     isStarted: false,
 *     players: {
 *       "socketId_AAAA": { nickname: "메론대장", score: 0, joinedAt: 1779319504 },
 *       "socketId_BBBB": { nickname: "수열마스터", score: 0, joinedAt: 1779319510 }
 *     }
 *   }
 * }
 */
const rooms = {};

// 특정 방의 랭킹 리스트를 정렬(점수 내림차순, 동일점 시 닉네임 사전순)하여 반환
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

// 실시간 대기방 참여 유저 정보를 방송 (최고 점수 정보 포함 및 최고 점수 랭킹순 정렬)
function broadcastLobbyUpdate(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const playerList = Object.entries(room.players).map(([socketId, p]) => ({
    nickname: p.nickname,
    score: p.highestScore || 0, // 대기실에는 이 방에 들어온 후 달성한 최고 점수(Highest Score)를 노출!
    isHost: socketId === room.hostId,
    joinedAt: p.joinedAt
  })).sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.joinedAt - b.joinedAt;
  });

  io.to(roomId).emit('lobbyUpdate', {
    players: playerList,
    hostId: room.hostId
  });
}

// 성능 향상을 위한 방별 브로드캐스트 스로틀 타이머 관리 객체
const roomThrottles = {};

function broadcastLeaderboard(roomId) {
  // 이미 대기 중인 스로틀 타이머가 있다면 대기
  if (roomThrottles[roomId]) return;

  // 400ms 스로틀을 적용하여 잦은 점수 업데이트 시 네트워크 부하와 렌더링 렉을 방지
  roomThrottles[roomId] = setTimeout(() => {
    const leaderboard = getSortedLeaderboard(roomId);
    io.to(roomId).emit('leaderboardUpdate', leaderboard);
    delete roomThrottles[roomId];
  }, 400);
}

io.on('connection', (socket) => {
  console.log(`🔌 새 접속: ${socket.id}`);

  // 1. 방 참여 (joinRoom)
  socket.on('joinRoom', ({ roomId, nickname }) => {
    if (!roomId || !nickname) {
      return socket.emit('errorMsg', '방 코드와 닉네임을 정확히 입력해주세요!');
    }

    const cleanRoomId = roomId.trim().toUpperCase();
    const cleanNickname = nickname.trim().slice(0, 10);
