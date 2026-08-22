import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGroup } from '../src/shared/storage.js';
import { hasRules, isGroupActive, isTemporaryActive } from '../src/shared/schedule.js';

const NOW = new Date(2026, 7, 22, 12, 0).getTime();

test('legacy temporary blocks retain their expiry during normalization', () => {
  const expiresAt = NOW + 30 * 60_000;
  const group = normalizeGroup({
    id: 'legacy-temporary',
    enabled: true,
    mode: 'temporary',
    expiresAt,
    domains: ['example.com']
  });

  assert.equal('mode' in group, false);
  assert.equal(group.expiresAt, expiresAt);
  assert.equal(hasRules(group), true);
  assert.equal(isTemporaryActive(group, NOW), true);
  assert.equal(isGroupActive(group, NOW), true);
});

test('legacy temporary blocks open after their expiry', () => {
  const expiresAt = NOW - 1;
  const group = normalizeGroup({
    id: 'expired-temporary',
    enabled: true,
    mode: 'temporary',
    expiresAt,
    domains: ['example.com']
  });

  assert.equal(hasRules(group), true);
  assert.equal(isTemporaryActive(group, NOW), false);
  assert.equal(isGroupActive(group, NOW), false);
});

test('legacy permanent and scheduled groups keep their previous behavior', () => {
  const permanent = normalizeGroup({ id: 'permanent', enabled: true, mode: 'permanent' });
  const scheduled = normalizeGroup({
    id: 'scheduled',
    enabled: true,
    mode: 'schedule',
    schedule: { days: [6], start: 9 * 60, end: 17 * 60 }
  });

  assert.equal(isGroupActive(permanent, NOW), true);
  assert.equal(isGroupActive(scheduled, NOW), true);
});
