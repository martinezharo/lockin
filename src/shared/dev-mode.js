// Lock In — dev mode flag.
// Read from env.js, a git-ignored local file loaded as a plain (non-module)
// script before anything else (see README). It stays a function rather than a
// constant so a missing env.js simply means "off" instead of breaking the page.

export function isDevMode() {
  return globalThis.LOCKIN_DEV === true;
}
