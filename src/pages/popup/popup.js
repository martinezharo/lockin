import { Storage } from '../../shared/storage.js';
import { isGroupActive, isInWindow } from '../../shared/schedule.js';
import { isAllowanceSpent, isPermanentLimit, remainingMs, formatDuration } from '../../shared/usage.js';
import { formatClock, nextEvent } from '../../shared/timeline.js';
import { enforcementReasonText } from '../../shared/enforcement.js';
import { lockIconHtml } from '../../shared/lock-icon.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Short enough for a 268px row: state first, then the one number that matters
// for that state.
function zoneLine(g, now, usage, session) {
  if (!g.enabled) return { state: 'off', note: 'off' };
  if (isPermanentLimit(g.limit)) return { state: 'spent', note: 'permanent' };
  if (isAllowanceSpent(g, usage, session, now)) return { state: 'spent', note: 'spent' };
  if (isInWindow(g, now)) return { state: 'shut', note: 'shut' };
  if (g.limit) return { state: 'open', note: `${formatDuration(remainingMs(g, usage, session, now))} left` };
  return { state: isGroupActive(g, now, usage, session) ? 'shut' : 'open', note: 'open' };
}

async function init() {
  const consent = await Storage.getPrivacyConsent();

  if (!consent) {
    const emptyState = document.getElementById('emptyState');
    emptyState.textContent = 'setup required · review local data use first 🔐';
    emptyState.hidden = false;
    document.getElementById('lockRow').textContent = 'no browsing activity is being read';
    document.getElementById('openDash').textContent = 'Review privacy & continue';
    return;
  }

  const [groups, lockMode, usage, session, localState] = await Promise.all([
    Storage.getGroups(),
    Storage.getLockMode(),
    Storage.getUsage(),
    Storage.getUsageSession(),
    chrome.storage.local.get('nativeStatus')
  ]);
  const now = Date.now();

  const event = nextEvent(groups, now, usage, session);
  if (event) {
    document.getElementById('nextPanel').hidden = false;
    document.getElementById('nextValue').textContent = formatDuration(event.at - now);
    document.getElementById('nextLabel').textContent =
      `until ${event.group.name} ${event.kind === 'shuts' ? 'shuts' : 'reopens'}`;
    document.getElementById('nextClock').textContent = formatClock(event.at);
  }

  document.getElementById('emptyState').hidden = groups.length > 0;
  document.getElementById('zoneList').innerHTML = groups
    .map((g) => {
      const { state, note } = zoneLine(g, now, usage, session);
      return `
        <div class="zone-row state-${state}">
          <span class="zone-dot" aria-hidden="true"></span>
          <span class="zone-name">${escapeHtml(g.name)}</span>
          <span class="zone-note">${escapeHtml(note)}</span>
        </div>`;
    })
    .join('');

  const lockRow = document.getElementById('lockRow');
  lockRow.textContent = lockMode ? '🔒 edit lock sealed' : '🔓 tiny mammal has admin privileges';
  lockRow.classList.toggle('on', lockMode);
  const brandLock = document.getElementById('brandLock');
  brandLock.innerHTML = lockIconHtml(lockMode, 15);
  brandLock.classList.toggle('on', lockMode);

  const serviceRow = document.getElementById('serviceRow');
  const nativeStatus = localState.nativeStatus;
  if (!nativeStatus?.connected) {
    serviceRow.textContent = '⚠️ local enforcement watchdog offline';
    serviceRow.classList.add('offline');
  } else if (!nativeStatus.enforcementArmed) {
    serviceRow.textContent = '⚠️ watchdog connected · waiting to arm';
    serviceRow.classList.add('blocking');
  } else if ((nativeStatus.blockedDomains || []).length > 0) {
    serviceRow.textContent = `● Windows is blocking · ${enforcementReasonText(nativeStatus.enforcementReason)}`;
    serviceRow.classList.add('blocking');
  } else {
    const protectedAccounts = (nativeStatus.protectedWindowsAccounts?.length
      ? nativeStatus.protectedWindowsAccounts
      : [nativeStatus.protectedWindowsAccount]
    ).filter(Boolean).map((account) => account.split('\\').pop());
    serviceRow.textContent = protectedAccounts.length
      ? `● Windows enforcement armed · ${protectedAccounts.join(' + ')}`
      : '● Windows enforcement armed';
    serviceRow.classList.add('ready');
  }
}

document.getElementById('openDash').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

init();
