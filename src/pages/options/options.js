// Lock In — dashboard: state, storage writes and event wiring.
// Markup lives in templates.js, the typing challenge in lock-gate.js.

import { Storage } from '../../shared/storage.js';
import { uid, normalizeDomainInput, parseDomainList } from '../../shared/domains.js';
import { isGroupActive } from '../../shared/schedule.js';
import { isDevMode } from '../../shared/dev-mode.js';
import { withLockCheck, toggleLockMode } from './lock-gate.js';
import { groupCardHtml, rulesControlsHtml, readRules, lcdText, meterState } from './templates.js';

const groupsListEl = document.getElementById('groupsList');
const emptyStateEl = document.getElementById('emptyState');
const groupCountLabelEl = document.getElementById('groupCountLabel');

const lockSwitch = document.getElementById('lockSwitch');
const lockSwitchState = document.getElementById('lockSwitchState');
const lockSwitchIcon = lockSwitch.querySelector('.lock-switch-icon');

const newGroupForm = document.getElementById('newGroupForm');
const rulesControls = document.getElementById('rulesControls');

const editingIds = new Set();

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
   site or a group is deliberately free. */

const deleteGroup = (id) => withLockCheck(() => updateGroups((gs) => gs.filter((g) => g.id !== id)));

const disableGroup = (id) => withLockCheck(() => updateGroup(id, (g) => { g.enabled = false; }));

const removeDomain = (id, domain) =>
  withLockCheck(() => updateGroup(id, (g) => { g.domains = g.domains.filter((d) => d !== domain); }));

// Changing the rules can loosen an existing block — later gate hours, a bigger
// allowance, a rule switched off entirely — so the whole save gets the same
// typing-challenge friction as disabling a group.
const saveRules = (id, rules) =>
  withLockCheck(() =>
    updateGroup(id, (g) => {
      g.schedule = rules.schedule;
      g.limit = rules.limit;
      editingIds.delete(id);
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
  lockSwitchState.textContent = lockMode ? 'sealed' : 'open';
  lockSwitchIcon.textContent = lockMode ? '🔒' : '🔓';
}

lockSwitch.addEventListener('click', () => toggleLockMode(refreshLockSwitch));

document.getElementById('devBanner').hidden = !isDevMode();

/* ---------------- New group form ---------------- */

function resetRulesControls() {
  rulesControls.innerHTML = rulesControlsHtml();
}
resetRulesControls();

newGroupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('groupName').value.trim();
  const domains = parseDomainList(document.getElementById('groupDomains').value);
  if (!name || domains.length === 0) return;

  const rules = readRules(rulesControls);
  if (!rules) return;

  await updateGroups((groups) => {
    groups.push({ id: uid(), name, domains, enabled: true, ...rules, createdAt: Date.now() });
  });

  // reset() clears the inputs but not the checked styling on day pills, rule
  // blocks and presets, so the controls are rebuilt from the template instead
  // of untangled.
  newGroupForm.reset();
  resetRulesControls();
});

/* ---------------- Rendering ---------------- */

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
    ? `${groups.filter((g) => isGroupActive(g, now, usage, session)).length} of ${groups.length} zones active`
    : '';

  emptyStateEl.hidden = groups.length > 0;
  groupsListEl.innerHTML = groups.map((g) => groupCardHtml(g, now, editingIds, usage, session)).join('');

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
  'edit-rules': (id) => {
    editingIds.add(id);
    render();
  },
  'cancel-edit-rules': (id) => {
    editingIds.delete(id);
    render();
  },
  'save-rules': (id, btn) => {
    const editor = btn.closest('.rules-editor');
    const rules = readRules(editor);
    if (rules) saveRules(id, rules);
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

/* ---------------- Rule controls ----------------
   The create form and every inline editor render the same markup, so all of
   this is delegated from the document once instead of being re-wired each
   time a card opens its editor. */

function markPresets(root) {
  const minutes = Number(root.querySelector('[data-limit-minutes]').value);
  root.querySelectorAll('[data-limit-preset]').forEach((btn) => {
    btn.classList.toggle('checked', Number(btn.dataset.limitPreset) === minutes);
  });
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
    block.classList.toggle('on', e.target.checked);
    block.querySelector('[data-rule-body]').disabled = !e.target.checked;
    refreshNoRulesHint(block.parentElement);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.matches('[data-limit-minutes]')) markPresets(e.target.closest('[data-rule-body]'));
});

document.addEventListener('click', (e) => {
  const preset = e.target.closest('[data-limit-preset]');
  if (!preset) return;
  const body = preset.closest('[data-rule-body]');
  body.querySelector('[data-limit-minutes]').value = preset.dataset.limitPreset;
  markPresets(body);
});

/* ---------------- Live tick ----------------
   Schedule windows open and close on the clock and allowances run down while
   the tiny mammal browses, neither of which is a storage change this page can
   react to. Cards refresh themselves once a second instead — text and widths
   only, never a re-render, so open editors and half-typed domains survive. */

setInterval(async () => {
  if (renderedGroups.length === 0) return;

  const [usage, session] = await Promise.all([Storage.getUsage(), Storage.getUsageSession()]);
  const now = Date.now();
  let activeCount = 0;

  for (const g of renderedGroups) {
    const card = groupsListEl.querySelector(`[data-group-card="${g.id}"]`);
    if (!card) continue;

    const active = isGroupActive(g, now, usage, session);
    if (active) activeCount += 1;
    card.classList.toggle('active', active);

    const lcd = card.querySelector('[data-lcd]');
    lcd.textContent = lcdText(g, now, usage, session);
    lcd.classList.toggle('on', active);

    const meter = card.querySelector('[data-meter]');
    if (!meter) continue;
    const { percent, label, spent } = meterState(g, now, usage, session);
    meter.classList.toggle('spent', spent);
    meter.querySelector('.meter-fill').style.width = `${percent.toFixed(1)}%`;
    meter.querySelector('.meter-label').textContent = label;
  }

  groupCountLabelEl.textContent = `${activeCount} of ${renderedGroups.length} zones active`;
}, 1000);

render();
