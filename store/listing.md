# Chrome Web Store listing — version 1.5.0

## Product details

- Name: `Lock In — Site Blocker`
- Summary: `Manage scheduled site blocks and daily limits enforced by a protected local Windows watchdog.`
- Category: `Productivity`
- Language: `English`
- Visibility: `Unlisted`

## Detailed description

Lock In helps you avoid distracting websites and applications using schedules and daily allowances. The extension provides the dashboard and active-tab sensor; the installed Windows app runs a protected service that stores usage and applies managed Chrome/Brave URL policies, and a tray app that also counts and closes blocked applications.

Main features:

- Group user-selected domains, URLs or executables into containment zones.
- Schedule blocking windows by weekday, including overnight windows.
- Set daily allowances measured only while a configured domain, URL or application is active in the focused window.
- Keep enforcement active outside the extension through a protected Windows service with SCM recovery.
- Fail closed for configured domains or URLs if the extension sensor disappears after setup.
- Close blocked applications (WM_CLOSE, then terminate) from the per-account tray app.
- Require a manual typing challenge before weakening existing rules.
- Display authoritative remaining time, current policy state and watchdog health.
- Keep all configuration and usage information on the device, with no account, analytics, ads or server.

Lock In requires its Windows app installer. It reads the hostname of the active tab and, when it matches a configured URL rule, its path, query, and fragment and never reads page content. This data is sent only to `127.0.0.1` and is never transmitted over the internet.

## Single purpose

Lock In's single purpose is to help the user avoid distracting websites by measuring user-selected domains or URLs and managing local schedule and allowance enforcement, with deliberate friction before restrictions can be weakened.

## Store fields

- Privacy policy URL: update the existing public policy to version `1.5.0` before submission.
- Official URL: leave blank.
- Support URL: use the reviewer-accessible installer download page when available.
- Mature content: `No`
- In-app purchases: `No`
