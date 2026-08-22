import { Storage } from '../../shared/storage.js';
import { domainMatches } from '../../shared/domains.js';
import { isGroupActive, isInWindow, formatSchedule } from '../../shared/schedule.js';
import { isAllowanceSpent, formatDuration } from '../../shared/usage.js';
import { MINUTES_PER_DAY, minutesIntoDay, formatClock, todayShutSegments, nextEventFor } from '../../shared/timeline.js';
import { tallyFor, blockTallyLine, repeatOffenderLine } from '../../shared/tally.js';
import { pickBlockedMessage } from '../../shared/challenge.js';

const domainNameEl = document.getElementById('domainName');
const statusEl = document.getElementById('statusLine');
const countdownEl = document.getElementById('countdown');
const countdownValueEl = document.getElementById('countdownValue');
const countdownLabelEl = document.getElementById('countdownLabel');
const stripEl = document.getElementById('strip');
const stripFillsEl = document.getElementById('stripFills');
const stripNowEl = document.getElementById('stripNow');
const tallyEl = document.getElementById('tally');

const pct = (minutes) => `${((minutes / MINUTES_PER_DAY) * 100).toFixed(3)}%`;

/* ---------- The scoreboard ----------
   Counted here because this page is the only thing that knows a redirect
   happened: declarativeNetRequest does it without waking the service worker.
   A reload of this page counts again, which is the honest reading — the tiny
   mammal did come back. */

function paintTally(tally, domain, now) {
  const { total } = tallyFor(tally, now);
  if (total <= 0) return;

  document.getElementById('tallyCount').textContent = `×${total}`;
  document.getElementById('tallyLine').textContent = blockTallyLine(total);
  document.getElementById('tallySub').textContent = repeatOffenderLine(tally, domain, now);
  tallyEl.hidden = false;
}

/* ---------- When do I get it back ----------
   Recomputed on a tick so the number counts down while the page sits open,
   rather than going stale the moment it renders. */

function paintCountdown(group, now, usage, session) {
  const event = group ? nextEventFor(group, now, usage, session) : null;
  if (!event || event.kind !== 'opens') {
    countdownEl.hidden = true;
    return;
  }
  countdownEl.hidden = false;
  countdownValueEl.textContent = `back in ${formatDuration(event.at - now)}`;
  countdownLabelEl.textContent =
    event.reason === 'allowance'
      ? 'allowance resets at midnight'
      : `gates reopen at ${formatClock(event.at)}`;
}

function paintStrip(group, now, usage, session) {
  if (!group) {
    stripEl.hidden = true;
    return;
  }
  const segments = todayShutSegments(group, now, usage, session);
  if (segments.length === 0) {
    stripEl.hidden = true;
    return;
  }
  stripEl.hidden = false;
  stripFillsEl.innerHTML = segments
    .map(
      (s) =>
        `<span class="band-fill ${s.kind}" style="left: ${pct(s.start)}; width: ${pct(s.end - s.start)}"></span>`
    )
    .join('');
  stripNowEl.style.left = pct(minutesIntoDay(now));
}

async function init() {
  const params = new URLSearchParams(location.search);
  const domain = params.get('domain') || '';

  domainNameEl.textContent = domain || 'this forbidden tunnel';
  document.getElementById('flavorText').textContent = pickBlockedMessage();

  const [groups, usage, session, tally] = await Promise.all([
    Storage.getGroups(),
    Storage.getUsage(),
    Storage.getUsageSession(),
    Storage.recordBlock(domain)
  ]);
  const now = Date.now();

  paintTally(tally, domain, now);

  const matches = groups.filter(
    (g) => isGroupActive(g, now, usage, session) && g.domains.some((d) => domainMatches(domain, d))
  );

  if (matches.length === 0) {
    statusEl.textContent = 'inside the tiny mammal containment perimeter';
    return;
  }

  const names = matches.map((g) => g.name).join(', ');

  // Whichever rule actually shut the gates is the one worth naming, and the
  // one whose clock the countdown should follow: a schedule says when they
  // reopen, a spent allowance says come back tomorrow.
  const scheduled = matches.find((g) => isInWindow(g, now));
  const spent = matches.find((g) => isAllowanceSpent(g, usage, session, now));
  const timed = scheduled || spent || null;

  let reason = 'contained around the clock';
  if (scheduled) reason = formatSchedule(scheduled.schedule);
  else if (spent) reason = 'daily allowance spent';

  statusEl.textContent = `${names} · ${reason}`;

  const repaint = () => {
    const at = Date.now();
    paintCountdown(timed, at, usage, session);
    paintStrip(timed, at, usage, session);
  };
  repaint();
  setInterval(repaint, 1000);
}

document.getElementById('backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else window.close();
});

document.getElementById('dashBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

init();
