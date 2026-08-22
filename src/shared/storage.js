// Lock In — the only door to chrome.storage.local.
// Pages and the service worker all go through here, so the key names and
// their defaults are defined exactly once.

import { pruneUsage } from './usage.js';

/* Groups used to carry a `mode` of 'permanent' | 'schedule' (and, further
   back, 'temporary'). They now carry two optional rules instead, and no mode:
   no schedule and no limit *is* the permanent case. Every read normalizes, so
   a stored group written by an older version is understood the same way it
   always was; the service worker writes the normalized shape back once on
   install so the old field does not linger forever. */
export function normalizeGroup(g) {
  const legacy = 'mode' in g;
  const { mode, expiresAt, ...rest } = g;
  return {
    ...rest,
    schedule: (legacy ? mode === 'schedule' && g.schedule : g.schedule) || null,
    limit: (legacy ? null : g.limit) || null
  };
}

export const Storage = {
  async getGroups() {
    const { groups = [] } = await chrome.storage.local.get('groups');
    return groups.map(normalizeGroup);
  },
  async saveGroups(groups) {
    await chrome.storage.local.set({ groups });
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
  }
};
