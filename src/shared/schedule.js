// Lock In — containment rules and whether a group is blocking right now.
//
// A group carries two independent, optional rules:
//
//   schedule  { days: [1,2,3,4,5], windows: [{ start: 540, end: 1020 }] }
//                                                               -- when it is shut
//   limit     { minutes: 30 }                               -- how long it may
//                                                              be used while open
//
// `days` uses JS getDay() numbering (0 = Sunday .. 6 = Saturday).
// Window `start`/`end` values are minutes since local midnight. `start > end`
// means that window crosses midnight (e.g. 22:00 -> 06:00), anchored to the
// start day. Legacy schedules with top-level start/end are still accepted.
//
// Both rules are optional, but a group without either one is invalid and must
// not be active. The dashboard rejects empty rule sets before saving them;
// this guard also keeps malformed or legacy data from blocking sites.

import { isAllowanceSpent } from './usage.js';

// The one list of weekdays, in the Monday-first order the UI shows them.
// Everything that renders day pills or formats a schedule reads it from here.
export const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' }
];

const LABEL_BY_DAY = Object.fromEntries(DAYS.map((d) => [d.value, d.label]));

export function scheduleWindows(schedule) {
  if (!schedule) return [];
  if (Array.isArray(schedule.windows) && schedule.windows.length > 0) {
    return schedule.windows.map(({ start = 0, end = 0 }) => ({ start, end }));
  }
  if ('start' in schedule || 'end' in schedule) {
    return [{ start: schedule.start ?? 0, end: schedule.end ?? 0 }];
  }
  return [];
}

function isWithinWindow(days, { start = 0, end = 0 }, day, minutes) {
  if (start === end) return days.includes(day);
  if (start < end) return days.includes(day) && minutes >= start && minutes < end;
  const prevDay = (day + 6) % 7;
  return (days.includes(day) && minutes >= start) || (days.includes(prevDay) && minutes < end);
}

export function isWithinSchedule(schedule, now = new Date()) {
  if (!schedule || !Array.isArray(schedule.days) || schedule.days.length === 0) return false;
  const { days } = schedule;
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return scheduleWindows(schedule).some((window) => isWithinWindow(days, window, day, minutes));
}

export function isInWindow(g, now = Date.now()) {
  return Boolean(g.schedule) && isWithinSchedule(g.schedule, new Date(now));
}

export function hasRules(g) {
  return Boolean(g.schedule || g.limit);
}

// `usage` and `session` are only consulted for groups that carry a limit, so
// callers with no interest in allowances can keep leaving them out.
export function isGroupActive(g, now = Date.now(), usage = null, session = null) {
  if (!g.enabled) return false;
  if (!hasRules(g)) return false;
  if (isInWindow(g, now)) return true;
  return isAllowanceSpent(g, usage, session, now);
}

/* ---------- Minutes <-> text ----------
   Two directions, two audiences: `formatMinutes` is for people reading a
   schedule ("9:00 AM"), `minutesToTimeValue`/`timeValueToMinutes` are for the
   24h strings an <input type="time"> hands back. Keeping them apart stops one
   from being pressed into the other's job. */

export function formatMinutes(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function minutesToTimeValue(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function timeValueToMinutes(str) {
  const [h, m] = String(str || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/* ---------- Human-readable summaries ---------- */

export function formatScheduleDays(days) {
  if (!days || days.length === 0) return 'no days';
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 7) return 'every day';
  if (sorted.join(',') === '1,2,3,4,5') return 'weekdays';
  if (sorted.join(',') === '0,6') return 'weekends';
  return sorted.map((d) => LABEL_BY_DAY[d]).join(', ');
}

export function formatSchedule(schedule) {
  if (!schedule) return '';
  const ranges = scheduleWindows(schedule).map((window) =>
    window.start === window.end
      ? 'all day'
      : `${formatMinutes(window.start)}–${formatMinutes(window.end)}`
  );
  return `${formatScheduleDays(schedule.days)} · ${ranges.join(', ')}`;
}
