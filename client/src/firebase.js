import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';

let services;
let signInPromise;

export function getFirebaseServices() {
  if (services) return services;
  const emulator = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
  if (emulator && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    throw new Error('운영 환경에서 개발 서버에 연결할 수 없습니다.');
  }
  // Keep local validation on the same demo namespace even with production env values present.
  const projectId = emulator ? 'demo-sequencepang' : import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const config = emulator ? {
    apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId,
    databaseURL: `https://${projectId}.firebaseio.com`, appId: '1:123:web:demo'
  } : {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  };
  if (Object.values(config).some(value => !value)) throw new Error('게임 서버 설정이 필요합니다.');
  const app = initializeApp(config);
  const auth = getAuth(app);
  const database = getDatabase(app);
  if (emulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(database, '127.0.0.1', 9000);
  }
  const region = emulator ? 'us-central1' : (import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'asia-southeast1');
  const apiBaseUrl = emulator ? `http://127.0.0.1:5001/${projectId}/${region}/api`
    : (import.meta.env.VITE_FIREBASE_FUNCTIONS_URL || `https://${region}-${projectId}.cloudfunctions.net/api`).replace(/\/+$/, '');
  services = { app, auth, database, apiBaseUrl };
  return services;
}

export async function ensureAnonymousUser() {
  const { auth } = getFirebaseServices();
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  if (!signInPromise) {
    signInPromise = signInAnonymously(auth).then(result => result.user).finally(() => { signInPromise = null; });
  }
  return signInPromise;
}

export async function requestFirebaseApi(path, { body, method = body === undefined ? 'GET' : 'POST', keepalive = false } = {}) {
  const user = await ensureAnonymousUser();
  const token = await user.getIdToken();
  const { apiBaseUrl } = getFirebaseServices();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method, keepalive, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '게임 서버 요청에 실패했습니다.');
  return result;
}
