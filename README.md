# Lock In — Site Blocker 👹

Lock In is a Manifest V3 extension plus a protected PowerShell watchdog for Windows. The extension is the dashboard and active-tab sensor. The watchdog owns elapsed time, applies Chrome/Brave `URLBlocklist` and `URLAllowlist` policy, and closes the disable-extension escape hatch with Windows Firewall.

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
  ├─ owned Chrome/Brave URLAllowlist exceptions
  └─ emergency browser firewall rules when the sensor disappears
```

No custom executable, certificate, cloud account or external server is required.

## Safe rollout and fail-closed behavior

The watchdog starts disarmed and imports the extension's current groups. It arms only after three consecutive valid heartbeats. After it is armed:

- scheduled zones are written to managed browser URL policy;
- zones whose daily allowance is spent are written to the same policy;
- zone-specific always-allowed paths stay open and do not consume allowance;
- policy decisions are reevaluated every 250 ms; when a newly blocked domain is
  already the active tab, Lock In reloads that tab once so the browser applies
  the policy without a manual refresh; and
- if Brave or Chrome is running and the sensor disappears for more than 30 seconds, all enabled zone domains are blocked and outbound network access for the browser executable is disabled.

The firewall rule prevents disabling the extension from becoming an escape route while browser policy refreshes. Reconnecting the extension removes the emergency firewall block and returns to ordinary schedule/allowance evaluation. Configuration edits are queued across a temporary watchdog disconnect and replayed after reconnect.

Lock In removes only registry values it recorded as its own. Its firewall rules have the group name `LockInWatchdog` and never modify unrelated rules.

## Requirements

- Windows 10 or 11.
- Brave or Chrome. The installer stops if neither is installed.
- An account that can approve one UAC prompt during installation.
- Nothing else: no Node.js, no account, no certificate and no internet server.

## Install

Download both archives from the [latest release](https://github.com/martinezharo/lockin/releases/latest) and
check each one against the `.sha256` file published beside it.

### 1. Load the extension

Extract `lock-in-<version>-chrome-web-store.zip` into a folder you intend to keep. Brave and Chrome reload an
unpacked extension from its original path on every start, so a temporary folder breaks it.

1. Open `brave://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder.
4. Accept the first-run local-data disclosure.

The dashboard now reports **Local enforcement watchdog disconnected** and enforces nothing. That is expected
until the next step.

### 2. Install the watchdog

Extract `lock-in-<version>-windows-watchdog.zip` and run once from an elevated PowerShell window opened in
that folder:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-windows-watchdog.ps1 -ProtectedWindowsUser 'user1,user2'
```

`-ProtectedWindowsUser` takes the Windows account names allowed to configure Lock In; `whoami` prints yours.
From a clone of this repository the same script lives at `.\scripts\install-windows-watchdog.ps1`.

The installer:

- copies the watchdog to `C:\Program Files\Lock In`;
- stores protected state under `C:\ProgramData\LockIn`;
- creates disabled outbound firewall rules for installed Brave/Chrome executables;
- registers `Lock In Watchdog` as an automatic `SYSTEM` scheduled task;
- configures automatic restart; and
- starts safely disarmed.

### 3. Confirm enforcement

Reload the extension. The dashboard must progress from **connected · waiting to arm** to **Windows
enforcement armed** after three heartbeats. Only the selected Windows accounts can configure the watchdog.
Their heartbeats are tracked independently, so one account cannot hide a missing sensor in another active
account.

### About the Chrome Web Store listing

The unlisted store listing still serves version `1.3.0`, which predates the watchdog and blocks only with
`declarativeNetRequest` from inside the browser. It installs in one click and needs no PowerShell, but it can
be removed from the extensions page like any other extension. Install from a release above for the enforced
build.

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

When switching Windows users, disconnected sessions do not require a browser
sensor. Connected sessions still require their own sensor; reconnecting starts
a fresh grace period. Scheduled blocks continue to apply machine-wide.

To update an existing watchdog without resetting its rules, usage, or armed
state, run `pnpm watchdog:update` and accept the single UAC prompt. The updater
elevates only the protected copy step, backs up the installed script, restarts
the SYSTEM task, verifies its health, and restores the backup if startup fails.
UAC cannot be removed safely without allowing user-writable code to replace a
SYSTEM process.
Reload the unpacked extension in the current browser to activate client changes.

```powershell
pnpm verify
pnpm release
```

`pnpm verify` runs the extension suite plus an end-to-end loopback watchdog test. The test proves three-heartbeat arming and fail-closed firewall activation without touching the real registry or firewall.

The Chrome Web Store archive is written to `dist/lock-in-1.4.1-chrome-web-store.zip` with a SHA-256 file beside it. `pnpm watchdog:bundle` writes the companion `dist/lock-in-1.4.1-windows-watchdog.zip` the same way.

## Publish a release

Both archives reach users through GitHub Releases. Bump the version in `manifest.json`, then push a matching tag:

```bash
git tag v1.4.1
git push origin v1.4.1
```

`.github/workflows/release.yml` refuses a tag that disagrees with the manifest, runs the release checks and the extension suite on Linux, proves three-heartbeat arming and fail-closed activation on Windows, builds both archives, and publishes them with their checksums. Nothing is published unless every check passes.

A final `store` job then uploads the same verified package to the Chrome Web Store and submits it for review. It runs only for tags, only after the GitHub release succeeds, and only through the `chrome-web-store` environment. Publishing keeps the listing's existing unlisted visibility.

A required reviewer on that environment holds the store job until someone approves it, so a tag reaches GitHub on its own but never reaches the store unattended. That protection is available because this repository is public; it disappears if the repository is made private again on a free plan, and the job would then publish as soon as a tag passes its checks.

The job needs four repository secrets. Without them it logs a notice and skips, leaving the GitHub release intact:

```text
CWS_CLIENT_ID          OAuth client id for the Chrome Web Store API
CWS_CLIENT_SECRET      its client secret
CWS_REFRESH_TOKEN      long-lived refresh token for the publisher account
CWS_ITEM_ID            ceggfchogfcdgnobpekajiojobghcggi
```

Keep the Google Cloud OAuth consent screen in production. A consent screen left in testing expires the refresh token after seven days and the job then fails on the token exchange.

To mint those credentials once: enable the Chrome Web Store API in a Google Cloud project, create an OAuth client of type **Desktop app** under Google Auth Platform → Clients, then run

```bash
pnpm store:token
```

and approve the printed URL as the publisher account. The helper listens on loopback, exchanges the returned code and prints the refresh token. It keeps the client secret on your machine. If the exchange reports no `refresh_token`, the account has already granted that client: revoke it at <https://myaccount.google.com/permissions> and run the helper again.

Tagging publishes the extension and the watchdog bundle from one commit. That is deliberate: Chrome silently auto-updates the extension while the watchdog only updates when someone runs `pnpm watchdog:update`, so both halves must always be buildable from the same verified source. Any new watchdog-dependent feature must also announce its own capability flag, the way `supportsUrlRules` does, so an older watchdog degrades with a clear message instead of failing.

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
scripts/get-store-refresh-token.mjs       one-time Chrome Web Store token helper
tests/                                    deterministic extension tests
store/                                    Chrome Web Store materials
LICENSE                                   MIT terms
.github/workflows/release.yml             tagged build and publication of both archives
```

## Privacy and security boundary

Lock In has no account, analytics, advertising, remote code or internet server. The extension posts the active hostname and focus state only to loopback (`127.0.0.1`). Configuration and usage stay on the PC.

This is a self-control tool, not protection against a determined administrator. A user who deliberately elevates with UAC can unregister the task or remove its firewall rules. Using a separate administrator account would strengthen that boundary, but is not required for the current setup.

No build or installation script commits or pushes Git changes.

## License

MIT. See [LICENSE](LICENSE).
