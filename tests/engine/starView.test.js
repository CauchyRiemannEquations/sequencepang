import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoardView } from '../../client/src/ui/boardView.js';
import { createStarTimeView } from '../../client/src/ui/starTimeView.js';
import { PANG_BURST_MS, PANG_BURST_STAGGER_MS, PANG_BURST_SETTLE_MS } from '../../client/src/gameConstants.js';
import { getCrossCells } from '../../client/src/engine/chainTier.js';

function element() {
  const classes = new Set();
  const attributes = new Map();
  const styles = new Map();
  return {
    dataset: {}, style: {
      setProperty: (name, value) => styles.set(name, value),
      removeProperty: name => styles.delete(name),
      getPropertyValue: name => styles.get(name) || ''
    }, children: [], textContent: '', hidden: false, clientWidth: 360, clientHeight: 360,
    classList: {
      contains: name => classes.has(name),
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    appendChild(child) { this.children.push(child); child.parent = this; },
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 360 })
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

test('크로스팡은 십자 대상만 순서대로, 풀보드팡은 전판을 동시에 터뜨리고 잔여 효과를 정리한다', t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: element };
  t.after(() => { globalThis.document = previous; });
  const wrapper = element();
  const view = createBoardView({
    boardElement: element(), boardWrapper: wrapper, size: 6,
    getDisplayValue: tile => tile.baseValue, isBigNumberTile: () => false
  });
  view.build(Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ({ type: 'normal', baseValue: 1 }))));
  const origin = { row: 2, col: 2 };
  for (const tier of ['cross', 'full']) {
    const cells = tier === 'cross' ? [origin, ...getCrossCells(origin, 6)]
      : Array.from({ length: 36 }, (_, i) => ({ row: Math.floor(i / 6), col: i % 6 }));
    const duration = view.triggerPangBurst(cells, origin, {
      tier, durationMs: PANG_BURST_MS, staggerMs: PANG_BURST_STAGGER_MS, settleMs: PANG_BURST_SETTLE_MS
    });
    assert.equal(duration, PANG_BURST_MS + PANG_BURST_SETTLE_MS + (tier === 'cross' ? 3 * PANG_BURST_STAGGER_MS : 0));
    assert.equal(wrapper.children.length, 1);
    const copy = wrapper.children[0].children.at(-1);
    assert.equal(copy.children[0].textContent, tier === 'full' ? '풀보드팡!' : '크로스팡!');
    assert.equal(view.getTileEl(5, 2).style.getPropertyValue('--pang-delay'), tier === 'cross' ? '96ms' : '0ms');
    assert.equal(view.getTileEl(5, 5).classList.contains('pang-burst'), tier === 'full');
    view.clearPangBurst();
    assert.equal(wrapper.classList.contains('pang-cinematic'), false);
    assert.equal(view.getTileEl(5, 5).classList.contains('pang-burst'), false);
    assert.equal(wrapper.children.length, 0);
    assert.equal(view.getTileEl(5, 2).style.getPropertyValue('--pang-delay'), '');
  }
});

test('폭발 후 같은 숫자로 생성된 블록도 낙하하고 완료되면 효과가 정리된다', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = globalThis.document;
  globalThis.document = { createElement: element };
  t.after(() => { globalThis.document = previous; });
  const view = createBoardView({
    boardElement: element(), boardWrapper: element(), size: 1,
    getDisplayValue: tile => tile.baseValue, isBigNumberTile: () => false
  });
  const data = [[{ type: 'normal', baseValue: 7 }]];
  view.build(data);
  view.renderGravityRefill(data, { spawned: [{ row: 0, col: 0, fallRows: 1 }] });
  const tile = view.getTileEl(0, 0);
  assert.equal(tile.classList.contains('falling'), true);
  t.mock.timers.tick(380);
  assert.equal(tile.classList.contains('falling'), false);
});
