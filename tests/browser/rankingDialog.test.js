// Run explicitly with CHROMIUM_PATH=/usr/bin/chromium node --test tests/browser/rankingDialog.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

test('ranking dialog traps keyboard focus, closes with Escape and restores its opener', async t => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const source = readFileSync(new URL('../../client/src/rankingHome.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export function initHomeRankingUI', 'function initHomeRankingUI');
  const css = ['style.css', 'rankingHome.css', 'style.lovable.css'].map(name =>
    readFileSync(new URL(`../../client/src/${name}`, import.meta.url), 'utf8')).join('\n');
  await page.setContent(`<style>${css}</style><button id="btn-single-start">게임 시작</button><button id="btn-multi-lobby">함께</button><button id="btn-show-ranking">랭킹</button>`);
  await page.addScriptTag({ content: `const peekLeaderboard = () => null; const fetchLeaderboard = async period => ({ period, leaders: [] }); const renderGlobalLeaderboard = () => {}; const formatWeekRange = () => ''; ${source}; initHomeRankingUI();` });
  assert.equal(await page.locator('#ranking-overlay').isVisible(), false);
  await page.locator('#btn-show-ranking').click();
  assert.equal(await page.locator('#ranking-overlay').evaluate(el => el.matches(':modal')), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-ranking-close');
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => ['btn-single-start', 'btn-multi-lobby', 'btn-show-ranking'].includes(document.activeElement.id)), false);
  }
  await page.locator('#btn-ranking-weekly').click();
  assert.equal(await page.locator('#btn-ranking-weekly').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#btn-ranking-daily').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#ranking-overlay').open && document.activeElement.id === 'btn-show-ranking');
  assert.equal(await page.locator('#ranking-overlay').isVisible(), false);
  await page.locator('#btn-show-ranking').click();
  await page.locator('#btn-ranking-close').click();
  await page.waitForFunction(() => document.activeElement.id === 'btn-show-ranking');
  assert.equal(await page.locator('#ranking-overlay').isVisible(), false);
});
