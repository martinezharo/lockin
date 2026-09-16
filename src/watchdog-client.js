// Loopback bridge between the MV3 service worker and the protected PowerShell
// watchdog. The watchdog remains the enforcement authority; the extension
// only mirrors state and nudges an already-open active tab to re-run policy.

import { Storage, isGroup, serializeGroup } from './shared/storage.js';
import { siteMatches, normalizeDomainInput } from './shared/domains.js';

const ENDPOINT = 'http://127.0.0.1:8765/api/request';
const HEARTBEAT_MS = 1000;
const REQUEST_TIMEOUT_MS = 4000;
const CONFIG_KEYS = new Set(['groups', 'lockMode', 'privacyConsent']);

function isFragmentRule(rule) {
  return String(rule || '').includes('#');
}

function hostOf(url) {
  if (!url || !/^https?:/i.test(url)) return '';
  try {
    return normalizeDomainInput(new URL(url).hostname);
  } catch {
    return '';
  }
}

async function focusedTab() {
  try {
    const win = await chrome.windows.getLastFocused();
    if (!win?.focused) return null;
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    return tab || null;
  } catch {
    return null;
  }
}

async function focusedPage() {
  if (!(await Storage.getPrivacyConsent())) return { host: '', focused: false };
  const tab = await focusedTab();
  const host = hostOf(tab?.url);
  const groups = await Storage.getGroups();
  // Only send a URL when a configured URL rule matches this page.
  const matchingUrlRules = groups.flatMap(g => g.domains)
    .filter(rule => /[/?# :]/.test(rule) && siteMatches(tab?.url, rule));
  let url = '';
  if (matchingUrlRules.length) {
    const page = new URL(tab.url);
    page.username = ''; page.password = '';
    if (!matchingUrlRules.some(isFragmentRule)) page.hash = '';
    url = page.href;
  }
  return { host, url, focused: Boolean(tab && host) };
}

async function reloadTabsForPolicyChange(domains) {
  const listedDomains = [...new Set(domains.filter((rule) => rule && !isFragmentRule(rule)))];
  if (!listedDomains.length || typeof chrome.tabs?.query !== 'function' || typeof chrome.tabs?.reload !== 'function') return;
  try {
    if (!(await Storage.getPrivacyConsent())) return;
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs
      .filter((tab) => typeof tab?.id === 'number' && [tab.url, tab.pendingUrl]
        .some((url) => listedDomains.some((domain) => siteMatches(url, domain))))
      .map((tab) => Promise.resolve(chrome.tabs.reload(tab.id)).catch(() => undefined)));
  } catch {
    // A browser-internal tab or tabs closed during the query are not a
    // watchdog failure; URLBlocklist still protects its next navigation.
  }
}

export class WatchdogClient {
  constructor() {
    this.connected = false;
    this.requestNumber = 0;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.connectPromise = null;
    this.configSyncPromise = null;
    this.heartbeatPromise = null;
    this.requestQueue = Promise.resolve();
    this.configRevision = 0;
    this.configSyncPending = false;
    this.lastObservedBlockedDomains = null;
    this.applyingSnapshot = false;
    this.started = false;
    this.checkedNavigations = new Map();
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.connect();
  }

  async connect() {
    if (this.connectPromise) return this.connectPromise;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connectPromise = this.finishConnect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async finishConnect() {
    try {
      const state = await chrome.storage.local.get(['usage', 'lockMode', 'privacyConsent']);
      await this.request('bootstrap', {
        groups: await Storage.getGroups(),
        usage: state.usage || {},
        lockMode: state.lockMode === true,
        privacyConsent: state.privacyConsent === true
      });
      this.connected = true;
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);

      // A storage change can arrive while the watchdog is offline. Bootstrap
      // intentionally does not overwrite an existing authoritative state, so
      // replay only a queued configuration once the connection is usable again.
      if (this.configSyncPending) await this.syncConfig();
      await this.heartbeat();
    } catch (error) {
      this.onDisconnect(error?.message || String(error));
    }
  }

  async heartbeat() {
    if (this.heartbeatPromise) return this.heartbeatPromise;
    this.heartbeatPromise = this.finishHeartbeat().finally(() => {
      this.heartbeatPromise = null;
    });
    return this.heartbeatPromise;
  }

  async finishHeartbeat() {
    try {
      await this.request('heartbeat', await focusedPage());
      this.connected = true;
      if (this.configSyncPending && !this.configSyncPromise) await this.syncConfig();
    } catch (error) {
      this.onDisconnect(error?.message || String(error));
    }
  }

  async syncConfig() {
    this.configSyncPending = true;
    if (!this.connected || this.applyingSnapshot) return;
    if (this.configSyncPromise) return this.configSyncPromise;

    const revision = this.configRevision;
    this.configSyncPromise = (async () => {
      const state = await chrome.storage.local.get(['lockMode', 'privacyConsent']);
      await this.request('updateConfig', {
        groups: await Storage.getGroups(),
        lockMode: state.lockMode === true,
        privacyConsent: state.privacyConsent === true
      });
      if (this.configRevision === revision) this.configSyncPending = false;
    })().catch((error) => {
      this.onDisconnect(error?.message || String(error));
    }).finally(() => {
      this.configSyncPromise = null;
      // If storage changed while the request was in flight, the listener may
      // have observed the old promise. Run the newer revision immediately.
      if (this.configSyncPending && this.connected) void this.syncConfig();
    });
    return this.configSyncPromise;
  }

  markConfigDirty() {
    this.configRevision += 1;
    this.configSyncPending = true;
    return this.syncConfig();
  }

  pulse() {
    return this.connected ? this.heartbeat() : this.connect();
  }

  async checkNavigation(tabId, url) {
    // History API navigation may not make a document request. Reload a matched
    // route once so managed-browser policy also applies inside single-page apps.
    if (!(await Storage.getPrivacyConsent())) return;
    const { nativeStatus } = await chrome.storage.local.get('nativeStatus');
    const matchingRule = (nativeStatus?.blockedDomains || []).find(rule => siteMatches(url, rule));
    const matches = Boolean(matchingRule);
    if (!matches) { this.checkedNavigations.delete(tabId); return; }
    if (this.checkedNavigations.get(tabId) === url) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || (tab.pendingUrl || tab.url) !== url) return;
    this.checkedNavigations.set(tabId, url);
    // Fragment routes never make a document request. The content script keeps
    // the URL and browser history intact while covering an active match.
    if (isFragmentRule(matchingRule)) return;
    await chrome.tabs.reload(tabId).catch(() => this.checkedNavigations.delete(tabId));
  }

  async clearData() {
    const data = await this.request('clearData', {});
    this.configSyncPending = false;
    return data;
  }

  async request(type, payload = {}) {
    const request = this.requestQueue.then(() => this.performRequest(type, payload));
    this.requestQueue = request.catch(() => undefined);
    return request;
  }

  async performRequest(type, payload = {}) {
    if (['bootstrap', 'updateConfig'].includes(type) && payload.groups?.some(g => g.domains.some(rule => /[/?# :]/.test(rule)))) {
      const health = await fetch('http://127.0.0.1:8765/health', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: 'no-store' });
      const status = await health.json();
      if (!health.ok || status.data?.supportsUrlRules !== true) throw new Error('Update the Windows watchdog before using URL rules.');
    }
    const requestId = `${Date.now()}-${++this.requestNumber}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, requestId, payload }),
        cache: 'no-store',
        signal: controller.signal
      });
      const message = await response.json();
      if (!response.ok || !message?.ok) throw new Error(message?.error || `Watchdog returned HTTP ${response.status}.`);
      // A local edit can be queued while the watchdog is offline or while a
      // request is in flight. Preserve those three local values until the
      // queued update has reached the watchdog, while still mirroring usage
      // and enforcement status from every successful response.
      const preserveConfig = this.configSyncPending;
      await this.applySnapshot(message.data, {
        preserveConfig,
        adoptEmptyGroups: type === 'clearData',
        reloadActiveTab: type !== 'bootstrap' || !preserveConfig
      });
      return message.data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async applySnapshot(snapshot, { preserveConfig = false, adoptEmptyGroups = false, reloadActiveTab = true } = {}) {
    if (!snapshot) return;
    this.applyingSnapshot = true;
    try {
      const next = {
        groups: (snapshot.groups || []).filter(isGroup).map(serializeGroup),
        usage: snapshot.usage || {},
        usageSession: snapshot.usageSession || null,
        lockMode: snapshot.lockMode === true,
        privacyConsent: snapshot.privacyConsent === true,
        nativeStatus: {
          connected: true,
          supportsUrlRules: snapshot.supportsUrlRules === true,
          configured: snapshot.configured === true,
          enforcementArmed: snapshot.enforcementArmed === true,
          failClosed: snapshot.failClosed === true,
          failClosedActive: snapshot.failClosedActive === true,
          firewallBlocked: snapshot.firewallBlocked === true,
          lastHeartbeatMs: snapshot.lastHeartbeatMs || 0,
          protectedWindowsAccount: snapshot.protectedWindowsAccount || '',
          protectedWindowsAccounts: snapshot.protectedWindowsAccounts || [],
          blockedDomains: snapshot.blockedDomains || [],
          enforcementReason: snapshot.enforcementReason || 'open',
          updatedAt: Date.now()
        }
      };
      const current = await chrome.storage.local.get(Object.keys(next));
      // A watchdog that answers with no zones at all — its state file lost them,
      // or a malformed entry was just dropped — is re-seeded from the local copy
      // instead of mirrored. Mirroring it would leave every zone unenforced.
      if (!adoptEmptyGroups && next.groups.length === 0 && (current.groups || []).length > 0) {
        delete next.groups;
        this.configSyncPending = true;
      }
      const previousBlockedDomains = new Set(
        this.lastObservedBlockedDomains ?? current.nativeStatus?.blockedDomains ?? []
      );
      const nextBlockedDomains = new Set(next.nativeStatus.blockedDomains);
      const changedPolicyDomains = [...new Set([...previousBlockedDomains, ...nextBlockedDomains])]
        .filter((domain) => previousBlockedDomains.has(domain) !== nextBlockedDomains.has(domain));
      const changed = Object.fromEntries(
        Object.entries(next).filter(([key, value]) =>
          (!preserveConfig || !CONFIG_KEYS.has(key)) && JSON.stringify(current[key]) !== JSON.stringify(value)
        )
      );
      if (Object.keys(changed).length) await chrome.storage.local.set(changed);
      this.lastObservedBlockedDomains = [...next.nativeStatus.blockedDomains];
      if (reloadActiveTab) await reloadTabsForPolicyChange(changedPolicyDomains);
    } finally {
      this.applyingSnapshot = false;
    }
  }

  onDisconnect(reason) {
    this.connected = false;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.writeDisconnectedStatus(reason || 'Lock In watchdog disconnected.');
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 5000);
    }
  }

  async writeDisconnectedStatus(error) {
    await chrome.storage.local.set({ nativeStatus: { connected: false, error, updatedAt: Date.now() } });
  }
}

export const watchdogClient = new WatchdogClient();
