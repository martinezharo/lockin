// Lock In — where this copy of the extension came from.
//
// Chrome and Brave add their own `update_url` to the manifest they hand back
// for anything installed from the Web Store. A build loaded unpacked from a
// clone of the repository never has one, and that is the only build the
// Windows watchdog can be attached to: the store listing predates it and can
// be removed from the extensions page like any other extension.
//
// So the dashboard asks this before offering super-strict mode, and stays
// quiet everywhere else.

export function isRepoBuild() {
  try {
    return !chrome.runtime.getManifest().update_url;
  } catch {
    // An answer we cannot establish is not an invitation to show setup steps.
    return false;
  }
}

export function extensionVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '';
  }
}
