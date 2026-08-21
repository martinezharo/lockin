// Lock In — the only door to chrome.storage.local.
// Pages and the service worker all go through here, so the key names and
// their defaults are defined exactly once.

export const Storage = {
  async getGroups() {
    const { groups = [] } = await chrome.storage.local.get('groups');
    return groups;
  },
  async saveGroups(groups) {
    await chrome.storage.local.set({ groups });
  },
  async getLockMode() {
    const { lockMode = false } = await chrome.storage.local.get('lockMode');
    return lockMode;
  },
  async setLockMode(value) {
    await chrome.storage.local.set({ lockMode: value });
  }
};
