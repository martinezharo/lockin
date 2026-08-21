// Lock In — dashboard logic

const groupsListEl = document.getElementById('groupsList');
const emptyStateEl = document.getElementById('emptyState');
const groupCountLabelEl = document.getElementById('groupCountLabel');

const lockSwitch = document.getElementById('lockSwitch');
const lockSwitchState = document.getElementById('lockSwitchState');
const lockSwitchIcon = lockSwitch.querySelector('.lock-switch-icon');

const modal = document.getElementById('challengeModal');
const modalEmoji = document.getElementById('modalEmoji');
const challengeTextEl = document.getElementById('challengeText');
const challengeInputEl = document.getElementById('challengeInput');
const challengeErrorEl = document.getElementById('challengeError');

let pendingAction = null;
let currentTarget = '';

const MODAL_EMOJIS = ['🔒', '💅', '✨', '🧠', '🔥', '🌟', '🚀', '💖', '🕹️', '📚'];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ---------------- Challenge modal ---------------- */

function openChallenge(action) {
  pendingAction = action;
  currentTarget = pickChallengeParagraph();
  challengeTextEl.textContent = currentTarget;
  challengeInputEl.value = '';
  challengeErrorEl.textContent = '';
  modalEmoji.textContent = MODAL_EMOJIS[Math.floor(Math.random() * MODAL_EMOJIS.length)];
  modal.classList.remove('hidden');
  setTimeout(() => challengeInputEl.focus(), 30);
}

function closeChallenge() {
  pendingAction = null;
  modal.classList.add('hidden');
}

challengeTextEl.addEventListener('copy', (e) => e.preventDefault());
challengeTextEl.addEventListener('cut', (e) => e.preventDefault());
challengeTextEl.addEventListener('contextmenu', (e) => e.preventDefault());
challengeTextEl.addEventListener('selectstart', (e) => e.preventDefault());

challengeInputEl.addEventListener('paste', (e) => e.preventDefault());
challengeInputEl.addEventListener('drop', (e) => e.preventDefault());
challengeInputEl.addEventListener('contextmenu', (e) => e.preventDefault());

document.getElementById('challengeSubmit').addEventListener('click', () => {
  if (isChallengeMatch(challengeInputEl.value, currentTarget)) {
    const action = pendingAction;
    closeChallenge();
    if (action) action();
  } else {
    challengeErrorEl.textContent = "not quite bestie, type it exactly as shown 🥲 try again";
    modal.classList.add('shake');
    setTimeout(() => modal.classList.remove('shake'), 400);
  }
});

// Dev-mode escape hatch: the modal still shows up exactly as usual, but with
// DEV_MODE on in env.js this shortcut runs the pending action without typing.
document.addEventListener('keydown', (e) => {
  if (!isDevMode()) return;
  if (modal.classList.contains('hidden')) return;
  if (!(e.ctrlKey && e.shiftKey && e.key === 'Enter')) return;
  e.preventDefault();
  const action = pendingAction;
  closeChallenge();
  if (action) action();
});

document.getElementById('challengeCancel').addEventListener('click', closeChallenge);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeChallenge();
});

async function withLockCheck(action) {
  const lockMode = await Storage.getLockMode();
  if (!lockMode) {
    action();
    return;
  }
  openChallenge(action);
}

/* ---------------- Lock switch ---------------- */

async function refreshLockSwitch() {
  const lockMode = await Storage.getLockMode();
  lockSwitch.setAttribute('aria-pressed', String(lockMode));
  lockSwitchState.textContent = lockMode ? 'on' : 'off';
  lockSwitchIcon.textContent = lockMode ? '🔒' : '🔓';
}

lockSwitch.addEventListener('click', async () => {
  const lockMode = await Storage.getLockMode();
  if (!lockMode) {
    await Storage.setLockMode(true);
    refreshLockSwitch();
  } else {
    openChallenge(async () => {
      await Storage.setLockMode(false);
      refreshLockSwitch();
    });
  }
});

/* ---------------- Dev mode banner ---------------- */

// The shortcut is only worth advertising while it actually works, so both the
// top banner and the in-modal hint follow DEV_MODE.
function refreshDevBanner() {
  const on = isDevMode();
  document.getElementById('devBanner').hidden = !on;
  document.getElementById('challengeDevHint').hidden = !on;
}

/* ---------------- New group form ---------------- */

const scheduleField = document.getElementById('scheduleField');
const scheduleStartInput = document.getElementById('scheduleStart');
const scheduleEndInput = document.getElementById('scheduleEnd');

// Keep a `.checked` class in sync on day-toggle labels so the styling
// doesn't depend on :has() support.
function wireDayToggleStyling(root) {
  root.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    const sync = () => cb.closest('label').classList.toggle('checked', cb.checked);
    cb.addEventListener('change', sync);
    sync();
  });
}
wireDayToggleStyling(document.getElementById('dayToggle'));

function timeStringToMinutes(str) {
  const [h, m] = String(str || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTimeString(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    scheduleField.hidden = mode !== 'schedule';
  });
});

document.getElementById('newGroupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('groupName').value.trim();
  const domainsRaw = document.getElementById('groupDomains').value;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const domains = Array.from(
    new Set(
      domainsRaw
        .split(/[\n,]/)
        .map(normalizeDomainInput)
        .filter(Boolean)
    )
  );
  if (!name || domains.length === 0) return;

  let schedule = null;
  if (mode === 'schedule') {
    const days = Array.from(document.querySelectorAll('#dayToggle input:checked')).map((cb) =>
      Number(cb.value)
    );
    if (days.length === 0) {
      alert('Pick at least one day for the schedule.');
      return;
    }
    schedule = {
      days,
      start: timeStringToMinutes(scheduleStartInput.value),
      end: timeStringToMinutes(scheduleEndInput.value)
    };
  }

  const groups = await Storage.getGroups();
  const group = {
    id: uid(),
    name,
    domains,
    enabled: true,
    mode,
    schedule,
    createdAt: Date.now()
  };
  groups.push(group);
  await Storage.saveGroups(groups);

  e.target.reset();
  scheduleField.hidden = true;
  document.querySelectorAll('#dayToggle label.checked').forEach((l) => l.classList.remove('checked'));
  render();
});

/* ---------------- Group actions ---------------- */

async function deleteGroup(id) {
  withLockCheck(async () => {
    let groups = await Storage.getGroups();
    groups = groups.filter((g) => g.id !== id);
    await Storage.saveGroups(groups);
    render();
  });
}

async function disableGroup(id) {
  withLockCheck(async () => {
    const groups = await Storage.getGroups();
    const g = groups.find((g) => g.id === id);
    if (!g) return;
    g.enabled = false;
    await Storage.saveGroups(groups);
    render();
  });
}

async function enableGroup(id) {
  const groups = await Storage.getGroups();
  const g = groups.find((g) => g.id === id);
  if (!g) return;
  g.enabled = true;
  await Storage.saveGroups(groups);
  render();
}

async function removeDomain(groupId, domain) {
  withLockCheck(async () => {
    const groups = await Storage.getGroups();
    const g = groups.find((g) => g.id === groupId);
    if (!g) return;
    g.domains = g.domains.filter((d) => d !== domain);
    await Storage.saveGroups(groups);
    render();
  });
}

const editingScheduleIds = new Set();

async function saveSchedule(groupId, schedule) {
  // Changing the hours can loosen an existing block, so it gets the same
  // typing-challenge friction as disabling one.
  withLockCheck(async () => {
    const groups = await Storage.getGroups();
    const g = groups.find((g) => g.id === groupId);
    if (!g) return;
    g.schedule = schedule;
    await Storage.saveGroups(groups);
    editingScheduleIds.delete(groupId);
    render();
  });
}

async function addDomain(groupId, rawDomain) {
  const domain = normalizeDomainInput(rawDomain);
  if (!domain) return;
  const groups = await Storage.getGroups();
  const g = groups.find((g) => g.id === groupId);
  if (!g) return;
  if (!g.domains.includes(domain)) g.domains.push(domain);
  await Storage.saveGroups(groups);
  render();
}

/* ---------------- Rendering ---------------- */

function groupCardHtml(g, now) {
  const active = isGroupActive(g, now);
  const chips = g.domains
    .map(
      (d) => `
      <span class="chip">
        ${escapeHtml(d)}
        <button type="button" data-action="remove-domain" data-group="${g.id}" data-domain="${escapeHtml(d)}" title="Remove site" aria-label="Remove ${escapeHtml(d)}">&times;</button>
      </span>`
    )
    .join('');

  let lcdHtml;
  if (g.mode === 'schedule') {
    const days = (g.schedule && g.schedule.days) || [];
    lcdHtml = `<div class="lcd ${active ? 'on' : ''}" data-sched-lcd data-group="${g.id}"
        data-enabled="${g.enabled}" data-days="${days.join(',')}"
        data-start="${g.schedule ? g.schedule.start : 0}" data-end="${g.schedule ? g.schedule.end : 0}">
        ${!g.enabled ? '&#9675; armed off' : active ? '&#9679; blocking now' : '&#9675; waiting'}
        &middot; ${escapeHtml(formatSchedule(g.schedule))}
      </div>`;
  } else {
    lcdHtml = active
      ? `<div class="lcd on" data-permanent>&#9679; permanent &middot; blocking</div>`
      : `<div class="lcd">&#9675; not blocking</div>`;
  }

  let actionsHtml;
  if (g.mode === 'schedule') {
    const armToggle = g.enabled
      ? `<button type="button" class="ghost" data-action="disable" data-group="${g.id}">Disable</button>`
      : `<button type="button" class="primary" data-action="enable" data-group="${g.id}">Enable</button>`;
    actionsHtml = `
      ${armToggle}
      <button type="button" class="ghost" data-action="edit-schedule" data-group="${g.id}">Edit hours</button>
      <button type="button" class="btn-danger" data-action="delete" data-group="${g.id}">Delete</button>
    `;
  } else if (active) {
    actionsHtml = `
      <button type="button" class="ghost" data-action="disable" data-group="${g.id}">Disable</button>
      <button type="button" class="btn-danger" data-action="delete" data-group="${g.id}">Delete</button>
    `;
  } else {
    actionsHtml = `
      <button type="button" class="primary" data-action="enable" data-group="${g.id}">Enable</button>
      <button type="button" class="btn-danger" data-action="delete" data-group="${g.id}">Delete</button>
    `;
  }

  const scheduleEditorHtml =
    g.mode === 'schedule' && editingScheduleIds.has(g.id) ? scheduleEditorFormHtml(g) : '';

  return `
    <div class="group-card ${active ? 'active' : ''}" data-group-card="${g.id}">
      <div class="group-card-head">
        <span class="group-name">${escapeHtml(g.name)}</span>
        <span class="group-count">${g.domains.length} site${g.domains.length === 1 ? '' : 's'}</span>
      </div>
      ${lcdHtml}
      ${scheduleEditorHtml}
      <div class="domain-chips">${chips || '<span class="muted">no sites</span>'}</div>
      <div class="add-domain-row">
        <input type="text" placeholder="add a site..." data-add-domain-input="${g.id}" />
        <button type="button" class="ghost" data-action="add-domain" data-group="${g.id}">Add</button>
      </div>
      <div class="group-actions">${actionsHtml}</div>
    </div>
  `;
}

const DAY_TOGGLE_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' }
];

function scheduleEditorFormHtml(g) {
  const days = new Set((g.schedule && g.schedule.days) || []);
  const start = g.schedule ? g.schedule.start : 9 * 60;
  const end = g.schedule ? g.schedule.end : 17 * 60;
  const dayInputs = DAY_TOGGLE_OPTIONS.map(
    ({ value, label }) => `
      <label class="${days.has(value) ? 'checked' : ''}">
        <input type="checkbox" class="sched-edit-day" value="${value}" ${days.has(value) ? 'checked' : ''} /> ${label}
      </label>`
  ).join('');

  return `
    <div class="schedule-editor" data-schedule-editor="${g.id}">
      <div class="day-toggle">${dayInputs}</div>
      <div class="field-row schedule-time-row">
        <label class="field">
          <span class="field-label">From</span>
          <input type="time" class="sched-edit-start" value="${minutesToTimeString(start)}" />
        </label>
        <label class="field">
          <span class="field-label">Until</span>
          <input type="time" class="sched-edit-end" value="${minutesToTimeString(end)}" />
        </label>
      </div>
      <div class="schedule-actions">
        <button type="button" class="primary" data-action="save-schedule" data-group="${g.id}">Save</button>
        <button type="button" class="ghost" data-action="cancel-edit-schedule" data-group="${g.id}">Cancel</button>
      </div>
    </div>
  `;
}

async function render() {
  const [groups, lockMode] = await Promise.all([Storage.getGroups(), Storage.getLockMode()]);
  const now = Date.now();

  groups.sort((a, b) => b.createdAt - a.createdAt);

  groupCountLabelEl.textContent = groups.length
    ? `${groups.filter((g) => isGroupActive(g, now)).length} of ${groups.length} active`
    : '';

  if (groups.length === 0) {
    groupsListEl.innerHTML = '';
    emptyStateEl.hidden = false;
  } else {
    emptyStateEl.hidden = true;
    groupsListEl.innerHTML = groups.map((g) => groupCardHtml(g, now)).join('');
  }

  refreshLockSwitch();
}

groupsListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const groupId = btn.dataset.group;

  if (action === 'delete') deleteGroup(groupId);
  else if (action === 'disable') disableGroup(groupId);
  else if (action === 'enable') enableGroup(groupId);
  else if (action === 'remove-domain') {
    removeDomain(groupId, btn.dataset.domain);
  } else if (action === 'add-domain') {
    const card = btn.closest('.group-card');
    const input = card.querySelector('[data-add-domain-input]');
    addDomain(groupId, input.value);
    input.value = '';
  } else if (action === 'edit-schedule') {
    editingScheduleIds.add(groupId);
    render();
  } else if (action === 'cancel-edit-schedule') {
    editingScheduleIds.delete(groupId);
    render();
  } else if (action === 'save-schedule') {
    const editor = btn.closest('.schedule-editor');
    const days = Array.from(editor.querySelectorAll('.sched-edit-day:checked')).map((cb) =>
      Number(cb.value)
    );
    if (days.length === 0) {
      alert('Pick at least one day for the schedule.');
      return;
    }
    const schedule = {
      days,
      start: timeStringToMinutes(editor.querySelector('.sched-edit-start').value),
      end: timeStringToMinutes(editor.querySelector('.sched-edit-end').value)
    };
    saveSchedule(groupId, schedule);
  }
});

// Keep the `.checked` styling class in sync for day checkboxes inside
// dynamically-rendered schedule editors.
groupsListEl.addEventListener('change', (e) => {
  if (e.target.matches('.sched-edit-day')) {
    e.target.closest('label').classList.toggle('checked', e.target.checked);
  }
});

groupsListEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-add-domain-input]')) {
    e.preventDefault();
    const groupId = e.target.getAttribute('data-add-domain-input');
    addDomain(groupId, e.target.value);
    e.target.value = '';
  }
});

/* ---------------- Live countdown tick ---------------- */

function refreshGroupCountLabel() {
  const cards = document.querySelectorAll('.group-card');
  if (!cards.length) return;
  const active = document.querySelectorAll('.group-card.active').length;
  groupCountLabelEl.textContent = `${active} of ${cards.length} active`;
}

setInterval(() => {
  const now = Date.now();
  document.querySelectorAll('.lcd[data-sched-lcd]').forEach((el) => {
    const enabled = el.dataset.enabled === 'true';
    const days = el.dataset.days ? el.dataset.days.split(',').filter((d) => d !== '').map(Number) : [];
    const schedule = { days, start: Number(el.dataset.start), end: Number(el.dataset.end) };
    const desc = formatSchedule(schedule);
    const withinWindow = isWithinSchedule(schedule, new Date(now));
    const isActive = enabled && withinWindow;

    el.textContent = `${!enabled ? '○ armed off' : isActive ? '● blocking now' : '○ waiting'} · ${desc}`;
    el.classList.toggle('on', isActive);
    el.closest('.group-card')?.classList.toggle('active', isActive);
  });

  refreshGroupCountLabel();
}, 1000);

refreshDevBanner();
render();
