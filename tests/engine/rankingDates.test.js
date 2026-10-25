import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { formatWeekRange } from '../../client/src/rankingDates.js';

test('weekly labels use calendar-only arithmetic across viewer timezones and DST', () => {
  const moduleUrl = new URL('../../client/src/rankingDates.js', import.meta.url).href;
  const cases = [
    ['2026-10-19', '2026-10-19 ~ 2026-10-25'],
    ['2026-12-28', '2026-12-28 ~ 2027-01-03'],
    ['2024-02-26', '2024-02-26 ~ 2024-03-03'],
    ['2026-03-02', '2026-03-02 ~ 2026-03-08'],
    ['2026-10-26', '2026-10-26 ~ 2026-11-01']
  ];
  for (const TZ of ['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'Pacific/Honolulu']) {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e',
      `import { formatWeekRange } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(${JSON.stringify(cases)}.map(([date]) => formatWeekRange(date))));`
    ], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), cases.map(([, expected]) => expected), TZ);
  }
});

test('missing and malformed ranking dates do not produce misleading ranges', () => {
  assert.equal(formatWeekRange(null), '');
  for (const input of ['', 'invalid', '2026-02-30', '2026-13-01', '2026-1-01']) {
    assert.equal(formatWeekRange(input), input);
  }
});

test('ranking modal uses native modal focus management and honest toggle semantics', () => {
  const source = readFileSync(new URL('../../client/src/rankingHome.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../client/src/rankingHome.css', import.meta.url), 'utf8');
  assert.match(source, /createElement\('dialog'\)/);
  assert.match(source, /overlay\.showModal\(\)/);
  assert.match(source, /overlay\.close\(\)/);
  assert.match(source, /rankingOpener\?\.isConnected\) rankingOpener\.focus\(\)/);
  assert.match(source, /role="group" aria-label="랭킹 기간 선택"/);
  assert.match(source, /setAttribute\('aria-pressed', String\(active\)\)/);
  assert.doesNotMatch(source, /role="tablist"/);
  assert.match(css, /dialog\.ranking-overlay:not\(\[open\]\)\s*\{\s*display: none;/);
});
