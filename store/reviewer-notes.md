# Reviewer notes and test instructions — version 1.5.0

Lock In is a local-only site and app blocker for Windows. It has no account or external service.
Version `1.5.0` installs a Windows service and a tray app through one signed-or-unsigned installer;
the extension remains the dashboard and the precise browser sensor.

## Companion setup (no terminal)

1. Download `LockIn-Setup-1.5.0.exe` from
   <https://github.com/martinezharo/lockin/releases/download/v1.5.0/LockIn-Setup-1.5.0.exe>.
   Its SHA-256 is published beside it as `LockIn-Setup-1.5.0.exe.sha256` and repeated in the release
   notes. The installer is built from this repository by a tagged GitHub Actions run, not by hand.
2. Double-click it and approve the single UAC prompt.
3. Tick the local Windows accounts to protect on the account page and continue.
4. If the build is unsigned, SmartScreen shows **Windows protected your PC**; choose **More info → Run anyway**.
5. Install or reload the submitted extension (the Chrome Web Store copy, or the release ZIP by hand).
6. Open its dashboard. Confirm it progresses from **watchdog connected · waiting to arm** to
   **Windows enforcement armed** after three sensor heartbeats.

> Before submitting: paste the literal SHA-256 from that release here so the reviewer does not have to
> follow a second link.

The installer creates a `LockInWatchdog` service with SCM recovery actions, protected local state
under `C:\ProgramData\LockIn`, a per-account tray app at logon, and disabled emergency firewall rules
for installed Chrome/Brave executables. It starts disarmed, so installing components in either order
cannot unexpectedly block a reviewer.

## Core policy test

1. Accept the first-run local-data disclosure.
2. Create a zone named `Review test` containing `example.com`.
3. Enable scheduled hours for the current weekday and a window containing the current time.
4. Wait a few seconds, then open `chrome://policy` and reload policies.
5. Confirm that `URLBlocklist` contains `example.com` and navigating there displays Chrome's managed-policy block.

## Daily allowance test

1. Edit the zone to remove scheduled hours and use a one-minute allowance.
2. Keep `example.com` active in the focused window.
3. Confirm the dashboard countdown is sourced from the watchdog and eventually reports the allowance as spent.
4. Reload `chrome://policy` and confirm `example.com` appears in `URLBlocklist`.

## Application-zone test (new in 1.5.0)

1. Create a zone containing `notepad.exe` (or another test executable) with a schedule that contains the current time.
2. Focus the application; the tray app reports it as blocked and closes it (WM_CLOSE, then terminate after a few seconds).
3. Confirm the dashboard row reports the app count and the tray shows a blocked-app notification.

## Fail-closed test

1. With the watchdog armed, stop or reload the extension service worker while Chrome remains open.
2. After 60 seconds, confirm the watchdog reports `sensor missing`, keeps every enabled zone in `URLBlocklist`, and enables the browser-specific outbound firewall rule.
3. Reload the extension and confirm normal schedule/allowance evaluation resumes.
4. The UIA fallback sensor does not suppress this: a missing extension still fails closed.

## Recovery and removal

1. Start menu → **Lock In Emergency Disarm**: one UAC prompt, containment stops, everything stays installed.
2. Windows Settings → Apps → **Lock In** → Uninstall: disarm first, then remove the service, the tray app,
   the `LockInWatchdog` firewall rules and only Lock In's own registry values. Choose whether to keep or
   erase `C:\ProgramData\LockIn` (default: keep).

## Edit-lock and deletion tests

1. Enable Edit lock and confirm weakening a zone requires the displayed manual typing challenge.
2. Choose `Delete all local data` and confirm both the protected watchdog state and extension mirror clear.
3. If the service is stopped, confirm the dashboard reports that protected deletion failed rather than claiming success.

## Privacy verification

- The extension contains no remote code and contacts only `127.0.0.1:8765`.
- The extension reads only the active-tab hostname, focus state and, for configured URL rules, the path/query/fragment.
- The tray app's UIA fallback reads only the foreground executable name and the browser address bar; hostnames and executable names are held in memory and never written to disk.
- Loopback requests carrying a normal website origin are rejected.
- Authoritative settings and usage stay under protected local Windows storage.
- The extension keeps only a local dashboard mirror in `chrome.storage.local`.
