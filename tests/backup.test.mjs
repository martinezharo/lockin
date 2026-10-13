import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBackup, backupFileName, readBackup, BACKUP_KIND, BACKUP_VERSION } from '../src/shared/backup.js';

const zone = (extra) => ({
  id: 'scroll1',
  name: 'Scroll pit',
  domains: ['x.com'],
  apps: [],
  exceptions: [],
  enabled: true,
  schedule: null,
  limit: { minutes: 45 },
  createdAt: 1,
  ...extra
});

const exportThenImport = (groups) => readBackup(JSON.stringify(buildBackup(groups, 0)));

test('a backup file reads back as the zones that were exported', () => {
  const groups = exportThenImport([
    zone(),
    zone({
      id: 'video2',
      name: 'Video tunnels',
      domains: ['youtube.com/watch?v=abc'],
      apps: ['discord.exe'],
      exceptions: ['youtube.com/watch?t=1&v=abc'],
      schedule: { days: [1, 2], windows: [{ start: 540, end: 1020 }] },
      limit: null
    })
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].domains, ['x.com']);
  assert.deepEqual(groups[0].limit, { minutes: 45 });
  assert.equal(groups[0].enabled, true);
  assert.deepEqual(groups[1].apps, ['discord.exe']);
  assert.deepEqual(groups[1].exceptions, ['youtube.com/watch?t=1&v=abc']);
  assert.deepEqual(groups[1].schedule, { days: [1, 2], windows: [{ start: 540, end: 1020 }] });
});

test('the envelope carries its kind and version, and the file name dates itself', () => {
  // A local date, because the file name is local: the same instant west of
  // UTC would honestly be named with the previous day.
  const stamp = new Date(2026, 9, 13).getTime();
  const backup = buildBackup([zone()], stamp);
  assert.equal(backup.kind, BACKUP_KIND);
  assert.equal(backup.version, BACKUP_VERSION);
  assert.equal(backup.exportedAt, new Date(stamp).toISOString());
  assert.equal(backupFileName(stamp), 'lock-in-zones-2026-10-13.json');
});

test('a bare array of zones is accepted, so a hand-made file still imports', () => {
  const groups = readBackup(JSON.stringify([{ ...zone(), mode: 'schedule' }]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'Scroll pit');
});

test('the stored shape round-trips through export and import', () => {
  const released = zone({ enabled: false, disarmedUntil: 4102444800000 });
  const [restored] = exportThenImport([released]);
  assert.equal(restored.enabled, false);
  assert.equal(restored.disarmedUntil, 4102444800000);
});

test('a file that is not JSON, or not this app, is refused with a reason', () => {
  assert.throws(() => readBackup('this is not json'), /not JSON/);
  assert.throws(() => readBackup(JSON.stringify({ kind: 'something-else', groups: [zone()] })), /something other than Lock In/);
  assert.throws(() => readBackup(JSON.stringify({ kind: BACKUP_KIND, version: 99, groups: [zone()] })), /newer Lock In/);
  assert.throws(() => readBackup(JSON.stringify({ version: 1 })), /does not carry any zones/);
});

test('a zone with no rules or nothing to block is refused', () => {
  assert.throws(() => readBackup(JSON.stringify([zone({ limit: null })])), /would contain nothing/);
  assert.throws(() => readBackup(JSON.stringify([zone({ domains: [], apps: [] })])), /nothing to block/);
  assert.throws(() => readBackup(JSON.stringify([zone({ name: '   ' })])), /has no name/);
});

test('site rules, application names and exemptions are normalized on the way in', () => {
  const [restored] = readBackup(JSON.stringify([zone({
    domains: ['https://www.X.com/', 'x.com'],
    apps: ['Discord.EXE'],
    exceptions: ['x.com/free']
  })]));
  assert.deepEqual(restored.domains, ['x.com']);
  assert.deepEqual(restored.apps, ['discord.exe']);
  assert.deepEqual(restored.exceptions, ['x.com/free']);

  assert.throws(() => readBackup(JSON.stringify([zone({ domains: ['not a domain'] })])), /not an HTTP\(S\) URL/);
  assert.throws(() => readBackup(JSON.stringify([zone({ domains: ['x.com'], exceptions: ['x.com'] })])), /not inside its own tunnels/);
});

test('a schedule day or a time outside the week and day is refused', () => {
  assert.throws(
    () => readBackup(JSON.stringify([zone({ schedule: { days: [7], windows: [{ start: 0, end: 60 }] } })])),
    /not one of the seven/
  );
  assert.throws(
    () => readBackup(JSON.stringify([zone({ schedule: { days: [1], windows: [{ start: 0, end: 1441 }] } })])),
    /outside the day/
  );
});

test('a window list that is not a list of windows is refused, not crashed on', () => {
  assert.throws(
    () => readBackup(JSON.stringify([zone({ schedule: { days: [1], windows: [null] } })])),
    /time window Lock In cannot read/
  );
  assert.throws(
    () => readBackup(JSON.stringify([zone({ schedule: { days: [1], windows: 'soon' } })])),
    /time window list Lock In cannot read/
  );
});

test('an allowance outside 0–1440 minutes is refused', () => {
  assert.throws(() => readBackup(JSON.stringify([zone({ limit: { minutes: -1 } })])), /outside of 0–1440/);
  assert.throws(() => readBackup(JSON.stringify([zone({ limit: { minutes: 1441 } })])), /outside of 0–1440/);
});

test('legacy top-level schedule windows still import as one window', () => {
  const [restored] = readBackup(JSON.stringify([zone({ schedule: { days: [1], start: 600, end: 720 } })]));
  assert.deepEqual(restored.schedule, { days: [1], windows: [{ start: 600, end: 720 }] });
});

test('duplicate ids are replaced, since usage is banked per id', () => {
  const groups = exportThenImport([zone(), zone({ name: 'Twin' })]);
  assert.notEqual(groups[0].id, groups[1].id);
});

test('a release deadline that is not a moment in time is refused', () => {
  assert.throws(
    () => readBackup(JSON.stringify([zone({ enabled: false, disarmedUntil: 'tomorrow' })])),
    /not a moment in time/
  );
});

test('a file with more zones than the board will hold is refused', () => {
  const many = Array.from({ length: 501 }, (_, index) => zone({ id: `zone${index}`, name: `Zone ${index}` }));
  assert.throws(() => readBackup(JSON.stringify(many)), /more than 500 zones/);
});
