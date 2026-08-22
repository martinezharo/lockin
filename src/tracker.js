// Lock In — the stopwatch behind daily allowances.
//
// Only one thing is ever being watched: the active tab of the focused window.
// When that tab sits on a site belonging to a group with an allowance, a
// session is opened; anything that could change which tab that is — switching
// tab, switching window, navigating, closing — closes the session and banks
// the elapsed time. A minute alarm plus a deadline alarm cover the case where
// nothing happens at all because the tiny mammal is simply reading.
//
// The service worker gets shut down between events, so no state is kept in
// module scope: the open session lives in storage and is recomputed from
// scratch every time.

import { Storage } from './shared/storage.js';
import { domainMatches, normalizeDomainInput } from './shared/domains.js';
import { isGroupActive, isInWindow } from './shared/schedule.js';
import { bankUsage, sessionElapsedMs, remainingMs } from './shared/usage.js';

const DEADLINE_ALARM = 'lockin-allowance-deadline';
const BLOCKED_PAGE = '/src/pages/blocked/blocked.html';

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
    if (!win || !win.focused) return null;
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    return tab || null;
  } catch {
    return null;
  }
}

function matchingGroups(groups, host) {
  if (!host) return [];
  return groups.filter((g) => (g.domains || []).some((d) => domainMatches(host, d)));
}

// A group's allowance only runs down while the group is watching but open:
// disarmed groups and groups already shut by their schedule do not tick, and
// neither does one whose allowance is already gone.
function tickingGroups(groups, host, usage, session, now) {
  return matchingGroups(groups, host).filter(
    (g) => g.enabled && g.limit && !isInWindow(g, now) && remainingMs(g, usage, session, now) > 0
  );
}

// Banks the open session and clears it. Returns true if anything was banked,
// which is the caller's cue that blocking state may have changed.
async function flush(now = Date.now()) {
  const session = await Storage.getUsageSession();
  if (!session) return false;

  await Storage.setUsageSession(null);
  const elapsed = sessionElapsedMs(session, now);
  if (elapsed <= 0 || !Array.isArray(session.groupIds) || session.groupIds.length === 0) return false;

  const usage = await Storage.getUsage();
  await Storage.saveUsage(bankUsage(usage, session.groupIds, elapsed, now));
  return true;
}

// Rules only redirect the *next* navigation, so a page that was already open
// when the allowance ran out would otherwise stay readable indefinitely.
async function evictTab(tab, host) {
  const target = chrome.runtime.getURL(`${BLOCKED_PAGE}?domain=${encodeURIComponent(host)}`);
  try {
    await chrome.tabs.update(tab.id, { url: target });
  } catch (err) {
    console.error('Lock In: could not close the gates on the open tab', err);
  }
}

async function scheduleDeadline(groups, host, usage, session, now) {
  await chrome.alarms.clear(DEADLINE_ALARM);
  const ticking = tickingGroups(groups, host, usage, session, now);
  if (ticking.length === 0) return;

  const soonest = Math.min(...ticking.map((g) => remainingMs(g, usage, session, now)));
  if (Number.isFinite(soonest)) chrome.alarms.create(DEADLINE_ALARM, { when: now + Math.max(soonest, 1000) });
}

// The whole cycle: bank what has happened, work out what is being used now,
// open a fresh session for it and arm the alarm that ends it.
async function runSync(onUsageBanked) {
  const now = Date.now();
  const banked = await flush(now);

  const [groups, usage, tab] = await Promise.all([Storage.getGroups(), Storage.getUsage(), focusedTab()]);
  const host = tab ? hostOf(tab.url) : '';

  const ticking = tickingGroups(groups, host, usage, null, now);
  await Storage.setUsageSession(ticking.length ? { groupIds: ticking.map((g) => g.id), startedAt: now } : null);
  await scheduleDeadline(groups, host, usage, null, now);

  if (banked && onUsageBanked) await onUsageBanked();

  // Anything matching the current tab that is blocking right now gets the tab
  // sent to the blocked page, whether it just ran out of allowance or the
  // schedule closed under it.
  if (tab && host && matchingGroups(groups, host).some((g) => isGroupActive(g, now, usage, null))) {
    await evictTab(tab, host);
  }
}

// Switching tab can easily fire two events at once (onActivated together with
// onUpdated), and two cycles reading the same open session before either
// clears it would bank the same minutes twice. Runs are queued instead.
let queue = Promise.resolve();

export function syncTracker(onUsageBanked) {
  queue = queue.then(() => runSync(onUsageBanked)).catch((err) => {
    console.error('Lock In: allowance sync failed', err);
  });
  return queue;
}

export function initTracker(onUsageBanked) {
  const sync = () => syncTracker(onUsageBanked);

  chrome.tabs.onActivated.addListener(sync);
  chrome.tabs.onRemoved.addListener(sync);
  chrome.windows.onFocusChanged.addListener(sync);
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    // Only a navigation can change which group a tab belongs to; the rest of
    // the update noise (title, favicon, loading state) is ignored.
    if (changeInfo.url) sync();
  });

  return sync;
}

export { DEADLINE_ALARM };
