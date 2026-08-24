import { Storage } from '../../shared/storage.js';
import { isGroupActive, isInWindow } from '../../shared/schedule.js';
import { isAllowanceSpent, isPermanentLimit, remainingMs, formatDuration } from '../../shared/usage.js';
import { formatClock, nextEvent } from '../../shared/timeline.js';
import { isDevMode } from '../../shared/dev-mode.js';

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
  if (g.limit) return { state: 'open', note: formatDuration(remainingMs(g, usage, session, now)) };
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

  const [groups, lockMode, usage, session] = await Promise.all([
    Storage.getGroups(),
    Storage.getLockMode(),
    Storage.getUsage(),
    Storage.getUsageSession()
  ]);
  const now = Date.now();

  const event = nextEvent(groups, now, usage, session);
  if (event) {
    document.getElementById('nextPanel').hidden = false;
    document.getElementById('nextValue').textContent = formatDuration(event.at - now);
    document.getElementById('nextLabel').textContent =
      `until ${event.group.name} ${event.kind === 'shuts' ? 'shuts' : 'reopens'} · ${formatClock(event.at)}`;
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
  document.getElementById('brandLock').textContent = lockMode ? '🔒' : '🔓';

  document.getElementById('devBanner').hidden = !isDevMode();
}

document.getElementById('openDash').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

init();
