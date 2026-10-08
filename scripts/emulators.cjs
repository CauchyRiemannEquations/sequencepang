const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
// Parameter discovery reads dotenv files rather than the parent shell environment.
const demoEnv = path.resolve(__dirname, '../functions/.env.demo-sequencepang');
if (!fs.existsSync(demoEnv)) fs.writeFileSync(demoEnv,
  'DEPLOY_REGION=us-central1\nRTDB_INSTANCE=demo-sequencepang\nFRONTEND_ORIGINS=http://localhost:5173,http://127.0.0.1:5173\n');
const cli = path.resolve(__dirname, '../node_modules/firebase-tools/lib/bin/firebase.js');
const testing = process.argv[2] === 'test';
const browserTesting = process.argv[2] === 'browser';
const rankingBrowserTesting = process.argv[2] === 'ranking-browser';
const args = [cli, testing || browserTesting || rankingBrowserTesting ? 'emulators:exec' : 'emulators:start', '--project', 'demo-sequencepang',
  '--only', 'auth,firestore,database,functions'];
if (testing) args.push('node --test --test-concurrency=1 tests/firebase/emulator.test.cjs');
if (browserTesting) args.push('node scripts/browser-check.cjs');
if (rankingBrowserTesting) args.push('node scripts/ranking-browser-check.cjs');
const task = spawn(process.execPath, args, { stdio: 'inherit', env: {
  ...process.env, RTDB_INSTANCE: 'demo-sequencepang', DEPLOY_REGION: 'us-central1',
  ...(process.env.SEQUENCEPANG_EMULATOR_TCP === 'true' ? {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${path.resolve(__dirname, 'emulator-loopback.cjs')}`
  } : {}),
  // The Node RTDB SDK ignores NO_PROXY. Emulator WebSockets must stay on loopback.
  HTTP_PROXY: '', http_proxy: '',
  _JAVA_OPTIONS: process.env._JAVA_OPTIONS || '-Xms32m -Xmx512m'
} });
task.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => task.kill(signal));
