// Local-only DOM/network harness. No Firebase or production requests.
// CHROMIUM_PATH=/usr/bin/chromium node --test tests/browser/rankingReuse.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

async function harness(t) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const cacheSource = readFileSync(new URL('../../client/src/leaderboardCache.js', import.meta.url), 'utf8').replace('export function', 'function');
  const uiSource = readFileSync(new URL('../../client/src/rankingHome.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export function initHomeRankingUI', 'function initHomeRankingUI');
  const css = ['style.css', 'rankingHome.css', 'style.lovable.css'].map(name =>
    readFileSync(new URL(`../../client/src/${name}`, import.meta.url), 'utf8')).join('\n');
  await page.setContent(`<style>${css}</style><button id="btn-single-start">게임 시작</button><button id="btn-multi-lobby">함께</button><button id="btn-show-ranking">랭킹</button>`);
  await page.addScriptTag({ content: `${cacheSource}
    window.probe = { time: Date.parse('2026-10-28T12:00:00Z'), requests: [] };
    const cache = createLeaderboardCache(period => new Promise((resolve, reject) => {
      probe.requests.push({ period, resolve, reject });
    }), { now: () => probe.time });
    const fetchLeaderboard = period => cache.fetch(period);
    const peekLeaderboard = period => cache.peek(period);
    const formatWeekRange = value => value;
    const renderGlobalLeaderboard = (list, leaders) => {
      list.replaceChildren(...leaders.map(name => { const item = document.createElement('li'); item.textContent = name; return item; }));
    };
    probe.board = (period, label) => ({ period, rankingDay: new Date(probe.time + 9*60*60*1000).toISOString().slice(0, 10), rankingWeekStart: '2026-10-26', leaders: [label] });
    probe.seed = (period, label) => cache.prime(period, probe.board(period, label));
    probe.resolve = (index, label) => probe.requests[index].resolve(probe.board(probe.requests[index].period, label));
    probe.reject = index => probe.requests[index].reject(new Error('연결 실패'));
    ${uiSource}
    initHomeRankingUI();` });
  return page;
}

test('만료된 랭킹을 즉시 표시하되 한 번만 갱신하고 새 결과로 바꾼다', async t => {
  const page = await harness(t);
  await page.evaluate(() => { probe.seed('daily', '이전 일간'); probe.time += 15000; });
  await page.locator('#btn-show-ranking').click();
  assert.equal(await page.locator('#main-ranking-list').innerText(), '이전 일간');
  assert.match(await page.locator('#ranking-period-meta').innerText(), /업데이트 중/);
  await page.locator('#btn-ranking-daily').click();
  await page.locator('#btn-ranking-daily').click();
  assert.equal(await page.evaluate(() => probe.requests.length), 1, 'repeated clicks join one HTTP request');
  await page.evaluate(() => probe.resolve(0, '새 일간'));
  await page.waitForFunction(() => document.querySelector('#main-ranking-list').textContent === '새 일간');
  assert.doesNotMatch(await page.locator('#ranking-period-meta').innerText(), /업데이트/);
  await page.locator('#btn-ranking-close').click();
  await page.locator('#btn-show-ranking').click();
  assert.equal(await page.locator('#main-ranking-list').innerText(), '새 일간');
  assert.equal(await page.evaluate(() => probe.requests.length), 1, 'fresh reopen makes no HTTP request');
});

test('이전 탭 응답과 닫기 뒤 응답이 새 탭/재열기를 덮지 않는다', async t => {
  const page = await harness(t);
  await page.evaluate(() => { probe.seed('daily', '이전 일간'); probe.time += 15000; });
  await page.locator('#btn-show-ranking').click();
  await page.locator('#btn-ranking-weekly').click();
  assert.match(await page.locator('#main-ranking-list').innerText(), /불러오는 중/);
  await page.evaluate(() => probe.resolve(0, '늦은 일간'));
  assert.match(await page.locator('#ranking-title').innerText(), /주간/);
  assert.doesNotMatch(await page.locator('#main-ranking-list').innerText(), /늦은 일간/);
  await page.locator('#btn-ranking-close').click();
  await page.locator('#btn-show-ranking').click();
  assert.equal(await page.evaluate(() => probe.requests.length), 2, 'reopen joins pending weekly request');
  await page.evaluate(() => probe.resolve(1, '새 주간'));
  await page.waitForFunction(() => document.querySelector('#main-ranking-list').textContent === '새 주간');
  assert.equal(await page.locator('#ranking-overlay').evaluate(el => el.open), true);
  assert.match(await page.locator('#ranking-title').innerText(), /주간/);
});

test('갱신 실패는 이전 기록임을 표시하고 재시도하며 자정에는 전날을 숨긴다', async t => {
  const page = await harness(t);
  await page.evaluate(() => { probe.seed('daily', '이전 일간'); probe.time += 15000; });
  await page.locator('#btn-show-ranking').click();
  await page.evaluate(() => probe.reject(0));
  await page.waitForFunction(() => document.querySelector('#ranking-period-meta').textContent.includes('업데이트 실패'));
  assert.equal(await page.locator('#main-ranking-list').innerText(), '이전 일간');
  assert.match(await page.locator('#ranking-period-meta').innerText(), /이전 기록 표시/);
  await page.locator('#btn-ranking-daily').click();
  assert.equal(await page.evaluate(() => probe.requests.length), 2);
  await page.evaluate(() => probe.resolve(1, '갱신 성공'));
  await page.waitForFunction(() => document.querySelector('#main-ranking-list').textContent === '갱신 성공');
  await page.locator('#btn-ranking-close').click();
  await page.evaluate(() => { probe.time = Date.parse('2026-10-28T15:00:00Z'); });
  await page.locator('#btn-show-ranking').click();
  assert.match(await page.locator('#main-ranking-list').innerText(), /불러오는 중/);
  assert.doesNotMatch(await page.locator('#main-ranking-list').innerText(), /갱신 성공/);
  assert.equal(await page.evaluate(() => probe.requests.length), 3);
  await page.evaluate(() => probe.resolve(2, '오늘 기록'));
  await page.waitForFunction(() => document.querySelector('#main-ranking-list').textContent === '오늘 기록');
});

test('제출 결과를 prime한 뒤 이전 GET이 끝나도 DOM은 새 점수를 표시한다', async t => {
  const page = await harness(t);
  await page.locator('#btn-show-ranking').click();
  await page.evaluate(() => { probe.seed('daily', '제출된 새 점수'); probe.resolve(0, '이전 점수'); });
  await page.waitForFunction(() => document.querySelector('#main-ranking-list').textContent === '제출된 새 점수');
  assert.equal(await page.evaluate(() => probe.requests.length), 1, 'no extra GET after accepted snapshot');
});

test('자정 전 시작한 GET은 한 번 재조회하여 오늘 기록만 표시한다', async t => {
  const page = await harness(t);
  await page.locator('#btn-show-ranking').click();
  await page.evaluate(() => {
    const previousDay = probe.board('daily', '어제 기록');
    probe.time = Date.parse('2026-10-28T15:00:00Z');
    probe.requests[0].resolve(previousDay);
  });
  await page.waitForFunction(() => probe.requests.length === 2);
  assert.doesNotMatch(await page.locator('#main-ranking-list').innerText(), /어제 기록/);
  await page.evaluate(() => probe.resolve(1, '오늘 기록'));
  await page.waitForFunction(() => document.querySelector('#main-ranking-list').textContent === '오늘 기록');
  assert.match(await page.locator('#ranking-period-meta').innerText(), /2026-10-29/);
  assert.equal(await page.evaluate(() => probe.requests.length), 2);
});
