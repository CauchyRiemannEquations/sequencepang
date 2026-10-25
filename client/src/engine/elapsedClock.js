// Monotonic active-time accounting. Pauses exclude their exact interval, even
// when the browser does not deliver callbacks while paused.
export function createElapsedClock(now) {
  let previous = now();
  let running = false;
  let intervals = [];
  function sample(at = now()) {
    if (running && at > previous) intervals.push([previous, at]);
    previous = at;
  }
  function takeFrame(blockedUntil = 0) {
    sample();
    let elapsedMs = 0;
    let eligibleMs = 0;
    for (const [start, end] of intervals) {
      elapsedMs += end - start;
      eligibleMs += Math.max(0, end - Math.max(start, blockedUntil));
    }
    intervals = [];
    return { elapsedMs, eligibleMs };
  }
  return {
    takeFrame,
    setRunning(value) { sample(); running = value; },
    take() { return takeFrame().elapsedMs; },
    reset() { previous = now(); intervals = []; running = false; }
  };
}

// Fever consumes active time first. Delayed callbacks carry any remainder into
// the normal timer instead of extending the round beyond the fever deadline.
export function splitFeverElapsed(elapsedMs, feverRemainingMs) {
  const feverElapsedMs = Math.min(elapsedMs, Math.max(0, feverRemainingMs));
  return { feverElapsedMs, mainElapsedMs: elapsedMs - feverElapsedMs };
}
