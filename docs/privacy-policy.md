# Lock In — Privacy Policy

Effective August 24, 2026 · Version 1.4.1

Lock In is a local-first site-blocking system composed of a Chrome extension and a protected Windows PowerShell watchdog. It uses the minimum browsing activity required to measure user-configured daily allowances. It has no internet server and does not transmit data off the device.

## Data handled

- Zone names, user-selected domains, schedules, daily limits, and edit-lock preference.
- The hostname of the active tab and whether its browser window is focused.
- Local time totals per zone and the current enforcement state.
- The user's privacy-consent choice and the health of the local watchdog connection.
- The selected Windows account names and SIDs, used locally to authenticate each protected sensor independently.

Lock In does not read page content, form values, messages, passwords, full browsing history, or unrelated tabs.

## How the data is used

The active hostname is compared only with domains configured by the user. The watchdog calculates elapsed time, evaluates schedules and allowances, and applies local managed-browser URL policies. If the extension sensor disappears after enforcement has been armed, the watchdog applies configured-domain policies and an emergency outbound firewall block to the supported browser executable.

## Local storage and loopback communication

Authoritative configuration and daily usage totals are stored under `C:\ProgramData\LockIn`, protected for Windows SYSTEM and administrators. The extension keeps a local display mirror in `chrome.storage.local`. It sends JSON requests only to the watchdog on `http://127.0.0.1:8765`; loopback traffic never leaves the computer.

No component sends these records over the internet. Lock In does not sell, share, rent, use, or transfer data for advertising, profiling, credit decisions, or any unrelated purpose. Daily usage is rotated by local date. Configuration remains until the user deletes it from the dashboard or uninstalls the watchdog with its data-purge option.

## User control

Browsing activity is not handled until the user accepts the in-product disclosure. Users can view remaining time and enforcement state, edit their zones and rules, and request deletion of all protected local Lock In data from the dashboard. The dashboard reports an error rather than falsely claiming deletion if the local watchdog cannot complete that request.

## Limited Use compliance

Lock In's use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. No human can access the user's extension data because it never leaves the device.

## Changes and contact

Material changes to these practices will be disclosed in the extension and reflected in this policy before new data use begins. Privacy questions can be sent to the developer contact shown on Lock In's Chrome Web Store listing.
