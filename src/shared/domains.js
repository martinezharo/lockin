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
