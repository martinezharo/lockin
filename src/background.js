// Lock In — background service worker.
// Owns declarativeNetRequest rule state and schedule (block-by-hours)
// transitions.

import { Storage } from './shared/storage.js';
import { normalizeDomainInput } from './shared/domains.js';
import { isGroupActive } from './shared/schedule.js';

const ALARM_NAME = 'lockin-schedule-tick';
const BLOCKED_PAGE = '/src/pages/blocked/blocked.html';

// Schedule windows open and close on their own without any storage change, so
// a periodic tick is the only thing that catches those transitions (~1 min
// latency). Re-created on startup too, in case the alarm was ever lost.
async function ensureAlarm() {
  // Drop alarms from older versions (this one used to be 'lockin-expiry-check')
  // so a renamed tick can't leave a stale one firing forever.
  await chrome.alarms.clearAll();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await migrateTemporaryGroups();
  rebuildRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  rebuildRules();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) rebuildRules();
});

// Any change to groups (from popup/options) triggers a fresh rule build.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.groups) rebuildRules();
});

// Temporary blocks were removed; any group still stored with that mode
// becomes a permanent one so it keeps blocking instead of silently
// falling through.
async function migrateTemporaryGroups() {
  const groups = await Storage.getGroups();
  let changed = false;
  for (const g of groups) {
    if (g.mode === 'temporary') {
      g.mode = 'permanent';
      g.expiresAt = null;
      changed = true;
    }
  }
  if (changed) await Storage.saveGroups(groups);
}

async function rebuildRules() {
  const groups = await Storage.getGroups();
  const now = Date.now();
  const activeDomains = new Set();

  for (const g of groups) {
    if (!isGroupActive(g, now)) continue;
    for (const raw of g.domains || []) {
      const d = normalizeDomainInput(raw);
      if (d) activeDomains.add(d);
    }
  }

  // Every build replaces the whole set, so the ids currently installed are
  // exactly what needs clearing first.
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  const addRules = Array.from(activeDomains).map((domain, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { extensionPath: `${BLOCKED_PAGE}?domain=${encodeURIComponent(domain)}` }
    },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ['main_frame']
    }
  }));

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (err) {
    // If a malformed domain slips through, drop rules one at a time to isolate it
    // rather than leaving the whole rule set unapplied.
    console.error('Lock In: rule update failed, retrying individually', err);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
    for (const rule of addRules) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] });
      } catch (innerErr) {
        console.error('Lock In: skipping bad domain rule', rule, innerErr);
      }
    }
  }
}
