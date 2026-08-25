// Lock In — pure HTML builders for the dashboard, plus the functions that read
// a rule set back out of the DOM. Nothing here touches storage or wires up
// events; it turns data into markup and markup into data.

import {
  DAYS,
  isGroupActive,
  isInWindow,
  hasRules,
  scheduleWindows,
  minutesToTimeValue,
  timeValueToMinutes
} from '../../shared/schedule.js';
import { limitMs, remainingMs, formatDuration, isAllowanceSpent, isPermanentLimit } from '../../shared/usage.js';
import {
  MINUTES_PER_DAY,
  minutesIntoDay,
  formatClock,
  todayShutSegments,
  nextEventFor,
  nextEvent
} from '../../shared/timeline.js';

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const pct = (minutes) => `${((minutes / MINUTES_PER_DAY) * 100).toFixed(3)}%`;

/* ---------- Rule controls ----------
   The "new permit" form and the editor inside an open zone ask for exactly the
   same thing, so they render from these templates and are read back by
   readRules(). The `data-rule-*` and `data-sched-*` hooks tie the two
   together. Both rules are optional and independent: a zone can be shut on a
   schedule, capped by a daily allowance, both, or neither — and neither is the
   strict case, since a zone with no rules is contained around the clock. */

// Zero is the "permanent" preset: an allowance nobody ever gets, which shuts
// the gates for good instead of until midnight. It sits at the end of the row
// because it is the choice you make on purpose, not the one you nudge towards.
const LIMIT_PRESETS = [15, 30, 60, 120, 0];

const presetLabel = (minutes) => (minutes === 0 ? 'Permanent 👹' : formatDuration(minutes * 60000));

// The window drawn as a band over the same 24 hours the day strip uses, so
// "09:00 to 17:00" is the same shape in the editor as it is on the board.
// Read-only on purpose: the time inputs stay the thing you edit, because a
// hand-rolled drag control would lose keyboard entry, screen readers and the
// browser's own clock picker for the sake of looking clever.
function windowFillsHtml(windows) {
  return windows.map(({ start, end }, index) => {
    const className = `band-fill window-${index % 3}`;
    return start === end
      ? `<span class="${className}" style="left: 0; width: 100%"></span>`
      : start > end
      ? `<span class="${className}" style="left: ${pct(start)}; width: ${pct(MINUTES_PER_DAY - start)}"></span>
         <span class="${className}" style="left: 0; width: ${pct(end)}"></span>`
      : `<span class="${className}" style="left: ${pct(start)}; width: ${pct(Math.max(0, end - start))}"></span>`;
  }).join('');
}

function windowBandHtml(windows) {
  const fills = windowFillsHtml(windows);

  return `
    <div class="band" data-window-band aria-hidden="true">${fills}</div>
    <div class="band-scale" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
  `;
}

export function scheduleWindowRowHtml({ start, end }, index, total) {
  return `
    <div class="schedule-window" data-sched-window>
      <span class="window-number" aria-hidden="true">${index + 1}</span>
      <label class="field">
        <span class="field-label">Gates close</span>
        <input type="time" data-sched-start value="${minutesToTimeValue(start)}" />
      </label>
      <span class="window-arrow" aria-hidden="true">→</span>
      <label class="field">
        <span class="field-label">Gates reopen</span>
        <input type="time" data-sched-end value="${minutesToTimeValue(end)}" />
      </label>
      <button type="button" class="remove-window" data-remove-window
        aria-label="Remove time window ${index + 1}" title="Remove this window" ${total === 1 ? 'hidden' : ''}>×</button>
    </div>`;
}

function scheduleControlsHtml({ days = [], windows, start = 9 * 60, end = 17 * 60 } = {}) {
  const selected = new Set(days);
  const ranges = Array.isArray(windows) && windows.length > 0 ? windows : [{ start, end }];
  const pills = DAYS.map(
    ({ value, label }) => `
      <label class="day-pill ${selected.has(value) ? 'checked' : ''}">
        <input type="checkbox" data-sched-day value="${value}" ${selected.has(value) ? 'checked' : ''} />
        ${label}
      </label>`
  ).join('');

  return `
    <div class="day-toggle">${pills}</div>
    ${windowBandHtml(ranges)}
    <div class="schedule-windows" data-schedule-windows>
      ${ranges.map((window, index) => scheduleWindowRowHtml(window, index, ranges.length)).join('')}
    </div>
    <button type="button" class="add-window" data-add-window><span aria-hidden="true">＋</span> Add another window</button>
    <p class="rule-error" data-sched-error role="alert" hidden></p>
  `;
}

function limitControlsHtml({ minutes = 30 } = {}) {
  const presets = LIMIT_PRESETS.map(
    (m) => `<button type="button" class="preset ${m === 0 ? 'preset-permanent' : ''} ${m === minutes ? 'checked' : ''}"
      data-limit-preset="${m}">${presetLabel(m)}</button>`
  ).join('');

  return `
    <div class="preset-row">${presets}</div>
    <label class="field limit-field">
      <span class="field-label">Minutes per day</span>
      <input type="number" min="0" max="1440" step="1" data-limit-minutes value="${minutes}" />
    </label>
    <p class="rule-note" data-limit-permanent ${minutes === 0 ? '' : 'hidden'}>
      🔒 Permanent: zero minutes a day, so these gates never open — not at midnight, not ever, until you change this rule.
    </p>
    <p class="rule-error" data-limit-error role="alert" hidden></p>
  `;
}

// `limitExtra` is where the allowance meter goes when there is one to draw.
// It belongs to the allowance rule and nowhere else: a bar reading "22m of 30m
// left today" under a heading about domains was answering a question nobody
// had asked there.
export function rulesControlsHtml({ schedule = null, limit = null, showNoRulesHint = false, limitExtra = '' } = {}) {
  const section = (key, label, hint, checked, body) => `
    <div class="rule-block ${checked ? 'on' : ''}" data-rule-block="${key}">
      <label class="rule-head">
        <input
          class="rule-switch"
          type="checkbox"
          role="switch"
          data-rule-toggle="${key}"
          ${checked ? 'checked' : ''}
        />
        <span>${label}</span>
      </label>
      <!-- A fieldset so switching a rule off disables every control inside it
           natively: the rule stays visible and readable, just inert. -->
      <fieldset class="rule-body" data-rule-body="${key}" ${checked ? '' : 'disabled'}>
        ${body}
        <p class="rule-hint">${hint}</p>
      </fieldset>
    </div>`;

  return `
    ${section(
      'schedule',
      'Scheduled hours ⏰',
      'Add as many shut windows as you need. They share the selected days, and overnight containment (e.g. 22:00 &rarr; 06:00) works too.',
      Boolean(schedule),
      scheduleControlsHtml(schedule || {})
    )}
    ${section(
      'limit',
      'Daily allowance ⏳',
      'Time spent on these sites while the gates are open. When it runs out they shut until midnight — or pick <strong>Permanent</strong> for an allowance of nothing at all.',
      Boolean(limit),
      limitControlsHtml(limit || {}) + limitExtra
    )}
    <p class="no-rules-hint" data-no-rules-hint ${showNoRulesHint && !schedule && !limit ? '' : 'hidden'}>
      ⚠ No rules set — this zone stays contained 24/7.
    </p>
  `;
}

/* ---------- Reading rules back ----------
   Each reader returns null when its rule is unusable and leaves an inline
   message in the form saying so, so nothing is ever saved half-configured. */

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
  return null;
}

function readSchedule(root) {
  const errorEl = root.querySelector('[data-sched-error]');
  const days = Array.from(root.querySelectorAll('[data-sched-day]:checked')).map((cb) => Number(cb.value));

  if (days.length === 0) return showError(errorEl, 'Pick at least one containment day, tiny mammal. 🐭');

  const windows = Array.from(root.querySelectorAll('[data-sched-window]')).map((row) => ({
    start: timeValueToMinutes(row.querySelector('[data-sched-start]').value),
    end: timeValueToMinutes(row.querySelector('[data-sched-end]').value)
  }));
  if (windows.length === 0) return showError(errorEl, 'Add at least one containment window. ⏰');

  errorEl.hidden = true;
  return { days, windows, start: windows[0].start, end: windows[0].end };
}

function readLimit(root) {
  const errorEl = root.querySelector('[data-limit-error]');
  const raw = root.querySelector('[data-limit-minutes]').value.trim();
  const minutes = Math.floor(Number(raw));

  // Zero is the permanent preset, so only negatives and junk are rejected —
  // and an empty box is junk, not a silent "permanent".
  if (raw === '') return showError(errorEl, 'How many minutes? Zero is permanent containment. ⏳');
  if (!Number.isFinite(minutes) || minutes < 0) return showError(errorEl, 'An allowance cannot be negative, tiny mammal. 🐭');
  if (minutes > 1440) return showError(errorEl, 'A day only has 1440 minutes, tiny mammal. 🐭');

  errorEl.hidden = true;
  return { minutes };
}

// Returns { schedule, limit } — either of which may be null — or null if
// something the user asked for does not validate.
export function readRules(root) {
  const wants = (key) => root.querySelector(`[data-rule-toggle="${key}"]`).checked;

  const schedule = wants('schedule') ? readSchedule(root) : null;
  if (wants('schedule') && !schedule) return null;

  const limit = wants('limit') ? readLimit(root) : null;
  if (wants('limit') && !limit) return null;

  return { schedule, limit };
}

/* ---------- Live zone state ----------
   Written once and used twice: on render, and again every second by the tick
   in options.js, which refreshes the text in place instead of rebuilding the
   row (rebuilding would throw away whatever is half-typed inside it). */

export function zoneStatusText(g, now = Date.now(), usage = null, session = null) {
  if (!g.enabled) return 'disarmed · tiny mammal roaming free 🐭';
  if (!hasRules(g)) return 'contained around the clock · no way out 👹';

  const parts = [];
  const event = nextEventFor(g, now, usage, session);
  const left = g.limit ? formatDuration(remainingMs(g, usage, session, now)) : '';

  if (isPermanentLimit(g.limit)) {
    parts.push('permanent allowance of nothing');
    parts.push('no way out 👹');
  } else if (isAllowanceSpent(g, usage, session, now)) {
    parts.push('allowance spent');
    parts.push('back at midnight 🌙');
  } else if (isInWindow(g, now)) {
    parts.push('shut');
    if (event) parts.push(`reopens ${formatClock(event.at)}`);
    if (left) parts.push(`${left} allowance waiting`);
  } else {
    parts.push('open');
    if (event && event.kind === 'shuts') parts.push(`gates close ${formatClock(event.at)}`);
    if (left) parts.push(`${left} left today`);
  }

  return parts.join(' · ');
}

export function zoneStateClass(g, now = Date.now(), usage = null, session = null) {
  if (!g.enabled) return 'off';
  if (isAllowanceSpent(g, usage, session, now)) return 'spent';
  return isGroupActive(g, now, usage, session) ? 'shut' : 'open';
}

export function meterState(g, now = Date.now(), usage = null, session = null) {
  const total = limitMs(g.limit);
  const left = remainingMs(g, usage, session, now);
  const spent = left <= 0;
  const permanent = isPermanentLimit(g.limit);
  return {
    spent,
    percent: total > 0 ? Math.min(100, ((total - left) / total) * 100) : 100,
    label: permanent
      ? 'permanent · no allowance, today or any other day'
      : spent
        ? `allowance spent · ${formatDuration(total)} used today`
        : `${formatDuration(left)} of ${formatDuration(total)} left today`
  };
}

/* ---------- The now panel ----------
   The one question the dashboard exists to answer, worked out from the same
   rules everything else reads. */

export function nowPanelState(groups, now = Date.now(), usage = null, session = null) {
  const shut = groups.filter((g) => isGroupActive(g, now, usage, session)).length;
  const event = nextEvent(groups, now, usage, session);

  const headline = groups.length === 0
    ? 'nothing is contained'
    : `${shut} of ${groups.length} zone${groups.length === 1 ? '' : 's'} sealed`;

  if (!event) {
    return {
      headline,
      detail: groups.length === 0
        ? 'Tiny mammal has unrestricted internet access. This seems dangerous. 👁️👄👁️'
        : 'Nothing is on the clock — these zones open and shut with your browsing, not the hour. 🐭',
      countdown: '',
      countdownLabel: ''
    };
  }

  const shuts = event.kind === 'shuts';
  return {
    headline,
    detail: `Next thing that happens: <strong>${escapeHtml(event.group.name)} ${shuts ? 'shuts' : 'reopens'} at ${formatClock(event.at)}</strong> — in ${formatDuration(event.at - now)}. 👹`,
    countdown: formatDuration(event.at - now),
    // The zone is the subject in the sentence above and the gates are the
    // subject here, so the verb has to agree with the gates, not with it.
    countdownLabel: `until the gates ${shuts ? 'shut' : 'reopen'}`
  };
}

/* ---------- The day strip ----------
   Schedules stop being a sentence and become a shape: shut hours in colour,
   free hours in paper, with a line where "now" is. */

function stripRowHtml(g, now, usage, session) {
  const segments = todayShutSegments(g, now, usage, session);
  const state = zoneStateClass(g, now, usage, session);
  const bands = segments
    .map(
      (s) =>
        `<span class="band-fill ${s.kind}" style="left: ${pct(s.start)}; width: ${pct(s.end - s.start)}"></span>`
    )
    .join('');

  // The note explains the track, so an empty track on a scheduled zone has to
  // say "not today" rather than quote hours that are not on this day's strip.
  let note = 'allowance only';
  if (!g.enabled) note = 'disarmed';
  else if (isPermanentLimit(g.limit)) note = 'permanent';
  else if (segments.some((s) => s.kind === 'spent')) note = 'spent';
  else if (!hasRules(g)) note = 'all day';
  else if (g.schedule) {
    if (segments.length === 0) note = 'not today';
    else {
      const windows = scheduleWindows(g.schedule);
      if (windows.some((window) => window.start === window.end)) note = 'all day';
      else if (windows.length > 1) note = `${windows.length} windows`;
      else note = `${minutesToTimeValue(windows[0].start)}–${minutesToTimeValue(windows[0].end)}`;
    }
  }

  return `
    <div class="strip-row state-${state}">
      <span class="strip-name">${escapeHtml(g.name)}</span>
      <span class="band strip-band">
        ${bands}
        <span class="band-now" style="left: ${pct(minutesIntoDay(now))}"></span>
      </span>
      <span class="strip-note">${escapeHtml(note)}</span>
    </div>`;
}

export function dayStripHtml(groups, now = Date.now(), usage = null, session = null) {
  if (groups.length === 0) return '';
  return groups.map((g) => stripRowHtml(g, now, usage, session)).join('');
}

/* ---------- Zone rows ----------
   A zone is a row, not a card. Collapsed it answers "what is this doing"; open
   it gets the full width for its tunnels and its rules, which is space a
   280px card never had. Only one is open at a time. */

function chipsHtml(g) {
  if (g.domains.length === 0) return '<span class="muted">no forbidden tunnels yet</span>';
  return g.domains
    .map((d) => {
      const safe = escapeHtml(d);
      return `
      <span class="chip">
        ${safe}
        <button type="button" data-action="remove-domain" data-group="${g.id}" data-domain="${safe}"
          title="Release ${safe}" aria-label="Release ${safe} from containment">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </span>`;
    })
    .join('');
}

function meterHtml(g, now, usage, session) {
  if (!g.limit) return '';
  const { percent, label, spent } = meterState(g, now, usage, session);
  return `
    <div class="meter ${spent ? 'spent' : ''}" data-meter="${g.id}">
      <div class="meter-track"><span class="meter-fill" style="width: ${percent.toFixed(1)}%"></span></div>
      <div class="meter-label">${escapeHtml(label)}</div>
    </div>`;
}

function zoneBodyHtml(g, now, usage, session) {
  return `
    <div class="zone-body">
      <div class="zone-name-editor">
        <label class="field-label" for="zone-name-${g.id}">Zone name</label>
        <div class="zone-name-row">
          <input type="text" id="zone-name-${g.id}" value="${escapeHtml(g.name)}"
            data-zone-name-input="${g.id}" aria-label="Edit the name of ${escapeHtml(g.name)}" required />
          <button type="button" class="ghost" data-action="save-name" data-group="${g.id}">Save name</button>
        </div>
      </div>

      <div class="zone-columns">
        <div class="zone-col">
          <div class="col-label">Forbidden tunnels</div>
          <div class="domain-chips">${chipsHtml(g)}</div>
          <div class="add-domain-row">
            <input type="text" placeholder="add a forbidden tunnel..." data-add-domain-input="${g.id}"
              aria-label="Add a forbidden tunnel to ${escapeHtml(g.name)}" />
            <button type="button" class="ghost" data-action="add-domain" data-group="${g.id}">Add</button>
          </div>
        </div>

        <div class="zone-col rules-col">
          <div class="col-head">
            <span class="col-label">Containment rules</span>
            <span class="paperwork-flag">🔒 needs paperwork</span>
          </div>
          <div class="rules-editor" data-rules-editor="${g.id}">
            ${rulesControlsHtml({ ...g, limitExtra: meterHtml(g, now, usage, session) })}
          </div>
        </div>
      </div>

      <div class="zone-actions">
        <button type="button" class="primary" data-action="save-rules" data-group="${g.id}">Save rules 🔒</button>
        <button type="button" class="ghost" data-action="toggle" data-group="${g.id}">Cancel</button>
        <span class="spacer"></span>
        ${
          g.enabled
            ? `<button type="button" class="ghost" data-action="disable" data-group="${g.id}">Disarm 🔓</button>`
            : `<button type="button" class="ghost" data-action="enable" data-group="${g.id}">Arm containment 🔒</button>`
        }
        <button type="button" class="btn-danger" data-action="delete" data-group="${g.id}">Delete zone</button>
      </div>
    </div>`;
}

export function zoneRowHtml(g, now, openIds, usage = null, session = null) {
  const open = openIds.has(g.id);
  const state = zoneStateClass(g, now, usage, session);
  const count = `${g.domains.length} tunnel${g.domains.length === 1 ? '' : 's'}`;

  // Arming is free and strengthens containment, so a disarmed row gets the
  // shortcut right there. It sits outside the toggle: a button inside a button
  // is not markup, it is a dare.
  const armShortcut =
    !g.enabled && !open
      ? `<button type="button" class="arm-shortcut" data-action="enable" data-group="${g.id}">Arm 🔒</button>`
      : '';

  return `
    <div class="zone state-${state} ${open ? 'is-open' : ''}" data-zone="${g.id}">
      <div class="zone-head">
        <button type="button" class="zone-toggle" data-action="toggle" data-group="${g.id}"
          aria-expanded="${open}" aria-controls="zone-body-${g.id}">
          <span class="zone-dot" aria-hidden="true"></span>
          <span class="zone-name">${escapeHtml(g.name)}</span>
          <span class="zone-status" data-status="${g.id}">${escapeHtml(zoneStatusText(g, now, usage, session))}</span>
          <span class="zone-count">${count}</span>
          <span class="zone-chevron" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </span>
        </button>
        ${armShortcut}
      </div>
      <div id="zone-body-${g.id}" ${open ? '' : 'hidden'}>${open ? zoneBodyHtml(g, now, usage, session) : ''}</div>
    </div>`;
}
