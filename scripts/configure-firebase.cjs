const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.web-config.json'), 'utf8'));
const projectId = process.argv[2];
if (projectId !== config.projectId) {
  console.error(`확인된 기존 프로젝트만 설정합니다: npm run configure:firebase -- ${config.projectId}`);
  process.exit(1);
}
const targets = [
  ['client/.env.local', {
    VITE_FIREBASE_API_KEY: config.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: config.authDomain,
    VITE_FIREBASE_PROJECT_ID: config.projectId,
    VITE_FIREBASE_DATABASE_URL: config.databaseURL,
    VITE_FIREBASE_APP_ID: config.appId,
    VITE_FIREBASE_FUNCTIONS_REGION: config.functionsRegion,
    VITE_USE_FIREBASE_EMULATORS: 'false'
  }],
  [`functions/.env.${projectId}`, {
    DEPLOY_REGION: config.functionsRegion,
    RTDB_INSTANCE: config.rtdbInstance,
    RTDB_DATABASE_URL: config.databaseURL,
    FRONTEND_ORIGINS: config.frontendOrigins.join(',')
  }]
];
// Check both files before writing; preserve local settings instead of replacing them.
for (const [relative, expected] of targets) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) continue;
  const existing = parseEnv(fs.readFileSync(target, 'utf8'));
  if (Object.entries(expected).some(([key, value]) => existing[key] !== value)) {
    console.error(`${relative}에 다른 설정이 있습니다. 기존 파일을 확인한 뒤 필요한 공개 값만 병합하세요.`);
    process.exit(1);
  }
}
for (const [relative, values] of targets) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`공개 Firebase 설정 생성: ${relative}`);
  } else {
    console.log(`기존 설정 일치: ${relative}`);
  }
}
console.log('인증 정보는 포함하지 않습니다. Firebase CLI 로그인 후 deploy:firebase를 실행하세요.');
