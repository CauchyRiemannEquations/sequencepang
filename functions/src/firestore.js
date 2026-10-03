const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getDatabase, getDatabaseWithUrl } = require('firebase-admin/database');

function getAdminApp() {
  // Firebase/Google Cloud runtime supplies application-default credentials.
  // Emulator URLs and project ID are supplied by the Emulator Suite.
  return getApps()[0] || initializeApp();
}

function getScoreFirestore() { return getFirestore(getAdminApp()); }
function getRoomDatabase() {
  const app = getAdminApp();
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) return getDatabase(app);
  if (!process.env.RTDB_DATABASE_URL) throw new Error('RTDB_DATABASE_URL 설정이 필요합니다.');
  return getDatabaseWithUrl(process.env.RTDB_DATABASE_URL, app);
}

module.exports = { getScoreFirestore, getRoomDatabase };
