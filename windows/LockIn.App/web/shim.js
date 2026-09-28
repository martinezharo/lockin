// Lock In — the chrome.* shim for the Windows app.
//
// The dashboard, the popup and the edit challenge are the extension's own
// pages, unchanged. This script gives them the browser API surface they use
// (see tests/ui/chrome-mock.js) backed by the LockIn service on loopback:
//
//   - chrome.storage.local is the same mirror of the authoritative state the
//     extension's service worker keeps, persisted in the WebView2 profile.
//   - config edits are debounced and replayed exactly like the extension's
//     watchdog client, so an edit made while the service is restarting is not
//     lost.
//   - this shim never sends an extension heartbeat. The UIA sensor in the app
//     is a separate source, and fail-closed must keep seeing a missing
//     extension exactly as it always did.

(() => {
  const APP = globalThis.__LOCKIN_APP__ || {};
  const PORT = APP.port || 8765;
  const ENDPOINT = `http://127.0.0.1:${PORT}`;
  const POLL_MS = 2000;
  const OFFLINE_AFTER_MS = 10000;
  const CONFIG_KEYS = ['groups', 'lockMode', 'privacyConsent'];
  const STORAGE_KEY = 'lockin.storage';

  const listeners = [];
  const webview = () => globalThis.chrome?.webview;

  const memory = new Map();
  const localStore = {
    getItem(key) {
      try { return globalThis.localStorage?.getItem(key) ?? memory.get(key) ?? null; }
      catch { return memory.get(key) ?? null; }
    },
    setItem(key, value) {
      try { globalThis.localStorage?.setItem(key, value); } catch { /* private mode */ }
      memory.set(key, value);
    }
  };

  function loadState() {
    try {
      const raw = localStore.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  let state = loadState();
  let applyingSnapshot = false;
  let connected = false;
  let bootstrapped = false;
  let failingSince = 0;
  let configRevision = 0;
  let configSyncPending = false;
  let configSyncInFlight = false;
  let syncTimer = null;

  function persist() {
    try { localStore.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* full quota */ }
  }

  function selected(keys) {
    if (keys == null) return { ...state };
    if (typeof keys === 'string') return { [keys]: state[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, state[key]]));
    return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, state[key] ?? fallback]));
  }

  function emit(changes) {
    if (!changes || Object.keys(changes).length === 0) return;
    for (const listener of listeners) {
      try { listener(changes, 'local'); } catch { /* a page listener must not break the mirror */ }
    }
  }

  function write(values, { silent = false } = {}) {
    const changes = {};
    for (const [key, value] of Object.entries(values)) {
      if (JSON.stringify(state[key]) === JSON.stringify(value)) continue;
      changes[key] = { oldValue: state[key], newValue: value };
      state[key] = value;
    }
    if (Object.keys(changes).length > 0) {
      persist();
      if (!silent) emit(changes);
    }
    return changes;
  }

  async function post(type, payload = {}) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const response = await fetch(`${ENDPOINT}/api/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, requestId, payload }),
      cache: 'no-store'
    });
    const message = await response.json();
    if (!response.ok || message?.ok !== true) {
      throw new Error(message?.error || `The LockIn service returned HTTP ${response.status}.`);
    }
    return message.data;
  }

  function markConfigDirty() {
    configRevision += 1;
    configSyncPending = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void syncConfig(), 100);
  }

  async function syncConfig() {
    if (!connected || applyingSnapshot || configSyncInFlight) return;
    configSyncInFlight = true;
    const revision = configRevision;
    try {
      await post('updateConfig', {
        groups: state.groups || [],
        lockMode: state.lockMode === true,
        privacyConsent: state.privacyConsent === true
      });
      if (configRevision === revision) configSyncPending = false;
    } catch {
      // The service is away; the pending edit stays queued for the next poll.
    } finally {
      configSyncInFlight = false;
      if (configSyncPending && connected) void syncConfig();
    }
  }

  function isGroup(group) {
    return Boolean(group) && typeof group === 'object';
  }

  function nativeStatusOf(snapshot) {
    return {
      connected: true,
      supportsUrlRules: snapshot.supportsUrlRules === true,
      supportsExceptions: snapshot.supportsExceptions === true,
      supportsTimedDisarm: snapshot.supportsTimedDisarm === true,
      supportsAppZones: snapshot.supportsAppZones === true,
      configured: snapshot.configured === true,
      enforcementArmed: snapshot.enforcementArmed === true,
      failClosed: snapshot.failClosed === true,
      failClosedActive: snapshot.failClosedActive === true,
      firewallBlocked: snapshot.firewallBlocked === true,
      lastHeartbeatMs: snapshot.lastHeartbeatMs || 0,
      protectedWindowsAccount: snapshot.protectedWindowsAccount || '',
      protectedWindowsAccounts: snapshot.protectedWindowsAccounts || [],
      blockedDomains: snapshot.blockedDomains || [],
      allowedDomains: snapshot.allowedDomains || [],
      blockedApps: snapshot.blockedApps || [],
      enforcementReason: snapshot.enforcementReason || 'open',
      updatedAt: Date.now()
    };
  }

  async function applySnapshot(snapshot) {
    if (!snapshot) return;
    applyingSnapshot = true;
    try {
      const next = {
        groups: (snapshot.groups || []).filter(isGroup),
        usage: snapshot.usage || {},
        usageSession: snapshot.usageSession || null,
        lockMode: snapshot.lockMode === true,
        privacyConsent: snapshot.privacyConsent === true,
        nativeStatus: nativeStatusOf(snapshot)
      };
      // A service that answers with no zones at all is re-seeded from the local
      // copy instead of mirrored, exactly like the extension client does.
      if (next.groups.length === 0 && (state.groups || []).length > 0) {
        delete next.groups;
        configSyncPending = true;
      }
      const changed = {};
      for (const [key, value] of Object.entries(next)) {
        if (CONFIG_KEYS.includes(key) && configSyncPending) continue;
        if (JSON.stringify(state[key]) === JSON.stringify(value)) continue;
        changed[key] = value;
      }
      if (Object.keys(changed).length > 0) {
        write(changed, { silent: true });
        emit(changed);
      }
    } finally {
      applyingSnapshot = false;
    }
  }

  async function bootstrap() {
    const data = await post('bootstrap', {
      groups: state.groups || [],
      usage: state.usage || {},
      lockMode: state.lockMode === true,
      privacyConsent: state.privacyConsent === true
    });
    bootstrapped = true;
    await applySnapshot(data);
    if (configSyncPending) await syncConfig();
  }

  async function poll() {
    try {
      const response = await fetch(`${ENDPOINT}/health`, { cache: 'no-store' });
      const message = await response.json();
      if (!response.ok || message?.ok !== true) throw new Error(`HTTP ${response.status}`);
      connected = true;
      failingSince = 0;
      if (!bootstrapped) await bootstrap();
      await applySnapshot(message.data);
      if (configSyncPending) await syncConfig();
    } catch (error) {
      connected = false;
      bootstrapped = false;
      const now = Date.now();
      if (!failingSince) failingSince = now;
      if (now - failingSince >= OFFLINE_AFTER_MS) {
        write({
          nativeStatus: {
            connected: false,
            error: error?.message || String(error) || 'Lock In service disconnected.',
            updatedAt: now
          }
        });
      }
    }
  }

  const noopEvent = { addListener() {} };

  globalThis.chrome = {
    lockin: {
      app: true,
      version: APP.version || '',
      // The host and the tests can ask for a poll without waiting for the timer.
      refresh: () => poll()
    },
    storage: {
      local: {
        async get(keys) { return selected(keys); },
        async set(values) {
          const changes = write(values);
          if (!applyingSnapshot && Object.keys(changes).some((key) => CONFIG_KEYS.includes(key))) {
            markConfigDirty();
          }
        },
        async clear() {
          const changes = Object.fromEntries(Object.keys(state).map((key) => [key, { oldValue: state[key], newValue: undefined }]));
          state = {};
          persist();
          emit(changes);
        }
      },
      onChanged: {
        addListener(listener) { listeners.push(listener); },
        removeListener(listener) {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        }
      }
    },
    runtime: {
      getManifest() { return { version: APP.version || '0.0.0' }; },
      getURL(path) { return path; },
      async sendMessage(message) {
        try {
          if (message?.type === 'lockin-native-clear') {
            const data = await post('clearData', {});
            configSyncPending = false;
            return { ok: true, data };
          }
          if (message?.type === 'lockin-native-state') {
            const data = await post('getState', {});
            return { ok: true, data };
          }
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      },
      openOptionsPage() {
        try { webview()?.postMessage({ type: 'lockin-open-options' }); } catch { /* no host bridge */ }
      },
      onInstalled: noopEvent,
      onStartup: noopEvent
    },
    windows: {
      async getLastFocused() {
        const focused = typeof globalThis.document?.hasFocus === 'function' ? globalThis.document.hasFocus() : true;
        return { id: 1, focused };
      }
    },
    tabs: {
      async query() { return []; },
      async get() { return null; },
      async reload() {}
    },
    alarms: {
      create() {},
      onAlarm: noopEvent
    }
  };

  const timer = setInterval(() => void poll(), POLL_MS);
  if (typeof timer?.unref === 'function') timer.unref();
  void poll();
})();
