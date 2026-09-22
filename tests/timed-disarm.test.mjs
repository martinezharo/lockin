import test from 'node:test';
import assert from 'node:assert/strict';

import { isArmed, rearmAt, isGroupActive } from '../src/shared/schedule.js';
import { normalizeGroup, serializeGroup } from '../src/shared/storage.js';
import { nextEventFor, todayShutSegments, eventVerb } from '../src/shared/timeline.js';
import { zoneStatusText, zoneStateClass, readDisarm } from '../src/pages/options/templates.js';

const NOW = new Date('2026-09-22T12:00:00').getTime();
const MINUTE = 60000;

// Contained around the clock when armed, so anything open is the release.
const zone = (extra) => ({
  id: 'scroll',
  name: 'Scroll pit',
  domains: ['x.com'],
  exceptions: [],
  enabled: true,
  schedule: null,
  limit: { minutes: 0 },
  createdAt: 1,
  ...extra
});

const released = (minutes) => zone({ enabled: false, disarmedUntil: NOW + minutes * MINUTE });
const disarmed = zone({ enabled: false, disarmedUntil: null });

test('a release with a length holds only until its own moment', () => {
  const g = released(15);

  assert.equal(isArmed(g, NOW), false);
  assert.equal(rearmAt(g, NOW), NOW + 15 * MINUTE);
  assert.equal(isGroupActive(g, NOW), false);

  const later = NOW + 15 * MINUTE;
  assert.equal(isArmed(g, later), true);
  assert.equal(rearmAt(g, later), null);
  assert.equal(isGroupActive(g, later), true);
});

test('an open-ended release still has no moment to count down to', () => {
  assert.equal(isArmed(disarmed, NOW), false);
  assert.equal(rearmAt(disarmed, NOW), null);
  assert.equal(isArmed(disarmed, NOW + 10 * 24 * 60 * MINUTE), false);
});

test('an armed zone is never counting down', () => {
  // A leftover deadline on an armed zone is history, not a promise.
  const g = zone({ disarmedUntil: NOW + 30 * MINUTE });
  assert.equal(rearmAt(g, NOW), null);
  assert.equal(isArmed(g, NOW), true);
});

test('storage expires a release that ran out while nothing was looking', () => {
  const stale = { ...released(-5), mode: 'schedule' };

  const normalized = normalizeGroup(stale, NOW);
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.disarmedUntil, null);

  // And the expiry survives the trip back into storage, so the watchdog is
  // told about it rather than being left to disagree. serializeGroup reads the
  // real clock, so this half of the check uses a deadline that is in the past
  // wherever and whenever the suite runs.
  assert.equal(serializeGroup(zone({ enabled: false, disarmedUntil: Date.now() - MINUTE })).enabled, true);
});

test('storage keeps a release that is still running', () => {
  const normalized = normalizeGroup({ ...released(20), mode: 'schedule' }, NOW);
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.disarmedUntil, NOW + 20 * MINUTE);
});

test('a junk deadline is not a release', () => {
  assert.equal(normalizeGroup({ ...zone(), enabled: false, disarmedUntil: 'soon' }, NOW).disarmedUntil, null);
  assert.equal(normalizeGroup({ ...zone(), enabled: false, disarmedUntil: -1 }, NOW).disarmedUntil, null);
});

test('the moment containment returns is the next thing that happens', () => {
  const event = nextEventFor(released(15), NOW);

  assert.deepEqual(event, { at: NOW + 15 * MINUTE, kind: 'rearms', reason: 'disarm' });
  assert.equal(eventVerb(event.kind), 're-arms');
  // A zone that has to be armed by hand promises nothing, so it says nothing.
  assert.equal(nextEventFor(disarmed, NOW), null);
});

test('a released zone draws no shut hours until it is armed again', () => {
  const scheduled = { days: [0, 1, 2, 3, 4, 5, 6], windows: [{ start: 9 * 60, end: 17 * 60 }] };

  const scheduledZone = (extra) => zone({ schedule: scheduled, limit: null, enabled: false, ...extra });

  assert.deepEqual(todayShutSegments(scheduledZone({ disarmedUntil: NOW + 15 * MINUTE }), NOW), []);
  assert.deepEqual(todayShutSegments(scheduledZone({ disarmedUntil: NOW - MINUTE }), NOW), [
    { start: 9 * 60, end: 17 * 60, kind: 'schedule' }
  ]);
});

test('a row says how much of its release is left', () => {
  assert.match(zoneStatusText(released(15), NOW), /released · containment returns in 15m/);
  assert.equal(zoneStateClass(released(15), NOW), 'off');

  assert.match(zoneStatusText(disarmed, NOW), /tiny mammal roaming free/);
  // Once the release runs out the row speaks for the rules again.
  assert.match(zoneStatusText(released(-1), NOW), /permanent allowance of nothing/);
  assert.equal(zoneStateClass(released(-1), NOW), 'spent');
});

/* readDisarm reads the picker back out of the DOM, so it gets the smallest
   stand-in that answers the four questions it asks. */
function picker(mode, value) {
  const error = { textContent: '', hidden: true };
  const minutes = { value };
  return {
    dataset: { disarmMode: mode },
    querySelector(selector) {
      return selector === '[data-disarm-error]' ? error : minutes;
    },
    error
  };
}

test('the picker reads back a length, or a release with no end', () => {
  assert.deepEqual(readDisarm(picker('timed', '45')), { minutes: 45 });
  assert.deepEqual(readDisarm(picker('forever', '45')), { minutes: null });
  assert.deepEqual(readDisarm(picker('timed', ' 90 ')), { minutes: 90 });
});

test('the picker refuses a length a release cannot have', () => {
  for (const value of ['', '0', '-5', 'soon', '1441']) {
    const root = picker('timed', value);
    assert.equal(readDisarm(root), null, `${value} is not a release`);
    assert.equal(root.error.hidden, false);
  }
});
