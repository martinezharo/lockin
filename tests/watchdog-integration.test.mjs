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
  assert.match(background, /watchdogClient\.pulse/);
  assert.match(background, /watchdogClient\.markConfigDirty/);
  assert.doesNotMatch(background, /updateDynamicRules/);
});

test('the snapshot never reports a group the extension cannot read', async () => {
  const watchdog = await readFile('watchdog/LockInWatchdog.ps1', 'utf8');
  assert.ok(watchdog.includes('groups = @($script:State.groups | Where-Object { $null -ne $_ })'));
  assert.ok(watchdog.includes('$script:State.groups = @(Normalize-Groups $Request.payload.groups)'));
  assert.ok(client.includes('.filter(isGroup).map(serializeGroup)'));
  assert.ok(client.includes('next.groups.length === 0 && (current.groups || []).length > 0'));
});

test('the watchdog client is pinned to loopback', () => {
  assert.match(client, /127\.0\.0\.1:8765/);
  assert.match(installer, /New-ScheduledTaskPrincipal/);
  assert.match(installer, /SYSTEM/);
  assert.match(installer, /New-NetFirewallRule/);
  assert.match(installer, /MultipleInstances IgnoreNew/);
  assert.match(installer, /ProtectedWindowsUser/);
  assert.match(client, /HEARTBEAT_MS = 1000/);
});

test('safe rollout arms only after the watchdog is reachable', async () => {
  const watchdog = await readFile('watchdog/LockInWatchdog.ps1', 'utf8');
  assert.match(watchdog, /ConsecutiveHeartbeatsBySid\[\$sensorKey\].*-ge 3/);
  assert.match(watchdog, /sensor missing/);
  assert.match(watchdog, /Set-FirewallBlocked/);
  assert.match(watchdog, /EvaluationIntervalMilliseconds = 250/);
  assert.match(watchdog, /Test-ProtectedAccountRequest/);
  assert.match(watchdog, /Get-NetTCPConnection/);
  assert.match(watchdog, /GetOwnerSid/);
  assert.match(watchdog, /Get-CimInstance Win32_Process/);
  assert.match(watchdog, /Group-Object SessionId/);
  assert.match(watchdog, /Get-CimProcessOwnerSid \$process/);
  assert.match(watchdog, /Invoke-CimMethod -InputObject \$Process/);
  assert.doesNotMatch(watchdog, /Get-ProcessOwnerSid \(\[int\]\$process\.ProcessId\)/);
  assert.doesNotMatch(watchdog, /Get-Process chrome, brave -IncludeUserName/);
  assert.match(installer, /ProtectedWindowsUser/);
  assert.match(installer, /ProtectedUserSids/);
  assert.match(watchdog, /SensorHeartbeatMsBySid/);
  assert.match(watchdog, /missingAccounts/);
  assert.match(watchdog, /Schedule\.windows/);
  assert.match(watchdog, /function Test-OwnedPoliciesCurrent/);
  assert.match(watchdog, /LastPolicyFingerprint.*Test-OwnedPoliciesCurrent/);
  assert.match(watchdog, /WOW6432Node\\Policies\\BraveSoftware\\Brave\\URLBlocklist/);
});
