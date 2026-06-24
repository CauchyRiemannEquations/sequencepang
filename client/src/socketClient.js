export function createSocketClient(handlers = {}) {
  if (typeof window.io !== 'function') {
    throw new Error('Socket.IO client script is not loaded.');
  }

  const socket = window.io();

  socket.on('connect', () => handlers.onConnect?.(socket));
  socket.on('roomJoined', payload => handlers.onRoomJoined?.(payload));
  socket.on('lobbyUpdate', payload => handlers.onLobbyUpdate?.(payload));
  socket.on('errorMsg', message => handlers.onError?.(message));
  socket.on('leaderboardUpdate', players => handlers.onLeaderboardUpdate?.(players));
  socket.on('raidStart', config => handlers.onRaidStart?.(config || {}));
  socket.on('gameStart', () => handlers.onGameStart?.());
  socket.on('disconnect', () => handlers.onDisconnect?.());

  return socket;
}
