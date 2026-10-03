const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const projectId = process.argv[2];
if (!projectId || projectId.startsWith('demo-') || !/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) {
  console.error('사용법: npm run deploy:firebase -- <확인된 기존 Firebase project ID>');
  process.exit(1);
}
const confirmedConfig = require('../firebase.web-config.json');
if (projectId !== confirmedConfig.projectId) {
  console.error(`확인된 기존 프로젝트 ${confirmedConfig.projectId}에만 배포할 수 있습니다.`);
  process.exit(1);
}
// Require public configuration that explicitly identifies the same existing project.
const configPath = path.resolve(__dirname, `../functions/.env.${projectId}`);
if (!fs.existsSync(configPath)) {
  console.error(`functions/.env.${projectId}에 DEPLOY_REGION, RTDB_INSTANCE, RTDB_DATABASE_URL, FRONTEND_ORIGINS를 먼저 설정하세요.`);
  process.exit(1);
}
const config = require('node:util').parseEnv(fs.readFileSync(configPath, 'utf8'));
const required = ['DEPLOY_REGION', 'RTDB_INSTANCE', 'RTDB_DATABASE_URL', 'FRONTEND_ORIGINS'];
if (required.some(key => !config[key])) {
  console.error(`필수 설정: ${required.join(', ')}`);
  process.exit(1);
}
let url;
try { url = new URL(config.RTDB_DATABASE_URL); } catch { /* Checked below. */ }
if (!url || url.protocol !== 'https:' || url.hostname.split('.')[0] !== config.RTDB_INSTANCE
  || !/\.(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname) || url.username || url.password) {
  console.error('기존 RTDB Console의 URL과 RTDB_INSTANCE가 일치해야 합니다.');
  process.exit(1);
}
const cli = path.resolve(__dirname, '../node_modules/firebase-tools/lib/bin/firebase.js');
const root = path.resolve(__dirname, '..');
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
// Deploy rules to the same confirmed instance used by both the SDK and trigger.
firebaseConfig.database = [{ instance: config.RTDB_INSTANCE, rules: 'database.rules.json' }];
const deployConfig = path.join(root, `.firebase-deploy-${process.pid}.json`);
let result;
try {
  fs.writeFileSync(deployConfig, JSON.stringify(firebaseConfig, null, 2));
  result = spawnSync(process.execPath, [cli, 'deploy', '--project', projectId, '--config', deployConfig,
    '--only', 'functions:sequencepang,firestore:rules,firestore:indexes,database'], { cwd: root, stdio: 'inherit' });
} finally { fs.rmSync(deployConfig, { force: true }); }
process.exit(result.status ?? 1);
