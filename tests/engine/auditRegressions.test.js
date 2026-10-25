import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createSafeStorage } from '../../client/src/safeStorage.js';
import { bindDragInput } from '../../client/src/ui/dragInput.js';
import { createElapsedClock, splitFeverElapsed } from '../../client/src/engine/elapsedClock.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function submissionHarness() {
  const source = readFileSync(new URL('../../client/src/gameEngine.js', import.meta.url), 'utf8');
  const start = source.indexOf('  async function saveFinalScoreAndLoadLeaderboard()');
  const end = source.indexOf('  function handleStart(', start);
  const requests = [], statuses = [];
  const context = vm.createContext({
    isMultiplayMode: false, currentNickname: '테스트', playerNicknameInput: { value: '테스트' },
    globalRanking: {}, scoreSubmitRetry: {}, gameOverOverlay: { classList: { contains: () => true } },
    singleSessionStartedAt: 1, playerId: 'player', score: 100, maxCombo: 1,
    clearCount: 1, feverClearCount: 0, repeatedPathCount: 0, repeatedValuePatternCount: 0,
    crossPangCount: 0, fullPangCount: 0, maxChainLength: 3,
    performance: { now: () => 1000 },
    setScoreSubmitStatus: (...args) => statuses.push(args), buildRankResultMessage: () => 'success',
    loadGlobalLeaderboard: async () => {},
    submitScore(payload) { const request = deferred(); requests.push({ ...request, payload }); return request.promise; }
  });
  vm.runInContext(source.slice(start, end), context);
  function begin(id) {
    context.currentGameSession = { gameSessionId: id, sessionToken: `token-${id}` };
    context.scoreSubmission = { session: context.currentGameSession, status: 'idle', payload: null };
  }
  return { context, begin, requests, statuses, save: () => context.saveFinalScoreAndLoadLeaderboard() };
}
for (const outcome of ['resolve', 'reject']) {
  test(`previous run ${outcome} cannot suppress or overwrite next run`, async () => {
    const h = submissionHarness(); h.begin('A'); const a = h.save();
    h.begin('B'); const b = h.save(); const before = h.statuses.length;
    h.requests[0][outcome](new Error('old error')); await a;
    assert.equal(h.statuses.length, before);
    assert.equal(h.context.scoreSubmission.status, 'pending');
    h.requests[1].resolve({}); await b;
    assert.deepEqual(h.requests.map(r => r.payload.gameSessionId), ['A', 'B']);
    assert.equal(h.context.scoreSubmission.status, 'submitted');
    await h.save(); assert.equal(h.requests.length, 2);
  });
}
test('score retries coalesce and preserve immutable finished payload', async () => {
  const h = submissionHarness(); h.begin('A'); const first = h.save();
  await h.save(); assert.equal(h.requests.length, 1);
  h.requests[0].reject(new Error('offline')); await first;
  assert.equal(h.context.scoreSubmission.status, 'failed');
  h.context.score = 999; h.context.performance.now = () => 90000;
  const retry = h.save(); await h.save();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].payload, h.requests[0].payload);
  assert.equal(h.requests[1].payload.score, 100);
  h.requests[1].resolve({}); await retry;
});
test('return home while uploading does not change hidden submit UI', async () => {
  const h = submissionHarness(); h.begin('A'); const first = h.save();
  h.context.gameOverOverlay.classList.contains = () => false;
  const before = h.statuses.length;
  h.requests[0].reject(new Error('offline')); await first;
  assert.equal(h.statuses.length, before);
});
function target() {
  const handlers = {};
  return { addEventListener(type, fn) { handlers[type] = fn; },
    emit(type, data = {}) { handlers[type]?.({ preventDefault() {}, ...data }); } };
}
const touch = (identifier, clientX = identifier) => ({ identifier, clientX, clientY: 10 });
test('touch cancellation clears without scoring and allows fresh drag', () => {
  const board = target(), win = target(), calls = [];
  bindDragInput({ boardWrapper: board, eventTarget: win,
    start: x => calls.push(['start', x]), move: x => calls.push(['move', x]),
    end: () => calls.push(['end']), cancel: () => calls.push(['cancel']) });
  board.emit('touchstart', { changedTouches: [touch(1)] });
  board.emit('touchstart', { changedTouches: [touch(2)] });
  win.emit('touchmove', { touches: [touch(2, 200), touch(1, 100)] });
  win.emit('touchend', { changedTouches: [touch(2)] });
  win.emit('touchcancel', { changedTouches: [touch(1)] });
  win.emit('touchend', { changedTouches: [touch(1)] });
  board.emit('touchstart', { changedTouches: [touch(3)] });
  win.emit('touchend', { changedTouches: [touch(3)] });
  assert.deepEqual(calls, [['start',1],['move',100],['cancel'],['start',3],['end']]);
});
test('mouse ignores secondary buttons; blur and rotation cancel once', () => {
  const board = target(), win = target(), calls = [];
  bindDragInput({ boardWrapper: board, eventTarget: win, start: () => calls.push('start'),
    move() {}, end: () => calls.push('end'), cancel: () => calls.push('cancel') });
  board.emit('mousedown', { button: 2 });
  board.emit('mousedown', { button: 0 });
  win.emit('blur'); win.emit('mouseup', { button: 0 });
  board.emit('touchstart', { changedTouches: [touch(1)] }); win.emit('orientationchange');
  assert.deepEqual(calls, ['start','cancel','start','cancel']);
});
test('elapsed clock catches delayed callbacks and excludes full explicit pause intervals', () => {
  let now = 0; const clock = createElapsedClock(() => now);
  clock.setRunning(true); now = 2100; assert.equal(clock.take(), 2100);
  now = 2150; clock.setRunning(false); now = 12150;
  clock.setRunning(true); now = 12200; assert.equal(clock.take(), 100);
  clock.reset(); now += 9000; assert.equal(clock.take(), 0);
});
test('delayed fever tick carries excess into normal time', () => {
  assert.deepEqual(splitFeverElapsed(2500, 1000), { feverElapsedMs: 1000, mainElapsedMs: 1500 });
  assert.deepEqual(splitFeverElapsed(2500, 8000), { feverElapsedMs: 2500, mainElapsedMs: 0 });
});
test('denied storage getter/read/write falls back in memory', () => {
  for (const storage of [() => { throw new Error('blocked'); }, () => ({
    getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }
  })]) {
    const safe = createSafeStorage(storage);
    assert.equal(safe.getItem('player'), null); safe.setItem('player', 'same-id');
    assert.equal(safe.getItem('player'), 'same-id');
  }
});

function timerHarness() {
  const source = readFileSync(new URL('../../client/src/gameEngine.js', import.meta.url), 'utf8');
  const tick = source.slice(source.indexOf('  function tickTimer() {'), source.indexOf('  // ── 0초 드래그 유예'));
  const comboTick = source.slice(source.indexOf('  function tickComboTimer('), source.indexOf('  function isLastSpurtActive()'));
  let now = 0, ended = 0;
  const timerClock = createElapsedClock(() => now); timerClock.setRunning(true);
  const context = vm.createContext({ timerClock, splitFeverElapsed,
    performance: { now: () => now }, isGameOver: false, isGameActive: true,
    pangCinematicActive: false, timeoutGraceActive: false,
    fever: { active: false, ending: false, timeLeftMs: 0 },
    starTime: { state: { isStarTime: false } }, starComboPausedUntil: 0,
    timeLeft: 30, combo: 2, comboTimeLeft: 5, isDragging: false, selectedTiles: [],
    updateStarTime() {}, updateFeverUI() {}, updateTimerUI() {},
    finishFeverMode() { context.fever.active = false; },
    enterTimeoutGrace() { context.timeoutGraceActive = true; },
    triggerGameOver() { ended++; context.isGameOver = true; },
    hud: { clearCombo() {}, setComboSeconds() {} }, playSound() {}
  });
  vm.runInContext(tick + comboTick, context);
  return { context, clock: timerClock, advance(ms) { now += ms; },
    tick: () => context.tickTimer(), ended: () => ended };
}
test('actual game tick uses delayed elapsed time for game and combo', () => {
  const h = timerHarness(); h.advance(2000); h.tick();
  assert.equal(h.context.timeLeft, 28); assert.equal(h.context.comboTimeLeft, 3);
  h.advance(29000); h.tick(); assert.equal(h.ended(), 1);
});
test('actual fever tick pauses main and combo then charges overflow', () => {
  const h = timerHarness(); h.context.fever = { active: true, ending: false, timeLeftMs: 3000 };
  h.advance(2000); h.tick();
  assert.equal(h.context.fever.timeLeftMs, 1000); assert.equal(h.context.timeLeft, 30);
  assert.equal(h.context.comboTimeLeft, 5);
  h.advance(2500); h.tick();
  assert.equal(h.context.fever.active, false); assert.equal(h.context.timeLeft, 28.5);
  assert.equal(h.context.comboTimeLeft, 3.5);
});
test('cinematic and hyper pauses preserve time even without intermediate callbacks', () => {
  const h = timerHarness(); h.advance(50); h.clock.setRunning(false);
  h.context.pangCinematicActive = true; h.advance(4000); h.tick();
  assert.equal(h.context.timeLeft, 30);
  h.context.pangCinematicActive = false; h.context.isGameActive = false;
  h.advance(6000); h.tick(); h.context.isGameActive = true; h.clock.setRunning(true);
  h.advance(50); h.tick(); assert.equal(h.context.timeLeft, 29.9);
});
test('STAR TIME expiry only charges combo time after its deadline', () => {
  const h = timerHarness(); h.context.starComboPausedUntil = 1500;
  h.advance(2000); h.tick();
  assert.equal(h.context.timeLeft, 28); assert.equal(h.context.comboTimeLeft, 4.5);
});
test('fever excludes cinematic/hyper pauses and resumes the exact remainder', () => {
  const h = timerHarness(); h.context.fever = { active: true, ending: false, timeLeftMs: 3000 };
  h.advance(50); h.clock.setRunning(false); h.context.pangCinematicActive = true;
  h.advance(10000); h.tick(); assert.equal(h.context.fever.timeLeftMs, 3000);
  h.context.pangCinematicActive = false; h.clock.setRunning(true);
  h.advance(50); h.tick(); assert.equal(h.context.fever.timeLeftMs, 2900);
  assert.equal(h.context.timeLeft, 30);
});
test('STAR TIME expiring inside a pause does not charge pre-pause protected combo time', () => {
  const h = timerHarness(); h.context.starComboPausedUntil = 1500;
  h.advance(50); h.clock.setRunning(false); h.context.pangCinematicActive = true;
  h.advance(2000); h.tick();
  h.context.pangCinematicActive = false; h.clock.setRunning(true);
  h.advance(50); h.tick();
  assert.equal(h.context.timeLeft, 29.9);
  assert.equal(h.context.comboTimeLeft, 4.95);
});
