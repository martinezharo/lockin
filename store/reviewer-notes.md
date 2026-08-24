# Reviewer notes and test instructions — version 1.4.0

Lock In is a local-only site blocker for Windows. It has no account or external service, but version `1.4.0` requires the reproducible PowerShell watchdog bundle.

> Submission blocker: replace this paragraph with a reviewer-accessible HTTPS download and SHA-256 for `lock-in-1.4.0-windows-watchdog.zip` before submitting the update.

## Companion setup

1. Extract the Windows watchdog archive.
2. Open an elevated PowerShell window in the extracted folder.
3. Run `Set-ExecutionPolicy -Scope Process Bypass`.
4. Run `./install-windows-watchdog.ps1`.
5. Install or reload the submitted extension.
6. Open its dashboard. Confirm it progresses from **watchdog connected · waiting to arm** to **Windows enforcement armed** after three sensor heartbeats.

The installer creates a `SYSTEM` scheduled task, protected local state and disabled emergency firewall rules for installed Chrome/Brave executables. It starts disarmed, so installing components in either order cannot unexpectedly block a reviewer.

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

## Fail-closed test

1. With the watchdog armed, stop or reload the extension service worker while Chrome remains open.
2. After 30 seconds, confirm the watchdog reports `sensor missing`, keeps every enabled zone in `URLBlocklist`, and enables the browser-specific outbound firewall rule.
3. Reload the extension and confirm normal schedule/allowance evaluation resumes.

## Edit-lock and deletion tests

1. Enable Edit lock and confirm weakening a zone requires the displayed manual typing challenge.
2. Choose `Delete all local data` and confirm both the protected watchdog state and extension mirror clear.
3. If the watchdog is stopped, confirm the dashboard reports that protected deletion failed rather than claiming success.

## Privacy verification

- The extension contains no remote code and contacts only `127.0.0.1:8765`.
- It reads only the active-tab hostname and focus state.
- Loopback requests carrying a normal website origin are rejected.
- Authoritative settings and usage stay under protected local Windows storage.
- The extension keeps only a local dashboard mirror in `chrome.storage.local`.
