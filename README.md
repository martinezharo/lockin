# Lock In — Site Blocker 👹

Lock In is a Manifest V3 extension plus a protected PowerShell watchdog for Windows. The extension is the dashboard and active-tab sensor. The watchdog owns elapsed time, applies Chrome/Brave `URLBlocklist` policy, and closes the disable-extension escape hatch with Windows Firewall.

## How it works

```text
Lock In extension
  ├─ dashboard, popup and edit challenge
  ├─ active hostname + focused-window sensor
  └─ heartbeat to http://127.0.0.1:8765
                         │
                         ▼
LockInWatchdog.ps1 (scheduled task running as SYSTEM)
  ├─ authoritative groups and daily usage
  ├─ schedules and allowance decisions
  ├─ owned Chrome/Brave URLBlocklist entries
  └─ emergency browser firewall rules when the sensor disappears
```

No custom executable, certificate, cloud account or external server is required.

## Safe rollout and fail-closed behavior

The watchdog starts disarmed and imports the extension's current groups. It arms only after three consecutive valid heartbeats. After it is armed:

- scheduled zones are written to managed browser URL policy;
- zones whose daily allowance is spent are written to the same policy; and
- if Brave or Chrome is running and the sensor disappears for more than 30 seconds, all enabled zone domains are blocked and outbound network access for the browser executable is disabled.

The firewall rule prevents disabling the extension from becoming an escape route while browser policy refreshes. Reconnecting the extension removes the emergency firewall block and returns to ordinary schedule/allowance evaluation.

Lock In removes only registry values it recorded as its own. Its firewall rules have the group name `LockInWatchdog` and never modify unrelated rules.

## Install

Run once from an elevated PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-windows-watchdog.ps1
```

The installer:

- copies the watchdog to `C:\Program Files\Lock In`;
- stores protected state under `C:\ProgramData\LockIn`;
- creates disabled outbound firewall rules for installed Brave/Chrome executables;
- registers `Lock In Watchdog` as an automatic `SYSTEM` scheduled task;
- configures automatic restart; and
- starts safely disarmed.

Reload extension version `1.4.0` after installation. The dashboard must progress from **connected · waiting to arm** to **Windows enforcement armed** after three heartbeats.

## Emergency recovery and uninstall

From an elevated PowerShell window:

```powershell
.\scripts\disarm-windows-watchdog.ps1
```

Uninstall while preserving configuration:

```powershell
.\scripts\uninstall-windows-watchdog.ps1
```

Add `-PurgeData` only to permanently remove protected configuration and usage.

## Build and test

```powershell
pnpm verify
pnpm release
```

`pnpm verify` runs the extension suite plus an end-to-end loopback watchdog test. The test proves three-heartbeat arming and fail-closed firewall activation without touching the real registry or firewall.

The Chrome Web Store archive is written to `dist/lock-in-1.4.0-chrome-web-store.zip` with a SHA-256 file beside it.

## Repository layout

```text
manifest.json                              extension entry points and permissions
src/background.js                         heartbeat and state-mirror orchestration
src/watchdog-client.js                    loopback HTTP client
watchdog/LockInWatchdog.ps1               protected enforcement engine
scripts/install-windows-watchdog.ps1      elevated one-time installation
scripts/disarm-windows-watchdog.ps1       emergency recovery
scripts/uninstall-windows-watchdog.ps1    selective removal
scripts/test-watchdog.mjs                 end-to-end safe-mode integration test
tests/                                    deterministic extension tests
store/                                    Chrome Web Store materials
```

## Privacy and security boundary

Lock In has no account, analytics, advertising, remote code or internet server. The extension posts the active hostname and focus state only to loopback (`127.0.0.1`). Configuration and usage stay on the PC.

This is a self-control tool, not protection against a determined administrator. A user who deliberately elevates with UAC can unregister the task or remove its firewall rules. Using a separate administrator account would strengthen that boundary, but is not required for the current setup.

No build or installation script commits or pushes Git changes.
