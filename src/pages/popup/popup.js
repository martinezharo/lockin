import { Storage } from '../../shared/storage.js';
import { isGroupActive } from '../../shared/schedule.js';
import { isDevMode } from '../../shared/dev-mode.js';

async function init() {
  const [groups, lockMode] = await Promise.all([Storage.getGroups(), Storage.getLockMode()]);
  const now = Date.now();
  const active = groups.filter((g) => isGroupActive(g, now));
  const domainCount = new Set(active.flatMap((g) => g.domains)).size;

  document.getElementById('statGroups').textContent = active.length;
  document.getElementById('statDomains').textContent = domainCount;

  const lockRow = document.getElementById('lockRow');
  lockRow.textContent = lockMode ? '🔒 Edit lock is on' : '🔓 Edit lock is off';
  lockRow.classList.toggle('on', lockMode);

  document.getElementById('devBanner').hidden = !isDevMode();
}

document.getElementById('openDash').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

init();
