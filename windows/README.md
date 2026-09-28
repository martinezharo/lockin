# Lock In Windows app — developer notes

`LockIn.Service` and `LockIn.App` replace the PowerShell watchdog with a native Windows app. The
loopback protocol is unchanged, so the extension works unmodified.

## Layout

```text
LockIn.Engine/          rules, state, sensors, usage accounting, firewall and policy ports
  Rules/                SiteRules (domains/URLs/app targets), ScheduleRules
  Engine/               WatchdogEngine (the authoritative loop), AppEnforcer, state store, log
  Platform/             native probe, registry policy store, firewall COM controller, launcher
  Installer/            account merge for the installer
LockIn.Service/         ServiceBase host, loopback HttpListener, setup helper commands
LockIn.App/             WinForms tray + WebView2 dashboard + UIA sensor + app enforcement
LockIn.App/web/shim.js  the chrome.* shim injected into the extension's own pages
LockIn.Engine.Tests/    xUnit: rule parity, usage, firewall, sessions, arming, fail-closed, e2e
installer/LockIn.iss    Inno Setup wizard (account page, upgrade, rollback, uninstall)
build-windows-app.ps1   publish both projects, fetch WebView2 bootstrapper, run ISCC, sign
```

## Service configuration

`HKLM\SOFTWARE\LockIn` (written by the installer, read at startup):

| Value | Meaning |
| --- | --- |
| `ProtectedUserSids` | `REG_MULTI_SZ` of protected account SIDs |
| `Port` | loopback port, default `8765` |
| `AppExecutablePath` | tray app path used for the session relaunch |
| `ForceInstallExtension` | `1` when the extension force-install policy is owned and enabled |
| `OwnedExtensionPolicy` | `REG_MULTI_SZ` of `browser|slot` records for policy cleanup |

`C:\ProgramData\LockIn\state.json` stays byte-compatible with the PowerShell watchdog's schema
version 2 and is migrated as-is. The directory is ACL'd to SYSTEM and Administrators; URLs are never
written to it.

## Running and testing

```powershell
dotnet test windows/LockIn.sln -c Release

# console mode on a private port with no registry and no firewall:
dotnet run --project windows\LockIn.Service -- --console --test-mode --port 18766 `
  --data-dir "$env:TEMP\lockin-test" --protected-sids "$([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)" `
  --assume-browser-running
```

`--test-mode` swaps the registry policy store, the firewall controller and the process launcher for
no-ops, so a test run never touches the machine's policy. The xUnit e2e test starts the same host in
process and asserts latency under 100 ms, aborted requests, garbage bodies, per-account 403s,
three-heartbeat arming, fail-closed activation and timed-release expiry.

## Per-account firewall scoping

The service writes one outbound block rule per (executable, account) through the Windows Firewall COM
API, using `INetFwRule3.LocalUserAuthorizedList` with `D:(A;;CC;;;<SID>)` — the same condition
`New-NetFirewallRule -LocalUser` writes. If a scoped rule cannot be created, the controller retries
the rule without the user condition and reports it, so the block covers every protected account
rather than silently covering none.

The PowerShell watchdog's scoping was only ever tested with mocked cmdlets. To prove it on a real
machine, run from an elevated window:

```powershell
.\scripts\verify-firewall-scoping.ps1 -AccountA 'PC\alice' -AccountB 'PC\bob'
```

and follow the printed traffic test from both accounts. If both accounts can still reach the network
with the rule enabled, per-account outbound scoping does not work on that machine; the service's
fallback is documented above and logged as `Per-account firewall rules are unavailable`.

## The chrome.* shim

`LockIn.App/web/shim.js` is injected before the extension pages load and provides the API surface the
pages use: `storage.local` (with `onChanged`), `runtime.getManifest/sendMessage/openOptionsPage/getURL`,
`windows`, `tabs` and `alarms`. It mirrors `GET /health` into `nativeStatus` exactly like the
extension's client, queues configuration edits across a restart, and **never sends an extension
heartbeat** — the UIA sensor is a separate source and fail-closed must keep seeing a missing
extension. The shim is tested in `tests/app-shim.test.mjs` with a fake service.

## UIA limitations

The fallback sensor reads the foreground executable and, for Chrome/Brave/Edge, the address bar
through UI Automation. It cannot see fragments, single-page navigations or in-app routes, and a
browser update can change the accessibility tree. When the extension's heartbeat is fresh for an
account, the extension wins and UIA data for that browser is ignored; UIA only covers browsers
without the extension and application zones. The dashboard's zone editor says so where app targets
are added.

## Installer

`installer/LockIn.iss` (Inno Setup 6) was chosen over WiX: the product needs one double-click
wizard with a dynamic account page, in-place upgrade with rollback, and Windows-native recovery
entries — not an MSI for managed deployment. The service is published self-contained single-file and
doubles as the elevated setup helper (`--setup-helper list-accounts|apply-config|disarm|remove-config|health`),
so the installer has no extra runtime dependency.

Build:

```powershell
pnpm app:build
# or, for developers without the WebView2 bootstrapper cached:
powershell -File windows\build-windows-app.ps1 -SkipInstaller
```

Signing: set `SIGNING_CERT_BASE64` (base64 PFX) and `SIGNING_CERT_PASSWORD`. Without them the build
is unsigned; SmartScreen then needs **More info → Run anyway**.
