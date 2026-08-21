import { Storage } from '../../shared/storage.js';
import { domainMatches } from '../../shared/domains.js';
import { isGroupActive, formatSchedule } from '../../shared/schedule.js';
import { pickChallengeParagraph } from '../../shared/challenge.js';

async function init() {
  const params = new URLSearchParams(location.search);
  const domain = params.get('domain') || '';

  document.getElementById('domainName').textContent = domain || 'this site';
  document.getElementById('flavorText').textContent = pickChallengeParagraph();

  const groups = await Storage.getGroups();
  const now = Date.now();
  const matches = groups.filter(
    (g) => isGroupActive(g, now) && g.domains.some((d) => domainMatches(domain, d))
  );

  const statusEl = document.getElementById('statusLine');
  if (matches.length === 0) {
    statusEl.textContent = 'is locked.';
    return;
  }

  const names = matches.map((g) => g.name).join(', ');
  const scheduled = matches.find((g) => g.mode === 'schedule');

  statusEl.textContent = scheduled
    ? `is locked by "${names}" · ${formatSchedule(scheduled.schedule)}`
    : `is locked by "${names}" · permanent`;
}

document.getElementById('backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else window.close();
});

document.getElementById('dashBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

init();
