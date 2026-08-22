// Lock In — background service worker.
// Owns declarativeNetRequest rule state, schedule (block-by-hours)
// transitions, and the alarms that drive daily allowances.

import { Storage } from './shared/storage.js';
import { normalizeDomainInput } from './shared/domains.js';
import { isGroupActive } from './shared/schedule.js';
import { initTracker, syncTracker, DEADLINE_ALARM } from './tracker.js';

const ALARM_NAME = 'lockin-schedule-tick';
const BLOCKED_PAGE = '/src/pages/blocked/blocked.html';

// Schedule windows open and close on their own without any storage change, so
// a periodic tick is the only thing that catches those transitions (~1 min
// latency). It doubles as the safety net for allowances: the deadline alarm
// aims at the exact second one runs out, and this catches whatever it misses.
// Re-created on startup too, in case the alarm was ever lost.
async function ensureAlarm() {
  // Drop alarms from older versions (this one used to be 'lockin-expiry-check')
  // so a renamed tick can't leave a stale one firing forever.
  await chrome.alarms.clearAll();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

// The tracker settles what has been used, the rule build acts on it. Both run
// on every wake-up: alarms, startup, and any change to the groups.
async function refresh() {
  await syncTracker();
  await rebuildRules();
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await migrateGroups();
  refresh();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  refresh();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME || alarm.name === DEADLINE_ALARM) refresh();
});

// Any change to groups (from popup/options) triggers a fresh rule build — and
// a re-sync, since adding or lifting an allowance changes what is being timed.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.groups) refresh();
});

initTracker(rebuildRules);

// Reading a group already migrates it in memory (see storage.js); this writes
// that shape back once, so the retired `mode`/`expiresAt` fields stop being
// carried around by groups created before rules became independent.
async function migrateGroups() {
  const { groups: stored = [] } = await chrome.storage.local.get('groups');
  const groups = await Storage.getGroups();
  if (stored.some((g) => 'mode' in g || 'expiresAt' in g)) await Storage.saveGroups(groups);
}

async function rebuildRules() {
  const [groups, usage, session] = await Promise.all([
    Storage.getGroups(),
    Storage.getUsage(),
    Storage.getUsageSession()
  ]);
  const now = Date.now();
  const activeDomains = new Set();

  for (const g of groups) {
    if (!isGroupActive(g, now, usage, session)) continue;
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
