// Lock In — the export / import dialog behind the footer's one small button.
//
// The dialog is built here rather than written into options.html: it is a
// single feature with a single subject, and keeping the markup next to the
// counts it prints and the file it reads stops the two from drifting.
//
// Exporting is free — it only reads. Restoring goes through the edit lock,
// because replacing every zone at once can open tunnels that were shut, and
// that is exactly the paperwork the lock is for.
//
// The overlay sits below the challenge modal (z-index 40 against its 50), so
// the typing challenge is served on top of the dialog that asked for it.
// Cancelling the challenge leaves the picked file sitting in the dialog.

import { Storage } from '../../shared/storage.js';
import { buildBackup, backupFileName, readBackup } from '../../shared/backup.js';
import { withLockCheck } from './lock-gate.js';

const overlay = document.createElement('div');
overlay.id = 'backupModal';
overlay.className = 'modal-overlay backup-overlay hidden';
overlay.innerHTML = `
  <div class="modal-card backup-card" role="dialog" aria-modal="true"
    aria-labelledby="backupTitle" aria-describedby="backupBody">
    <div class="info-modal-heading">
      <h3 id="backupTitle">zones out, zones in 🧳</h3>
      <button type="button" class="info-modal-close" data-backup="close"
        aria-label="Close the export / import dialog">×</button>
    </div>
    <p class="backup-intro" id="backupBody">
      One JSON file with every zone: tunnels, always-allowed pages, hours, allowances and
      application targets. It is written and read on this device — nothing is uploaded.
    </p>
    <div class="backup-actions">
      <button type="button" class="primary" data-backup="export">Download a backup</button>
      <button type="button" class="ghost" data-backup="pick">Restore from a file…</button>
      <input type="file" accept=".json,application/json" hidden data-backup="file" />
    </div>
    <p class="backup-status" data-backup="status" hidden></p>
    <div class="backup-confirm" data-backup="confirm" hidden>
      <p class="backup-confirm-copy" data-backup="confirm-copy"></p>
      <div class="backup-actions">
        <button type="button" class="primary" data-backup="apply">Replace every zone</button>
        <button type="button" class="ghost" data-backup="discard">Pick another file</button>
      </div>
    </div>
    <div class="modal-actions"><button type="button" class="ghost" data-backup="close">Done</button></div>
  </div>`;
document.body.append(overlay);

const card = overlay.querySelector('.backup-card');
const statusEl = overlay.querySelector('[data-backup="status"]');
const confirmEl = overlay.querySelector('[data-backup="confirm"]');
const confirmCopyEl = overlay.querySelector('[data-backup="confirm-copy"]');
const fileInput = overlay.querySelector('[data-backup="file"]');

let pendingGroups = null;
let previousFocus = null;
let onRestored = () => {};

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function tally(groups) {
  const tunnels = new Set(groups.flatMap((group) => group.domains)).size;
  const apps = new Set(groups.flatMap((group) => group.apps || [])).size;
  const freePasses = groups.reduce((total, group) => total + (group.exceptions || []).length, 0);
  const parts = [plural(groups.length, 'zone')];
  if (tunnels > 0) parts.push(plural(tunnels, 'tunnel'));
  if (apps > 0) parts.push(plural(apps, 'app target'));
  if (freePasses > 0) parts.push(plural(freePasses, 'free pass', 'free passes'));
  return parts.join(' · ');
}

function setStatus(message, tone) {
  statusEl.hidden = !message;
  statusEl.textContent = message || '';
  statusEl.dataset.tone = tone || '';
}

function clearPending() {
  pendingGroups = null;
  confirmEl.hidden = true;
  fileInput.value = '';
}

function focusable() {
  return Array.from(
    card.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter((el) => el.offsetParent !== null);
}

function open() {
  previousFocus = document.activeElement;
  clearPending();
  setStatus('');
  overlay.classList.remove('hidden');
  overlay.querySelector('[data-backup="close"]').focus();
}

function dismiss() {
  if (overlay.classList.contains('hidden')) return;
  overlay.classList.add('hidden');
  const target = previousFocus;
  previousFocus = null;
  if (target?.isConnected) target.focus();
}

/* ---------- Export ---------- */

async function exportBackup() {
  const groups = await Storage.getGroups();
  const blob = new Blob([JSON.stringify(buildBackup(groups), null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFileName();
  document.body.append(link);
  link.click();
  link.remove();
  // Freed after the click has been handed to the download manager, not before.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  setStatus(`${tally(groups)} written to ${link.download}.`);
}

/* ---------- Import ---------- */

async function pickFile() {
  clearPending();
  setStatus('');
  fileInput.click();
}

async function readFile(file) {
  // The largest honest backup is a few hundred zones of URLs; anything past
  // this is not one, and it must not be parsed to find that out.
  if (file.size > 2 * 1024 * 1024) {
    clearPending();
    setStatus('That file is too large to be a Lock In backup.', 'error');
    return;
  }

  let groups;
  try {
    groups = readBackup(await file.text());
  } catch (error) {
    clearPending();
    setStatus(error.message, 'error');
    return;
  }

  const current = await Storage.getGroups();
  pendingGroups = groups;
  const replacement = groups.length === 0
    ? 'Restoring would clear every zone on this device.'
    : `Restoring replaces the ${plural(current.length, 'zone')} on this device right now.`;
  confirmCopyEl.textContent = `“${file.name}” carries ${tally(groups)}. ${replacement}`;
  confirmEl.hidden = false;
  setStatus('');
  overlay.querySelector('[data-backup="apply"]').focus();
}

async function applyBackup() {
  if (!pendingGroups) return;
  const groups = pendingGroups;
  await withLockCheck(async () => {
    try {
      await Storage.saveGroups(groups);
    } catch (error) {
      setStatus(`Lock In could not write the restored zones: ${error.message}`, 'error');
      return;
    }
    dismiss();
    onRestored();
  });
}

/* ---------- Wiring ---------- */

overlay.addEventListener('click', (event) => {
  const action = event.target.closest('[data-backup]')?.dataset.backup;
  if (action === 'export') exportBackup();
  if (action === 'pick') pickFile();
  if (action === 'apply') applyBackup();
  if (action === 'discard') pickFile();
  if (action === 'close') dismiss();
  if (event.target === overlay) dismiss();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  // Cleared first so picking the same file twice in a row still fires.
  fileInput.value = '';
  if (file) readFile(file);
});

document.addEventListener('keydown', (event) => {
  if (overlay.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    // The challenge, when it is open, owns Escape: leaving that closes the
    // paperwork and keeps this dialog, file included, exactly where it was.
    if (!document.getElementById('challengeModal').classList.contains('hidden')) return;
    event.preventDefault();
    dismiss();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusable();
  if (items.length === 0) return;
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

export function initBackupDialog(options = {}) {
  onRestored = options.onRestored || (() => {});
  document.getElementById('backupOpen').addEventListener('click', open);
}
