import { ref, onValue, onDisconnect, set, remove, update, serverTimestamp, get } from 'firebase/database';
import { ensureAnonymousUser, getFirebaseServices, requestFirebaseApi } from './firebase.js';

const SCORE_INTERVAL_MS = 850;
const SAVED_ROOM_KEY = 'seq_pang_firebase_room';
export function getSavedMultiplayerRoom() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SAVED_ROOM_KEY));
    return value && /^[A-Z]{6}$/.test(value.roomId) && typeof value.nickname === 'string' ? value : null;
  } catch { return null; }
}

// Event adapter preserves the existing game/UI boundary. All transport is modular Firebase.
export async function createSocketClient(handlers = {}) {
  const user = await ensureAnonymousUser();
  const { database } = getFirebaseServices();
  const listeners = new Map();
  const connectionId = crypto.randomUUID();
  let closed = false;
  let roomId = null;
  let nickname = null;
  let roomState = null;
  let stopRoom = null;
  let disconnectOperation = null;
  let startTimer = null;
  let scoreTimer = null;
  let offset = 0;
  let observedRound = '';
  let confirmedScore = 0;
  let queuedScore = 0;
  let writingScore = false;
  let lastWriteAt = 0;
  let reconnecting = false;

  function publish(event, payload) {
    if (closed) return;
    for (const callback of listeners.get(event) || []) callback(payload);
  }
  const socket = {
    id: user.uid,
    connected: false,
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
      return socket;
    },
    emit(event, payload = {}) {
      let operation;
      if (event === 'joinRoom') operation = join(payload);
      else if (event === 'startGame') operation = requestFirebaseApi('/api/rooms/start', { body: { roomId } });
      else if (event === 'requestLobbyUpdate') operation = refreshRoom();
      else if (event === 'updateScore') {
        if (Number.isSafeInteger(payload.score) && payload.score >= 0) {
          queuedScore = Math.max(queuedScore, payload.score);
          scheduleScore();
        }
      }
      if (operation) void operation.catch(error => publish('errorMsg', error.message));
      return socket;
    },
    async disconnect() {
      if (closed) return;
      closed = true;
      socket.connected = false;
      clearTimeout(startTimer);
      clearTimeout(scoreTimer);
      stopRoom?.(); stopConnection(); stopOffset();
      try { sessionStorage.removeItem(SAVED_ROOM_KEY); } catch { /* Storage may be disabled. */ }
      if (roomId) {
        const currentRoomId = roomId;
        roomId = null;
        // Remove this tab's presence even if the HTTP leave request cannot complete.
        await remove(ref(database, `rooms/${currentRoomId}/players/${user.uid}/connections/${connectionId}`)).catch(() => {});
        await disconnectOperation?.cancel().catch(() => {});
        await requestFirebaseApi('/api/rooms/leave', { body: { roomId: currentRoomId }, keepalive: true }).catch(() => {});
      }
    }
  };
  for (const [event, key] of [['connect','onConnect'], ['roomJoined','onRoomJoined'], ['lobbyUpdate','onLobbyUpdate'],
    ['errorMsg','onError'], ['leaderboardUpdate','onLeaderboardUpdate'], ['gameStart','onGameStart'], ['disconnect','onDisconnect']]) {
    if (handlers[key]) socket.on(event, payload => handlers[key](event === 'connect' ? socket : payload));
  }

  async function establishPresence() {
    if (!roomId || closed || !socket.connected) return;
    const presenceRef = ref(database, `rooms/${roomId}/players/${user.uid}/connections/${connectionId}`);
    disconnectOperation = onDisconnect(presenceRef);
    // Register on the server BEFORE advertising this tab as connected.
    await disconnectOperation.remove();
    await set(presenceRef, true);
  }

  async function join(payload) {
    const result = await requestFirebaseApi('/api/rooms/join', { body: payload });
    if (closed) {
      await requestFirebaseApi('/api/rooms/leave', { body: { roomId: result.roomId } });
      return;
    }
    roomId = result.roomId;
    nickname = result.nickname;
    try { sessionStorage.setItem(SAVED_ROOM_KEY, JSON.stringify({ roomId, nickname })); } catch { /* Optional persistence. */ }
    publish('roomJoined', result);
    await establishPresence();
    stopRoom?.();
    stopRoom = onValue(ref(database, `rooms/${roomId}`), snapshot => renderRoom(snapshot.val()),
      () => publish('errorMsg', '방 연결이 종료되었습니다. 다시 입장해주세요.'));
  }

  function renderRoom(value) {
    if (closed) return;
    roomState = value;
    if (!value?.players?.[user.uid]) return publish('errorMsg', '방이 정리되었습니다. 다시 입장해주세요.');
    const players = Object.entries(value.players).filter(([, p]) => Object.values(p.connections || {}).some(v => v === true));
    publish('lobbyUpdate', { hostId: value.hostUid, players: players.map(([uid, p]) => ({
      nickname: p.nickname, score: p.highestScore || 0, joinedAt: p.joinedAt, isHost: uid === value.hostUid
    })).sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt) });
    publish('leaderboardUpdate', players.map(([uid, p]) => ({ socketId: uid, nickname: p.nickname, score: p.score }))
      .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname)));
    if (value.isStarted && value.roundId && value.roundId !== observedRound) {
      const firstObservation = !observedRound;
      observedRound = value.roundId;
      confirmedScore = value.players[user.uid].score;
      queuedScore = confirmedScore;
      lastWriteAt = 0;
      clearTimeout(scoreTimer); scoreTimer = null;
      clearTimeout(startTimer);
      const delay = value.startsAt - (Date.now() + offset);
      // A page reload resumes lobby/presence; it must not replay an old start signal.
      if (!firstObservation || delay > -5000) {
        startTimer = setTimeout(() => publish('gameStart'), Math.max(0, delay));
      }
    }
  }

  async function refreshRoom() {
    if (roomId && !closed) renderRoom((await get(ref(database, `rooms/${roomId}`))).val());
  }

  function scheduleScore() {
    if (scoreTimer || writingScore || !socket.connected || !roomState?.isStarted || queuedScore <= confirmedScore) return;
    const wait = Math.max(0, SCORE_INTERVAL_MS - (performance.now() - lastWriteAt), roomState.startsAt - (Date.now() + offset));
    scoreTimer = setTimeout(() => { scoreTimer = null; void flushScore(); }, wait);
  }

  async function flushScore() {
    if (closed || !roomId || !socket.connected || writingScore || queuedScore <= confirmedScore) return;
    writingScore = true;
    const round = roomState.roundId;
    const wanted = queuedScore;
    lastWriteAt = performance.now();
    try {
      await update(ref(database, `rooms/${roomId}/players/${user.uid}`), {
        score: wanted, scoreRoundId: round, highestScore: Math.max(roomState.players[user.uid].highestScore || 0, wanted),
        lastScoreAt: serverTimestamp()
      });
      if (roomState?.roundId === round) confirmedScore = wanted;
    } catch {
      // Preserve the latest score during a transient failure; retries remain throttled.
      if (!closed && socket.connected) console.warn('점수 동기화가 지연되어 다시 시도합니다.');
    } finally { writingScore = false; scheduleScore(); }
  }

  const stopOffset = onValue(ref(database, '.info/serverTimeOffset'), snapshot => { offset = snapshot.val() || 0; });
  const stopConnection = onValue(ref(database, '.info/connected'), snapshot => {
    const connected = snapshot.val() === true;
    const changed = socket.connected !== connected;
    socket.connected = connected;
    if (changed) publish(connected ? 'connect' : 'disconnect', connected ? socket : undefined);
    if (!connected || !roomId || reconnecting || closed) return;
    reconnecting = true;
    void (async () => {
      try { await establishPresence(); }
      catch {
        // Membership may have been pruned after a longer outage; the server decides admission.
        await requestFirebaseApi('/api/rooms/join', { body: { roomId, nickname } });
        await establishPresence();
      }
      await refreshRoom();
      scheduleScore();
    })().catch(error => publish('errorMsg', error.message)).finally(() => { reconnecting = false; });
  });
  return socket;
}
