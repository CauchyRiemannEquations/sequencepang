// Run inside the Emulator Suite. Never creates scores/users in production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { chromium } = require('playwright');
const admin = createRequire(require.resolve('../functions/package.json'));
const { initializeApp } = admin('firebase-admin/app');
const { getFirestore, Timestamp } = admin('firebase-admin/firestore');
const { getCurrentRankingDayInfo, getCurrentRankingWeekInfo, RANKING_SEASON_ID } = require('../functions/src/constants');

(async () => {
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-sequencepang');
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST.startsWith('127.0.0.1:'));
  const db = getFirestore(initializeApp({ projectId: 'demo-sequencepang' }));
  const day = getCurrentRankingDayInfo(); const week = getCurrentRankingWeekInfo();
  await db.collection('scores').doc('ranking-ui-fixture').set({ nickname: '랭킹검증', score: 1000, maxCombo: 2,
    mode: 'timeAttack', rankingSeason: RANKING_SEASON_ID, rankingDay: day.rankingDay,
    rankingWeek: week.rankingWeek, createdAt: Timestamp.now() });
  const vite = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
    { env: { ...process.env, VITE_USE_FIREBASE_EMULATORS: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  const errors = [];
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Vite startup timeout')), 15000);
      vite.stdout.on('data', data => { if (data.toString().includes('http://127.0.0.1:5173')) { clearTimeout(timeout); resolve(); } });
      vite.on('exit', code => { clearTimeout(timeout); reject(Error(`Vite exited ${code}`)); });
    });
    browser = await chromium.launch({ headless: true,
      ...(process.env.SEQUENCEPANG_BROWSER_EXECUTABLE ? { executablePath: process.env.SEQUENCEPANG_BROWSER_EXECUTABLE } : {}),
      args: ['--no-sandbox', '--disable-gpu', '--no-zygote', '--single-process', '--use-gl=disabled', '--disable-software-rasterizer'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.addInitScript(() => {
      const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      localStorage.setItem('sequencepang-sequel3-launch-2026-10-seen-day', day);
      localStorage.setItem('sequencepang-star-time-intro-v1-dismissed', 'true');
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    page.on('request', req => { if (req.url().includes('/api/leaderboard?')) requests.push(req.url()); });
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
    async function openAndMeasure() {
      const start = performance.now();
      await page.locator('#btn-show-ranking').click();
      await page.waitForFunction(() => document.getElementById('main-ranking-list').textContent.includes('랭킹검증'));
      return Math.round((performance.now() - start) * 10) / 10;
    }
    const firstUiMs = await openAndMeasure();
    const dailyRows = await page.locator('#main-ranking-list').textContent();
    assert.equal(requests.length, 1);
    await page.locator('#btn-ranking-close').click();
    const repeatUiMs = await openAndMeasure();
    assert.equal(requests.length, 1, 'repeat UI view issues zero Firebase requests');
    assert.equal(await page.locator('#main-ranking-list').textContent(), dailyRows);
    await page.locator('#btn-ranking-weekly').click();
    await page.waitForFunction(() => document.querySelector('#btn-ranking-weekly').dataset.active === 'true'
      && document.getElementById('main-ranking-list').textContent.includes('랭킹검증'));
    await page.locator('#btn-ranking-daily').click();
    await page.waitForFunction(() => document.querySelector('#btn-ranking-daily').dataset.active === 'true'
      && document.getElementById('main-ranking-list').textContent.includes('랭킹검증'));
    assert.equal(requests.length, 2);
    const samples = await page.evaluate(async () => (await import('/src/apiTiming.js')).getApiTimingSamples());
    const first = samples.find(sample => sample.kind === 'api' && sample.period === 'daily');
    assert.ok(first); assert.equal(first.status, 200);
    assert.match(first.serverTiming, /auth_verify;dur=/);
    assert.ok(samples.some(sample => sample.kind === 'client-hit'));
    assert.deepEqual(errors, []);
    const result = { kind: 'mobile browser with local Auth/Functions/Firestore emulators; not production speed',
      firstUiMs, repeatUiMs, leaderboardHttpRequests: requests.length, samples, errors };
    fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync('artifacts/ranking-browser-results.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser?.close(); vite.kill('SIGTERM'); }
})().catch(error => { console.error(error); process.exitCode = 1; });
