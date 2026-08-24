import test from 'node:test';
import assert from 'node:assert/strict';

import { isGroupActive, isWithinSchedule } from '../src/shared/schedule.js';
import { normalizeGroup, serializeGroup } from '../src/shared/storage.js';
import { todayKey, isAllowanceSpent, isPermanentLimit } from '../src/shared/usage.js';

const NOW = new Date(2026, 7, 22, 12, 0).getTime();

function previousWorkerIsActive(group) {
  if (!group.enabled) return false;
  if (group.mode === 'schedule') return isWithinSchedule(group.schedule, new Date(NOW));
  return true;
}

test('a limit-only group starts open in the current worker', () => {
  const group = normalizeGroup({
    id: 'allowance-only',
    enabled: true,
    schedule: null,
    limit: { minutes: 30 }
  });

  assert.equal(isGroupActive(group, NOW, {}, null), false);
});

test('a group without rules is inactive in the current worker', () => {
  const group = normalizeGroup({
    id: 'empty-rules',
    enabled: true,
    schedule: null,
    limit: null
  });

  assert.equal(isGroupActive(group, NOW, {}, null), false);
});

test('a limit-only group blocks after its allowance is spent', () => {
  const group = normalizeGroup({
    id: 'allowance-only',
    enabled: true,
    schedule: null,
    limit: { minutes: 30 }
  });
  const usage = {
    'allowance-only': { date: todayKey(NOW), ms: 30 * 60_000 }
  };

  assert.equal(isGroupActive(group, NOW, usage, null), true);
});

test('a limit-only group does not become permanent under the previous worker', () => {
  const stored = serializeGroup({
    id: 'allowance-only',
    enabled: true,
    schedule: null,
    limit: { minutes: 30 }
  });

  assert.equal(stored.mode, 'schedule');
  assert.equal(stored.schedule, null);
  assert.deepEqual(stored.limit, { minutes: 30 });
  assert.equal(previousWorkerIsActive(stored), false);

  const current = normalizeGroup(stored);
  assert.deepEqual(current.limit, { minutes: 30 });
  assert.equal(isGroupActive(current, NOW, {}, null), false);
});

test('compatibility serialization keeps empty legacy groups inactive', () => {
  const scheduled = serializeGroup({
    id: 'scheduled',
    enabled: true,
    schedule: { days: [6], start: 9 * 60, end: 17 * 60 },
    limit: null
  });
  const empty = serializeGroup({
    id: 'empty-rules',
    enabled: true,
    schedule: null,
    limit: null
  });

  assert.equal(scheduled.mode, 'schedule');
  assert.equal(previousWorkerIsActive(scheduled), true);
  assert.equal(empty.mode, 'schedule');
  assert.equal(previousWorkerIsActive(empty), false);
  assert.equal(isGroupActive(normalizeGroup(empty), NOW, {}, null), false);
});

test('a permanent allowance blocks from the first minute of the day', () => {
  const group = normalizeGroup({
    id: 'permanent',
    enabled: true,
    schedule: null,
    limit: { minutes: 0 }
  });

  assert.equal(isPermanentLimit(group.limit), true);
  assert.equal(isAllowanceSpent(group, {}, null, NOW), true);
  assert.equal(isGroupActive(group, NOW, {}, null), true);
});

test('a permanent allowance survives a save and stays inactive for the old worker', () => {
  const stored = serializeGroup({
    id: 'permanent',
    enabled: true,
    schedule: null,
    limit: { minutes: 0 }
  });

  assert.equal(stored.mode, 'schedule');
  assert.deepEqual(stored.limit, { minutes: 0 });
  assert.equal(previousWorkerIsActive(stored), false);
  assert.equal(isGroupActive(normalizeGroup(stored), NOW, {}, null), true);
});

test('an ordinary allowance is not permanent', () => {
  assert.equal(isPermanentLimit({ minutes: 30 }), false);
  assert.equal(isPermanentLimit(null), false);
});
