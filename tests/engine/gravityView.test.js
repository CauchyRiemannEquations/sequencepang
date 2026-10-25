import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoardView } from '../../client/src/ui/boardView.js';

function element() {
  const classes = new Set();
  return {
    dataset: {}, textContent: '', children: [],
    style: { setProperty(name, value) { this[name] = value; } },
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
      contains: name => classes.has(name)
    },
    setAttribute() {}, appendChild(child) { this.children.push(child); },
    get offsetHeight() { throw new Error('individual tile layout read'); }
  };
}
function setup(t) {
  const original = globalThis.document;
  globalThis.document = { createElement: element };
  t.after(() => { globalThis.document = original; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const board = element();
  let reads = 0;
  Object.defineProperty(board, 'offsetHeight', { get() { reads++; return 100; } });
  const view = createBoardView({ boardElement: board, boardWrapper: element(), size: 2,
    getDisplayValue: tile => tile.baseValue, isBigNumberTile: () => false });
  const data = value => Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => ({ type: 'normal', baseValue: value })));
  view.build(data(1));
  return { view, data, reads: () => reads };
}

test('gravity performs one board layout flush and preserves column delays and fall distances', t => {
  const { view, data, reads } = setup(t);
  view.renderGravityRefill(data(2));
  assert.equal(reads(), 1);
  for (let col = 0; col < 2; col++) {
    assert.equal(view.getTileEl(0, col).style['--fall-from'], '-112px');
    assert.equal(view.getTileEl(0, col).style.animationDelay, '0ms');
    assert.equal(view.getTileEl(1, col).style['--fall-from'], '-56px');
    assert.equal(view.getTileEl(1, col).style.animationDelay, '30ms');
  }
  t.mock.timers.tick(380);
  assert.equal(view.getTileEl(0, 0).classList.contains('falling'), false);
  assert.equal(view.getTileEl(1, 0).classList.contains('falling'), true);
  t.mock.timers.tick(30);
  assert.equal(view.getTileEl(1, 0).classList.contains('falling'), false);
  view.renderGravityRefill(data(2));
  assert.equal(reads(), 1, 'unchanged values need no layout flush');
});

test('old cleanup cannot terminate a restarted fall or mutate tiles after a rebuild', t => {
  const { view, data } = setup(t);
  view.renderGravityRefill(data(2));
  t.mock.timers.tick(100);
  view.renderGravityRefill(data(3));
  t.mock.timers.tick(280);
  const tile = view.getTileEl(0, 0);
  assert.equal(tile.classList.contains('falling'), true);
  assert.equal(tile.style.animationDelay, '0ms');
  t.mock.timers.tick(100);
  assert.equal(tile.classList.contains('falling'), false);
  view.renderGravityRefill(data(4));
  view.build(data(5));
  tile.style.animationDelay = 'sentinel';
  t.mock.timers.tick(1000);
  assert.equal(tile.style.animationDelay, 'sentinel');
  assert.equal(view.getTileEl(0, 0).classList.contains('falling'), false);
});
