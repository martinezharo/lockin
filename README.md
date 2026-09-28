# Lock In — Site & App Blocker 👹

Lock In is a Windows app plus a Manifest V3 extension. The extension is the dashboard and the precise
sensor for Chrome and Brave. A protected Windows service owns zones, schedules, daily allowances and
fail-closed enforcement, applies Chrome/Brave `URLBlocklist` and `URLAllowlist` policy, and closes
blocked applications. A per-account tray app reuses the extension's own pages as its dashboard and
reads the foreground window as a fallback sensor for browsers without the extension.

## How it works

```text
Lock In extension (Chrome/Brave)          Lock In tray app (per account)
  ├─ dashboard, popup and edit challenge     ├─ dashboard in WebView2 (same pages)
  ├─ active hostname + focused sensor        ├─ UIA foreground/address-bar sensor
  └─ heartbeat to 127.0.0.1:8765             ├─ closes blocked applications
                    │                        └─ status and notifications
                    ▼                                  │
              LockIn.Service (Windows service, LocalSystem)
                ├─ authoritative zones, usage, schedules and allowances
                ├─ owned Chrome/Brave/Edge URLBlocklist and URLAllowlist policy
                ├─ per-account emergency firewall rules when a sensor disappears
                ├─ UIA and extension sensors, deduplicated per account
                └─ starts the tray app in active sessions if it is killed
```

No account, certificate, cloud service or external server is required. Everything talks over loopback
`127.0.0.1`; URLs are never written to disk.

## Install

Nothing below needs a terminal.

### 1. Run the installer

Download `LockIn-Setup-<version>.exe` from the [latest release](https://github.com/martinezharo/lockin/releases/latest),
check it against the `.sha256` file published beside it, and double-click it. Windows asks for
administrator rights once. Tick the local Windows accounts to protect — the account that launched the
installer and any already-protected accounts are ticked already — and continue.

The installer installs the service, the tray app for every protected account, and the WebView2 runtime
if it is missing. It migrates an existing PowerShell watchdog's data, removes its scheduled task, and
starts safely disarmed.

Unsigned builds show **Windows protected your PC**; choose **More info → Run anyway**. Tagged releases
can be signed when a certificate is configured in CI, which removes that step.

### 2. Install the browser extension

The extension is the precise sensor for Chrome and Brave: it sees the exact page, path, query and
`#fragment`. Once the Chrome Web Store serves a watchdog-compatible version, the installer can
force-install it. Until then:

1. Extract `lock-in-<version>-chrome-web-store.zip` into a folder you intend to keep.
2. Open `brave://extensions` or `chrome://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select the extracted folder.
4. Accept the first-run local-data disclosure.

The tray app detects a browser with no Lock In sensor and offers to open the extensions page for you.

### 3. Let it arm

The dashboard reports **Local enforcement watchdog disconnected** until the service answers. Three
valid heartbeats later it shows **Windows enforcement armed**. Each protected account's sensor is
tracked on its own.

## Rules

Zones can contain sites, applications, or both:

- **Sites**: a domain (`youtube.com`), a section (`youtube.com/shorts/`), or a page
  (`youtube.com/watch?v=ABC`). Paths and `#fragments` are case-sensitive prefixes; query tokens must
  match but may be reordered. Tracking parameters are ignored. Fragments are enforced in the page by
  the extension and never broadened into browser policy.
- **Applications**: executable names such as `discord.exe`. Time is counted from the foreground
  window of the session in front; when the gates are shut the tray app asks the app to close and
  terminates it a few seconds later. A zone can optionally block the app's network for the protected
  accounts. UIA cannot see in-app navigation or fragments, so app zones are approximate.
- **Always allowed pages** stay open inside a site rule and never spend allowance. Applications have
  no free pass.
- **Scheduled hours** support several windows per day, overnight windows, and an all-day window.
- **Daily allowances** run out until midnight; zero minutes is a permanent containment.
- **Timed releases** (`disarmedUntil`) are enforced by the service even while the browser is closed.
- **Edit lock** requires a typing challenge before weakening containment.

## Multiple Windows accounts

Tick every account to protect in the installer. Only the account in front spends allowance; two
accounts on the same zone count the time once; the emergency firewall rules are per browser and per
account, so a missing sensor cuts off only that account's browser. The service starts the tray app for
each protected account at logon and puts it back if it is killed.

## Recovery and removal

- **Lock In Emergency Disarm** in the Start menu (or the tray menu) stops enforcement with one UAC
  prompt and leaves everything installed.
- **Windows Settings → Apps → Lock In → Uninstall** disarms first, then removes the service, the tray
  app, the `LockInWatchdog` firewall rules and only the registry values Lock In wrote. Choose whether
  to keep or erase `C:\ProgramData\LockIn` (default: keep).
- Running a newer installer updates in place and keeps zones, usage and protected accounts. If the new
  service does not become healthy, the previous installation is restored.

## Privacy and security boundary

Lock In has no account, analytics, advertising, remote code or internet server. The extension posts
the active hostname and focus state only to loopback. The tray app reads only the foreground
executable name and, for browsers, the address bar; hostnames and executable names are held in memory.
Configuration and usage stay on the PC under `C:\ProgramData\LockIn`, ACL'd to SYSTEM and
Administrators. Requests are authenticated by the loopback client's PID → owner SID, so only protected
accounts can configure Lock In.

This is a self-control tool, not protection against a determined administrator. A user who
deliberately elevates with UAC can stop the service or remove its firewall rules. Using a separate
administrator account strengthens that boundary.

## Build and test

```powershell
pnpm verify          # release checks, extension tests, and the end-to-end loopback test
pnpm app:test        # the C# engine, service and app tests (xUnit)
pnpm app:build       # self-contained service + tray app + LockIn-Setup-<version>.exe
pnpm watchdog:test   # the legacy PowerShell watchdog's safe-mode integration test
pnpm release         # the Chrome Web Store archive
```

`pnpm verify` proves three-heartbeat arming and fail-closed activation without touching the real
registry or firewall. `pnpm app:test` includes the same end-to-end loopback test against the C#
service (latency under 100 ms, aborted requests, garbage bodies, per-account 403s). Tagged releases
build the installer on `windows-latest`; signing is pluggable through `SIGNING_CERT_BASE64` and
`SIGNING_CERT_PASSWORD` secrets, and unsigned builds still install.

The legacy PowerShell watchdog and its bundles remain buildable and tested
(`pnpm watchdog:bundle`, `pnpm watchdog:update`); `watchdog/README.md` explains why it is deprecated.

The Chrome Web Store archive is written to `dist/lock-in-<version>-chrome-web-store.zip` with a
SHA-256 file beside it. The installer is written to `dist/LockIn-Setup-<version>.exe` the same way.

## Publish a release

Bump the version in `manifest.json` and `package.json`, then push a matching tag:

```bash
git tag v1.5.0
git push origin v1.5.0
```

`.github/workflows/release.yml` refuses a tag that disagrees with the manifest, runs the release
checks and the extension suite on Linux, proves arming and fail-closed activation for both the C#
service and the legacy watchdog on Windows, builds the installer and both archives, and publishes
them with their checksums. Nothing is published unless every check passes.

A final `store` job uploads the same verified extension package to the Chrome Web Store and submits
it for review, only through the `chrome-web-store` environment and only when the four `CWS_*` secrets
are configured. See `store/` for the listing materials and `store/force-install-after-approval.md`
for the switchable force-install policy.

## Repository layout

```text
manifest.json                              extension entry points and permissions
src/background.js                          heartbeat and state-mirror orchestration
src/watchdog-client.js                     loopback HTTP client
src/shared/apps.js                         application-target parsing
src/pages/options/                         dashboard and the in-app setup guide
windows/LockIn.Engine/                     rules, state, sensors, usage, firewall and policy ports
windows/LockIn.Service/                    the Windows service, loopback server and installer helper
windows/LockIn.App/                        the tray app, WebView2 dashboard and UIA sensor
windows/LockIn.Engine.Tests/               xUnit tests, including the end-to-end loopback test
installer/LockIn.iss                       Inno Setup script (account page, upgrade, rollback, uninstall)
windows/build-windows-app.ps1              publish + installer + optional signing
watchdog/LockInWatchdog.ps1                the legacy PowerShell watchdog (deprecated, still tested)
scripts/                                   legacy watchdog and release helpers
store/                                     Chrome Web Store materials
docs/parity-checklist.md                   feature parity checklist with evidence
.github/workflows/release.yml              tagged build and publication
```

## License

MIT. See [LICENSE](LICENSE).
