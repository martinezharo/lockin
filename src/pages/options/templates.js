// Lock In — pure HTML builders for the dashboard, plus the functions that read
// a rule set back out of the DOM. Nothing here touches storage or wires up
// events; it turns data into markup and markup into data.

import {
  DAYS,
  isGroupActive,
  isInWindow,
  hasRules,
  formatSchedule,
  formatRules,
  minutesToTimeValue,
  timeValueToMinutes
} from '../../shared/schedule.js';
import { limitMs, remainingMs, formatDuration } from '../../shared/usage.js';

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ---------- Rule controls ----------
   The "create a group" form and the inline "edit rules" editor ask for exactly
   the same thing, so they render from these templates and are read back by
   readRules(). The `data-rule-*` and `data-sched-*` hooks tie the two
   together. Both rules are optional and independent, but every zone needs at
   least one of them before it can be created or saved. */

const LIMIT_PRESETS = [15, 30, 60, 120];

function scheduleControlsHtml({ days = [], start = 9 * 60, end = 17 * 60 } = {}) {
  const selected = new Set(days);
  const pills = DAYS.map(
    ({ value, label }) => `
      <label class="${selected.has(value) ? 'checked' : ''}">
        <input type="checkbox" data-sched-day value="${value}" ${selected.has(value) ? 'checked' : ''} />
        ${label}
      </label>`
  ).join('');

  return `
    <div class="day-toggle">${pills}</div>
    <div class="field-row schedule-time-row">
      <label class="field">
        <span class="field-label">Gates close</span>
        <input type="time" data-sched-start value="${minutesToTimeValue(start)}" />
      </label>
      <label class="field">
        <span class="field-label">Gates reopen</span>
        <input type="time" data-sched-end value="${minutesToTimeValue(end)}" />
      </label>
    </div>
    <p class="rule-error" data-sched-error role="alert" hidden></p>
  `;
}

function limitControlsHtml({ minutes = 30 } = {}) {
  const presets = LIMIT_PRESETS.map(
    (m) => `<button type="button" class="preset ${m === minutes ? 'checked' : ''}"
      data-limit-preset="${m}">${formatDuration(m * 60000)}</button>`
  ).join('');

  return `
    <div class="preset-row">${presets}</div>
    <label class="field limit-field">
      <span class="field-label">Minutes per day</span>
      <input type="number" min="1" max="1440" step="1" data-limit-minutes value="${minutes}" />
    </label>
    <p class="rule-error" data-limit-error role="alert" hidden></p>
  `;
}

export function rulesControlsHtml({ schedule = null, limit = null } = {}) {
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
      'Scheduled hours',
      'The gates stay shut only during this window. Overnight containment (e.g. 22:00 &rarr; 06:00) works too.',
      Boolean(schedule),
      scheduleControlsHtml(schedule || {})
    )}
    ${section(
      'limit',
      'Daily allowance',
      'Time spent on these sites while the gates are open. When it runs out they shut until midnight.',
      Boolean(limit),
      limitControlsHtml(limit || {})
    )}
    <p class="no-rules-hint" data-no-rules-hint hidden role="alert">
      ⚠ No rules set — add at least one rule before creating this zone.
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

  errorEl.hidden = true;
  return {
    days,
    start: timeValueToMinutes(root.querySelector('[data-sched-start]').value),
    end: timeValueToMinutes(root.querySelector('[data-sched-end]').value)
  };
}

function readLimit(root) {
  const errorEl = root.querySelector('[data-limit-error]');
  const minutes = Math.floor(Number(root.querySelector('[data-limit-minutes]').value));

  if (!Number.isFinite(minutes) || minutes < 1) return showError(errorEl, 'An allowance needs at least one minute. ⏳');
  if (minutes > 1440) return showError(errorEl, 'A day only has 1440 minutes, tiny mammal. 🐭');

  errorEl.hidden = true;
  return { minutes };
}

// Returns { schedule, limit } — either of which may be null — or null if the
// selected rules do not validate or no rule is enabled. Empty rule sets are
// rejected here so every caller gets the same save guard.
export function readRules(root) {
  const toggles = Array.from(root.querySelectorAll('[data-rule-toggle]'));
  if (!toggles.some((cb) => cb.checked)) {
    root.dataset.noRulesAttempted = 'true';
    const hint = root.querySelector('[data-no-rules-hint]');
    if (hint) hint.hidden = false;
    return null;
  }

  const wants = (key) => root.querySelector(`[data-rule-toggle="${key}"]`).checked;

  const schedule = wants('schedule') ? readSchedule(root) : null;
  if (wants('schedule') && !schedule) return null;

  const limit = wants('limit') ? readLimit(root) : null;
  if (wants('limit') && !limit) return null;

  return { schedule, limit };
}

/* ---------- Live group state ----------
   Written once and used twice: on render, and again every second by the tick
   in options.js, which refreshes the text in place instead of rebuilding the
   card (rebuilding would throw away whatever is half-typed inside it). */

export function lcdText(g, now = Date.now(), usage = null, session = null) {
  if (!g.enabled) return hasRules(g) ? `○ containment disarmed · ${formatRules(g)}` : '○ tiny mammal roaming free';
  if (!hasRules(g)) return '○ no rules set · zone inactive';

  const parts = [];
  const shut = isInWindow(g, now);
  const spent = !shut && isGroupActive(g, now, usage, session);

  if (shut) parts.push('● tiny mammal contained');
  else if (spent) parts.push('● allowance spent · resets at midnight');
  // "Waiting" is about a schedule that will shut on its own; a zone held open
  // only by its allowance has no gate hour to wait for.
  else parts.push(g.schedule ? '○ gates waiting' : '○ gates open');

  if (g.schedule) parts.push(formatSchedule(g.schedule));
  // While the allowance is what's doing the blocking the state line already
  // says so; a "0m left" next to it would just be the same news twice.
  if (g.limit && !spent) parts.push(`${formatDuration(remainingMs(g, usage, session, now))} left`);

  return parts.join(' · ');
}

export function meterState(g, now = Date.now(), usage = null, session = null) {
  const total = limitMs(g.limit);
  const left = remainingMs(g, usage, session, now);
  const spent = left <= 0;
  return {
    spent,
    percent: total > 0 ? Math.min(100, ((total - left) / total) * 100) : 100,
    label: spent
      ? `allowance spent · ${formatDuration(total)} used today`
      : `${formatDuration(left)} of ${formatDuration(total)} left today`
  };
}

/* ---------- Group cards ---------- */

function lcdHtml(g, now, usage, session) {
  const active = isGroupActive(g, now, usage, session);
  return `<div class="lcd ${active ? 'on' : ''}" data-lcd="${g.id}">${escapeHtml(lcdText(g, now, usage, session))}</div>`;
}

// Only groups that actually carry an allowance get a meter: an empty bar sat
// at 100% on every other card would be noise pretending to be information.
function meterHtml(g, now, usage, session) {
  if (!g.limit) return '';
  const { percent, label, spent } = meterState(g, now, usage, session);
  return `
    <div class="meter ${spent ? 'spent' : ''}" data-meter="${g.id}">
      <div class="meter-track"><span class="meter-fill" style="width: ${percent.toFixed(1)}%"></span></div>
      <div class="meter-label">${escapeHtml(label)}</div>
    </div>`;
}

function actionsHtml(g) {
  const btn = (cls, action, label) =>
    `<button type="button" class="${cls}" data-action="${action}" data-group="${g.id}">${label}</button>`;

  // The arm/disarm toggle follows the group's own switch, not whether its
  // rules happen to be blocking this second.
  const toggle = g.enabled ? btn('ghost', 'disable', 'Disarm') : btn('primary', 'enable', 'Arm containment');

  return `${toggle}${btn('ghost', 'edit-rules', 'Edit rules')}${btn('btn-danger', 'delete', 'Delete zone')}`;
}

function chipsHtml(g) {
  if (g.domains.length === 0) return '<span class="muted">no forbidden tunnels</span>';
  return g.domains
    .map((d) => {
      const safe = escapeHtml(d);
      return `
      <span class="chip">
        ${safe}
        <button type="button" data-action="remove-domain" data-group="${g.id}" data-domain="${safe}"
          title="Release site" aria-label="Release ${safe} from containment">&times;</button>
      </span>`;
    })
    .join('');
}

function rulesEditorHtml(g) {
  return `
    <div class="rules-editor" data-rules-editor="${g.id}">
      ${rulesControlsHtml(g)}
      <div class="rule-actions">
        <button type="button" class="primary" data-action="save-rules" data-group="${g.id}">Save rules</button>
        <button type="button" class="ghost" data-action="cancel-edit-rules" data-group="${g.id}">Cancel</button>
      </div>
    </div>
  `;
}

export function groupCardHtml(g, now, editingIds, usage = null, session = null) {
  const active = isGroupActive(g, now, usage, session);
  const editor = editingIds.has(g.id) ? rulesEditorHtml(g) : '';

  return `
    <div class="group-card ${active ? 'active' : ''}" data-group-card="${g.id}">
      <div class="group-card-head">
        <span class="group-name">${escapeHtml(g.name)}</span>
        <span class="group-count">${g.domains.length} tunnel${g.domains.length === 1 ? '' : 's'}</span>
      </div>
      ${lcdHtml(g, now, usage, session)}
      ${meterHtml(g, now, usage, session)}
      ${editor}
      <div class="domain-chips">${chipsHtml(g)}</div>
      <div class="add-domain-row">
        <input type="text" placeholder="add a forbidden tunnel..." data-add-domain-input="${g.id}" />
        <button type="button" class="ghost" data-action="add-domain" data-group="${g.id}">Add to zone</button>
      </div>
      <div class="group-actions">${actionsHtml(g)}</div>
    </div>
  `;
}
