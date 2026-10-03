const crypto = require('node:crypto');
const { getRoomDatabase, getScoreFirestore } = require('./firestore');
const { MAX_ROOM_PLAYERS } = require('./constants');
const { normalizeNickname } = require('./scoreRoutes');
const { isProfaneNickname } = require('./profanityFilter');

const DISCONNECT_GRACE_MS = 45000;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
class RoomError extends Error {}

function validateRoomInput(roomId, nickname) {
  const id = typeof roomId === 'string' ? roomId.trim().toUpperCase() : '';
  if (!/^[A-Z]{6}$/.test(id)) throw new RoomError('방 코드는 영어 알파벳 6자리여야 합니다!');
  if (nickname === undefined) return { roomId: id };
  const name = normalizeNickname(nickname);
  if (!name || /\s/.test(name)) throw new RoomError('닉네임을 공백 없이 1~10자로 입력해주세요!');
  if (isProfaneNickname(name)) throw new RoomError('사용할 수 없는 닉네임입니다.');
  return { roomId: id, nickname: name, nicknameKey: name.normalize('NFKC').toLocaleLowerCase() };
}

function hasConnection(player) { return Object.values(player.connections || {}).some(v => v === true); }
function reconcileRoom(room, now, prune = false) {
  if (!room || now >= room.expiresAt) return null;
  for (const [uid, player] of Object.entries(room.players || {})) {
    player.connected = hasConnection(player);
    if (player.connected) delete player.disconnectedAt;
    else {
      player.disconnectedAt ??= player.joinedAt;
      if (prune && now - player.disconnectedAt >= DISCONNECT_GRACE_MS) delete room.players[uid];
    }
  }
  const admitted = Object.entries(room.players || {});
  if (!admitted.length) return null;
  const online = admitted.filter(([, p]) => p.connected)
    .sort(([ua, a], [ub, b]) => a.joinedAt - b.joinedAt || ua.localeCompare(ub));
  if (!room.players[room.hostUid]?.connected && online.length) room.hostUid = online[0][0];
  else if (!room.players[room.hostUid]) {
    room.hostUid = admitted.sort(([ua, a], [ub, b]) => a.joinedAt - b.joinedAt || ua.localeCompare(ub))[0][0];
  }
  room.cleanupAt = Math.min(room.expiresAt, ...admitted.filter(([,p]) => !p.connected)
    .map(([,p]) => p.disconnectedAt + DISCONNECT_GRACE_MS));
  return room;
}

async function transactRoom(roomId, mutate, database = getRoomDatabase()) {
  const reference = database.ref(`rooms/${roomId}`);
  // Keep the read active until commit. A one-shot read alone can be evicted,
  // causing the first transaction callback to see speculative null and abort.
  const keepCache = () => {};
  reference.on('value', keepCache);
  let failure = null;
  try {
    await reference.once('value');
    const result = await reference.transaction(current => {
      failure = null;
      try { return mutate(current); }
      catch (error) { failure = error; return undefined; }
    }, undefined, false);
    if (failure) throw failure;
    if (!result.committed) throw new RoomError('방 상태가 바뀌었습니다. 다시 시도해주세요.');
    return result.snapshot.val();
  } finally { reference.off('value', keepCache); }
}

async function joinRoom({ uid, roomId, nickname, create = false }, database) {
  const input = validateRoomInput(roomId, nickname);
  await transactRoom(input.roomId, current => {
    const now = Date.now();
    let room = reconcileRoom(current, now, true);
    if (!room) {
      // Preserve the old join-or-create behavior for a previously unused code.
      room = { hostUid: uid, isStarted: false, mode: 'timeAttack', createdAt: now,
        expiresAt: now + ROOM_TTL_MS, cleanupAt: now + DISCONNECT_GRACE_MS, roundId: '', startsAt: 0, players: {} };
    } else if (create && !room.players[uid]) throw new RoomError('이미 사용 중인 방 코드입니다. 다시 방을 만들어주세요.');
    const existing = room.players[uid];
    if (existing) {
      if (existing.nicknameKey !== input.nicknameKey) throw new RoomError('이미 입장한 방에서는 닉네임을 바꿀 수 없습니다.');
      // A disconnected member can resume the current round within the grace period.
      return room;
    }
    if (room.isStarted) throw new RoomError('이미 게임이 시작되어 대기실에 입장할 수 없습니다.');
    if (Object.keys(room.players).length >= MAX_ROOM_PLAYERS) throw new RoomError(`이 방은 최대 ${MAX_ROOM_PLAYERS}명까지만 입장할 수 있습니다.`);
    if (Object.values(room.players).some(p => p.nicknameKey === input.nicknameKey)) {
      throw new RoomError('이미 사용 중인 닉네임입니다. 다른 이름을 사용해주세요.');
    }
    room.players[uid] = { nickname: input.nickname, nicknameKey: input.nicknameKey, score: 0, highestScore: 0,
      joinedAt: now, connected: false, disconnectedAt: now, scoreRoundId: room.roundId, lastScoreAt: 0 };
    room.cleanupAt = Math.min(room.cleanupAt, now + DISCONNECT_GRACE_MS);
    return room;
  }, database);
  return { roomId: input.roomId, nickname: input.nickname };
}

async function leaveRoom({ uid, roomId }, database) {
  const input = validateRoomInput(roomId);
  await transactRoom(input.roomId, room => {
    if (!room) return null;
    if (room.players) delete room.players[uid];
    return reconcileRoom(room, Date.now());
  }, database);
  return { ok: true };
}

async function startRoom({ uid, roomId }, database) {
  const input = validateRoomInput(roomId);
  const roundId = crypto.randomUUID();
  const room = await transactRoom(input.roomId, current => {
    const now = Date.now();
    const next = reconcileRoom(current, now, true);
    if (!next || !next.players[uid]?.connected) throw new RoomError('방에 다시 입장해주세요.');
    if (next.hostUid !== uid) throw new RoomError('방장만 게임을 시작할 수 있습니다!');
    if (next.startsAt && now - next.startsAt < 5000) throw new RoomError('게임 시작 요청을 잠시 후 다시 시도해주세요.');
    next.isStarted = true;
    next.mode = 'timeAttack';
    next.roundId = roundId;
    next.startsAt = now + 1500;
    next.expiresAt = now + ROOM_TTL_MS;
    for (const player of Object.values(next.players)) {
      player.score = 0;
      player.scoreRoundId = roundId;
      player.lastScoreAt = 0;
    }
    return reconcileRoom(next, now);
  }, database);
  return { roundId, startsAt: room.startsAt };
}

async function reconcilePresence(roomId, database) {
  return transactRoom(roomId, room => {
    const now = Date.now();
    for (const player of Object.values(room?.players || {})) {
      // Record the actual disconnection time, not the original join time.
      if (player.connected && !hasConnection(player)) player.disconnectedAt = now;
    }
    return reconcileRoom(room, now);
  }, database);
}

async function cleanupExpiredState(database = getRoomDatabase(), firestore = getScoreFirestore(), now = Date.now()) {
  const rooms = await database.ref('rooms').orderByChild('cleanupAt').endAt(now).once('value');
  for (const roomId of Object.keys(rooms.val() || {})) {
    await transactRoom(roomId, room => reconcileRoom(room, now, true), database);
  }
  // No production ranking collections are touched. Runtime expiry is authoritative.
  for (const collection of ['game_sessions', 'request_limits', 'leaderboard_cache']) {
    const expired = await firestore.collection(collection).where('expiresAt', '<=', new Date(now)).limit(400).get();
    const batch = firestore.batch();
    expired.docs.forEach(document => batch.delete(document.ref));
    if (expired.size) await batch.commit();
  }
}

module.exports = { RoomError, DISCONNECT_GRACE_MS, joinRoom, leaveRoom, startRoom, reconcilePresence,
  reconcileRoom, cleanupExpiredState, validateRoomInput };
