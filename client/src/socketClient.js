const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || '').replace(/\/+$/, '');
let socketIoLoader = null;

function getSocketScriptUrl() {
  if (!SOCKET_URL) return '/socket.io/socket.io.js';
  return `${SOCKET_URL}/socket.io/socket.io.js`;
}

function ensureSocketIoLoaded() {
  if (typeof window.io === 'function') {
    return Promise.resolve();
  }

  if (!socketIoLoader) {
    socketIoLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = getSocketScriptUrl();
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        socketIoLoader = null;
        script.remove();
        reject(new Error('Failed to load Socket.IO client script.'));
      };
      document.head.appendChild(script);
    });
  }

  return socketIoLoader;
}

export async function createSocketClient(handlers = {}) {
  await ensureSocketIoLoaded();

  if (typeof window.io !== 'function') {
    throw new Error('Socket.IO client script is not loaded.');
  }

  const socket = SOCKET_URL ? window.io(SOCKET_URL) : window.io();

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
