import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoardView } from '../../client/src/ui/boardView.js';
import { createStarTimeView } from '../../client/src/ui/starTimeView.js';

function element() {
  const classes = new Set();
  const attributes = new Map();
  return {
    dataset: {}, style: {}, children: [], textContent: '', hidden: false,
    classList: {
      contains: name => classes.has(name),
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    appendChild(child) { this.children.push(child); }
  };
}

test('동일 숫자 7의 리필에서도 별 클래스·접근성 이름·데이터가 이동한다', t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: element };
  t.after(() => { globalThis.document = previous; });
  const view = createBoardView({
    boardElement: element(), boardWrapper: element(), size: 1,
    getDisplayValue: tile => tile.baseValue, isBigNumberTile: () => false
  });
  const tile = isStar => ({ type: 'normal', baseValue: 7, isStar });
  view.build([[tile(false)]]);
  const el = view.getTileEl(0, 0);
  view.renderGravityRefill([[tile(true)]]);
  assert.equal(el.textContent, 7);
  assert.equal(el.dataset.isStar, 'true');
  assert.equal(el.classList.contains('star-number'), true);
  assert.equal(el.getAttribute('aria-label'), '별 숫자 7');
  view.renderGravityRefill([[tile(false)]]);
  assert.equal(el.classList.contains('star-number'), false);
  assert.equal(el.dataset.isStar, 'false');
  assert.equal(el.getAttribute('aria-label'), '7');
});

test('STAR 종료·게임 리셋은 효과와 알림 타이머를 정리하며 HUD 노드가 늘지 않는다', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = globalThis.document;
  globalThis.document = { createElement: element };
  t.after(() => { globalThis.document = previous; });
  const parts = Object.fromEntries(['star-gauge', 'star-label', 'star-timer', 'star-feedback']
    .map(name => [`.${name}`, element()]));
  const panel = element();
  panel.querySelector = name => parts[name];
  const wrapper = element();
  const view = createStarTimeView({ panel, boardWrapper: wrapper, required: 5, multiplier: 2 });
  const off = { starCount: 0, isStarTime: false, starTimeRemaining: 0 };
  const on = { starCount: 0, isStarTime: true, starTimeRemaining: 8 };
  view.render(on);
  view.notify('STAR TIME!');
  assert.equal(wrapper.classList.contains('star-time-active'), true);
  assert.equal(parts['.star-timer'].textContent, '8.0s · 점수 ×2');
  assert.equal(parts['.star-gauge'].hidden, true);
  for (let i = 0; i < 100; i++) view.render(on);
  assert.equal(parts['.star-gauge'].children.length, 5);
  view.render(off);
  assert.equal(wrapper.classList.contains('star-time-active'), false);
  assert.equal(parts['.star-feedback'].textContent, '');
  assert.equal(parts['.star-timer'].hidden, true);
  view.notify('이전 게임');
  t.mock.timers.tick(1000);
  view.reset(off);
  view.notify('새 게임');
  t.mock.timers.tick(400);
  assert.equal(parts['.star-feedback'].textContent, '새 게임');
  t.mock.timers.tick(1000);
  assert.equal(parts['.star-feedback'].textContent, '');
});
