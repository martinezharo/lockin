import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dataDirectory = await mkdtemp(join(tmpdir(), 'lockin-watchdog-'));
const port = 18766;
const endpoint = `http://127.0.0.1:${port}/api/request`;
const watchdog = spawn('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', resolve('watchdog/LockInWatchdog.ps1'),
  '-DataDirectory', dataDirectory,
  '-Port', String(port),
  '-HeartbeatTimeoutSeconds', '2',
  '-TestMode',
  '-AssumeBrowserRunning'
], { stdio: ['ignore', 'pipe', 'pipe'] });

function waitForReady() {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Watchdog did not become ready.')), 10000);
    watchdog.stdout.on('data', (chunk) => {
      if (!chunk.toString().includes('LOCKIN_WATCHDOG_READY')) return;
      clearTimeout(timeout);
      resolveReady();
    });
    watchdog.once('exit', (code) => reject(new Error(`Watchdog exited early with ${code}.`)));
  });
}

let requestNumber = 0;
async function send(type, payload = {}) {
  const requestId = `test-${++requestNumber}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, requestId, payload })
  });
  const message = await response.json();
  assert.equal(response.ok, true, message.error);
  assert.equal(message.ok, true, message.error);
  assert.equal(message.requestId, requestId);
  return message.data;
}

try {
  await waitForReady();
  await send('bootstrap', {
    groups: [{
      id: 'permanent-test',
      name: 'Permanent test',
      domains: ['example.com'],
      enabled: true,
      schedule: null,
      limit: { minutes: 0 },
      createdAt: Date.now(),
      mode: 'schedule'
    }],
    usage: {},
    lockMode: false,
    privacyConsent: true
  });
  await send('heartbeat', { host: 'example.com', focused: true });
  await send('heartbeat', { host: 'example.com', focused: true });
  const armed = await send('heartbeat', { host: 'example.com', focused: true });
  assert.equal(armed.enforcementArmed, true);
  assert.equal(armed.firewallBlocked, false);
  assert.deepEqual(armed.blockedDomains, ['example.com']);

  await new Promise((resolveWait) => setTimeout(resolveWait, 3000));
  const missing = await send('getState');
  assert.equal(missing.failClosedActive, true);
  assert.equal(missing.firewallBlocked, true);
  assert.match(missing.enforcementReason, /sensor missing/);
  console.log('PowerShell watchdog integration test passed.');
} finally {
  watchdog.kill();
  await new Promise((resolveExit) => watchdog.once('exit', resolveExit));
  await rm(dataDirectory, { recursive: true, force: true });
}
