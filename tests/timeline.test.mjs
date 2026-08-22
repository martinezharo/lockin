import test from 'node:test';
import assert from 'node:assert/strict';

import {
  todayShutSegments,
  nextScheduleBoundary,
  nextEventFor,
  nextEvent,
  minutesIntoDay,
  MINUTES_PER_DAY
} from '../src/shared/timeline.js';
import { todayKey } from '../src/shared/usage.js';

// Tuesday 2026-08-25, 16:20 local. Tuesday matters: the weekday schedules
// below are meant to be inside their window at this moment.
const NOW = new Date(2026, 7, 25, 16, 20).getTime();
const WEEKDAYS = [1, 2, 3, 4, 5];

const zone = (over = {}) => ({
  id: 'z',
  name: 'Scroll pit',
  domains: ['x.com'],
  enabled: true,
  schedule: null,
  limit: null,
  ...over
});

const spentUsage = (id, minutes) => ({ [id]: { date: todayKey(NOW), ms: minutes * 60000 } });

/* ---------- segments ---------- */

test('a weekday window draws one band on a weekday', () => {
  const g = zone({ schedule: { days: WEEKDAYS, start: 9 * 60, end: 17 * 60 } });
  assert.deepEqual(todayShutSegments(g, NOW), [{ start: 540, end: 1020, kind: 'schedule' }]);
});

test('a weekday window draws nothing on a weekend', () => {
  const saturday = new Date(2026, 7, 29, 16, 20).getTime();
  const g = zone({ schedule: { days: WEEKDAYS, start: 9 * 60, end: 17 * 60 } });
  assert.deepEqual(todayShutSegments(g, saturday), []);
});

test('an overnight window draws a band at each end of the day', () => {
  const g = zone({ schedule: { days: [0, 1, 2, 3, 4, 5, 6], start: 22 * 60, end: 6 * 60 } });
  assert.deepEqual(todayShutSegments(g, NOW), [
    { start: 1320, end: MINUTES_PER_DAY, kind: 'schedule' },
    { start: 0, end: 360, kind: 'schedule' }
  ]);
});

test('a window whose start equals its end covers the whole day', () => {
  const g = zone({ schedule: { days: WEEKDAYS, start: 0, end: 0 } });
  assert.deepEqual(todayShutSegments(g, NOW), [{ start: 0, end: MINUTES_PER_DAY, kind: 'schedule' }]);
});

test('a spent allowance draws from now to midnight', () => {
  const g = zone({ id: 'spent', limit: { minutes: 30 } });
  const segments = todayShutSegments(g, NOW, spentUsage('spent', 30), null);
  assert.deepEqual(segments, [{ start: minutesIntoDay(NOW), end: MINUTES_PER_DAY, kind: 'spent' }]);
});

test('a disarmed zone draws nothing at all', () => {
  const g = zone({ enabled: false, schedule: { days: WEEKDAYS, start: 9 * 60, end: 17 * 60 } });
  assert.deepEqual(todayShutSegments(g, NOW), []);
});

/* ---------- boundaries ---------- */

test('the next boundary inside a window is the moment it ends', () => {
  const at = nextScheduleBoundary({ days: WEEKDAYS, start: 9 * 60, end: 17 * 60 }, NOW);
  assert.equal(at, new Date(2026, 7, 25, 17, 0).getTime());
});

test('the next boundary before a window is the moment it starts', () => {
  const morning = new Date(2026, 7, 25, 7, 0).getTime();
  const at = nextScheduleBoundary({ days: WEEKDAYS, start: 9 * 60, end: 17 * 60 }, morning);
  assert.equal(at, new Date(2026, 7, 25, 9, 0).getTime());
});

test('the next boundary after the last window of the week skips the weekend', () => {
  const fridayEvening = new Date(2026, 7, 28, 20, 0).getTime();
  const at = nextScheduleBoundary({ days: WEEKDAYS, start: 9 * 60, end: 17 * 60 }, fridayEvening);
  assert.equal(at, new Date(2026, 7, 31, 9, 0).getTime());
});

test('an overnight window that started yesterday ends this morning', () => {
  const earlyHours = new Date(2026, 7, 25, 2, 0).getTime();
  const at = nextScheduleBoundary({ days: [0, 1, 2, 3, 4, 5, 6], start: 22 * 60, end: 6 * 60 }, earlyHours);
  assert.equal(at, new Date(2026, 7, 25, 6, 0).getTime());
});

test('a schedule with no days has no boundary', () => {
  assert.equal(nextScheduleBoundary({ days: [], start: 0, end: 60 }, NOW), null);
});

/* ---------- events ---------- */

test('a zone shut by its schedule reports when it reopens', () => {
  const g = zone({ schedule: { days: WEEKDAYS, start: 9 * 60, end: 17 * 60 } });
  assert.deepEqual(nextEventFor(g, NOW), {
    at: new Date(2026, 7, 25, 17, 0).getTime(),
    kind: 'opens',
    reason: 'schedule'
  });
});

test('an open zone reports when its gates close', () => {
  const morning = new Date(2026, 7, 25, 7, 0).getTime();
  const g = zone({ schedule: { days: WEEKDAYS, start: 9 * 60, end: 17 * 60 } });
  assert.deepEqual(nextEventFor(g, morning), {
    at: new Date(2026, 7, 25, 9, 0).getTime(),
    kind: 'shuts',
    reason: 'schedule'
  });
});

test('a spent allowance reports midnight, even inside a schedule window', () => {
  const g = zone({ id: 'both', schedule: { days: WEEKDAYS, start: 9 * 60, end: 17 * 60 }, limit: { minutes: 30 } });
  assert.deepEqual(nextEventFor(g, NOW, spentUsage('both', 30), null), {
    at: new Date(2026, 7, 26).getTime(),
    kind: 'opens',
    reason: 'allowance'
  });
});

test('an unspent allowance with no schedule has nothing on the clock', () => {
  const g = zone({ limit: { minutes: 30 } });
  assert.equal(nextEventFor(g, NOW, {}, null), null);
});

test('a disarmed zone has no event', () => {
  const g = zone({ enabled: false, schedule: { days: WEEKDAYS, start: 9 * 60, end: 17 * 60 } });
  assert.equal(nextEventFor(g, NOW), null);
});

test('nextEvent picks the soonest across zones and names it', () => {
  const soon = zone({ id: 'soon', name: 'Scroll pit', schedule: { days: WEEKDAYS, start: 9 * 60, end: 17 * 60 } });
  const later = zone({ id: 'later', name: 'Video vortex', schedule: { days: WEEKDAYS, start: 9 * 60, end: 22 * 60 } });

  const event = nextEvent([later, soon], NOW);
  assert.equal(event.group.name, 'Scroll pit');
  assert.equal(event.at, new Date(2026, 7, 25, 17, 0).getTime());
});

test('nextEvent is null when nothing is on the clock', () => {
  assert.equal(nextEvent([zone({ limit: { minutes: 30 } })], NOW, {}, null), null);
});
