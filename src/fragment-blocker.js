// Fragment routes (the part after #) never reach Chromium's URLBlocklist.
// Keep the watchdog as the enforcement authority, but cover an active match
// in-place so single-page apps retain their URL and browser history.

(() => {
  let activeRules = [];
  let host = null;
  let previousOverflow = '';
  let lastHref = '';

  function domainMatches(domain, listed) {
    return domain === listed || domain.endsWith('.' + listed);
  }

  function siteMatches(page, rule) {
    try {
      const url = new URL(page);
      const listed = new URL('https://' + rule);
      if (!domainMatches(url.hostname.toLowerCase().replace(/^www\./, ''), listed.hostname)) return false;
      if (listed.port && (url.port || (url.protocol === 'https:' ? '443' : '80')) !== listed.port) return false;
      if (!url.pathname.startsWith(listed.pathname)) return false;
      if (![...listed.searchParams].every(([key, value]) => url.searchParams.getAll(key).includes(value))) return false;
      return Boolean(listed.hash) && url.hash.startsWith(listed.hash);
    } catch {
      return false;
    }
  }

  function blocksCurrentPage() {
    return activeRules.some((rule) => rule.includes('#') && siteMatches(location.href, rule));
  }

  function stopBlockedEvent(event) {
    if (!host || event.composedPath().includes(host)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function showBlocker() {
    if (host?.isConnected) return;
    if (!document.documentElement) {
      addEventListener('DOMContentLoaded', render, { once: true });
      return;
    }
    host = document.createElement('div');
    host.id = 'lockin-fragment-blocker';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:block;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .screen { box-sizing:border-box;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 20% 15%,rgba(213,255,83,.12),transparent 32rem),radial-gradient(circle at 90% 85%,rgba(117,96,255,.12),transparent 34rem),#090b0f;color:#f6f3ea;font-family:system-ui,sans-serif; }
        .card { box-sizing:border-box;width:min(560px,100%);padding:clamp(32px,7vw,64px);border:1px solid rgba(255,255,255,.12);border-radius:28px;background:rgba(18,21,27,.96);box-shadow:0 28px 80px rgba(0,0,0,.42);text-align:center; }
        .lock { width:64px;height:64px;margin:0 auto 24px;display:grid;place-items:center;border-radius:20px;background:#d5ff53;color:#10130a;font-size:30px;box-shadow:0 12px 32px rgba(213,255,83,.18); }
        .eyebrow { margin:0 0 10px;color:#d5ff53;font:600 12px/1 ui-monospace,monospace;letter-spacing:.18em; }
        h1 { margin:0;font-size:clamp(34px,7vw,54px);line-height:1;letter-spacing:-.045em; }
        p:last-child { margin:22px auto 0;max-width:440px;color:#b7bac4;font-size:16px;line-height:1.65; }
      </style>
      <main class="screen" role="dialog" aria-modal="true" aria-labelledby="lockin-title">
        <section class="card">
          <div class="lock" aria-hidden="true">&#128274;</div>
          <p class="eyebrow">LOCK IN</p>
          <h1 id="lockin-title">This section is blocked.</h1>
          <p>Another part of this site may still be available. Use the browser's Back button to leave this section.</p>
        </section>
      </main>`;
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.append(host);
  }

  function hideBlocker() {
    if (!host) return;
    host.remove();
    host = null;
    document.documentElement.style.overflow = previousOverflow;
  }

  function render() {
    if (blocksCurrentPage()) showBlocker();
    else hideBlocker();
  }

  async function refreshRules() {
    const { privacyConsent, nativeStatus } = await chrome.storage.local.get(['privacyConsent', 'nativeStatus']);
    activeRules = privacyConsent === true ? (nativeStatus?.blockedDomains || []).filter((rule) => typeof rule === 'string' && rule.includes('#')) : [];
    render();
  }

  for (const type of ['click', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'submit']) {
    document.addEventListener(type, stopBlockedEvent, true);
  }
  addEventListener('hashchange', render);
  addEventListener('popstate', render);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.nativeStatus || changes.privacyConsent)) void refreshRules();
  });

  // pushState and replaceState do not emit navigation events in the page's
  // isolated content-script world. A cheap URL comparison covers those SPAs.
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    render();
  }, 250);

  void refreshRules();
})();
