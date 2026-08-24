// Lock In — the only door to chrome.storage.local.
// Pages and the service worker all go through here, so the key names and
// their defaults are defined exactly once.

import { pruneUsage } from './usage.js';

/* Groups used to carry a `mode` of 'permanent' | 'schedule' (and, further
   back, 'temporary'). The current code reads independent `schedule` and
   `limit` rules and keeps a schedule marker for the older service worker.

   A limit-only group is serialized as `mode: 'schedule', schedule: null`.
   Empty rule sets are invalid in the current UI and also use the schedule
   marker when legacy data is rewritten, so an older worker does not interpret
   them as permanent containment. */
export function normalizeGroup(g) {
  const legacy = 'mode' in g;
  const { mode, expiresAt, ...rest } = g;
  return {
    ...rest,
    schedule: (legacy ? mode === 'schedule' && g.schedule : g.schedule) || null,
    limit: g.limit || null
  };
}

export function serializeGroup(g) {
  const normalized = normalizeGroup(g);
  return {
    ...normalized,
    mode: 'schedule'
  };
}

export const Storage = {
  async getPrivacyConsent() {
    const { privacyConsent = false } = await chrome.storage.local.get('privacyConsent');
    return privacyConsent === true;
  },
  async setPrivacyConsent(value) {
    await chrome.storage.local.set({ privacyConsent: value === true });
  },
  async getGroups() {
    const { groups = [] } = await chrome.storage.local.get('groups');
    return groups.map(normalizeGroup);
  },
  async saveGroups(groups) {
    await chrome.storage.local.set({ groups: groups.map(serializeGroup) });
  },
  async getLockMode() {
    const { lockMode = false } = await chrome.storage.local.get('lockMode');
    return lockMode;
  },
  async setLockMode(value) {
    await chrome.storage.local.set({ lockMode: value });
  },

  /* ---------- Daily allowance ----------
     `usage` is what has already been banked today, `usageSession` is the
     stretch of browsing still in progress. They are stored apart because the
     session is rewritten on every tab switch while usage only grows. */

  async getUsage() {
    const { usage = {} } = await chrome.storage.local.get('usage');
    return usage;
  },
  async saveUsage(usage) {
    await chrome.storage.local.set({ usage: pruneUsage(usage) });
  },
  async getUsageSession() {
    const { usageSession = null } = await chrome.storage.local.get('usageSession');
    return usageSession;
  },
  async setUsageSession(session) {
    await chrome.storage.local.set({ usageSession: session });
  },

  async clearAll() {
    await chrome.storage.local.clear();
  }
};
