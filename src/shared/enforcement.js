// Lock In — the watchdog's own words, said the way the UI says them.
// The watchdog reports why it is holding a policy as a comma-joined list of
// its internal reasons ('schedule', 'allowance spent', 'open', 'not armed').
// Both the dashboard and the popup show that string, so the translation into
// the vocabulary the rest of the interface uses lives in one place.

const PHRASES = {
  schedule: 'scheduled hours',
  'allowance spent': 'allowance spent',
  'fail-closed': 'sensor lost',
  open: 'gates open',
  'not armed': 'not armed yet'
};

export function enforcementReasonText(reason, fallback = 'gates open') {
  const parts = String(reason || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => PHRASES[part] || part);

  return parts.length ? parts.join(' + ') : fallback;
}
