import { Storage } from '../../shared/storage.js';
import { domainMatches } from '../../shared/domains.js';
import { isGroupActive, formatSchedule } from '../../shared/schedule.js';
import { pickBlockedMessage } from '../../shared/challenge.js';

async function init() {
  const params = new URLSearchParams(location.search);
  const domain = params.get('domain') || '';

  document.getElementById('domainName').textContent = domain || 'this forbidden tunnel';
  document.getElementById('flavorText').textContent = pickBlockedMessage();

  const groups = await Storage.getGroups();
  const now = Date.now();
  const matches = groups.filter(
    (g) => isGroupActive(g, now) && g.domains.some((d) => domainMatches(domain, d))
  );

  const statusEl = document.getElementById('statusLine');
  if (matches.length === 0) {
    statusEl.textContent = 'is inside the tiny mammal containment perimeter.';
    return;
  }

  const names = matches.map((g) => g.name).join(', ');
  const scheduled = matches.find((g) => g.mode === 'schedule');

  statusEl.textContent = scheduled
    ? `contained by “${names}” · ${formatSchedule(scheduled.schedule)}`
    : `contained by “${names}” · no release timer`;
}

document.getElementById('backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else window.close();
});

document.getElementById('dashBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

init();
