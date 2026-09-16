// Lock In service worker.
//
// Version 1.4+ is a sensor and management UI. The protected Windows watchdog
// owns allowance accounting and URLBlocklist enforcement, so disabling this
// extension makes the service fail closed instead of removing the block.

import { Storage } from './shared/storage.js';
import { watchdogClient } from './watchdog-client.js';

const RECONNECT_ALARM = 'lockin-watchdog-reconnect';

async function ensureReconnectAlarm() {
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureReconnectAlarm();
  if (!(await Storage.getPrivacyConsent())) await chrome.runtime.openOptionsPage();
  await watchdogClient.start();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureReconnectAlarm();
  await watchdogClient.start();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) watchdogClient.pulse();
});

let configSyncTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || watchdogClient.applyingSnapshot) return;
  if (!changes.groups && !changes.lockMode && !changes.privacyConsent) return;
  clearTimeout(configSyncTimer);
  configSyncTimer = setTimeout(() => watchdogClient.markConfigDirty(), 100);
});

chrome.tabs.onActivated.addListener(() => watchdogClient.heartbeat());
chrome.tabs.onRemoved.addListener((tabId) => {
  watchdogClient.checkedNavigations.delete(tabId);
  watchdogClient.heartbeat();
});
chrome.windows.onFocusChanged.addListener(() => watchdogClient.heartbeat());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    watchdogClient.heartbeat().then(() => watchdogClient.checkNavigation(tabId, changeInfo.url)).catch(() => undefined);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'lockin-native-clear') {
    watchdogClient.clearData().then(
      (data) => sendResponse({ ok: true, data }),
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }
  if (message?.type === 'lockin-native-state') {
    watchdogClient.request('getState').then(
      (data) => sendResponse({ ok: true, data }),
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }
  return false;
});

// Recreate the alarm on every worker wake, including extension reloads where
// neither onStartup nor onInstalled is guaranteed to run.
void ensureReconnectAlarm();
watchdogClient.start();
