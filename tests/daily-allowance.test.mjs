import test from 'node:test';
import assert from 'node:assert/strict';

import { isGroupActive, isWithinSchedule } from '../src/shared/schedule.js';
import { normalizeGroup, serializeGroup } from '../src/shared/storage.js';
import { todayKey } from '../src/shared/usage.js';

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

test('compatibility serialization preserves scheduled and permanent behavior', () => {
  const scheduled = serializeGroup({
    id: 'scheduled',
    enabled: true,
    schedule: { days: [6], start: 9 * 60, end: 17 * 60 },
    limit: null
  });
  const permanent = serializeGroup({
    id: 'permanent',
    enabled: true,
    schedule: null,
    limit: null
  });

  assert.equal(scheduled.mode, 'schedule');
  assert.equal(previousWorkerIsActive(scheduled), true);
  assert.equal(permanent.mode, 'permanent');
  assert.equal(previousWorkerIsActive(permanent), true);
});
