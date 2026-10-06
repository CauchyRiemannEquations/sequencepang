const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { getRoomDatabase } = require('../functions/src/firestore');
const remote = Boolean(process.env.SEQUENCEPANG_VERIFY_URL);
const base = process.env.SEQUENCEPANG_VERIFY_URL || 'http://127.0.0.1:5173';
const origin = new URL(base).origin;
if (remote && (process.env.SEQUENCEPANG_VERIFY_PROJECT !== 'sequencepang' || ![
  'https://sequencepang.vercel.app',
  'https://sequencepang.pages.dev',
  'https://sequencepang-git-migration-firebase-serverless-cooolguy.vercel.app'
].includes(origin))) throw new Error('원격 검증은 확인된 sequencepang 프로젝트와 운영/브랜치 Preview에서만 실행합니다.');
const prefix = remote ? (origin === 'https://sequencepang.vercel.app' ? 'production-'
  : origin === 'https://sequencepang.pages.dev' ? 'cloudflare-production-' : 'preview-') : '';
const playerPrefix = remote ? `검증${require('node:crypto').randomBytes(3).toString('hex')}` : '브라우저';
const playerA = `${playerPrefix}A`;
const playerB = `${playerPrefix}B`;
const output = path.resolve('docs/verification');
fs.mkdirSync(output, { recursive: true });
const vite = remote ? null : spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], {
  env: { ...process.env, VITE_USE_FIREBASE_EMULATORS: 'true',
    VITE_FIREBASE_PROJECT_ID: 'production-config-must-be-ignored',
    VITE_FIREBASE_FUNCTIONS_REGION: 'unused-region' },
  stdio: ['ignore','pipe','pipe']
});
let viteLog = '';
vite?.stdout.on('data', v => { viteLog += v; });
vite?.stderr.on('data', v => { viteLog += v; });
const report = { backend: remote ? 'Firebase sequencepang' : 'Firebase Emulator', origin,
  players: [playerA, playerB], startedAt: new Date().toISOString(),
  status: 'running', checks: [], requests: [], errors: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(150); }
  throw new Error(`timeout: ${label}`);
}
function passed(label) { report.checks.push(label); console.log(`PASS ${label}`); }
const artifactPath = name => path.join(output, `${prefix}${name}`);

async function dragSequence(page) {
  await page.waitForFunction(() => document.querySelector('#game-container.game-active') &&
    !document.querySelector('#countdown-overlay.show'), undefined, { timeout: 15000 });
  // The overlay keeps intercepting input during its visibility transition.
  await page.locator('#countdown-overlay').waitFor({ state: 'hidden' });
  const tiles = await page.locator('.tile').evaluateAll(elements => elements.map(el => {
    const box = el.getBoundingClientRect();
    return { row: +el.dataset.row, col: +el.dataset.col, value: +el.dataset.baseValue,
      x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }));
  const adjacent = (a,b) => a !== b && Math.abs(a.row-b.row) <= 1 && Math.abs(a.col-b.col) <= 1;
  let chain;
  search: for (const a of tiles) for (const b of tiles) for (const c of tiles) {
    if (a === c || !adjacent(a,b) || !adjacent(b,c)) continue;
    if (b.value-a.value === c.value-b.value) { chain = [a,b,c]; break search; }
  }
  assert.ok(chain, 'A 3-tile arithmetic sequence exists');
  const hit = await page.evaluate(point => {
    const el = document.elementFromPoint(point.x, point.y);
    return { tag: el?.tagName, id: el?.id, className: el?.className };
  }, chain[0]);
  assert.ok(hit.className?.includes('tile'), JSON.stringify(hit));
  await page.mouse.move(chain[0].x, chain[0].y); await page.mouse.down();
  for (const tile of chain.slice(1)) await page.mouse.move(tile.x, tile.y);
  const selected = await page.locator('.tile.selected').count();
  assert.equal(selected, 3, JSON.stringify({ chain, selected }));
  await page.mouse.up();
  await page.waitForFunction(() => Number(document.querySelector('#score-val').textContent.replace(/,/g,'')) > 0);
  return Number((await page.locator('#score-val').innerText()).replace(/,/g,''));
}

(async () => {
  let browser;
  const submitted = [];
  try {
    if (!remote) await waitFor(async () => { try { return (await fetch(base)).ok; } catch { return false; } }, 'Vite startup');
    browser = await chromium.launch({ headless: true,
      ...(process.env.SEQUENCEPANG_CHROME_PATH ? { executablePath: process.env.SEQUENCEPANG_CHROME_PATH } : {}) });
    report.browser = browser.version();
    report.viewports = { desktop: '1440x1000', mobile: '390x844' };
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    for (const context of [desktop,mobile]) await context.addInitScript(() => {
      localStorage.setItem('sequencepang-star-time-intro-v1-dismissed', 'true');
    });
    const a = await desktop.newPage(); const b = await mobile.newPage();
    for (const page of [a,b]) {
      page.on('request', request => report.requests.push(request.url()));
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('response', response => {
        if (response.url().endsWith('/api/scores') && response.request().method() === 'POST') {
          submitted.push(response.json().then(data => ({ status: response.status(), data })));
        }
      });
      page.on('dialog', dialog => { report.errors.push(`unexpected dialog: ${dialog.message()}`); void dialog.dismiss(); });
    }
    await a.goto(base); await b.goto(base);
    // The current launch campaign appears on fresh browsers before the game UI.
    for (const page of [a, b]) {
      const launchClose = page.locator('#sequel-launch-notice[open] .sequel-launch-close');
      if (await launchClose.count()) await launchClose.click();
    }
    await a.locator('#btn-single-start').waitFor(); await b.locator('#btn-single-start').waitFor();
    assert.ok((await a.locator('body').innerText()).length > 100);
    assert.equal(await a.locator('vite-error-overlay').count(), 0);
    await a.screenshot({ path: artifactPath('firebase-desktop-home.png') });
    passed('Desktop and mobile home load with no framework error overlay');

    await a.locator('#player-nickname').fill(playerA);
    await a.locator('#btn-single-start').click();
    const singleScore = await dragSequence(a);
    await a.locator('#gameover-overlay.show').waitFor({ timeout: 55000 });
    await a.waitForFunction(() => document.querySelector('#score-submit-status')?.dataset.state === 'success', undefined, { timeout: 15000 });
    const submission = (await Promise.all(submitted))[0];
    assert.equal(submission.status, 201); assert.ok(submission.data.dailyRank?.rank > 0, 'The submitted player has a daily rank');
    if (submission.data.dailyRank.rank <= 30) {
      await a.waitForFunction(nickname => document.querySelector('#global-ranking-list').innerText.includes(nickname), playerA);
    }
    const weeklyResponse = a.waitForResponse(response =>
      response.url().includes('/api/leaderboard?period=weekly') && response.status() === 200);
    await a.locator('#btn-global-ranking-weekly').click();
    const weekly = await (await weeklyResponse).json();
    assert.ok(Array.isArray(weekly.leaders));
    if (!remote || weekly.leaders.some(player => player.nickname === playerA)) {
      assert.ok(weekly.leaders.some(player => player.nickname === playerA));
      await a.waitForFunction(nickname => document.querySelector('#global-ranking-list').innerText.includes(nickname), playerA);
    }
    await a.screenshot({ path: artifactPath('firebase-single-ranking.png') });
    passed(`Single game drag, score ${singleScore}, submission, daily/weekly ranking and my rank`);
    await a.locator('#btn-retry').click();

    await a.locator('#btn-multi-lobby').click(); await a.locator('#btn-create-room').click();
    await a.waitForFunction(() => !document.querySelector('#lobby-overlay').classList.contains('hide'));
    await a.waitForFunction(() => /^방 코드: [A-Z]{6}$/.test(document.querySelector('#lobby-room-badge').textContent));
    const roomId = (await a.locator('#lobby-room-badge').textContent()).match(/[A-Z]{6}$/)[0];
    await b.locator('#player-nickname').fill(playerB); await b.locator('#btn-multi-lobby').click();
    await b.locator('#lobby-room-id').fill(roomId); await b.locator('#btn-join-room').click();
    await waitFor(async () => await a.locator('.lobby-p-item').count() === 2 && await b.locator('.lobby-p-item').count() === 2, 'two players');
    await b.reload();
    await waitFor(async () => await b.locator('.lobby-p-item').count() === 2, 'lobby reload resume');
    await b.waitForFunction(() => getComputedStyle(document.querySelector('#lobby-overlay')).opacity === '1'
      && getComputedStyle(document.querySelector('#welcome-overlay')).visibility === 'hidden');
    await b.screenshot({ path: artifactPath('firebase-mobile-lobby.png') });
    assert.equal(await b.locator('#btn-lobby-play').isEnabled(), false);
    passed('Two distinct browser Auth identities join and lobby reload resumes');

    await a.locator('#btn-lobby-play').click();
    const multiScore = await dragSequence(a);
    await b.waitForFunction(() => !document.querySelector('#countdown-overlay.show'));
    await waitFor(async () => (await b.locator('#leaderboard-list').innerText()).includes(String(multiScore)), 'live score synchronization');
    await b.screenshot({ path: artifactPath('firebase-mobile-multiplayer.png') });
    const geometry = await b.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(geometry.scrollWidth <= geometry.width + 1, 'No horizontal mobile overflow');
    passed('Shared start, positive score synchronization and 390px mobile layout');

    await desktop.setOffline(true);
    await waitFor(async () => await b.locator('#btn-lobby-play').isEnabled(), 'host delegation after disconnect', 15000);
    await desktop.setOffline(false);
    await waitFor(async () => await b.locator('.lobby-p-item').count() === 2, 'network reconnection');
    assert.equal(await a.locator('#btn-lobby-play').isEnabled(), false);
    passed('Network disconnect delegates host; reconnect keeps the delegated host');

    await a.locator('#gameover-overlay.show').waitFor({ timeout: 55000 });
    await b.locator('#gameover-overlay.show').waitFor({ timeout: 55000 });
    await a.locator('#btn-retry').click(); await b.locator('#btn-retry').click();
    await b.locator('#btn-lobby-exit').click();
    await waitFor(async () => await a.locator('#btn-lobby-play').isEnabled(), 'host leaves');
    await a.locator('#btn-lobby-exit').click();
    if (remote) {
      let room;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { stdout } = await promisify(execFile)(process.execPath, [
            path.resolve('node_modules/firebase-tools/lib/bin/firebase.js'), 'database:get', `/rooms/${roomId}`,
            '--project', 'sequencepang', '--instance', 'sequencepang-default-rtdb', '--non-interactive'
          ], { timeout: 30000 });
          room = JSON.parse(stdout.trim());
          break;
        } catch (error) {
          if (attempt === 1) throw error;
          console.warn('Firebase CLI 읽기 확인에 실패해 한 번 다시 조회합니다.');
          await pause(1000);
        }
      }
      assert.equal(room, null, 'The verified Firebase instance contains no empty test room');
    } else {
      const database = getRoomDatabase();
      await waitFor(async () => !(await database.ref(`rooms/${roomId}`).once('value')).exists(), 'empty room deletion');
      database.goOffline();
    }
    assert.equal((await Promise.all(submitted)).length, 1, 'Multiplayer never writes the public rankings');
    passed('Lobby return, explicit host exit, automatic delegation and empty room cleanup');
    assert.equal(report.requests.filter(url => /onrender\.com/i.test(url)).length, 0);
    assert.deepEqual(report.errors, []);
    passed('No legacy backend requests and no uncaught browser errors');
    report.status = 'passed';
    for (const name of ['failure-desktop.png', 'failure-mobile.png']) fs.rmSync(artifactPath(name), { force: true });
  } catch (error) {
    report.status = 'failed';
    report.failure = error.message;
    for (const context of browser?.contexts() || []) for (const page of context.pages()) {
      await page.screenshot({ path: artifactPath(`failure-${context === browser.contexts()[0] ? 'desktop' : 'mobile'}.png`) }).catch(() => {});
    }
    throw error;
  } finally {
    fs.writeFileSync(artifactPath('browser-results.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString(),
      requests: [...new Set(report.requests)].map(url => url.replace(/\?.*/, '')) }, null, 2));
    await browser?.close(); vite?.kill();
  }
})().catch(error => { console.error(error); console.error(viteLog.slice(-1500)); process.exitCode = 1; });
