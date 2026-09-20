// Lock In — the super-strict setup guide.
//
// Full enforcement needs a Windows watchdog that only the repository build can
// talk to, and the instructions for installing it used to live in the README.
// They live here instead: the dashboard knows which build is running, knows
// which of the three steps are already done, and cannot drift out of date the
// way a file in another checkout can.
//
// Markup is in options.html; this module is only its behaviour.

import { isRepoBuild, extensionVersion } from '../../shared/install-source.js';

const banner = document.getElementById('strictBanner');
const bannerTitle = document.getElementById('strictBannerTitle');
const bannerDetail = document.getElementById('strictBannerDetail');
const bannerOpen = document.getElementById('strictBannerOpen');
const bannerMark = banner.querySelector('.strict-banner-mark');

const modal = document.getElementById('strictModal');
const scrollArea = modal.querySelector('.strict-card-scroll');
const closeButton = document.getElementById('strictClose');
const doneButton = document.getElementById('strictDone');
const liveText = document.getElementById('strictLiveText');
const live = document.getElementById('strictLive');

const stepInstall = document.getElementById('strictStepInstall');
const stepInstallState = document.getElementById('strictStepInstallState');
const stepArm = document.getElementById('strictStepArm');
const stepArmState = document.getElementById('strictStepArmState');

// Three states, one for each honest answer to "is this thing enforcing?".
const STATES = {
  off: {
    title: 'Super-strict mode is off',
    detail: 'This build can hand enforcement to Windows. Three steps and the browser stops being the one deciding.',
    action: 'Show me the three steps',
    live: 'right now: no watchdog is answering on this machine'
  },
  warming: {
    title: 'Super-strict mode is warming up',
    detail: 'The watchdog is connected and counting three clean heartbeats before Windows policy can activate.',
    action: 'Review the steps',
    live: 'right now: connected, waiting for three valid heartbeats'
  },
  armed: {
    title: 'Super-strict mode is on',
    // Not a second copy of the panel above it: what this row still has to
    // offer once enforcement runs is the updater and the ways back out.
    detail: 'Windows owns the policy now. The setup steps, the updater and the ways back out live in here.',
    action: 'Setup & recovery',
    live: 'right now: armed — Windows is holding the policy',
    mark: '🔒'
  }
};

function stateOf(nativeStatus) {
  if (!nativeStatus?.connected) return 'off';
  return nativeStatus.enforcementArmed ? 'armed' : 'warming';
}

// Steps 2 and 3 can be observed, so they report themselves rather than asking
// the reader to work out how far they got. Step 1 is a folder on disk and
// stays a plain instruction.
function paintStep(step, label, done, text) {
  step.classList.toggle('is-done', done);
  label.textContent = done ? text : 'not yet';
}

// Nothing below runs at all in the Chrome Web Store copy; initStrictMode is
// the one place that decides.
let enabled = false;

export function paintStrictMode(nativeStatus) {
  if (!enabled) return;

  const key = stateOf(nativeStatus);
  const copy = STATES[key];

  banner.dataset.strictState = key;
  bannerTitle.textContent = copy.title;
  bannerDetail.textContent = copy.detail;
  bannerOpen.textContent = copy.action;
  bannerMark.textContent = copy.mark || '👹';
  bannerOpen.classList.toggle('primary', key !== 'armed');
  bannerOpen.classList.toggle('ghost', key === 'armed');

  liveText.textContent = copy.live;
  live.dataset.strictState = key;

  paintStep(stepInstall, stepInstallState, key !== 'off', 'installed');
  paintStep(stepArm, stepArmState, key === 'armed', 'armed');
}

/* ---------------- The guide itself ---------------- */

let previousFocus = null;

function focusable() {
  return Array.from(
    modal.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter((el) => el.offsetParent !== null);
}

function open() {
  previousFocus = document.activeElement;
  modal.classList.remove('hidden');
  scrollArea.scrollTop = 0;
  closeButton.focus();
}

function dismiss() {
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  const target = previousFocus;
  previousFocus = null;
  if (target?.isConnected) target.focus();
}

bannerOpen.addEventListener('click', open);
closeButton.addEventListener('click', dismiss);
doneButton.addEventListener('click', dismiss);
modal.addEventListener('click', (event) => {
  if (event.target === modal) dismiss();
});

document.addEventListener('keydown', (event) => {
  if (modal.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    dismiss();
    return;
  }
  if (event.key !== 'Tab') return;
  // The guide is long enough to tab through; keep that tabbing inside it.
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

// Retyping an elevated PowerShell line by hand is the one piece of friction
// here that buys nothing, so the command blocks hand themselves over.
modal.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const command = button.parentElement.querySelector('code')?.textContent ?? '';
  try {
    await navigator.clipboard.writeText(command);
    button.textContent = 'copied ✓';
    button.classList.add('is-copied');
  } catch {
    button.textContent = 'select it by hand';
  }
  setTimeout(() => {
    button.textContent = 'copy';
    button.classList.remove('is-copied');
  }, 2000);
});

export function initStrictMode() {
  if (!isRepoBuild()) return;
  enabled = true;
  const version = extensionVersion();
  if (version) {
    document.getElementById('strictExtensionArchive').textContent = `lock-in-${version}-chrome-web-store.zip`;
    document.getElementById('strictWatchdogArchive').textContent = `lock-in-${version}-windows-watchdog.zip`;
  }
  banner.hidden = false;
}
