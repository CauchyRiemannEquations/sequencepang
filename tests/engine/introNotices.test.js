import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initSequelLaunchNotice, LAUNCH_NOTICE_START, LAUNCH_NOTICE_END, launchNoticeDay } from '../../client/src/sequelLaunchNotice.js';
import { initStarTimeNotice } from '../../client/src/starTimeNotice.js';

function setup(t, { now = LAUNCH_NOTICE_START, hidden = false, storageBlocked = false, supported = true } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = { now };
  t.mock.method(Date, 'now', () => clock.now);
  const savedDocument = globalThis.document, savedStorage = globalThis.localStorage;
  const dialogs = [], storage = new Map();
  const home = { classList: { contains: () => hidden } };
  class Dialog extends EventTarget {
    constructor() { super(); this.controls = new Map(); if (!supported) this.showModal = undefined; }
    setAttribute() {}
    querySelector(selector) {
      if (!this.controls.has(selector)) this.controls.set(selector, new EventTarget());
      return this.controls.get(selector);
    }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
    remove() { const i = dialogs.indexOf(this); if (i >= 0) dialogs.splice(i, 1); }
  }
  const doc = new EventTarget();
  doc.getElementById = id => id === 'welcome-overlay' ? home : dialogs.find(d => d.id === id);
  doc.createElement = () => new Dialog();
  doc.body = { appendChild: el => dialogs.push(el) };
  globalThis.document = doc;
  globalThis.localStorage = {
    getItem(key) { if (storageBlocked) throw Error('blocked'); return storage.get(key) ?? null; },
    setItem(key, value) { if (storageBlocked) throw Error('blocked'); storage.set(key, value); }
  };
  t.after(() => { globalThis.document = savedDocument; globalThis.localStorage = savedStorage; });
  return { dialogs, storage, clock, doc, start: () => initSequelLaunchNotice({ onComplete: initStarTimeNotice }) };
}

test('소개 순서: 시퀀스팡2 닫기 → STAR → 닫기, 이후 같은 기기에서는 STAR 생략', t => {
  const env = setup(t);
  env.start();
  assert.deepEqual(env.dialogs.map(d => d.id), ['sequel-launch-notice']);
  env.dialogs[0].querySelector('.sequel-launch-close').dispatchEvent(new Event('click'));
  assert.deepEqual(env.dialogs.map(d => d.id), ['star-time-notice']);
  env.dialogs[0].querySelector('.star-intro-close').dispatchEvent(new Event('click'));
  assert.equal(env.dialogs.length, 0);
  env.start();
  assert.equal(env.dialogs.length, 0);
  env.clock.now += 86400000;
  env.start();
  assert.equal(env.dialogs[0].id, 'sequel-launch-notice');
  env.dialogs[0].close();
  assert.equal(env.dialogs.length, 0);
});

test('기존 소개를 오늘 이미 봤다면 STAR만 표시', t => {
  const env = setup(t);
  env.storage.set('sequencepang-sequel-launch-2026-09-seen-day', launchNoticeDay(env.clock.now));
  env.start();
  assert.deepEqual(env.dialogs.map(d => d.id), ['star-time-notice']);
});

test('시퀀스팡2 소개 기간 종료 후에도 새 STAR 안내는 표시', t => {
  const env = setup(t, { now: LAUNCH_NOTICE_END + 1 });
  env.start();
  assert.deepEqual(env.dialogs.map(d => d.id), ['star-time-notice']);
});

test('기존 링크 클릭 또는 Escape의 close 이벤트도 STAR 안내로 이어짐', t => {
  const env = setup(t);
  env.start();
  env.dialogs[0].querySelector('.sequel-launch-play').dispatchEvent(new Event('click'));
  assert.deepEqual(env.dialogs.map(d => d.id), ['star-time-notice']);
  env.dialogs[0].close();
  initStarTimeNotice();
  assert.equal(env.dialogs.length, 0);
});

test('기간 만료로 기존 안내가 닫혀도 다음 안내는 한 번만 표시', t => {
  const env = setup(t, { now: LAUNCH_NOTICE_END - 50 });
  env.start();
  env.clock.now = LAUNCH_NOTICE_END;
  t.mock.timers.tick(50);
  assert.deepEqual(env.dialogs.map(d => d.id), ['star-time-notice']);
  env.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(env.dialogs.length, 1);
});

test('게임 도중에는 소개 팝업을 띄우지 않음', t => {
  const env = setup(t, { hidden: true });
  env.start(); initStarTimeNotice();
  assert.equal(env.dialogs.length, 0);
});

test('저장소 차단 상태에서도 순서와 닫기 동작은 정상', t => {
  const env = setup(t, { storageBlocked: true });
  env.start();
  env.dialogs[0].close();
  assert.equal(env.dialogs[0].id, 'star-time-notice');
  env.dialogs[0].close();
  assert.equal(env.dialogs.length, 0);
});

test('dialog 미지원이면 메인 화면을 가로막는 요소를 남기지 않음', t => {
  const env = setup(t, { supported: false });
  env.start();
  assert.equal(env.dialogs.length, 0);
});
