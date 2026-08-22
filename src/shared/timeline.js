// Lock In — turning containment rules into the two things the redesigned
// dashboard draws: today's shut hours as bands on a 24-hour strip, and the
// next moment anything actually changes.
//
// Everything here is derived from data the extension already keeps — a group's
// schedule and limit, the banked usage and the live session. Nothing is stored
// on their behalf, so a strip and a countdown cost a computation, not a key.
//
// Like usage.js these are pure functions over whatever the caller just loaded.

import { isWithinSchedule, hasRules } from './schedule.js';
import { isAllowanceSpent } from './usage.js';

export const MINUTES_PER_DAY = 1440;

// Built from local date parts rather than millisecond arithmetic so the days
// either side of a DST change are still 00:00 to 00:00.
export function startOfDay(now = Date.now()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function addDays(ts, days) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

export function minutesIntoDay(now = Date.now()) {
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes();
}

export function formatClock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- The day strip ----------
   A segment is a stretch of today, in minutes since midnight, during which a
   group's gates are shut. A group can produce two: an overnight schedule
   leaves one at each end of the day, and a spent allowance adds one running
   from now to midnight.

   A spent allowance starts at *now* rather than at the moment it ran out
   because that moment is not recorded anywhere — usage.js banks totals, not
   timestamps. Drawing from now is the honest version of what is known. */

export function todayShutSegments(group, now = Date.now(), usage = null, session = null) {
  const segments = [];
  if (!group.enabled || !hasRules(group)) return segments;

  const schedule = group.schedule;
  if (schedule && Array.isArray(schedule.days) && schedule.days.length > 0) {
    const { days, start = 0, end = 0 } = schedule;
    const today = new Date(now).getDay();
    const yesterday = (today + 6) % 7;

    if (start === end) {
      if (days.includes(today)) segments.push({ start: 0, end: MINUTES_PER_DAY, kind: 'schedule' });
    } else if (start < end) {
      if (days.includes(today)) segments.push({ start, end, kind: 'schedule' });
    } else {
      // Overnight: the tail of a window that opened today, plus the head of
      // the one that opened yesterday.
      if (days.includes(today)) segments.push({ start, end: MINUTES_PER_DAY, kind: 'schedule' });
      if (days.includes(yesterday)) segments.push({ start: 0, end, kind: 'schedule' });
    }
  }

  if (isAllowanceSpent(group, usage, session, now)) {
    segments.push({ start: minutesIntoDay(now), end: MINUTES_PER_DAY, kind: 'spent' });
  }

  return segments;
}

/* ---------- The next thing that happens ----------
   Schedule windows open and close without anything being written down, so the
   only way to name the next transition is to generate the boundaries and pick
   the first one still ahead. Nine days of candidates covers every day of the
   week plus the overnight window that started yesterday. */

export function nextScheduleBoundary(schedule, now = Date.now()) {
  if (!schedule || !Array.isArray(schedule.days) || schedule.days.length === 0) return null;
  const { days, start = 0, end = 0 } = schedule;
  let best = null;

  for (let offset = -1; offset <= 7; offset++) {
    const dayStart = addDays(startOfDay(now), offset);
    if (!days.includes(new Date(dayStart).getDay())) continue;

    const opens = start === end ? dayStart : dayStart + start * 60000;
    const closes =
      start === end ? addDays(dayStart, 1)
      : start < end ? dayStart + end * 60000
      : addDays(dayStart, 1) + end * 60000;

    for (const boundary of [opens, closes]) {
      if (boundary > now && (best === null || boundary < best)) best = boundary;
    }
  }

  return best;
}

// { at, kind: 'opens' | 'shuts', reason: 'schedule' | 'allowance' } or null when
// nothing is scheduled to change — a group held open only by an unspent
// allowance has no clock to watch, just a tiny mammal to watch.
export function nextEventFor(group, now = Date.now(), usage = null, session = null) {
  if (!group.enabled || !hasRules(group)) return null;

  // A spent allowance outranks the schedule: even when the window ends first,
  // the group stays shut until the allowance resets at midnight.
  if (isAllowanceSpent(group, usage, session, now)) {
    return { at: addDays(startOfDay(now), 1), kind: 'opens', reason: 'allowance' };
  }

  const boundary = group.schedule ? nextScheduleBoundary(group.schedule, now) : null;
  if (boundary === null) return null;

  return {
    at: boundary,
    // A second past the boundary is inside the window exactly when the
    // boundary was a closing one.
    kind: isWithinSchedule(group.schedule, new Date(boundary + 1000)) ? 'shuts' : 'opens',
    reason: 'schedule'
  };
}

// The soonest event across every group: { group, at, kind, reason } or null.
export function nextEvent(groups, now = Date.now(), usage = null, session = null) {
  let best = null;
  for (const group of groups) {
    const event = nextEventFor(group, now, usage, session);
    if (event && (best === null || event.at < best.at)) best = { group, ...event };
  }
  return best;
}
