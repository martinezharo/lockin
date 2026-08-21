// Lock In — dashboard: state, storage writes and event wiring.
// Markup lives in templates.js, the typing challenge in lock-gate.js.

import { Storage } from '../../shared/storage.js';
import { uid, normalizeDomainInput, parseDomainList } from '../../shared/domains.js';
import { isGroupActive } from '../../shared/schedule.js';
import { isDevMode } from '../../shared/dev-mode.js';
import { withLockCheck, toggleLockMode } from './lock-gate.js';
import { groupCardHtml, scheduleControlsHtml, readSchedule, lcdText } from './templates.js';

const groupsListEl = document.getElementById('groupsList');
const emptyStateEl = document.getElementById('emptyState');
const groupCountLabelEl = document.getElementById('groupCountLabel');

const lockSwitch = document.getElementById('lockSwitch');
const lockSwitchState = document.getElementById('lockSwitchState');
const lockSwitchIcon = lockSwitch.querySelector('.lock-switch-icon');

const newGroupForm = document.getElementById('newGroupForm');
const scheduleField = document.getElementById('scheduleField');
const scheduleControls = document.getElementById('scheduleControls');

const editingScheduleIds = new Set();

/* ---------------- Storage writes ----------------
   Every group edit is the same four steps: load, change, save, re-render.
   These two helpers are that shape, so the actions below are one line each. */

async function updateGroups(mutate) {
  const groups = await Storage.getGroups();
  const next = mutate(groups);
  await Storage.saveGroups(next === undefined ? groups : next);
  render();
}

function updateGroup(id, mutate) {
  return updateGroups((groups) => {
    const g = groups.find((group) => group.id === id);
    if (g) mutate(g);
  });
}

/* ---------------- Group actions ----------------
   The locked ones are those that could let a distraction back in. Adding a
   site or a group is deliberately free. */

const deleteGroup = (id) => withLockCheck(() => updateGroups((gs) => gs.filter((g) => g.id !== id)));

const disableGroup = (id) => withLockCheck(() => updateGroup(id, (g) => { g.enabled = false; }));

const removeDomain = (id, domain) =>
  withLockCheck(() => updateGroup(id, (g) => { g.domains = g.domains.filter((d) => d !== domain); }));

// Changing the hours can loosen an existing block, so it gets the same
// typing-challenge friction as disabling one.
const saveSchedule = (id, schedule) =>
  withLockCheck(() =>
    updateGroup(id, (g) => {
      g.schedule = schedule;
      editingScheduleIds.delete(id);
    })
  );

const enableGroup = (id) => updateGroup(id, (g) => { g.enabled = true; });

function addDomain(id, rawDomain) {
  const domain = normalizeDomainInput(rawDomain);
  if (!domain) return;
  return updateGroup(id, (g) => {
    if (!g.domains.includes(domain)) g.domains.push(domain);
  });
}

/* ---------------- Lock switch and dev banner ---------------- */

async function refreshLockSwitch() {
  const lockMode = await Storage.getLockMode();
  lockSwitch.setAttribute('aria-pressed', String(lockMode));
  lockSwitchState.textContent = lockMode ? 'on' : 'off';
  lockSwitchIcon.textContent = lockMode ? '🔒' : '🔓';
}

lockSwitch.addEventListener('click', () => toggleLockMode(refreshLockSwitch));

document.getElementById('devBanner').hidden = !isDevMode();

/* ---------------- New group form ---------------- */

function resetScheduleControls() {
  scheduleControls.innerHTML = scheduleControlsHtml();
}
resetScheduleControls();

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    scheduleField.hidden = document.querySelector('input[name="mode"]:checked').value !== 'schedule';
  });
});

newGroupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('groupName').value.trim();
  const domains = parseDomainList(document.getElementById('groupDomains').value);
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (!name || domains.length === 0) return;

  let schedule = null;
  if (mode === 'schedule') {
    schedule = readSchedule(scheduleControls);
    if (!schedule) return;
  }

  await updateGroups((groups) => {
    groups.push({ id: uid(), name, domains, enabled: true, mode, schedule, createdAt: Date.now() });
  });

  // reset() clears the inputs but not the day pills' `.checked` styling, so the
  // schedule controls are rebuilt from the template instead of untangled.
  newGroupForm.reset();
  resetScheduleControls();
  scheduleField.hidden = true;
});

/* ---------------- Rendering ---------------- */

async function render() {
  const groups = await Storage.getGroups();
  const now = Date.now();

  groups.sort((a, b) => b.createdAt - a.createdAt);

  groupCountLabelEl.textContent = groups.length
    ? `${groups.filter((g) => isGroupActive(g, now)).length} of ${groups.length} active`
    : '';

  emptyStateEl.hidden = groups.length > 0;
  groupsListEl.innerHTML = groups.map((g) => groupCardHtml(g, now, editingScheduleIds)).join('');

  refreshLockSwitch();
}

/* ---------------- Events ---------------- */

const CARD_ACTIONS = {
  delete: (id) => deleteGroup(id),
  disable: (id) => disableGroup(id),
  enable: (id) => enableGroup(id),
  'remove-domain': (id, btn) => removeDomain(id, btn.dataset.domain),
  'add-domain': (id, btn) => {
    const input = btn.closest('.group-card').querySelector('[data-add-domain-input]');
    addDomain(id, input.value);
    input.value = '';
  },
  'edit-schedule': (id) => {
    editingScheduleIds.add(id);
    render();
  },
  'cancel-edit-schedule': (id) => {
    editingScheduleIds.delete(id);
    render();
  },
  'save-schedule': (id, btn) => {
    const schedule = readSchedule(btn.closest('.schedule-editor'));
    if (schedule) saveSchedule(id, schedule);
  }
};

groupsListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const handler = CARD_ACTIONS[btn.dataset.action];
  if (handler) handler(btn.dataset.group, btn);
});

groupsListEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches('[data-add-domain-input]')) return;
  e.preventDefault();
  addDomain(e.target.getAttribute('data-add-domain-input'), e.target.value);
  e.target.value = '';
});

// One delegated listener keeps the `.checked` class in sync for every day pill
// on the page — the static create form and the inline editors alike — so the
// styling doesn't have to depend on :has() support.
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-sched-day]')) {
    e.target.closest('label').classList.toggle('checked', e.target.checked);
  }
});

/* ---------------- Live tick ----------------
   Schedule windows open and close on the clock, with no storage change to
   react to, so scheduled cards refresh themselves once a second. */

setInterval(() => {
  const now = Date.now();

  document.querySelectorAll('.lcd[data-sched-lcd]').forEach((el) => {
    const days = (el.dataset.days || '').split(',').filter(Boolean).map(Number);
    const group = {
      enabled: el.dataset.enabled === 'true',
      mode: 'schedule',
      schedule: { days, start: Number(el.dataset.start), end: Number(el.dataset.end) }
    };
    const active = isGroupActive(group, now);

    el.textContent = lcdText(group, now);
    el.classList.toggle('on', active);
    const card = el.closest('.group-card');
    if (card) card.classList.toggle('active', active);
  });

  const cards = document.querySelectorAll('.group-card');
  if (cards.length) {
    const active = document.querySelectorAll('.group-card.active').length;
    groupCountLabelEl.textContent = `${active} of ${cards.length} active`;
  }
}, 1000);

render();
