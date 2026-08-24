# Chrome Web Store listing — version 1.4.0

## Product details

- Name: `Lock In — Site Blocker`
- Summary: `Manage scheduled site blocks and daily limits enforced by a protected local Windows watchdog.`
- Category: `Productivity`
- Language: `English`
- Visibility: `Unlisted`

## Detailed description

Lock In helps you avoid distracting websites using schedules and daily allowances. The extension provides the dashboard and active-tab sensor; an installed PowerShell watchdog stores usage and applies managed Chrome/Brave URL policies.

Main features:

- Group user-selected domains into containment zones.
- Schedule blocking windows by weekday, including overnight windows.
- Set daily allowances measured only while a configured hostname is active in the focused browser window.
- Keep enforcement active outside the extension through a protected Windows watchdog task.
- Fail closed for configured domains if the extension sensor disappears after setup.
- Require a manual typing challenge before weakening existing rules.
- Display authoritative remaining time, current policy state and watchdog health.
- Keep all configuration and usage information on the device, with no account, analytics, ads or server.

Lock In requires its Windows watchdog package. It reads only the hostname of the active tab and never reads page content. The hostname is sent only to `127.0.0.1` and is never transmitted over the internet.

## Single purpose

Lock In's single purpose is to help the user avoid distracting websites by measuring user-selected domains and managing local schedule and allowance enforcement, with deliberate friction before restrictions can be weakened.

## Store fields

- Privacy policy URL: update the existing public policy to version `1.4.0` before submission.
- Official URL: leave blank.
- Support URL: use the reviewer-accessible Windows watchdog download page when available.
- Mature content: `No`
- In-app purchases: `No`
