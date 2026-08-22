import { Storage } from '../../shared/storage.js';
import { domainMatches } from '../../shared/domains.js';
import { isGroupActive, isInWindow, isTemporaryActive, formatSchedule } from '../../shared/schedule.js';
import { isAllowanceSpent, formatDuration } from '../../shared/usage.js';
import { pickBlockedMessage } from '../../shared/challenge.js';

async function init() {
  const params = new URLSearchParams(location.search);
  const domain = params.get('domain') || '';

  document.getElementById('domainName').textContent = domain || 'this forbidden tunnel';
  document.getElementById('flavorText').textContent = pickBlockedMessage();

  const [groups, usage, session] = await Promise.all([
    Storage.getGroups(),
    Storage.getUsage(),
    Storage.getUsageSession()
  ]);
  const now = Date.now();
  const matches = groups.filter(
    (g) => isGroupActive(g, now, usage, session) && g.domains.some((d) => domainMatches(domain, d))
  );

  const statusEl = document.getElementById('statusLine');
  if (matches.length === 0) {
    statusEl.textContent = 'is inside the tiny mammal containment perimeter.';
    return;
  }

  const names = matches.map((g) => g.name).join(', ');

  // Whichever rule actually shut the gates is the one worth naming: a schedule
  // says when they reopen, a temporary block shows its remaining time, and a
  // spent allowance says come back tomorrow.
  const temporary = matches.find((g) => isTemporaryActive(g, now));
  const scheduled = matches.find((g) => isInWindow(g, now));
  const spent = matches.find((g) => isAllowanceSpent(g, usage, session, now));

  let reason = 'no release timer';
  if (temporary) reason = `temporary block · ${formatDuration(temporary.expiresAt - now)} left`;
  else if (scheduled) reason = formatSchedule(scheduled.schedule);
  else if (spent) reason = 'daily allowance spent · resets at midnight';

  statusEl.textContent = `contained by “${names}” · ${reason}`;
}

document.getElementById('backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else window.close();
});

document.getElementById('dashBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

init();
