// Lock In — background service worker
// Owns declarativeNetRequest rule state, temporary-block expiry, and
// schedule (block-by-hours) transitions.

importScripts('common.js');

const ALARM_NAME = 'lockin-expiry-check';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  rebuildRules();
});

chrome.runtime.onStartup.addListener(() => {
  rebuildRules();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkExpiredGroups();
    // Temporary expiry above only rebuilds rules when it flips `enabled`.
    // Schedule windows open/close on their own without any storage change,
    // so rebuild on every tick to catch those transitions (~1 min latency).
    rebuildRules();
  }
});

// Any change to groups (from popup/options) triggers a fresh rule build.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.groups) {
    rebuildRules();
  }
});

async function checkExpiredGroups() {
  const { groups = [] } = await chrome.storage.local.get('groups');
  const now = Date.now();
  let changed = false;
  for (const g of groups) {
    if (g.enabled && g.mode === 'temporary' && g.expiresAt && g.expiresAt <= now) {
      g.enabled = false;
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.local.set({ groups });
  }
}

async function rebuildRules() {
  const { groups = [] } = await chrome.storage.local.get('groups');
  const now = Date.now();
  const activeDomains = new Set();

  for (const g of groups) {
    if (!isGroupActive(g, now)) continue;
    for (const raw of g.domains || []) {
      const d = normalizeDomainInput(raw);
      if (d) activeDomains.add(d);
    }
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  const addRules = Array.from(activeDomains).map((domain, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { extensionPath: `/blocked.html?domain=${encodeURIComponent(domain)}` }
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
