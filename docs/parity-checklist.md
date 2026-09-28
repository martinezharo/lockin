# Lock In feature parity checklist

Derived from `watchdog/LockInWatchdog.ps1`, `src/`, `scripts/` and the READMEs at
`main` (`0bd4ea0`). Every item is checked off with the test that proves it or the
manual step that exercises it. Items marked **[real machine]** cannot be proven by
the automated suites alone and are called out again in the final report.

Legend: `[x]` proven, `[~]` proven in tests only, `[ ]` not implemented.

## A. Loopback protocol

- [ ] A1 `POST http://127.0.0.1:8765/api/request` with `{type, requestId, payload}`; response `{ok, requestId, data}`.
- [ ] A2 Request types `bootstrap`, `updateConfig`, `heartbeat`, `getState`, `clearData`, `disarm` with the existing payload shapes.
- [ ] A3 `GET /health` returns `{ok, data: <snapshot>}`.
- [ ] A4 `OPTIONS` answers 204; unknown paths and methods answer 404; malformed bodies answer 400 and never stop the server.
- [ ] A5 CORS: reflect `chrome-extension://[a-p]{32}`; `Vary: Origin`, `Access-Control-Allow-Headers: Content-Type`, private-network header when requested, `Cache-Control: no-store`.
- [ ] A6 Extension-origin gate: a missing `Origin` is accepted; any other origin is rejected with 403.
- [ ] A7 Protected-account authentication: loopback client PID → owner SID; only protected SIDs accepted; `disarm` without an `Origin` is accepted for emergency recovery.
- [ ] A8 Requests are answered even when enforcement or persistence throws.
- [ ] A9 Every answer under 100 ms in the e2e test; aborted requests and garbage bodies do not affect later requests.
- [ ] A10 Additive `appHeartbeat` request type for the UIA/app sensor; the extension protocol is untouched.

## B. Snapshot

- [ ] B1 Status fields: `configured`, `enforcementArmed`, `failClosed`, `failClosedActive`, `firewallBlocked`, `enforcementReason`.
- [ ] B2 Config/usage fields: `groups`, `usage`, `usageSession`, `lockMode`, `privacyConsent`.
- [ ] B3 Capability flags: `supportsUrlRules`, `supportsExceptions`, `supportsTimedDisarm`; new `supportsAppZones`.
- [ ] B4 Enforcement fields: `blockedDomains`, `allowedDomains`; new `blockedApps`.
- [ ] B5 Accounts: `protectedWindowsAccount(s)`, `sensors[]` with `account`, `lastHeartbeatMs`, `activeSession`, `browserRunning` (extension heartbeats keep their exact meaning).
- [ ] B6 `usageSession.groupIds` scoped to the asking sensor key.
- [ ] B7 Snapshot never contains a null group; groups round-trip unknown fields (app targets included).

## C. State and persistence

- [ ] C1 `%ProgramData%\LockIn\state.json`, schema version 2, same field names.
- [ ] C2 Missing or malformed state starts safely disarmed (no enforcement).
- [ ] C3 Atomic save (`state.json.tmp` → move), usage debounce ≤ 5 s, configuration writes immediate; failures retry.
- [ ] C4 Data directory ACL: SYSTEM + Administrators only, inheritance removed.
- [ ] C5 Existing PowerShell `state.json` is migrated with groups, usage, owned policy values, browser paths and protected accounts intact.
- [ ] C6 Old `Lock In Watchdog` scheduled task unregistered and old policy/firewall values adopted or removed at install.

## D. Rule semantics

- [ ] D1 Domain normalization: lowercase, strip scheme/`www`/trailing dots, host only.
- [ ] D2 Site rules: HTTP(S) only, no credentials or wildcards, port kept, tracking parameters (`utm_*`, `fbclid`, `gclid`, `msclkid`) removed, query sorted, fragment kept.
- [ ] D3 URL matching: subdomains, case-sensitive path prefix, case-sensitive fragment prefix, query token equality with percent/`+` decoding, extra parameters do not bypass.
- [ ] D4 Browser policy filter: fragments dropped (`#...` never broadens), `?` becomes `@`, both HTTP and HTTPS covered.
- [ ] D5 Group normalization: domains/exceptions deduped case-sensitively, invalid exceptions dropped, always-allowed pages must sit inside a contained rule.
- [ ] D6 Exceptions win over their own zone, lose to another blocking zone, never consume allowance.
- [ ] D7 Schedules: JS day numbering, several windows, overnight windows, `start == end` all-day, legacy `start`/`end`, day list required.
- [ ] D8 Daily allowance: per local date, permanent zero-minute allowance, remaining time, allowance spent until midnight.
- [ ] D9 Timed disarm: `disarmedUntil` expires in the service (browser closed included), clears the deadline and re-arms; manual arming ends a release early; only advertised when supported.
- [ ] D10 Ticking rules: enabled, limited, not in a scheduled window, allowance left, page matches.
- [ ] D11 Arming: starts disarmed; arms after 3 consecutive heartbeats per sensor, resets after a >2× timeout gap; `disarm` clears counters; `clearData` returns to unconfigured.
- [ ] D12 `bootstrap` imports the extension's groups once and never overwrites an existing authoritative state; `updateConfig` replaces groups, lock mode and consent.
- [ ] D13 `clearData` empties zones, usage, lock mode, consent and armed state.

## E. Usage accounting

- [ ] E1 Only fresh (≤10 s) focused sensors in the session in front spend allowance.
- [ ] E2 The same group from two sensors/accounts counts once.
- [ ] E3 A switched-away session's sensor is ignored; disconnected sessions are exempt from fail-closed.
- [ ] E4 A long gap (sleep/resume) is capped, not charged.
- [ ] E5 Usage is written to disk at most every few seconds and only while someone browses.

## F. Fail-closed and firewall

- [ ] F1 Browser running in a connected session + extension sensor missing longer than `heartbeatTimeoutSeconds` after grace → every enabled zone blocked, reason `sensor missing: <accounts>`.
- [ ] F2 Fail-closed can be switched off by `failClosed` state, on by default.
- [ ] F3 One outbound block rule per (browser executable, account), enabled exactly for the account whose sensor is missing; `*` (unverifiable owner) cuts off every account.
- [ ] F4 Rules use `LocalUser` scoping; if the machine refuses scoped rules the service falls back to every-account blocking and says so.
- [ ] F5 Group `LockInWatchdog` only; old rules with other names in the group are removed; nothing unrelated is touched.
- [ ] F6 Browser executables are learned (including per-user AppData installs) and remembered.
- [ ] F7 Firewall reconciled only on change, on a 60 s tamper check, and after a 15 s backoff when a reconcile fails.
- [ ] F8 Fail-closed keeps the extension's semantics exactly: UIA coverage never suppresses it.

## G. Browser policy registry

- [ ] G1 Chrome/Brave `URLBlocklist` and `URLAllowlist` under HKLM and WOW6432Node (`Software\Policies\...`).
- [ ] G2 Only recorded values are removed, and only while they still hold the recorded value.
- [ ] G3 Slots 1..1000, reusing free numeric names; owned values verified every pass and rewritten when tampered with.
- [ ] G4 Policy writes happen only when the fingerprint changes or a value was tampered with.

## H. Background loop resilience

- [ ] H1 A >15 s clock jump (sleep/resume) resets browser grace periods and re-probes.
- [ ] H2 No slow call on the request path (`Get-NetFirewallRule`-class work moved off it).
- [ ] H3 Listener restarts after a failure; no exception exits the service; SCM recovery restarts it on crash.
- [ ] H4 Log with per-message 60 s dedupe and 1 MB rotation.
- [ ] H5 Multiple concurrent sessions, fast user switching and a stopped firewall service are handled without spinning.

## I. Extension behavior (unchanged)

- [ ] I1 Heartbeat every 2 s; bootstrap once; reconnect re-bootstraps.
- [ ] I2 Config edits debounced 100 ms, queued across disconnects and replayed.
- [ ] I3 Disconnected reported only after 10 s of continuous failure.
- [ ] I4 `url` sent only for a matching configured URL rule; hash stripped unless a fragment rule matches; credentials stripped; privacy consent gates everything.
- [ ] I5 Policy changes reload affected open tabs; SPA navigations reload once; fragment rules never reload.
- [ ] I6 Empty watchdog groups re-seed from local; malformed groups filtered; URL/app rules gated on capability flags.
- [ ] I7 Fragment blocker UI, edit-lock typing challenge, popup and dashboard keep working.

## J. Application limits (new)

- [ ] J1 Zones accept executable targets (`apps`) alongside sites; old extension round-trips them and `supportsAppZones` gates the UI.
- [ ] J2 App zones use the same schedule/allowance/timed-disarm model; exceptions do not apply to executables.
- [ ] J3 Time is counted from the foreground window of the session in front, once across sources.
- [ ] J4 Blocked apps are closed gracefully (`WM_CLOSE`) and terminated after a grace period; a per-zone network block is optional.
- [ ] J5 Blocked apps are reported in the snapshot and shown by the dashboard.

## K. LockIn.App

- [ ] K1 Tray app with dashboard window reusing `src/pages/options` + popup through a `chrome.*` shim.
- [ ] K2 Shim surface: `storage.local` get/set/clear/onChanged, `runtime.getManifest/sendMessage/openOptionsPage/getURL`, `windows`, `tabs`, `alarms`.
- [ ] K3 Shim mirrors `/health` snapshots into storage and pushes config edits to the service; it never sends extension heartbeats.
- [ ] K4 UIA sensor reads the foreground browser address bar (Chrome, Brave, Edge; Firefox best effort) and the foreground executable for app zones.
- [ ] K5 Extension beats UIA for a browser with a fresh heartbeat; UIA covers browsers without the extension; no double counting.
- [ ] K6 Status and notifications: sensor missing, extension not installed, blocked by schedule; UIA limits documented in the UI.
- [ ] K7 Started for every protected account at logon; the service relaunches it into active sessions (`WTSQueryUserToken` + `CreateProcessAsUser`).

## L. Installer

- [ ] L1 One `LockIn-Setup-<version>.exe`, double-click, one UAC prompt, no terminal.
- [ ] L2 Account checkbox page defaulting to the launching account plus already-protected accounts.
- [ ] L3 Installs service, app autostart, and WebView2 runtime when missing.
- [ ] L4 In-place upgrade preserves zones, usage and protected accounts; rolls back when the new service is unhealthy.
- [ ] L5 Uninstall via Settings → Apps disarms first, removes only Lock In's registry values and `LockInWatchdog` firewall rules; data kept by default, erase option.
- [ ] L6 Emergency disarm in Start menu and tray, with UAC.
- [ ] L7 Force-install extension policy switchable, conditional on store readiness; otherwise guide the user, and the tray detects per-browser sensor presence.
- [ ] L8 Removal touches only what Lock In created.

## M. Distribution and CI

- [ ] M1 Tagged release builds and publishes the installer (+ `.sha256`).
- [ ] M2 Code signing pluggable through CI secrets; unsigned builds documented with the SmartScreen step.
- [ ] M3 `store/*`, READMEs and the in-extension guide never instruct end users to open a terminal.
- [ ] M4 `pnpm verify` stays green; C# and JS test suites run on `windows-latest`.

## N. Security and privacy

- [ ] N1 Loopback only; no listener beyond 127.0.0.1; extension origin checks.
- [ ] N2 PID→SID authentication for protected-account requests.
- [ ] N3 Data directory ACL SYSTEM + Administrators.
- [ ] N4 URLs never persisted; app sensor stores hostnames/exe names only.
- [ ] N5 No auto-update that runs downloaded code as SYSTEM without signature/hash verification.
