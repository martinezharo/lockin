# Reviewer notes and test instructions

Lock In is a local-only site blocker. No account or external service is required.

## First-run disclosure

1. Install the extension and open its options page if Chrome does not open it automatically.
2. Confirm that Lock In shows a prominent local-data disclosure before it inspects active-tab hostnames or installs blocking rules.
3. Select `Accept and continue`.

## Core blocking test

1. In the dashboard, select `Open a new containment permit`.
2. Use `Review test` as the zone name and `example.com` as the domain.
3. Enable `Scheduled hours`, select the current weekday, and choose a window containing the current time.
4. Save the zone and navigate to `https://example.com`.
5. Confirm that navigation redirects to Lock In's packaged blocked page.

## Daily allowance test

1. Create or edit a zone containing `example.com`.
2. Disable scheduled hours and enable a one-minute daily allowance.
3. Keep `example.com` active in the focused window until the allowance expires.
4. Confirm that the open tab is redirected and the popup/dashboard report the allowance as spent.

## Edit-lock test

1. Enable `Edit lock` in the dashboard.
2. Try to disarm or delete a zone.
3. Confirm that Lock In requires the displayed paragraph to be typed before the weakening action runs.

## Privacy verification

- The package contains no remote code and performs no network requests.
- The extension reads only active-tab hostnames, not page content.
- All settings and usage records are stored in `chrome.storage.local`.
- `Delete all local data` is available in the dashboard footer.
