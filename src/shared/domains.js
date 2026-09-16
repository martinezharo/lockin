// Lock In — turning whatever someone types into a bare hostname.

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// "https://www.Reddit.com/r/x?y#z" -> "reddit.com"
export function normalizeDomainInput(raw) {
  if (!raw) return '';
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.split('/')[0];
  d = d.split('?')[0];
  d = d.split('#')[0];
  return d;
}

// The group form accepts one site per line or a comma-separated list; both
// end up here, deduplicated and normalized.
export function parseDomainList(raw) {
  return Array.from(new Set(String(raw || '').split(/[\n,]/).map(normalizeDomainInput).filter(Boolean)));
}

// A rule for "example.com" also covers its subdomains.
export function domainMatches(domain, listed) {
  return domain === listed || domain.endsWith('.' + listed);
}

// Rules omit the scheme so HTTP/HTTPS share the same restriction. Paths and
// query values remain case-sensitive, as in Chromium's URLBlocklist.
export function normalizeSiteInput(raw) {
  const input = String(raw || '').trim();
  if (!input) return '';
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !/^https?:\/\//i.test(input)) return '';
    const url = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
    if (url.username || url.password || !url.hostname || /[\s*@]/.test(url.host + url.pathname + url.search)) return '';
    const host = normalizeDomainInput(url.hostname);
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.includes('..')) return '';
    const query = [...url.searchParams].filter(([key]) => !/^(utm_.+|fbclid|gclid|msclkid)$/i.test(key));
    const params = new URLSearchParams(query);
    params.sort();
    return host + (url.port ? ':' + url.port : '') + (url.pathname === '/' && !params.size ? '' : url.pathname) + (params.size ? '?' + params : '');
  } catch { return ''; }
}

export function parseSiteList(raw) {
  const entries = String(raw || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  const sites = entries.map(normalizeSiteInput);
  if (sites.some(site => !site)) throw new Error('Enter valid HTTP(S) URLs or domains, without credentials or wildcards.');
  return [...new Set(sites)];
}

export function siteMatches(page, rule) {
  try {
    if (!/^https?:\/\//i.test(page || '')) return false;
    const url = new URL(page);
    const listed = new URL('https://' + rule);
    if (!domainMatches(normalizeDomainInput(url.hostname), listed.hostname)) return false;
    if (listed.port && (url.port || (url.protocol === 'https:' ? '443' : '80')) !== listed.port) return false;
    if (!url.pathname.startsWith(listed.pathname)) return false;
    return [...listed.searchParams].every(([key, value]) => url.searchParams.getAll(key).includes(value));
  } catch { return false; }
}
