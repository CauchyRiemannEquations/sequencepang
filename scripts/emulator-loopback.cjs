// Test-only adapter for restricted environments that allow loopback TCP but
// prohibit filesystem Unix sockets. Production code and security rules are unchanged.
// Pinned to firebase-tools 14.27.0; do not enable this on normal developer machines.
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'string' && /^\d+$/.test(args[0])) {
    args[0] = Number(args[0]);
    if (typeof args[1] !== 'string') args.splice(1, 0, '127.0.0.1');
  }
  return originalListen.apply(this, args);
};
const { FunctionsEmulator, TCPConn } = require('firebase-tools/lib/emulator/functionsEmulator');
FunctionsEmulator.prototype.startNode = async function (backend, envs) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.on('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const runtime = require.resolve('firebase-tools/lib/emulator/functionsEmulatorRuntime');
  const nodeBin = process.env.SEQUENCEPANG_FUNCTIONS_NODE || backend.bin;
  return {
    process: spawn(nodeBin, [runtime], { cwd: backend.functionsDir,
      env: { ...process.env, ...envs, node: nodeBin, METADATA_SERVER_DETECTION: 'none', PORT: String(port) },
      stdio: ['pipe','pipe','pipe','ipc'] }),
    events: new EventEmitter(), cwd: backend.functionsDir, conn: new TCPConn('127.0.0.1', port)
  };
};
