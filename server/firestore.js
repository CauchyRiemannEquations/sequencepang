const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

let firestore = null;
let initializationError = null;

function parseServiceAccount() {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawServiceAccount) return null;

  const serviceAccount = JSON.parse(rawServiceAccount);
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  return serviceAccount;
}

function initializeFirestore() {
  if (firestore || initializationError) return firestore;

  try {
    const serviceAccount = parseServiceAccount();
    if (!serviceAccount) {
      initializationError = new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
      console.warn('⚠️ Firestore 랭킹이 비활성화되었습니다: FIREBASE_SERVICE_ACCOUNT_JSON 환경변수가 없습니다.');
      return null;
    }

    const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
    firestore = getFirestore(app);
    return firestore;
  } catch (error) {
    initializationError = error;
    console.error('❌ Firebase Admin 초기화 실패:', error.message);
    return null;
  }
}

function getScoreFirestore() {
  return initializeFirestore();
}

module.exports = {
  getScoreFirestore
};
