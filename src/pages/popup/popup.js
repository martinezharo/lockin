import { Storage } from '../../shared/storage.js';
import { isGroupActive } from '../../shared/schedule.js';
import { isDevMode } from '../../shared/dev-mode.js';

async function init() {
  const [groups, lockMode, usage, session] = await Promise.all([
    Storage.getGroups(),
    Storage.getLockMode(),
    Storage.getUsage(),
    Storage.getUsageSession()
  ]);
  const now = Date.now();
  const active = groups.filter((g) => isGroupActive(g, now, usage, session));
  const domainCount = new Set(active.flatMap((g) => g.domains)).size;

  document.getElementById('statGroups').textContent = active.length;
  document.getElementById('statDomains').textContent = domainCount;

  const lockRow = document.getElementById('lockRow');
  lockRow.textContent = lockMode
    ? '🔒 tiny mammal containment locked'
    : '🔓 tiny mammal has administrative privileges';
  lockRow.classList.toggle('on', lockMode);

  document.getElementById('devBanner').hidden = !isDevMode();
}

document.getElementById('openDash').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

init();
