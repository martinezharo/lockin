// Lock In — containment rules and whether a group is blocking right now.
//
// A group carries two independent, optional rules:
//
//   schedule  { days: [1,2,3,4,5], start: 540, end: 1020 }  -- when it is shut
//   limit     { minutes: 30 }                               -- how long it may
//                                                              be used while open
//
// `days` uses JS getDay() numbering (0 = Sunday .. 6 = Saturday).
// `start`/`end` are minutes since local midnight. `start > end` means the
// window crosses midnight (e.g. 22:00 -> 06:00), anchored to the start day.
//
// Neither rule set is the strictest state, not the loosest: a group with no
// rules at all is contained around the clock. That is the old "permanent"
// mode, expressed as the absence of anything rather than as a mode of its own.

import { isAllowanceSpent, formatAllowance } from './usage.js';

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

export function isWithinSchedule(schedule, now = new Date()) {
  if (!schedule || !Array.isArray(schedule.days) || schedule.days.length === 0) return false;
  const { days, start = 0, end = 0 } = schedule;
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();

  if (start === end) {
    // Same start/end = block all day on the selected days.
    return days.includes(day);
  }
  if (start < end) {
    return days.includes(day) && minutes >= start && minutes < end;
  }
  // Overnight window (e.g. 22:00 -> 06:00), anchored to the day it starts on.
  const prevDay = (day + 6) % 7;
  return (days.includes(day) && minutes >= start) || (days.includes(prevDay) && minutes < end);
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
  if (!hasRules(g)) return true;
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
  const range =
    schedule.start === schedule.end
      ? 'all day'
      : `${formatMinutes(schedule.start)}–${formatMinutes(schedule.end)}`;
  return `${formatScheduleDays(schedule.days)} · ${range}`;
}

// The whole rule set in one line: "weekdays · 9:00 AM–5:00 PM · 30m/day".
export function formatRules(g) {
  const parts = [];
  if (g.schedule) parts.push(formatSchedule(g.schedule));
  if (g.limit) parts.push(formatAllowance(g.limit));
  return parts.join(' · ');
}
