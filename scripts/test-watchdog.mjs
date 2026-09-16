import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/watchdog-sessions.ps1')], { stdio: 'inherit' });

execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/watchdog-sites.ps1')], { stdio: 'inherit' });

const dataDirectory = await mkdtemp(join(tmpdir(), 'lockin-watchdog-'));
const port = 18766;
const endpoint = `http://127.0.0.1:${port}/api/request`;
const currentUserSid = execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'
], { encoding: 'utf8' }).trim();
const watchdog = spawn('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', resolve('watchdog/LockInWatchdog.ps1'),
  '-DataDirectory', dataDirectory,
  '-Port', String(port),
  '-HeartbeatTimeoutSeconds', '2',
  '-ProtectedUserSids', `${currentUserSid},S-1-5-18`,
  '-TestMode',
  '-AssumeBrowserRunning'
], { stdio: ['ignore', 'pipe', 'pipe'] });

function waitForReady(process) {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Watchdog did not become ready.')), 10000);
    process.stdout.on('data', (chunk) => {
      if (!chunk.toString().includes('LOCKIN_WATCHDOG_READY')) return;
      clearTimeout(timeout);
      resolveReady();
    });
    process.once('exit', (code) => reject(new Error(`Watchdog exited early with ${code}.`)));
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
  await waitForReady(watchdog);
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
  const missing = await send('heartbeat', { host: 'example.com', focused: true });
  assert.equal(missing.failClosedActive, true);
  assert.equal(missing.firewallBlocked, true);
  assert.match(missing.enforcementReason, /sensor missing: SYSTEM/);
  await send('updateConfig', {
    groups: [{ id: 'url', name: 'URL allowance', domains: ['example.com/Path?v=ABC'], enabled: true, schedule: null, limit: { minutes: 1 } }],
    privacyConsent: true, lockMode: false
  });
  const outside = await send('heartbeat', { host: 'example.com', url: 'https://example.com/elsewhere', focused: true });
  assert.equal(outside.supportsUrlRules, true);
  assert.ok(!outside.usageSession?.groupIds?.includes('url'));
  const inside = await send('heartbeat', { host: 'example.com', url: 'https://example.com/Path?extra=1&v=ABC', focused: true });
  assert.ok(inside.usageSession?.groupIds?.includes('url'));
  assert.deepEqual(inside.groups[0].domains, ['example.com/Path?v=ABC']);
  const caseSensitive = await send('updateConfig', {
    groups: [{ id: 'case', name: 'Distinct paths', domains: ['example.com/Path', 'example.com/path'], enabled: true, limit: { minutes: 0 } }],
    privacyConsent: true, lockMode: false
  });
  assert.equal(caseSensitive.blockedDomains.length, 2);
  console.log('PowerShell watchdog integration test passed.');
} finally {
  watchdog.kill();
  await new Promise((resolveExit) => watchdog.once('exit', resolveExit));
  await rm(dataDirectory, { recursive: true, force: true });
}

const rejectedDataDirectory = await mkdtemp(join(tmpdir(), 'lockin-watchdog-rejected-'));
const rejectedPort = 18767;
const rejectedWatchdog = spawn('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', resolve('watchdog/LockInWatchdog.ps1'),
  '-DataDirectory', rejectedDataDirectory,
  '-Port', String(rejectedPort),
  '-ProtectedUserSids', 'S-1-5-18',
  '-TestMode',
  '-AssumeBrowserRunning'
], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  await waitForReady(rejectedWatchdog);
  const response = await fetch(`http://127.0.0.1:${rejectedPort}/api/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'heartbeat', requestId: 'wrong-account', payload: {} })
  });
  const message = await response.json();
  assert.equal(response.status, 403);
  assert.match(message.error, /not the protected Lock In sensor/);
} finally {
  rejectedWatchdog.kill();
  await new Promise((resolveExit) => rejectedWatchdog.once('exit', resolveExit));
  await rm(rejectedDataDirectory, { recursive: true, force: true });
}
