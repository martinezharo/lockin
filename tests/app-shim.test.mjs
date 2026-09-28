import assert from 'node:assert/strict';
import test from 'node:test';

// The chrome.* shim the Windows app injects into the extension's own pages.
// It is exercised here with a fake service so the mirror, the debounced config
// sync and the offline behavior are all pinned down.

const snapshot = {
  configured: true,
  enforcementArmed: true,
  failClosed: true,
  failClosedActive: false,
  firewallBlocked: false,
  groups: [{ id: 'seed', name: 'Seed', domains: ['example.com'], enabled: true, limit: { minutes: 0 } }],
  usage: { seed: { date: '2026-01-01', ms: 1000 } },
  usageSession: null,
  lockMode: false,
  privacyConsent: true,
  supportsUrlRules: true,
  supportsExceptions: true,
  supportsTimedDisarm: true,
  supportsAppZones: true,
  blockedDomains: ['example.com'],
  allowedDomains: [],
  blockedApps: ['discord.exe'],
  enforcementReason: 'schedule',
  lastHeartbeatMs: 1,
  protectedWindowsAccount: 'PC\\user',
  protectedWindowsAccounts: ['PC\\user'],
  sensors: []
};

const calls = [];
let healthHandler = async () => ({ ok: true, data: snapshot });

globalThis.__LOCKIN_APP__ = { port: 18765, version: '1.5.0' };
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value))
};
globalThis.document = { hasFocus: () => true };
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
  if (String(url).endsWith('/health')) {
    const result = await healthHandler();
    if (result instanceof Error) throw result;
    return { ok: true, status: 200, json: async () => ({ ok: true, data: result.data }) };
  }
  const request = JSON.parse(options.body);
  return { ok: true, status: 200, json: async () => ({ ok: true, requestId: request.requestId, data: snapshot }) };
};

await import('../windows/LockIn.App/web/shim.js');
const chrome = globalThis.chrome;

const updates = () => calls.filter((call) => call.body?.type === 'updateConfig');

test('mirrors the service snapshot into storage', async () => {
  await chrome.lockin.refresh();
  const { nativeStatus, usage } = await chrome.storage.local.get(['nativeStatus', 'usage']);
  assert.equal(nativeStatus.connected, true);
  assert.equal(nativeStatus.supportsAppZones, true);
  assert.deepEqual(nativeStatus.blockedApps, ['discord.exe']);
  assert.equal(nativeStatus.enforcementArmed, true);
  assert.equal(usage.seed.ms, 1000);
});

test('the shim never sends an extension heartbeat', () => {
  assert.ok(!calls.some((call) => call.body?.type === 'heartbeat' || call.body?.type === 'appHeartbeat'));
});

test('an edit is pushed to the service once, after the debounce', async () => {
  const before = updates().length;
  await chrome.storage.local.set({ groups: [{ id: 'edited', domains: ['x.com'], enabled: true }] });
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(updates().length, before + 1);
  assert.equal(updates().at(-1).body.payload.groups[0].id, 'edited');
});

test('clear and state messages reach the service', async () => {
  const cleared = await chrome.runtime.sendMessage({ type: 'lockin-native-clear' });
  assert.equal(cleared.ok, true);
  assert.ok(calls.some((call) => call.body?.type === 'clearData'));
  const state = await chrome.runtime.sendMessage({ type: 'lockin-native-state' });
  assert.equal(state.ok, true);
  assert.ok(calls.some((call) => call.body?.type === 'getState'));
});

test('a config edit made while offline is replayed after reconnect', async () => {
  healthHandler = async () => new Error('offline');
  await chrome.lockin.refresh();
  await chrome.lockin.refresh();
  const before = updates().length;
  await chrome.storage.local.set({ lockMode: true });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(updates().length, before, 'nothing is sent while the service is away');

  healthHandler = async () => ({ ok: true, data: snapshot });
  await chrome.lockin.refresh();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(updates().length, before + 1);
  assert.equal(updates().at(-1).body.payload.lockMode, true);
});

test('a sustained outage is reported as disconnected', async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  healthHandler = async () => new Error('service down');
  try {
    await chrome.lockin.refresh();
    now += 11000;
    await chrome.lockin.refresh();
    const { nativeStatus } = await chrome.storage.local.get('nativeStatus');
    assert.equal(nativeStatus.connected, false);
    assert.equal(nativeStatus.error, 'service down');
  } finally {
    Date.now = realNow;
    healthHandler = async () => ({ ok: true, data: snapshot });
  }
});
