// Lock In — the friction in front of anything that would let a distraction
// back in. When edit lock is off these actions run straight away; when it is
// on, the caller's action is held until a randomly-picked paragraph has been
// typed out by hand. Tiny mammal bureaucracy, but useful.

import { Storage } from '../../shared/storage.js';
import { pickChallengeParagraph, isChallengeMatch } from '../../shared/challenge.js';
import { isDevMode } from '../../shared/dev-mode.js';

const MODAL_EMOJIS = ['👹', '🐭', '🔒', '⛏️', '🧠', '🚧', '📑', '🐾', '🛑', '👁️'];
const REJECTION_MESSAGES = [
  'appeal rejected 👹 the propaganda does not match. tiny mammal must type it again.',
  'containment remains active 🔒 there are suspicious differences in the paperwork.',
  'nice try, tiny mammal 🐭 the Department of Focus requests the paragraph as shown.',
  'bureaucratic catastrophe 📑 the text does not match closely enough. try again.',
  'the gatekeeper goblin squints at the form 👹 incorrect. please resubmit your appeal.',
  'forbidden tunnel access denied 🚧 tiny mammal has made too many creative edits.'
];

const modal = document.getElementById('challengeModal');
const modalEmoji = document.getElementById('modalEmoji');
const textEl = document.getElementById('challengeText');
const inputEl = document.getElementById('challengeInput');
const errorEl = document.getElementById('challengeError');
const devHintEl = document.getElementById('challengeDevHint');

let pendingAction = null;
let currentTarget = '';

function open(action) {
  pendingAction = action;
  currentTarget = pickChallengeParagraph();
  textEl.textContent = currentTarget;
  inputEl.value = '';
  errorEl.textContent = '';
  modalEmoji.textContent = MODAL_EMOJIS[Math.floor(Math.random() * MODAL_EMOJIS.length)];
  devHintEl.hidden = !isDevMode();
  modal.classList.remove('hidden');
  setTimeout(() => inputEl.focus(), 30);
}

function close() {
  pendingAction = null;
  modal.classList.add('hidden');
}

function runPending() {
  const action = pendingAction;
  close();
  if (action) action();
}

function reject() {
  errorEl.textContent = REJECTION_MESSAGES[Math.floor(Math.random() * REJECTION_MESSAGES.length)];
  modal.classList.add('shake');
  setTimeout(() => modal.classList.remove('shake'), 400);
}

// The whole point is that the paragraph can't be shortcut, so the source text
// refuses to be selected or copied and the input refuses paste and drop.
for (const event of ['copy', 'cut', 'contextmenu', 'selectstart']) {
  textEl.addEventListener(event, (e) => e.preventDefault());
}
for (const event of ['paste', 'drop', 'contextmenu']) {
  inputEl.addEventListener(event, (e) => e.preventDefault());
}

document.getElementById('challengeSubmit').addEventListener('click', () => {
  if (isChallengeMatch(inputEl.value, currentTarget)) runPending();
  else reject();
});

document.getElementById('challengeCancel').addEventListener('click', close);

modal.addEventListener('click', (e) => {
  if (e.target === modal) close();
});

// Dev-mode escape hatch: the modal still shows up exactly as usual, but with
// LOCKIN_DEV on in env.js this shortcut runs the pending action without typing.
document.addEventListener('keydown', (e) => {
  if (!isDevMode()) return;
  if (modal.classList.contains('hidden')) return;
  if (!(e.ctrlKey && e.shiftKey && e.key === 'Enter')) return;
  e.preventDefault();
  runPending();
});

// Run `action` now if edit lock is off, or behind the typing challenge if not.
export async function withLockCheck(action) {
  if (await Storage.getLockMode()) open(action);
  else action();
}

// Turning the lock *on* is always free; turning it off is not.
export async function toggleLockMode(onChange) {
  if (await Storage.getLockMode()) {
    open(async () => {
      await Storage.setLockMode(false);
      onChange();
    });
  } else {
    await Storage.setLockMode(true);
    onChange();
  }
}
