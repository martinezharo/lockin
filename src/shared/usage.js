// Lock In — daily allowance bookkeeping.
//
// Two shapes live here, both stored by storage.js and read by everything else:
//
//   usage   { [groupId]: { date: 'YYYY-MM-DD', ms } }   what is already banked
//   session { groupIds: [...], startedAt }              the stretch in progress
//
// The service worker can be shut down at any moment, so the in-progress
// session lives in storage rather than in a variable, and every reader adds it
// on top of the banked total. That is why nothing here touches storage itself:
// these are pure functions over whatever the caller just loaded.

const MINUTE_MS = 60000;

export function todayKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(now) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Yesterday's total is not deducted, it is simply not today's: a stale entry
// reads as zero and gets overwritten the next time anything is banked.
export function bankedMs(usage, groupId, now = Date.now()) {
  const entry = usage && usage[groupId];
  if (!entry || entry.date !== todayKey(now)) return 0;
  return entry.ms || 0;
}

// A session left running across midnight only counts from midnight on, so the
// first minutes of a new day never arrive pre-spent.
export function sessionElapsedMs(session, now = Date.now()) {
  if (!session || !session.startedAt) return 0;
  return Math.max(0, now - Math.max(session.startedAt, startOfDay(now)));
}

function sessionMsFor(session, groupId, now) {
  if (!session || !Array.isArray(session.groupIds) || !session.groupIds.includes(groupId)) return 0;
  return sessionElapsedMs(session, now);
}

export function usedMs(usage, session, groupId, now = Date.now()) {
  return bankedMs(usage, groupId, now) + sessionMsFor(session, groupId, now);
}

export function limitMs(limit) {
  return limit ? Math.max(0, limit.minutes) * MINUTE_MS : 0;
}

export function remainingMs(group, usage, session, now = Date.now()) {
  if (!group.limit) return Infinity;
  return Math.max(0, limitMs(group.limit) - usedMs(usage, session, group.id, now));
}

export function isAllowanceSpent(group, usage, session, now = Date.now()) {
  return Boolean(group.limit) && remainingMs(group, usage, session, now) <= 0;
}

// The "permanent" preset is an allowance of zero minutes: it is spent before
// the day starts and midnight hands back nothing, so the gates never open on
// their own. Readers use it to say "permanent" where they would otherwise say
// "spent · back at midnight".
export function isPermanentLimit(limit) {
  return Boolean(limit) && limitMs(limit) <= 0;
}

// Returns a fresh usage map with `ms` added to each group's total for today.
export function bankUsage(usage, groupIds, ms, now = Date.now()) {
  if (!groupIds || groupIds.length === 0 || ms <= 0) return usage || {};
  const date = todayKey(now);
  const next = { ...(usage || {}) };
  for (const id of groupIds) {
    const current = next[id] && next[id].date === date ? next[id].ms || 0 : 0;
    next[id] = { date, ms: current + ms };
  }
  return next;
}

// Drops entries from previous days so the map does not grow forever.
export function pruneUsage(usage, now = Date.now()) {
  const date = todayKey(now);
  return Object.fromEntries(Object.entries(usage || {}).filter(([, entry]) => entry && entry.date === date));
}

/* ---------- Text ---------- */

// Rounds up while any part of a minute is left, so a live counter never shows
// "0m left" on a group that is still open.
export function formatDuration(ms) {
  const totalMinutes = Math.ceil(Math.max(0, ms) / MINUTE_MS);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
