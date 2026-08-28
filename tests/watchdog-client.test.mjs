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
    async reload(tabId) { tabState.reloaded.push(tabId); }
  }
};

const { WatchdogClient } = await import('../src/watchdog-client.js');

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
