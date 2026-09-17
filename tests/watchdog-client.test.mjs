import assert from 'node:assert/strict';
import test from 'node:test';

const state = {
  groups: [{ id: 'queued', name: 'Queued', domains: ['example.com'], enabled: true, schedule: null, limit: { minutes: 0 } }],
  usage: {},
  lockMode: false,
  privacyConsent: true
};
const tabState = { tabs: [], reloaded: [] };

function select(keys) {
  if (typeof keys === 'string') return { [keys]: state[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, state[key]]));
  return { ...state };
}

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) { return select(keys); },
      async set(values) { Object.assign(state, values); }
    }
  },
  windows: {
    async getLastFocused() { return { id: 1, focused: true }; }
  },
  tabs: {
    async query() { return tabState.tabs; },
    async get(id) { return tabState.tabs.find(tab => tab.id === id); },
    async reload(tabId) { tabState.reloaded.push(tabId); }
  }
};

const { WatchdogClient } = await import('../src/watchdog-client.js');

test('slow heartbeats are coalesced instead of starving configuration updates', async () => {
  const client = new WatchdogClient();
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  client.request = async () => { calls += 1; await pending; };
  const pulses = Array.from({ length: 20 }, () => client.heartbeat());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await Promise.all(pulses);
  await client.heartbeat();
  assert.equal(calls, 2);
});

test('configuration changed while offline is replayed after reconnect', async () => {
  const client = new WatchdogClient();
  const requests = [];
  client.request = async (type, payload) => {
    requests.push({ type, payload });
    return { ok: true };
  };

  client.markConfigDirty();
  assert.equal(client.configSyncPending, true);
  assert.deepEqual(requests, []);

  await client.finishConnect();
  clearInterval(client.heartbeatTimer);

  assert.deepEqual(requests.map(({ type }) => type), ['bootstrap', 'updateConfig', 'heartbeat']);
  assert.equal(requests[1].payload.groups[0].id, 'queued');
  assert.equal(client.configSyncPending, false);
});

test('a clean reconnect does not overwrite the authoritative configuration', async () => {
  const client = new WatchdogClient();
  const requests = [];
  client.request = async (type) => {
    requests.push(type);
    return { ok: true };
  };

  await client.finishConnect();
  clearInterval(client.heartbeatTimer);

  assert.deepEqual(requests, ['bootstrap', 'heartbeat']);
  assert.equal(client.configSyncPending, false);
});

test('a newer configuration revision is sent after an update already started', async () => {
  const client = new WatchdogClient();
  client.connected = true;
  const requests = [];
  let releaseFirstUpdate;
  let firstUpdateStarted;
  const firstUpdateReady = new Promise((resolve) => { firstUpdateStarted = resolve; });
  const firstUpdate = new Promise((resolve) => { releaseFirstUpdate = resolve; });

  client.request = async (type, payload) => {
    requests.push({ type, payload });
    if (type === 'updateConfig' && requests.filter(({ type: kind }) => kind === 'updateConfig').length === 1) {
      firstUpdateStarted();
      await firstUpdate;
    }
    return { ok: true };
  };

  const initial = client.markConfigDirty();
  await firstUpdateReady;
  state.groups = [{ id: 'newest', name: 'Newest', domains: ['new.example'], enabled: true, schedule: null, limit: { minutes: 0 } }];
  client.markConfigDirty();
  releaseFirstUpdate();
  await initial;

  while (client.configSyncPending) {
    if (client.configSyncPromise) await client.configSyncPromise;
    else await Promise.resolve();
  }

  const updates = requests.filter(({ type: kind }) => kind === 'updateConfig');
  assert.equal(updates.length, 2);
  assert.equal(updates[1].payload.groups[0].id, 'newest');
});

test('a pending local edit is not overwritten by a stale bootstrap snapshot', async () => {
  const client = new WatchdogClient();
  client.configSyncPending = true;
  const localConfig = {
    groups: structuredClone(state.groups),
    lockMode: state.lockMode,
    privacyConsent: state.privacyConsent
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { ok: true, data: { groups: [] } }; }
  });

  try {
    await client.performRequest('bootstrap', {});
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(state.groups, localConfig.groups);
  assert.equal(state.lockMode, localConfig.lockMode);
  assert.equal(state.privacyConsent, localConfig.privacyConsent);
});

test('all affected open tabs are reloaded so policy changes take effect without manual refresh', async () => {
  tabState.tabs = [
    { id: 11, url: 'https://www.example.com/feed' },
    { id: 14, url: 'https://example.com/settings' },
    { id: 12, url: 'https://other.example.net/' },
    { id: 13, url: 'chrome://newtab/' }
  ];
  tabState.reloaded = [];
  const client = new WatchdogClient();

  await client.applySnapshot({
    groups: [],
    usage: {},
    lockMode: false,
    privacyConsent: true,
    blockedDomains: ['example.com']
  });

  assert.deepEqual(tabState.reloaded, [11, 14]);

  await client.applySnapshot({
    groups: [],
    usage: {},
    lockMode: false,
    privacyConsent: true,
    blockedDomains: ['example.com']
  });
  assert.deepEqual(tabState.reloaded, [11, 14]);
});

test('a restarted service worker reloads tabs for domains removed since its last stored snapshot', async () => {
  state.nativeStatus = { blockedDomains: ['chatgpt.com', 'claude.ai', 'x.com'] };
  tabState.tabs = [
    { id: 21, url: 'chrome-error://chromewebdata/', pendingUrl: 'https://chatgpt.com/' },
    { id: 22, url: 'https://claude.ai/new' },
    { id: 23, url: 'https://x.com/home' }
  ];
  tabState.reloaded = [];
  const client = new WatchdogClient();

  await client.applySnapshot({
    groups: [],
    usage: {},
    lockMode: false,
    privacyConsent: true,
    blockedDomains: ['x.com']
  });

  assert.deepEqual(tabState.reloaded, [21, 22]);
});

test('a malformed group in a snapshot does not take the connection down', async () => {
  const client = new WatchdogClient();
  state.groups = [{ id: 'kept', name: 'Kept', domains: ['example.com'], enabled: true, schedule: null, limit: { minutes: 0 } }];
  tabState.tabs = [];

  await client.applySnapshot({
    groups: [null, { id: 'live', name: 'Live', domains: ['live.example'], enabled: true, schedule: null, limit: null }],
    usage: {},
    lockMode: false,
    privacyConsent: true,
    blockedDomains: []
  });

  assert.deepEqual(state.groups.map(({ id }) => id), ['live']);
});

test('a watchdog that lost every zone is re-seeded instead of mirrored', async () => {
  const client = new WatchdogClient();
  const localGroups = [{ id: 'kept', name: 'Kept', domains: ['example.com'], enabled: true, schedule: null, limit: { minutes: 0 } }];
  state.groups = structuredClone(localGroups);
  tabState.tabs = [];

  await client.applySnapshot({
    groups: [null],
    usage: {},
    lockMode: true,
    privacyConsent: true,
    blockedDomains: []
  });

  assert.deepEqual(state.groups.map(({ id }) => id), ['kept']);
  assert.equal(client.configSyncPending, true);
  assert.equal(state.lockMode, true);
});

test('clearing the data still empties the local zones', async () => {
  const client = new WatchdogClient();
  state.groups = [{ id: 'kept', name: 'Kept', domains: ['example.com'], enabled: true, schedule: null, limit: null }];
  tabState.tabs = [];

  await client.applySnapshot({ groups: [], usage: {}, lockMode: false, privacyConsent: false, blockedDomains: [] }, { adoptEmptyGroups: true });

  assert.deepEqual(state.groups, []);
});

test('URL policy changes reload only matching pages, including pending navigation', async () => {
  const client = new WatchdogClient();
  client.lastObservedBlockedDomains = [];
  tabState.reloaded = [];
  tabState.tabs = [
    { id: 80, url: 'https://youtube.com/watch?v=ABC&extra=1' },
    { id: 81, url: 'https://youtube.com/watch?v=OTHER' },
    { id: 82, url: 'chrome-error://chromewebdata/', pendingUrl: 'https://youtube.com/watch?v=ABC' }
  ];
  await client.applySnapshot({ groups: state.groups, privacyConsent: true, blockedDomains: ['youtube.com/watch?v=ABC'] });
  assert.deepEqual(tabState.reloaded, [80, 82]);
});

test('heartbeats send URL details only for a matching configured URL rule', async () => {
  const client = new WatchdogClient();
  state.privacyConsent = true;
  state.groups = [{ id: 'url', domains: ['youtube.com/watch?v=ABC'] }];
  let payload;
  client.request = async (_type, value) => { payload = value; };
  tabState.tabs = [{ id: 1, url: 'https://youtube.com/watch?v=OTHER&private=value' }];
  await client.heartbeat();
  assert.equal(payload.url, '');
  tabState.tabs = [{ id: 1, url: 'https://youtube.com/watch?v=ABC#fragment' }];
  await client.heartbeat();
  assert.equal(payload.url, 'https://youtube.com/watch?v=ABC');
  state.groups = [{ id: 'fragment', domains: ['chatgpt.com/#settings/Personalization'] }];
  tabState.tabs = [{ id: 1, url: 'https://chatgpt.com/#settings/Personalization' }];
  await client.heartbeat();
  assert.equal(payload.url, 'https://chatgpt.com/#settings/Personalization');
  state.groups = [{ id: 'exception', domains: ['chatgpt.com'], exceptions: ['chatgpt.com/codex/cloud/settings/analytics'] }];
  tabState.tabs = [{ id: 1, url: 'https://chatgpt.com/codex/cloud/settings/analytics/team' }];
  await client.heartbeat();
  assert.equal(payload.url, 'https://chatgpt.com/codex/cloud/settings/analytics/team');
  state.privacyConsent = false;
  await client.heartbeat();
  assert.deepEqual(payload, { host: '', focused: false });
});

test('old watchdogs never receive URL configuration that they would broaden', async () => {
  const oldFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ data: requests.length === 1 ? { configured: true } : { configured: true, supportsUrlRules: true } }) };
  };
  try {
    const client = new WatchdogClient();
    await assert.rejects(client.performRequest('updateConfig', { groups: [{ domains: ['example.com/path'] }] }), /Update the Windows watchdog/);
    await assert.rejects(client.performRequest('updateConfig', { groups: [{ domains: ['example.com'], exceptions: ['example.com/free'] }] }), /always-allowed pages/);
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /health$/);
  } finally { globalThis.fetch = oldFetch; }
});

test('single-page navigation rechecks policy once without reloading unrelated routes', async () => {
  const client = new WatchdogClient();
  state.privacyConsent = true;
  state.nativeStatus = { blockedDomains: ['youtube.com/shorts/'] };
  tabState.tabs = [{ id: 90, url: 'https://youtube.com/shorts/ABC' }];
  tabState.reloaded = [];
  await client.checkNavigation(90, 'https://youtube.com/shorts/ABC');
  await client.checkNavigation(90, 'https://youtube.com/shorts/ABC');
  assert.deepEqual(tabState.reloaded, [90]);
  tabState.tabs[0].url = 'https://youtube.com/watch?v=OTHER';
  await client.checkNavigation(90, tabState.tabs[0].url);
  assert.deepEqual(tabState.reloaded, [90]);
  assert.equal(client.checkedNavigations.size, 0);
});

test('active fragment rules do not navigate or reload the tab', async () => {
  const client = new WatchdogClient();
  state.privacyConsent = true;
  state.nativeStatus = { blockedDomains: ['chatgpt.com/#settings/Personalization'] };
  tabState.tabs = [{ id: 91, url: 'https://chatgpt.com/#settings/Personalization' }];
  tabState.reloaded = [];

  await client.checkNavigation(91, tabState.tabs[0].url);

  assert.deepEqual(tabState.reloaded, []);
});
