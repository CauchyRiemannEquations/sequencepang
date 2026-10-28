// Observed SDK document-read work, not a billing export. Includes empty-query
// minimums and transaction attempts, but excludes index entries and SDK retries.
function recordRead(timing, category, count, { query = false } = {}) {
  timing?.add?.('firestoreReadCalls', 1);
  timing?.add?.('documentReadsReturned', count);
  timing?.add?.('documentReadUnitsObserved', query ? Math.max(1, count) : count);
  timing?.add?.(`${category}ReadUnits`, query ? Math.max(1, count) : count);
}
module.exports = { recordRead };
