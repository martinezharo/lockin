// Lock In — dashboard: state, storage writes and event wiring.
// Markup lives in templates.js, the typing challenge in lock-gate.js.

import { Storage } from '../../shared/storage.js';
import { uid, normalizeSiteInput, parseSiteList, exceptionFitsDomains, siteMatches } from '../../shared/domains.js';
import { timeValueToMinutes } from '../../shared/schedule.js';
import { MINUTES_PER_DAY, formatClock } from '../../shared/timeline.js';
import { enforcementReasonText } from '../../shared/enforcement.js';
import { withLockCheck, toggleLockMode } from './lock-gate.js';
import { initStrictMode, paintStrictMode } from './strict-mode.js';
import { lockIconHtml } from '../../shared/lock-icon.js';
import {
  zoneRowHtml,
  dayStripHtml,
  nowPanelState,
  rulesControlsHtml,
  scheduleWindowRowHtml,
  readRules,
  zoneStatusText,
  zoneStateClass,
  meterState
} from './templates.js';

const groupsListEl = document.getElementById('groupsList');
const emptyStateEl = document.getElementById('emptyState');
const groupCountLabelEl = document.getElementById('groupCountLabel');

const dayPanelEl = document.getElementById('dayPanel');
const dayStripEl = document.getElementById('dayStrip');
const dayNameEl = document.getElementById('dayName');

const nowClockEl = document.getElementById('nowClock');
const nowHeadlineEl = document.getElementById('nowHeadline');
const nowDetailEl = document.getElementById('nowDetail');
const nowStampEl = document.getElementById('nowStamp');
const nowCountdownEl = document.getElementById('nowCountdown');
const nowCountdownLabelEl = document.getElementById('nowCountdownLabel');

const lockSwitch = document.getElementById('lockSwitch');
const lockSwitchState = document.getElementById('lockSwitchState');
const lockSwitchIcon = lockSwitch.querySelector('.lock-switch-icon');
const lockNote = document.getElementById('lockNote');

const newZone = document.getElementById('newZone');
const newZoneToggle = document.getElementById('newZoneToggle');
const newZoneBody = document.getElementById('newZoneBody');
const newGroupForm = document.getElementById('newGroupForm');
const rulesControls = document.getElementById('rulesControls');
const privacyConsentModal = document.getElementById('privacyConsentModal');
const servicePanel = document.getElementById('servicePanel');
const serviceHeadline = document.getElementById('serviceHeadline');
const serviceDetail = document.getElementById('serviceDetail');
const serviceReason = document.getElementById('serviceReason');

// Exactly one zone is expanded at a time. A page with three open editors was
// the old dashboard's worst habit; this is a Set of one so the rule is
// enforced in a single place rather than remembered at every call site.
const openIds = new Set();

function openOnly(id) {
  const wasOpen = openIds.has(id);
  openIds.clear();
  if (!wasOpen) openIds.add(id);
  if (openIds.size > 0) closeNewZone();
}

// The per-second tick needs the groups it is refreshing, and re-reading them
// from storage every second to redraw a countdown would be silly. Usage is
// read fresh each tick instead — that is the part that actually moves.
let renderedGroups = [];

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
   site or a zone is deliberately free. */

const deleteGroup = (id) =>
  withLockCheck(() => {
    openIds.delete(id);
    return updateGroups((gs) => gs.filter((g) => g.id !== id));
  });

const disableGroup = (id) => withLockCheck(() => updateGroup(id, (g) => { g.enabled = false; }));

const removeDomain = (id, domain) =>
  withLockCheck(() => updateGroup(id, (g) => { g.domains = g.domains.filter((d) => d !== domain); }));

const removeException = (id, exception) =>
  updateGroup(id, (g) => { g.exceptions = (g.exceptions || []).filter((item) => item !== exception); });

// Changing the rules can loosen an existing block — later gate hours, a bigger
// allowance, a rule switched off entirely — so the whole save gets the same
// typing-challenge friction as disarming a zone.
const saveRules = (id, rules) =>
  withLockCheck(() =>
    updateGroup(id, (g) => {
      g.schedule = rules.schedule;
      g.limit = rules.limit;
      openIds.delete(id);
    })
  );

const enableGroup = (id) => updateGroup(id, (g) => { g.enabled = true; });

function saveGroupName(id, input) {
  const name = input.value.trim();
  if (!name) {
    input.setCustomValidity('Enter a zone name.');
    input.reportValidity();
    return;
  }
  input.setCustomValidity('');
  return updateGroup(id, (g) => { g.name = name; });
}

async function checkUrlSupport(rules, input) {
  const { nativeStatus } = await chrome.storage.local.get('nativeStatus');
  if (rules.some(rule => /[/? :]/.test(rule)) && nativeStatus?.supportsUrlRules !== true) {
    input.setCustomValidity('Update the Windows watchdog and reload the extension before adding URL rules.');
    input.reportValidity();
    return false;
  }
  return true;
}

async function addDomain(id, input) {
  const domain = normalizeSiteInput(input.value);
  if (!domain) {
    input.setCustomValidity('Enter a valid domain or HTTP(S) URL, without credentials or wildcards.');
    input.reportValidity();
    return;
  }
  if (!(await checkUrlSupport([domain], input))) return;
  input.setCustomValidity('');
  input.value = '';
  return updateGroup(id, (g) => {
    if (!g.domains.includes(domain)) g.domains.push(domain);
  });
}

async function addException(id, input) {
  const exception = normalizeSiteInput(input.value);
  const groups = await Storage.getGroups();
  const group = groups.find((item) => item.id === id);
  let message = '';
  if (!exception) message = 'Enter a valid HTTP(S) URL, without credentials or wildcards.';
  else if (!exceptionFitsDomains(exception, group?.domains)) message = 'Use a path inside one of this zone\'s forbidden tunnels; a whole domain cannot be exempted.';
  else if (groups.some((other) => other.id !== id && other.enabled && other.domains.some(rule => siteMatches('https://' + exception, rule)))) {
    message = 'Another armed zone also contains this page. Move or remove that overlapping rule before allowing it here.';
  }
  if (message) {
    input.setCustomValidity(message);
    input.reportValidity();
    return;
  }
  const { nativeStatus } = await chrome.storage.local.get('nativeStatus');
  if (nativeStatus?.supportsExceptions !== true) {
    input.setCustomValidity('Update the Windows watchdog and reload the extension before adding always-allowed pages.');
    input.reportValidity();
    return;
  }
  if (!(await checkUrlSupport([exception], input))) return;
  input.setCustomValidity('');
  return withLockCheck(() => updateGroup(id, (g) => {
    input.value = '';
    g.exceptions ||= [];
    if (!g.exceptions.includes(exception)) g.exceptions.push(exception);
  }));
}

/* ---------------- Lock switch and dev banner ---------------- */

async function refreshLockSwitch() {
  const lockMode = await Storage.getLockMode();
  lockSwitch.setAttribute('aria-pressed', String(lockMode));
  lockSwitchState.textContent = lockMode ? 'sealed' : 'open';
  lockSwitchIcon.innerHTML = lockIconHtml(lockMode, 16);
  lockNote.textContent = lockMode
    ? 'weakening containment needs paperwork'
    : 'anything can be undone right now 🐭';
}

lockSwitch.addEventListener('click', () => toggleLockMode(refreshLockSwitch));

/* ---------------- Privacy consent and local data ---------------- */

async function refreshPrivacyConsent() {
  const accepted = await Storage.getPrivacyConsent();
  privacyConsentModal.classList.toggle('hidden', accepted);
  return accepted;
}

document.getElementById('privacyConsentAccept').addEventListener('click', async () => {
  await Storage.setPrivacyConsent(true);
  privacyConsentModal.classList.add('hidden');
  await render();
});

document.getElementById('deleteLocalData').addEventListener('click', () => {
  const confirmed = window.confirm(
    'Delete every Lock In zone, schedule, usage total, watchdog state, and consent choice stored on this device?'
  );
  if (!confirmed) return;

  withLockCheck(async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'lockin-native-clear' });
      if (!result?.ok) throw new Error(result?.error || 'The watchdog rejected the delete request.');
      await Storage.clearAll();
      location.reload();
    } catch (error) {
      window.alert(`Lock In could not delete its protected watchdog data: ${error.message}`);
    }
  });
});

async function refreshServiceStatus() {
  const { nativeStatus = null } = await chrome.storage.local.get('nativeStatus');
  servicePanel.className = 'service-panel';
  // The super-strict guide answers the question this panel raises, so it is
  // repainted from the same reading rather than polling for its own copy.
  paintStrictMode(nativeStatus);

  if (!nativeStatus?.connected) {
    servicePanel.classList.add('state-disconnected');
    serviceHeadline.textContent = 'Local enforcement watchdog disconnected';
    serviceDetail.textContent = nativeStatus?.error || 'Install or start the Lock In Watchdog task to restore protected enforcement.';
    serviceReason.textContent = 'sensor offline';
    return;
  }

  if (!nativeStatus.enforcementArmed) {
    servicePanel.classList.add('state-warning');
    serviceHeadline.textContent = 'Watchdog connected · safe rollout not armed yet';
    serviceDetail.textContent = 'Three valid sensor heartbeats are required before Windows policies can activate.';
    serviceReason.textContent = enforcementReasonText(nativeStatus.enforcementReason, 'not armed yet');
    return;
  }

  const blocking = (nativeStatus.blockedDomains || []).length > 0;
  const protectedAccounts = (nativeStatus.protectedWindowsAccounts?.length
    ? nativeStatus.protectedWindowsAccounts
    : [nativeStatus.protectedWindowsAccount]
  ).filter(Boolean).map((account) => account.split('\\').pop());
  servicePanel.classList.add(blocking ? 'state-blocking' : 'state-ready');
  serviceHeadline.textContent = blocking
    ? `Windows is containing ${nativeStatus.blockedDomains.length} site rule${nativeStatus.blockedDomains.length === 1 ? '' : 's'}`
    : 'Windows enforcement armed · tunnels currently open';
  const accountPrefix = protectedAccounts.length
    ? `Protected Windows users: ${protectedAccounts.join(' + ')}. `
    : '';
  serviceDetail.textContent = accountPrefix + (nativeStatus.failClosedActive
    ? 'Lock In sensor disappeared, so the watchdog blocked browser networking.'
    : 'Usage and schedules are owned by the protected local watchdog.');
  serviceReason.textContent = enforcementReasonText(nativeStatus.enforcementReason);
}

/* ---------------- The new-permit row ----------------
   Folded away by default: creating a zone is the rarest thing anyone does
   here, and it used to own the top of the page. */

function closeNewZone() {
  newZone.classList.remove('is-open');
  newZoneToggle.setAttribute('aria-expanded', 'false');
  newZoneBody.hidden = true;
}

function openNewZone() {
  openIds.clear();
  render();
  newZone.classList.add('is-open');
  newZoneToggle.setAttribute('aria-expanded', 'true');
  newZoneBody.hidden = false;
  document.getElementById('groupName').focus();
}

newZoneToggle.addEventListener('click', () => {
  if (newZoneBody.hidden) openNewZone();
  else closeNewZone();
});

document.getElementById('newZoneCancel').addEventListener('click', () => {
  resetNewGroupForm();
  closeNewZone();
});

function resetRulesControls() {
  rulesControls.innerHTML = rulesControlsHtml();
}
resetRulesControls();

// reset() clears the inputs but not the checked styling on day pills, rule
// blocks and presets, so the controls are rebuilt from the template instead
// of untangled.
function resetNewGroupForm() {
  newGroupForm.reset();
  resetRulesControls();
}

document.getElementById('groupDomains').addEventListener('input', (e) => e.target.setCustomValidity(''));

newGroupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('groupName').value.trim();
  const sitesInput = document.getElementById('groupDomains');
  let domains;
  try { domains = parseSiteList(sitesInput.value); }
  catch (error) { sitesInput.setCustomValidity(error.message); sitesInput.reportValidity(); return; }
  sitesInput.setCustomValidity('');
  if (!name || domains.length === 0) return;
  if (!(await checkUrlSupport(domains, sitesInput))) return;

  const rules = readRules(rulesControls);
  if (!rules) return;

  await updateGroups((groups) => {
    groups.push({ id: uid(), name, domains, exceptions: [], enabled: true, ...rules, createdAt: Date.now() });
  });

  resetNewGroupForm();
  closeNewZone();
});

/* ---------------- Rendering ---------------- */

function paintNowPanel(groups, now, usage, session) {
  const { headline, detail, countdown, countdownLabel } = nowPanelState(groups, now, usage, session);
  const when = new Date(now);

  nowClockEl.textContent = `${formatClock(now)} · ${when.toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase()}`;
  nowHeadlineEl.textContent = headline;
  // nowPanelState escapes the zone name it interpolates; the rest is ours.
  nowDetailEl.innerHTML = detail;
  nowStampEl.hidden = !countdown;
  nowCountdownEl.textContent = countdown;
  nowCountdownLabelEl.textContent = countdownLabel;
}

function paintDayStrip(groups, now, usage, session) {
  dayPanelEl.hidden = groups.length === 0;
  if (groups.length === 0) return;
  dayNameEl.textContent = new Date(now).toLocaleDateString(undefined, { weekday: 'long' });
  dayStripEl.innerHTML = dayStripHtml(groups, now, usage, session);
}

async function render() {
  const [groups, usage, session] = await Promise.all([
    Storage.getGroups(),
    Storage.getUsage(),
    Storage.getUsageSession()
  ]);
  const now = Date.now();

  groups.sort((a, b) => b.createdAt - a.createdAt);
  renderedGroups = groups;

  groupCountLabelEl.textContent = groups.length
    ? `${groups.length} zone${groups.length === 1 ? '' : 's'} · ${new Set(groups.flatMap((g) => g.domains)).size} tunnels`
    : '';

  emptyStateEl.hidden = groups.length > 0;
  paintNowPanel(groups, now, usage, session);
  paintDayStrip(groups, now, usage, session);
  groupsListEl.innerHTML = groups.map((g) => zoneRowHtml(g, now, openIds, usage, session)).join('');

  refreshLockSwitch();
}

/* ---------------- Events ---------------- */

const ZONE_ACTIONS = {
  toggle: (id) => {
    openOnly(id);
    render();
  },
  delete: (id) => deleteGroup(id),
  disable: (id) => disableGroup(id),
  enable: (id) => enableGroup(id),
  'save-name': (id, btn) => {
    const input = btn.closest('.zone').querySelector('[data-zone-name-input]');
    saveGroupName(id, input);
  },
  'remove-domain': (id, btn) => removeDomain(id, btn.dataset.domain),
  'remove-exception': (id, btn) => removeException(id, btn.dataset.exception),
  'add-domain': (id, btn) => {
    const input = btn.closest('.zone').querySelector('[data-add-domain-input]');
    addDomain(id, input);
  },
  'add-exception': (id, btn) => {
    const input = btn.closest('.zone').querySelector('[data-add-exception-input]');
    addException(id, input);
  },
  'save-rules': (id, btn) => {
    const editor = btn.closest('.zone').querySelector('[data-rules-editor]');
    const rules = readRules(editor);
    if (rules) saveRules(id, rules);
  }
};

groupsListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const handler = ZONE_ACTIONS[btn.dataset.action];
  if (handler) handler(btn.dataset.group, btn);
});

groupsListEl.addEventListener('input', e => e.target.setCustomValidity?.(''));

groupsListEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;

  if (e.target.matches('[data-zone-name-input]')) {
    e.preventDefault();
    saveGroupName(e.target.getAttribute('data-zone-name-input'), e.target);
    return;
  }

  if (!e.target.matches('[data-add-domain-input], [data-add-exception-input]')) return;
  e.preventDefault();
  if (e.target.matches('[data-add-domain-input]')) addDomain(e.target.getAttribute('data-add-domain-input'), e.target);
  else addException(e.target.getAttribute('data-add-exception-input'), e.target);
});

/* ---------------- Rule controls ----------------
   The new-permit form and every open zone render the same markup, so all of
   this is delegated from the document once instead of being re-wired each
   time a zone opens. */

function markPresets(root) {
  const raw = root.querySelector('[data-limit-minutes]').value.trim();
  const minutes = Number(raw);
  root.querySelectorAll('[data-limit-preset]').forEach((btn) => {
    btn.classList.toggle('checked', raw !== '' && Number(btn.dataset.limitPreset) === minutes);
  });

  // Zero minutes is the permanent preset, which is a bigger promise than the
  // other four: it says so out loud the moment it is picked.
  const note = root.querySelector('[data-limit-permanent]');
  if (note) note.hidden = raw === '' || minutes !== 0;
}

// An off allowance claims nothing: no preset is picked and the permanent
// promise is not on screen, whatever number its box is holding.
function clearPresets(root) {
  root.querySelectorAll('[data-limit-preset]').forEach((btn) => btn.classList.remove('checked'));
  const note = root.querySelector('[data-limit-permanent]');
  if (note) note.hidden = true;
}

// The band above the time fields is the same picture as a row of the day
// strip, so editing the hours redraws it immediately rather than leaving the
// preview lying until the next save.
function paintWindowBand(root) {
  const band = root.querySelector('[data-window-band]');
  if (!band) return;
  const pct = (m) => `${((m / MINUTES_PER_DAY) * 100).toFixed(3)}%`;
  band.innerHTML = Array.from(root.querySelectorAll('[data-sched-window]')).map((row, index) => {
    const start = timeValueToMinutes(row.querySelector('[data-sched-start]').value);
    const end = timeValueToMinutes(row.querySelector('[data-sched-end]').value);
    const className = `band-fill window-${index % 3}`;
    return start === end
      ? `<span class="${className}" style="left: 0; width: 100%"></span>`
      : start > end
      ? `<span class="${className}" style="left: ${pct(start)}; width: ${pct(MINUTES_PER_DAY - start)}"></span>
         <span class="${className}" style="left: 0; width: ${pct(end)}"></span>`
      : `<span class="${className}" style="left: ${pct(start)}; width: ${pct(Math.max(0, end - start))}"></span>`;
  }).join('');
}

function refreshWindowRows(root) {
  const rows = Array.from(root.querySelectorAll('[data-sched-window]'));
  rows.forEach((row, index) => {
    row.querySelector('.window-number').textContent = String(index + 1);
    const remove = row.querySelector('[data-remove-window]');
    remove.hidden = rows.length === 1;
    remove.setAttribute('aria-label', `Remove time window ${index + 1}`);
  });
  paintWindowBand(root);
}

// "No rules set" is only true for the controls it sits in, so the hint is
// resolved against its own container rather than the page.
function refreshNoRulesHint(root) {
  const hint = root.querySelector('[data-no-rules-hint]');
  if (!hint) return;
  hint.hidden = root.dataset.noRulesAttempted !== 'true' ||
    Array.from(root.querySelectorAll('[data-rule-toggle]')).some((cb) => cb.checked);
}

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-sched-day]')) {
    e.target.closest('label').classList.toggle('checked', e.target.checked);
    return;
  }

  if (e.target.matches('[data-rule-toggle]')) {
    const block = e.target.closest('[data-rule-block]');
    const body = block.querySelector('[data-rule-body]');
    block.classList.toggle('on', e.target.checked);
    body.disabled = !e.target.checked;
    if (block.dataset.ruleBlock === 'limit') {
      if (e.target.checked) markPresets(body);
      else clearPresets(body);
    }
    refreshNoRulesHint(block.parentElement);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.matches('[data-zone-name-input]')) e.target.setCustomValidity('');
  if (e.target.matches('[data-add-domain-input], [data-add-exception-input]')) e.target.setCustomValidity('');
  if (e.target.matches('[data-limit-minutes]')) markPresets(e.target.closest('[data-rule-body]'));
  if (e.target.matches('[data-sched-start], [data-sched-end]')) paintWindowBand(e.target.closest('[data-rule-body]'));
});

document.addEventListener('click', (e) => {
  const addWindow = e.target.closest('[data-add-window]');
  if (addWindow) {
    const body = addWindow.closest('[data-rule-body]');
    const list = body.querySelector('[data-schedule-windows]');
    const rows = Array.from(list.querySelectorAll('[data-sched-window]'));
    const previousEnd = rows.length
      ? timeValueToMinutes(rows.at(-1).querySelector('[data-sched-end]').value)
      : 9 * 60;
    const start = (previousEnd + 60) % MINUTES_PER_DAY;
    const end = (start + 120) % MINUTES_PER_DAY;
    list.insertAdjacentHTML('beforeend', scheduleWindowRowHtml({ start, end }, rows.length, rows.length + 1));
    refreshWindowRows(body);
    list.lastElementChild.querySelector('[data-sched-start]').focus();
    return;
  }

  const removeWindow = e.target.closest('[data-remove-window]');
  if (removeWindow) {
    const body = removeWindow.closest('[data-rule-body]');
    if (body.querySelectorAll('[data-sched-window]').length > 1) removeWindow.closest('[data-sched-window]').remove();
    refreshWindowRows(body);
    return;
  }

  const preset = e.target.closest('[data-limit-preset]');
  if (!preset) return;
  const body = preset.closest('[data-rule-body]');
  body.querySelector('[data-limit-minutes]').value = preset.dataset.limitPreset;
  markPresets(body);
});

/* ---------------- Live tick ----------------
   Schedule windows open and close on the clock and allowances run down while
   the tiny mammal browses, neither of which is a storage change this page can
   react to. The board refreshes itself once a second instead — the now panel,
   the strip and each row's status line. Never a re-render of the rows
   themselves, so an open editor and a half-typed domain survive. */

setInterval(async () => {
  if (renderedGroups.length === 0) return;

  const [usage, session] = await Promise.all([Storage.getUsage(), Storage.getUsageSession()]);
  const now = Date.now();

  paintNowPanel(renderedGroups, now, usage, session);
  paintDayStrip(renderedGroups, now, usage, session);

  for (const g of renderedGroups) {
    const row = groupsListEl.querySelector(`[data-zone="${g.id}"]`);
    if (!row) continue;

    row.className = `zone state-${zoneStateClass(g, now, usage, session)}${openIds.has(g.id) ? ' is-open' : ''}`;
    row.querySelector(`[data-status="${g.id}"]`).textContent = zoneStatusText(g, now, usage, session);

    const meter = row.querySelector('[data-meter]');
    if (!meter) continue;
    const { percent, label, spent } = meterState(g, now, usage, session);
    meter.classList.toggle('spent', spent);
    meter.querySelector('.meter-fill').style.width = `${percent.toFixed(1)}%`;
    meter.querySelector('.meter-label').textContent = label;
  }
}, 1000);

setInterval(refreshServiceStatus, 2000);

refreshPrivacyConsent().then((accepted) => {
  if (accepted) render();
});
initStrictMode();
refreshServiceStatus();
