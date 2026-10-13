// Lock In — every zone as one portable file.
//
// The dashboard can write its zones to a JSON file and read one back. This
// module owns the file's shape and every check applied to a file on the way in:
// an import is untrusted input even when it was exported here a minute ago,
// because the whole point of a file is that it can come from anywhere.
//
// Only zones travel. Usage totals, the edit lock and the privacy consent are
// properties of the device, not of the containment rules, and a backup that
// carried them would silently rewrite settings nobody asked it to touch.

import { uid, normalizeSiteInput, exceptionFitsDomains } from './domains.js';
import { normalizeAppInput } from './apps.js';
import { scheduleWindows } from './schedule.js';
import { MINUTES_PER_DAY } from './timeline.js';
import { serializeGroup } from './storage.js';

export const BACKUP_KIND = 'lock-in-zones';
export const BACKUP_VERSION = 1;

const MAX_ZONES = 500;

export function buildBackup(groups, now = Date.now()) {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    // The stored shape exactly, so exporting and importing back is lossless
    // and the file is also a faithful copy of what the watchdog is enforcing.
    groups: groups.map(serializeGroup)
  };
}

export function backupFileName(now = Date.now()) {
  const d = new Date(now);
  const pad = (value) => String(value).padStart(2, '0');
  return `lock-in-zones-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

function fail(message) {
  throw new Error(message);
}

/* Lists are normalized rather than trusted: an entry that comes back empty from
   the same normalizers the form uses would be stored as a rule that never
   matches anything, which reads as protection without being any. */
function readList(raw, normalize, refusal, name) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) fail(`“${name}” has a malformed list of entries.`);
  const values = [];
  for (const entry of raw) {
    const value = normalize(entry);
    if (!value) fail(refusal(name));
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

function readSchedule(raw, name) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail(`“${name}” has an unreadable schedule.`);

  const days = Array.isArray(raw.days) ? [...new Set(raw.days)] : [];
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    fail(`“${name}” has a schedule day that is not one of the seven.`);
  }
  // scheduleWindows destructures each entry, so entries that are not objects
  // have to be refused here rather than allowed to throw a TypeError at it.
  if (raw.windows !== undefined && !Array.isArray(raw.windows)) {
    fail(`“${name}” has a time window list Lock In cannot read.`);
  }
  if (Array.isArray(raw.windows) && raw.windows.some((window) =>
    !window || typeof window !== 'object' || Array.isArray(window))) {
    fail(`“${name}” has a time window Lock In cannot read.`);
  }
  const windows = scheduleWindows(raw).map(({ start, end }) => ({
    start: Number(start ?? 0),
    end: Number(end ?? 0)
  }));
  const unreadable = windows.some(({ start, end }) =>
    !Number.isInteger(start) || !Number.isInteger(end) ||
    start < 0 || start > MINUTES_PER_DAY || end < 0 || end > MINUTES_PER_DAY);
  if (unreadable) fail(`“${name}” has a time window outside the day.`);

  // A schedule with no days or no windows directs nothing, exactly as the
  // dashboard's own empty rule sets are rejected rather than saved.
  if (days.length === 0 || windows.length === 0) return null;
  return { days, windows };
}

function readLimit(raw, name) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail(`“${name}” has an unreadable allowance.`);
  const minutes = Number(raw.minutes);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    fail(`“${name}” has an allowance outside of 0–1440 minutes.`);
  }
  return { minutes };
}

/* One zone in, rebuilt field by field. Unknown keys are dropped rather than
   spread through: whatever this file wants to remember is not what gets
   rendered next to the goblin, and the watchdog only ever needs these. */
function readGroup(raw, index, seenIds) {
  const label = (raw && typeof raw === 'object' && !Array.isArray(raw) && String(raw.name || '').trim())
    ? `“${String(raw.name).trim()}”`
    : `Zone ${index + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${label} in this file is not a zone.`);

  const name = String(raw.name ?? '').trim();
  if (!name) fail(`${label} has no name.`);
  const domains = readList(raw.domains, normalizeSiteInput, (zone) =>
    `${zone} has a site rule that is not an HTTP(S) URL or domain.`, name);
  const apps = readList(raw.apps, normalizeAppInput, (zone) =>
    `${zone} has an application entry that is not an executable name.`, name);
  const exceptions = readList(raw.exceptions, normalizeSiteInput, (zone) =>
    `${zone} has an always-allowed page that is not an HTTP(S) URL.`, name);
  for (const exception of exceptions) {
    if (!exceptionFitsDomains(exception, domains)) {
      fail(`${label} allows “${exception}”, which is not inside its own tunnels.`);
    }
  }

  const schedule = readSchedule(raw.schedule, name);
  const limit = readLimit(raw.limit, name);
  // The dashboard refuses to save a zone with neither rule because it would
  // never contain anything; the same refusal stands at the door.
  if (!schedule && !limit) fail(`${label} has neither scheduled hours nor an allowance, so it would contain nothing.`);
  if (domains.length === 0 && apps.length === 0) fail(`${label} has nothing to block.`);

  // Ids are kept when they are clean and unique — usage is banked per id, so a
  // restored zone should find its own allowances — and minted otherwise.
  const id = typeof raw.id === 'string' && /^[a-z0-9]{4,40}$/i.test(raw.id) && !seenIds.has(raw.id)
    ? raw.id
    : uid();
  seenIds.add(id);

  const enabled = raw.enabled !== false;
  let disarmedUntil = null;
  if (!enabled && raw.disarmedUntil != null) {
    const until = Number(raw.disarmedUntil);
    if (!Number.isFinite(until) || until <= 0) fail(`${label} has a release deadline that is not a moment in time.`);
    disarmedUntil = until;
  }

  return {
    id,
    name,
    domains,
    apps,
    exceptions,
    enabled,
    disarmedUntil,
    schedule,
    limit,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now()
  };
}

/* A backup file as zones, or a thrown Error whose message can be shown to
   whoever picked the file. A bare array is accepted so a hand-made list of
   zones still imports. */
export function readBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail('That file is not a Lock In backup: it is not JSON.');
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.kind !== undefined && data.kind !== BACKUP_KIND) fail('That file was written by something other than Lock In.');
    const version = Number(data.version ?? 0);
    if (Number.isFinite(version) && version > BACKUP_VERSION) fail('That file was written by a newer Lock In. Update this build first.');
  }

  const raw = Array.isArray(data) ? data : data?.groups;
  if (!Array.isArray(raw)) fail('That file does not carry any zones.');
  if (raw.length > MAX_ZONES) fail(`That file carries more than ${MAX_ZONES} zones; Lock In will not import it.`);

  const seenIds = new Set();
  return raw.map((group, index) => readGroup(group, index, seenIds));
}
