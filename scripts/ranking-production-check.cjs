// Production read-only browser probe: normal anonymous sign-in, no game session or score submission.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const label = process.argv[2] || 'before';
const output = path.resolve(process.env.SEQUENCEPANG_RANKING_OUTPUT || 'artifacts/production-ranking');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true });
    await context.addInitScript(() => {
      const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      localStorage.setItem('sequencepang-sequel3-launch-2026-10-seen-day', day);
      localStorage.setItem('sequencepang-star-time-intro-v1-dismissed', 'true');
    });
    const page = await context.newPage();
    const errors = [], responses = [], requests = [], network = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => {if(r.url().includes('/api/leaderboard?')) requests.push({url:r.url(),method:r.method()});});
    page.on('response', async r => {if(r.url().includes('/api/leaderboard?') && r.request().method()==='GET') responses.push({url:r.url(),status:r.status(),timing:await r.headerValue('server-timing'),body:await r.json()});});
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    const starts = new Map();
    cdp.on('Network.requestWillBeSent', e => {
      if(/cloudfunctions.net|identitytoolkit.googleapis.com|securetoken.googleapis.com/.test(e.request.url)) starts.set(e.requestId,{url:e.request.url.split('?')[0],method:e.request.method,start:e.timestamp,type:e.type});
    });
    cdp.on('Network.responseReceived', e => {
      const row=starts.get(e.requestId); if(row) {row.status=e.response.status; row.responseMs=(e.timestamp-row.start)*1000; row.timing=e.response.timing;}
    });
    cdp.on('Network.loadingFinished', e => {const row=starts.get(e.requestId);if(row){row.totalMs=(e.timestamp-row.start)*1000;network.push(row);}});
    await page.goto('https://sequencepang.vercel.app/',{waitUntil:'domcontentloaded'});
    await page.locator('#btn-show-ranking').waitFor({state:'visible'});
    const ui=[];
    async function open(kind) {
      const count = requests.length;
      const start = await page.evaluate(() => {const t=performance.now();document.querySelector('#btn-show-ranking').click();return t;});
      await page.waitForFunction(() => {
        const list=document.querySelector('#main-ranking-list');return list && !list.textContent.includes('불러오는 중') && list.textContent.trim().length>0;
      }, null, {timeout:60000});
      const row=await page.evaluate(start => ({uiMs:performance.now()-start,text:document.querySelector('#main-ranking-list').textContent, samples:performance.getEntriesByName('sequencepang:ranking').map(e=>e.detail)}),start);
      row.kind=kind;row.newHttpRequests=requests.length-count;ui.push(row);
      assert.ok(!/실패|못했|필요합니다/.test(row.text));
      console.log(JSON.stringify({kind,uiMs:row.uiMs,newHttpRequests:row.newHttpRequests,sample:row.samples.at(-1)}));
      return row;
    }
    await open('fresh-context-first');
    await page.locator('#btn-ranking-close').click();
    await open('within-15s');
    await page.locator('#btn-ranking-close').click();
    for(let i=0;i<3;i++) {
      await page.waitForTimeout(i===2?31000:16000);
      await open('auth-ready-expired-'+(i+1));
      if(i<2) await page.locator('#btn-ranking-close').click();
    }
    await page.screenshot({path:path.join(output,`ranking-${label}.png`),fullPage:true});
    await page.locator('#btn-ranking-weekly').click();
    await page.waitForFunction(() => {const list=document.querySelector('#main-ranking-list');return list && !list.textContent.includes('불러오는 중') && list.textContent.trim().length>0;});
    const weeklyText=await page.locator('#main-ranking-list').textContent();
    await page.screenshot({path:path.join(output,`ranking-${label}-weekly.png`),fullPage:true});
    await page.waitForTimeout(200);
    const data={label,at:new Date().toISOString(),browserVersion:browser.version(),environment:'local Windows headless Chromium; mobile viewport 390x844; actual production; no score submission; fresh browser context; not a representative Korean end-user device or controlled scale-from-zero test',ui,responses,network,errors,weeklyText};
    fs.writeFileSync(path.join(output,`ranking-${label}.json`),JSON.stringify(data,null,2));
    assert.equal(ui[1].newHttpRequests,0);
    assert.equal(ui[1].text,ui[0].text);
    assert.deepEqual(errors,[]);
    console.log('Saved production evidence '+label);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

