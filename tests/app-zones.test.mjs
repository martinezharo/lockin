import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeGroup, serializeGroup, isGroup } from '../src/shared/storage.js';
import { normalizeAppInput, parseAppList } from '../src/shared/apps.js';

// App targets are an additive group field. An older extension must round-trip
// them untouched, and an older watchdog must never be handed configuration it
// would silently drop.

test('app targets round-trip through normalizeGroup and serializeGroup', () => {
  const group = {
    id: 'focus',
    name: 'Focus drains',
    domains: ['x.com'],
    apps: ['discord.exe', 'steam.exe'],
    enabled: true,
    schedule: null,
    limit: { minutes: 30 },
    mode: 'schedule'
  };
  const normalized = normalizeGroup(group);
  assert.deepEqual(normalized.apps, ['discord.exe', 'steam.exe']);
  const serialized = serializeGroup(group);
  assert.deepEqual(serialized.apps, ['discord.exe', 'steam.exe']);
  assert.equal(serialized.mode, 'schedule');
});

test('a group with only app targets is still a group', () => {
  assert.equal(isGroup({ id: 'a', apps: ['discord.exe'] }), true);
  const normalized = normalizeGroup({ id: 'a', name: 'App only', apps: ['discord.exe'], enabled: true });
  assert.deepEqual(normalized.domains ?? [], []);
  assert.deepEqual(normalized.apps, ['discord.exe']);
});

test('app inputs normalize to bare lowercase executable names', () => {
  assert.equal(normalizeAppInput('Discord.exe'), 'discord.exe');
  assert.equal(normalizeAppInput('C:\\Program Files\\Discord\\Discord.exe'), 'discord.exe');
  assert.equal(normalizeAppInput('steam'), 'steam.exe');
  assert.equal(normalizeAppInput('   '), '');
  assert.equal(normalizeAppInput('bad*name.exe'), '');
  assert.deepEqual(parseAppList('Discord.exe\nsteam, DISCORD.EXE'), ['discord.exe', 'steam.exe']);
  assert.throws(() => parseAppList('ok.exe\nbad*name.exe'));
});
