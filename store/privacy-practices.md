# Chrome Web Store privacy practices

Use these answers in the Privacy practices tab. Keep them consistent with `docs/index.html` and the in-product privacy policy.

## Permission justifications

### storage

Stores the user's privacy-consent choice, user-created zones and domains, schedules, daily allowance totals, edit-lock preference, and daily blocked-visit tally in `chrome.storage.local`. This data never leaves the device.

### declarativeNetRequest

Creates local dynamic redirect rules that send navigation to user-selected blocked domains to Lock In's packaged blocked page. Rules are derived only from the user's configured zones, schedules, and allowances.

### alarms

Refreshes schedule boundaries approximately once per minute and schedules the exact local deadline at which an active daily allowance expires.

### Host permissions: http://*/* and https://*/*

Lock In lets the user block any HTTP or HTTPS domain, so it needs host access for user-selected destinations. It also reads only the hostname of the active tab to determine whether a configured daily allowance should run. It does not inject scripts, read page content, inspect forms, or transmit browsing data.

## Remote code

Select: `No, I am not using remote code.`

All JavaScript, CSS, fonts, icons, and text are contained in the submitted package. The extension does not fetch or execute remote resources.

## Data disclosure

Do not select "This item does not collect or use user data."

Declare the dashboard categories corresponding to:

- Web history or browsing activity: active-tab hostname and blocked-domain tally.
- User activity: time spent on configured domains for optional daily allowances.
- User-provided content, if the dashboard includes this category: zone names and domain lists entered by the user.

For every declared category:

- Used only for the extension's single purpose: `Yes`.
- Sold to third parties: `No`.
- Used or transferred for unrelated purposes: `No`.
- Used or transferred for creditworthiness or lending: `No`.
- Used for personalized advertising: `No`.
- Human access: `No`; the data remains solely on the user's device.

## Limited Use certification

Certify compliance. The public policy contains the required statement:

> Lock In's use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.
