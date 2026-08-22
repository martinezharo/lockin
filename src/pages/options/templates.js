// Lock In — pure HTML builders for the dashboard, plus the one function that
// reads a schedule back out of the DOM. Nothing here touches storage or wires
// up events; it turns data into markup and markup into data.

import { DAYS, isGroupActive, formatSchedule, minutesToTimeValue, timeValueToMinutes } from '../../shared/schedule.js';

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ---------- Schedule controls ----------
   The "create a group" form and the inline "edit hours" editor ask for exactly
   the same thing, so they render from this one template and are read back by
   readSchedule(). The `data-sched-*` hooks are what tie the two together. */

export function scheduleControlsHtml({ days = [], start = 9 * 60, end = 17 * 60 } = {}) {
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
    <p class="sched-error" data-sched-error role="alert" hidden></p>
  `;
}

// Returns null when the schedule is unusable — no day picked is the only way
// that can happen — and leaves an inline message in the form saying so.
export function readSchedule(root) {
  const errorEl = root.querySelector('[data-sched-error]');
  const days = Array.from(root.querySelectorAll('[data-sched-day]:checked')).map((cb) => Number(cb.value));

  if (days.length === 0) {
    errorEl.textContent = 'Pick at least one containment day, tiny mammal. 🐭';
    errorEl.hidden = false;
    return null;
  }

  errorEl.hidden = true;
  return {
    days,
    start: timeValueToMinutes(root.querySelector('[data-sched-start]').value),
    end: timeValueToMinutes(root.querySelector('[data-sched-end]').value)
  };
}

/* ---------- Group cards ---------- */

// Written once and used twice: on render, and again every second by the live
// tick, which rebuilds a group-shaped object from the card's data attributes.
export function lcdText(group, now = Date.now()) {
  const active = isGroupActive(group, now);
  if (group.mode !== 'schedule') {
    return active ? '● containment active · permanent' : '○ tiny mammal roaming free';
  }
  const state = !group.enabled
    ? '○ containment disarmed'
    : active
      ? '● tiny mammal contained'
      : '○ gates waiting';
  return `${state} · ${formatSchedule(group.schedule)}`;
}

function lcdHtml(g, now) {
  const active = isGroupActive(g, now);
  const text = escapeHtml(lcdText(g, now));
  if (g.mode !== 'schedule') {
    return `<div class="lcd ${active ? 'on' : ''}">${text}</div>`;
  }
  const days = (g.schedule && g.schedule.days) || [];
  return `<div class="lcd ${active ? 'on' : ''}" data-sched-lcd
      data-enabled="${g.enabled}" data-days="${days.join(',')}"
      data-start="${g.schedule ? g.schedule.start : 0}"
      data-end="${g.schedule ? g.schedule.end : 0}">${text}</div>`;
}

function actionsHtml(g, active) {
  const btn = (cls, action, label) =>
    `<button type="button" class="${cls}" data-action="${action}" data-group="${g.id}">${label}</button>`;

  // Scheduled groups keep their arm/disarm toggle regardless of whether the
  // window happens to be open right now; permanent ones follow their state.
  const armed = g.mode === 'schedule' ? g.enabled : active;
  const toggle = armed ? btn('ghost', 'disable', 'Disarm') : btn('primary', 'enable', 'Arm containment');
  const editHours = g.mode === 'schedule' ? btn('ghost', 'edit-schedule', 'Edit gate hours') : '';

  return `${toggle}${editHours}${btn('btn-danger', 'delete', 'Delete zone')}`;
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

function scheduleEditorHtml(g) {
  return `
    <div class="schedule-editor" data-schedule-editor="${g.id}">
      ${scheduleControlsHtml(g.schedule || {})}
      <div class="schedule-actions">
        <button type="button" class="primary" data-action="save-schedule" data-group="${g.id}">Save gate hours</button>
        <button type="button" class="ghost" data-action="cancel-edit-schedule" data-group="${g.id}">Cancel</button>
      </div>
    </div>
  `;
}

export function groupCardHtml(g, now, editingScheduleIds) {
  const active = isGroupActive(g, now);
  const editor = g.mode === 'schedule' && editingScheduleIds.has(g.id) ? scheduleEditorHtml(g) : '';

  return `
    <div class="group-card ${active ? 'active' : ''}" data-group-card="${g.id}">
      <div class="group-card-head">
        <span class="group-name">${escapeHtml(g.name)}</span>
        <span class="group-count">${g.domains.length} tunnel${g.domains.length === 1 ? '' : 's'}</span>
      </div>
      ${lcdHtml(g, now)}
      ${editor}
      <div class="domain-chips">${chipsHtml(g)}</div>
      <div class="add-domain-row">
        <input type="text" placeholder="add a forbidden tunnel..." data-add-domain-input="${g.id}" />
        <button type="button" class="ghost" data-action="add-domain" data-group="${g.id}">Add to zone</button>
      </div>
      <div class="group-actions">${actionsHtml(g, active)}</div>
    </div>
  `;
}
