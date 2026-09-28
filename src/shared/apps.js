// Lock In — executable targets for app zones.
//
// An app zone names an executable, not a path: Windows apps move and update,
// and the foreground-window sensor reports a bare file name. The stored form
// is lowercase, such as `discord.exe`.

export function normalizeAppInput(raw) {
  const value = String(raw || '').trim().replace(/\\/g, '/');
  if (!value) return '';
  const name = value.split('/').pop().toLowerCase();
  if (!name || /[*?"<>|]/.test(name)) return '';
  return name.includes('.') ? name : `${name}.exe`;
}

export function parseAppList(raw) {
  const entries = String(raw || '').split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
  const apps = entries.map(normalizeAppInput);
  if (apps.some((app) => !app)) {
    throw new Error('Enter executable names such as discord.exe, one per line or separated by commas.');
  }
  return [...new Set(apps)];
}
