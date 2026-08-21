async function init() {
  const params = new URLSearchParams(location.search);
  const domain = params.get('domain') || '';

  document.getElementById('domainName').textContent = domain || 'this site';
  document.getElementById('flavorText').textContent = pickChallengeParagraph();

  const groups = await Storage.getGroups();
  const now = Date.now();
  const matches = groups.filter(
    (g) => isGroupActive(g, now) && g.domains.some((d) => domain === d || domain.endsWith('.' + d))
  );

  const statusEl = document.getElementById('statusLine');
  if (matches.length === 0) {
    statusEl.textContent = 'is locked.';
    return;
  }

  const names = matches.map((g) => g.name).join(', ');
  const temp = matches.find((g) => g.mode === 'temporary' && g.expiresAt);
  const scheduled = matches.find((g) => g.mode === 'schedule');

  if (temp) {
    statusEl.dataset.expires = temp.expiresAt;
    statusEl.textContent = `is locked by "${names}" · ${formatRemaining(temp.expiresAt - now)}`;
  } else if (scheduled) {
    statusEl.textContent = `is locked by "${names}" · ${formatSchedule(scheduled.schedule)}`;
  } else {
    statusEl.textContent = `is locked by "${names}" · permanent`;
  }
}

setInterval(() => {
  const statusEl = document.getElementById('statusLine');
  const expires = Number(statusEl?.dataset.expires);
  if (!expires) return;
  const remaining = expires - Date.now();
  if (remaining <= 0) {
    location.reload();
  } else {
    statusEl.textContent = statusEl.textContent.replace(/·.*$/, `· ${formatRemaining(remaining)}`);
  }
}, 1000);

document.getElementById('backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else window.close();
});

document.getElementById('dashBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

init();
