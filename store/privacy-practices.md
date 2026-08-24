# Chrome Web Store privacy practices — version 1.4.0

Use these answers for the `1.4.0` update. Keep them consistent with `docs/index.html` and the in-product privacy page.

## Permission justifications

### storage

Stores the privacy-consent choice, a local display mirror of user-created zones, schedules and authoritative watchdog usage totals, the edit-lock preference, and local watchdog health. The authoritative records remain in protected Windows storage and nothing leaves the device.

### alarms

Retries the local watchdog connection if the Manifest V3 service worker is restarted. Enforcement and elapsed-time calculations do not depend on the alarm.

### Host permissions: http://*/* and https://*/*

Reads only the hostname of the active tab in the focused browser window so the local watchdog can determine whether a configured daily allowance should run. Lock In does not inject scripts, read page content, inspect forms, or contact internet servers.

### Host permission: http://127.0.0.1:8765/*

Sends heartbeats, configuration and state requests to the protected Lock In watchdog on the same computer. This loopback traffic never leaves the device.

## Remote code

Select: `No, I am not using remote code.`

All extension JavaScript, CSS, fonts, icons, and text are contained in the submitted package. The only `fetch` target is the fixed loopback watchdog address; the extension performs no remote-code execution or internet request.

## Data disclosure

Do not select “This item does not collect or use user data.” Declare the dashboard categories corresponding to:

- Web history or browsing activity: the active-tab hostname.
- User activity: locally calculated time spent on configured domains.
- User-provided content: zone names, domain lists, schedules and limits.

For every declared category:

- Used only for the extension's single purpose: `Yes`.
- Sold to third parties: `No`.
- Used or transferred for unrelated purposes: `No`.
- Used or transferred for creditworthiness or lending: `No`.
- Used for personalized advertising: `No`.
- Human access: `No`; the data remains solely on the user's device.

## Limited Use certification

Certify compliance. The public policy contains the required Limited Use statement.
