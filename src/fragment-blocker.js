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
        * { box-sizing: border-box; }
        .screen {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: auto;
          padding: 24px;
          background: #6b12b8;
          background-image: repeating-linear-gradient(45deg, rgba(255,255,255,.06) 0 12px, transparent 12px 24px);
          color: #fdf2e0;
          font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .card { width: min(560px,100%);padding: 40px 32px;text-align: center; }
        .goblin { margin-bottom: 12px;font-size: 58px;line-height: 1; }
        h1 {
          margin: 0 0 8px;
          color: #fff;
          font-family: 'Bricolage Grotesque', 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 38px;
          font-weight: 800;
          letter-spacing: -.03em;
          line-height: 1.05;
          text-wrap: balance;
        }
        .status-line {
          margin: 0 0 20px;
          color: #d9b8f5;
          font: 600 11.5px/1.4 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .explanation {
          margin: 0 0 22px;
          padding: 16px 18px;
          border: 2.5px solid #24102f;
          border-radius: 14px;
          background: #fffaf0;
          color: #24102f;
          font-size: 14.5px;
          line-height: 1.6;
          text-align: left;
        }
        .actions { display: flex;gap: 12px;justify-content: center;flex-wrap: wrap; }
        button {
          min-height: 44px;
          padding: 11px 20px;
          border: 2.5px solid #24102f;
          border-radius: 999px;
          font: 700 14px/1 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          cursor: pointer;
          transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
        }
        button:hover { transform: translate(-1px,-1px); }
        button:active { transform: translate(2px,2px);box-shadow: none; }
        button:focus-visible { outline: 3px solid #ffed6c;outline-offset: 3px; }
        .primary { background: #fdf2e0;color: #24102f;box-shadow: 4px 4px 0 #f9b32d; }
        .primary:hover { background: #fffaf0;box-shadow: 5px 5px 0 #f9b32d; }
        @media (max-width: 520px) {
          .screen { padding: 16px; }
          .card { padding: 32px 4px; }
          h1 { font-size: 30px; }
        }
        @media (prefers-reduced-motion: reduce) {
          button { transition: background .12s ease; }
          button:hover, button:active { transform: none; }
        }
      </style>
      <main class="screen" role="dialog" aria-modal="true" aria-labelledby="lockin-title">
        <section class="card">
          <div class="goblin" aria-hidden="true">&#128121;</div>
          <h1 id="lockin-title">this section</h1>
          <p class="status-line">is contained</p>
          <p class="explanation">Only this part of the site is blocked. Another section may still be available, tiny mammal. Go back and keep your attention on your side of the fence. &#128065;&#65039; &#128068; &#128065;&#65039;</p>
          <div class="actions">
            <button id="dashboard-btn" class="primary" type="button">File an appeal</button>
          </div>
        </section>
      </main>`;
    shadow.getElementById('dashboard-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());
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
