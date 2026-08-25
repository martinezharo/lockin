// Loopback bridge between the MV3 service worker and the protected PowerShell
// watchdog. The extension remains only a sensor and UI.

import { Storage, serializeGroup } from './shared/storage.js';
import { normalizeDomainInput } from './shared/domains.js';

const ENDPOINT = 'http://127.0.0.1:8765/api/request';
const HEARTBEAT_MS = 5000;
const REQUEST_TIMEOUT_MS = 4000;

function hostOf(url) {
  if (!url || !/^https?:/i.test(url)) return '';
  try {
    return normalizeDomainInput(new URL(url).hostname);
  } catch {
    return '';
  }
}

async function focusedPage() {
  if (!(await Storage.getPrivacyConsent())) return { host: '', focused: false };
  try {
    const win = await chrome.windows.getLastFocused();
    if (!win?.focused) return { host: '', focused: false };
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    const host = hostOf(tab?.url);
    return { host, focused: Boolean(tab && host) };
  } catch {
    return { host: '', focused: false };
  }
}

class WatchdogClient {
  constructor() {
    this.connected = false;
    this.requestNumber = 0;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.applyingSnapshot = false;
    this.started = false;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.connect();
  }

  async connect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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
      await this.heartbeat();
    } catch (error) {
      this.onDisconnect(error?.message || String(error));
    }
  }

  async heartbeat() {
    try {
      await this.request('heartbeat', await focusedPage());
      this.connected = true;
    } catch (error) {
      this.onDisconnect(error?.message || String(error));
    }
  }

  async syncConfig() {
    if (!this.connected || this.applyingSnapshot) return;
    const state = await chrome.storage.local.get(['lockMode', 'privacyConsent']);
    try {
      await this.request('updateConfig', {
        groups: await Storage.getGroups(),
        lockMode: state.lockMode === true,
        privacyConsent: state.privacyConsent === true
      });
    } catch (error) {
      this.onDisconnect(error?.message || String(error));
    }
  }

  async clearData() {
    return this.request('clearData', {});
  }

  async request(type, payload = {}) {
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
      await this.applySnapshot(message.data);
      return message.data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async applySnapshot(snapshot) {
    if (!snapshot) return;
    this.applyingSnapshot = true;
    try {
      const next = {
        groups: (snapshot.groups || []).map(serializeGroup),
        usage: snapshot.usage || {},
        usageSession: snapshot.usageSession || null,
        lockMode: snapshot.lockMode === true,
        privacyConsent: snapshot.privacyConsent === true,
        nativeStatus: {
          connected: true,
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
      const changed = Object.fromEntries(
        Object.entries(next).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value))
      );
      if (Object.keys(changed).length) await chrome.storage.local.set(changed);
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
