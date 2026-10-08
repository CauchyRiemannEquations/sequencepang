const { performance } = require('node:perf_hooks');
const moduleStartedAt = performance.now();
const { onRequest } = require('firebase-functions/v2/https');
const { onValueWritten } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineString } = require('firebase-functions/params');
const { app } = require('./app');
const { reconcilePresence, cleanupExpiredState } = require('./roomService');
app.locals.moduleLoadMs = performance.now() - moduleStartedAt;

const region = defineString('DEPLOY_REGION', { default: 'asia-southeast1', description: '기존 RTDB와 가까운 Functions 리전' });
const instance = defineString('RTDB_INSTANCE', { description: '기존 프로젝트 RTDB의 instance 이름 (URL hostname의 첫 부분)' });

exports.api = onRequest({ region, cors: false, minInstances: 0, maxInstances: 5, memory: '256MiB', timeoutSeconds: 60 }, app);
exports.roomPresence = onValueWritten({
  ref: '/rooms/{roomId}/players/{uid}/connections/{connectionId}', instance, region,
  maxInstances: 5, memory: '256MiB', retry: true
}, event => reconcilePresence(event.params.roomId));
exports.cleanup = onSchedule({
  schedule: 'every 1 minutes', region, minInstances: 0, maxInstances: 1,
  memory: '256MiB', timeoutSeconds: 120
}, () => cleanupExpiredState());
