import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_NOTICE_START, LAUNCH_NOTICE_END, launchNoticeDay, shouldShowLaunchNotice } from '../../client/src/sequelLaunchNotice.js';

test('launch notice is restricted to a fixed seven-day window, including late first visits', () => {
  assert.equal(LAUNCH_NOTICE_END - LAUNCH_NOTICE_START, 7 * 86400000);
  assert.equal(shouldShowLaunchNotice(LAUNCH_NOTICE_START - 1, null), false);
  assert.equal(shouldShowLaunchNotice(LAUNCH_NOTICE_START, null), true);
  assert.equal(shouldShowLaunchNotice(LAUNCH_NOTICE_END - 1, null), true);
  assert.equal(shouldShowLaunchNotice(LAUNCH_NOTICE_END, null), false);
  assert.equal(shouldShowLaunchNotice(LAUNCH_NOTICE_END + 30 * 86400000, null), false);
  assert.equal(shouldShowLaunchNotice(NaN, null), false);
});

test('notice stays hidden on the same Korean calendar day and returns the next day', () => {
  const beforeMidnight = Date.parse('2026-09-21T14:59:59.999Z');
  const midnight = beforeMidnight + 1;
  const seenDay = launchNoticeDay(beforeMidnight);
  assert.equal(seenDay, '2026-09-21');
  assert.equal(launchNoticeDay(midnight), '2026-09-22');
  assert.equal(shouldShowLaunchNotice(beforeMidnight, seenDay), false);
  assert.equal(shouldShowLaunchNotice(midnight, seenDay), true);
  assert.equal(shouldShowLaunchNotice(midnight, 'invalid-storage-value'), true);
});
