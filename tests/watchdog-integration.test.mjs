import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const background = await readFile('src/background.js', 'utf8');
const client = await readFile('src/watchdog-client.js', 'utf8');
const installer = await readFile('scripts/install-windows-watchdog.ps1', 'utf8');

test('the extension is a loopback sensor rather than a DNR blocker', () => {
  assert.ok(!manifest.permissions.includes('nativeMessaging'));
  assert.ok(!manifest.permissions.includes('declarativeNetRequest'));
  assert.match(background, /watchdogClient\.heartbeat/);
  assert.doesNotMatch(background, /updateDynamicRules/);
});

test('the watchdog client is pinned to loopback', () => {
  assert.match(client, /127\.0\.0\.1:8765/);
  assert.match(installer, /New-ScheduledTaskPrincipal/);
  assert.match(installer, /SYSTEM/);
  assert.match(installer, /New-NetFirewallRule/);
});

test('safe rollout arms only after the watchdog is reachable', async () => {
  const watchdog = await readFile('watchdog/LockInWatchdog.ps1', 'utf8');
  assert.match(watchdog, /ConsecutiveHeartbeats -ge 3/);
  assert.match(watchdog, /sensor missing/);
  assert.match(watchdog, /Set-FirewallBlocked/);
});
