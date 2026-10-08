import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import confirmedConfig from '../../firebase.web-config.json';
import { resolveFirebaseWebConfig } from './firebaseConfig.js';
import { createApiRequest } from './apiTiming.js';

let services;
let signInPromise;

export function getFirebaseServices() {
  if (services) return services;
  const emulator = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
  if (emulator && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    throw new Error('운영 환경에서 개발 서버에 연결할 수 없습니다.');
  }
  // Keep local validation on the same demo namespace even with production env values present.
  const config = emulator ? {
    apiKey: 'demo-api-key', authDomain: 'demo-sequencepang.firebaseapp.com', projectId: 'demo-sequencepang',
    databaseURL: 'https://demo-sequencepang.firebaseio.com', appId: '1:123:web:demo'
  } : resolveFirebaseWebConfig(confirmedConfig, import.meta.env);
  const projectId = config.projectId;
  const app = initializeApp(config);
  const auth = getAuth(app);
  const database = getDatabase(app);
  if (emulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(database, '127.0.0.1', 9000);
  }
  const region = emulator ? 'us-central1' : (import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || confirmedConfig.functionsRegion);
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

export const requestFirebaseApi = createApiRequest({
  ensureUser: ensureAnonymousUser,
  getBaseUrl: () => getFirebaseServices().apiBaseUrl
});
