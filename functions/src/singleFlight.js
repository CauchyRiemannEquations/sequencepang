// Only share work in progress. Revision-keyed callers still validate shared state
// on every request, so a score saved by another instance cannot leave a stale hit.
function createSingleFlight() {
  const pending = new Map();
  function run(key, load) {
    if (pending.has(key)) return { promise: pending.get(key), shared: true };
    const promise = Promise.resolve().then(load).finally(() => {
      if (pending.get(key) === promise) pending.delete(key);
    });
    pending.set(key, promise);
    return { promise, shared: false };
  }
  return { run };
}
module.exports = { createSingleFlight };
