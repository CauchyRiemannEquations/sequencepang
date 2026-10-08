const { performance } = require('node:perf_hooks');
const { info } = require('firebase-functions/logger');

// Timings stay in the response/logs: no analytics documents or extra Firestore writes.
function createRequestTiming({ now = () => performance.now(), log = info } = {}) {
  let firstRequest = true;
  return (req, res, next) => {
    const startedAt = now();
    const first = firstRequest;
    firstRequest = false;
    const durations = {};
    const details = {};
    req.timing = {
      async measure(name, task) {
        const start = now();
        try { return await task(); }
        finally { durations[name] = (durations[name] || 0) + now() - start; }
      },
      set(name, value) { details[name] = value; }
    };
    const json = res.json;
    res.json = function (body) {
      durations.server_total = now() - startedAt;
      const values = Object.entries(durations).map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`);
      values.push(`instance_first_request;desc="${first}"`);
      values.push(`module_load;dur=${Number(req.app.locals.moduleLoadMs || 0).toFixed(1)}`);
      if (details.cache) values.push(`leaderboard_cache;desc="${details.cache}"`);
      res.set('Server-Timing', values.join(', '));
      return json.call(this, body);
    };
    res.once('finish', () => {
      if (req.originalUrl.split('?')[0] !== '/api/leaderboard') return;
      log('ranking_timing', { status: res.statusCode, instanceFirstRequest: first,
        moduleLoadMs: req.app.locals.moduleLoadMs || 0, durations, ...details });
    });
    next();
  };
}

function measure(timing, name, task) { return timing ? timing.measure(name, task) : task(); }
module.exports = { createRequestTiming, measure };
