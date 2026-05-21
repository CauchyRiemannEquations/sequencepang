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

    if (!cleanRoomId || !cleanNickname) {
      return socket.emit('errorMsg', '방 코드 또는 닉네임 형식이 잘못되었습니다.');
    }

    // 방 객체가 존재하지 않으면 초기화 (첫 입장한 유저가 방장)
    if (!rooms[cleanRoomId]) {
      rooms[cleanRoomId] = {
        hostId: socket.id,
        isStarted: false,
        players: {}
      };
    }

    const room = rooms[cleanRoomId];

    // 이미 게임이 시작된 방은 중간 진입 차단
    if (room.isStarted) {
      return socket.emit('errorMsg', '이미 게임이 시작되어 대기실에 입장할 수 없습니다.');
    }

    // 동일 방 내 중복 닉네임 체크
    const isDuplicate = Object.values(room.players).some(
      player => player.nickname === cleanNickname
    );

    if (isDuplicate) {
      return socket.emit('errorMsg', '이미 사용 중인 닉네임입니다. 다른 이름을 사용해주세요.');
    }

    // 소켓 연결 인스턴스에 메타데이터 저장
    socket.roomId = cleanRoomId;
    socket.nickname = cleanNickname;

    // 소켓 룸 채널 연결
    socket.join(cleanRoomId);

    // 유저 리스트 등록
    room.players[socket.id] = {
      nickname: cleanNickname,
      score: 0,
      highestScore: 0, // 최고 점수 보존 기록 저장용 필드 추가
      joinedAt: Date.now()
    };

    console.log(`✅ [${cleanRoomId}] 방에 [${cleanNickname}](${socket.id}) 입장 완료`);

    // 클라이언트에게 성공 응답 전송
    socket.emit('roomJoined', { roomId: cleanRoomId, nickname: cleanNickname });

    // 실시간 대기실 리스트 동기화 방송
    broadcastLobbyUpdate(cleanRoomId);

    // 즉시 방 유저들에게 리더보드 갱신 브로드캐스트
    const leaderboard = getSortedLeaderboard(cleanRoomId);
    io.to(cleanRoomId).emit('leaderboardUpdate', leaderboard);
  });

  // 2. 게임 시작 (startGame) - 방장만 가능
  socket.on('startGame', () => {
    const { roomId } = socket;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];

    // 방장 권한 확인
    if (room.hostId !== socket.id) {
      return socket.emit('errorMsg', '방장만 게임을 시작할 수 있습니다!');
    }

    // 방 상태를 진행 중으로 전환
    room.isStarted = true;
    console.log(`🎮 [${roomId}] 방 게임 시작 신호 수신! 모든 플레이어 동시 기동`);

    // 방 안의 모든 소켓에게 동시 게임 시작 신호 전송
    io.to(roomId).emit('gameStart');
  });

  // 3. 점수 업데이트 (updateScore)
  socket.on('updateScore', ({ score }) => {
    const { roomId } = socket;

    // 정상 상태 검증
    if (!roomId || !rooms[roomId] || !rooms[roomId].players[socket.id]) return;

    const player = rooms[roomId].players[socket.id];

    // 실시간 현재 판의 점수 기록 갱신
    player.score = score;

    // 여러 번 재도전 시 이 방에서 낸 최고 점수(highestScore) 갱신 및 보존
    if (score > (player.highestScore || 0)) {
      player.highestScore = score;
    }

    // 스로틀을 적용하여 갱신된 순위 전달 (현재 활성 점수 기반 인게임용)
    broadcastLeaderboard(roomId);

    // 대기방 대시보드 리스트 동기화 송신 (최고 점수 기반 명예의 전당)
    broadcastLobbyUpdate(roomId);
  });

  // 3-2. 대기방 화면 수동 최신화 요청 (requestLobbyUpdate)
  socket.on('requestLobbyUpdate', () => {
    const { roomId } = socket;
    if (roomId && rooms[roomId]) {
      broadcastLobbyUpdate(roomId);
    }
  });

  // 4. 연결 종료 (disconnect)
  socket.on('disconnect', () => {
    const { roomId, nickname } = socket;

    if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
      const room = rooms[roomId];
      delete room.players[socket.id];
      console.log(`❌ [${roomId}] 방에서 [${nickname}] 접속 종료`);

      // 방의 남은 유저 확인 및 정리
      if (Object.keys(room.players).length === 0) {
        delete rooms[roomId];
        if (roomThrottles[roomId]) {
          clearTimeout(roomThrottles[roomId]);
          delete roomThrottles[roomId];
        }
      } else {
        // 끊은 유저가 방장(hostId)이었다면, 남은 플레이어 중 가장 먼저 참여한 사람에게 위임
        if (room.hostId === socket.id) {
          const remaining = Object.entries(room.players).sort(
            (a, b) => a[1].joinedAt - b[1].joinedAt
          );
          if (remaining.length > 0) {
            room.hostId = remaining[0][0]; // 새 방장의 socket.id 지정
            console.log(`👑 [${roomId}] 방장 자동 위임 -> [${remaining[0][1].nickname}]`);
          }
        }

        // 대기실 리스트 동기화 방송
        broadcastLobbyUpdate(roomId);

        // 남은 플레이어들에게 최신 리더보드 갱신 전송
        broadcastLeaderboard(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 수열팡 실시간 멀티플레이어 서버 실행 중: http://localhost:${PORT}`);
});
