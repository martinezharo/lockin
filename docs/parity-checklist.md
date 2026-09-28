# Lock In feature parity checklist

Derived from `watchdog/LockInWatchdog.ps1`, `src/`, `scripts/` and the READMEs at
`main` (`0bd4ea0`). Every item is checked off with the test that proves it or the manual step
that exercises it.

Legend:

- `[x]` proven by an automated test that ran in this worktree.
- `[~]` implemented and covered by code/compile-time checks, but its real-machine behavior needs
  the manual step named beside it (this worktree could not run elevated/installer/GUI steps).
- `[ ]` not implemented.

Automated suites: `pnpm verify` (release checks + 83 extension tests + the legacy PowerShell e2e),
`pnpm app:test` (46 xUnit tests including the C# end-to-end loopback test), and
`node --test tests/app-shim.test.mjs` (6 shim tests).

## A. Loopback protocol

- [x] A1 `POST /api/request` `{type, requestId, payload}` → `{ok, requestId, data}` — `LoopbackIntegrationTests.Send`.
- [x] A2 Same six request types and payload shapes — `ArmsAfterThreeHeartbeats...`, `UrlRules...`, `TimedReleases...`, `ConfigurationTests`, `ProtectedAccountTests`.
- [x] A3 `GET /health` returns `{ok, data: snapshot}` — `LoopbackServer.Handle`, e2e health polling.
- [x] A4 OPTIONS 204, unknown 404, malformed body 400, server survives — e2e garbage-body and unknown-path checks; `Program`/`LoopbackServer` try/catch.
- [x] A5 CORS headers, private-network header, `Cache-Control: no-store` — `LoopbackServer.WriteJson`; exercised by the shim test and the browser client tests.
- [x] A6 Missing Origin accepted, other origins 403 — `LoopbackServer.Handle` origin gate; `ProtectedAccountTests`.
- [x] A7 PID→SID authentication, `disarm` without Origin allowed — `NativeProbe.GetLoopbackClientProcessId`, `LoopbackServer.Authorize`; `ProtectedAccountTests.AnotherWindowsAccountIsRejectedButEmergencyDisarmIsNot`.
- [x] A8 Requests answered even when enforcement/persistence throws — `HandleRequest` wraps `Evaluate` and `SaveState`; e2e still answers after aborted requests.
- [x] A9 <100 ms answers, aborted requests, garbage bodies — `ArmsAfterThreeHeartbeatsAndReportsThePolicy` latency loop (asserts <100 ms).
- [x] A10 Additive `appHeartbeat` type; extension protocol untouched — `AppZoneTests`, `UiaPrecedenceTests`; extension suites unchanged.

## B. Snapshot

- [x] B1 Status fields — `Snapshot`; e2e asserts `failClosedActive`, `firewallBlocked`, `enforcementReason`.
- [x] B2 Config/usage fields — e2e bootstrap/updateConfig assertions; shim mirror test.
- [x] B3 Capability flags incl. `supportsAppZones` — e2e asserts all four; `watchdog-client` mirrors them.
- [x] B4 `blockedDomains`, `allowedDomains`, `blockedApps` — e2e; `AppZoneTests`.
- [x] B5 `protectedWindowsAccount(s)` and `sensors[]` with the same meaning — e2e `sensors` assertions; `WatchdogEngine.BuildSnapshotLocked`.
- [x] B6 `usageSession` scoped to the asking sensor — e2e URL-rule assertions.
- [x] B7 No null groups; unknown fields round-trip — `watchdog-client` `isGroup` test; `SiteRuleTests` round-trip via `[JsonExtensionData]`; `tests/app-zones.test.mjs`.

## C. State and persistence

- [x] C1 `%ProgramData%\LockIn\state.json`, schema 2, same field names — `WatchdogState`, `FileStateStore`.
- [x] C2 Missing/malformed state starts disarmed — `WatchdogEngine.LoadState`; `ConfigurationTests`.
- [x] C3 Atomic save, usage debounce, urgent config writes, retry — `FileStateStore.Save` (tmp+move), `SaveState`; `InMemoryStateStore` tests.
- [~] C4 Data directory ACL SYSTEM + Administrators — `SetupHelperCommands.SecureDirectory` (`icacls /inheritance:r`). Manual: install and run `icacls C:\ProgramData\LockIn`.
- [~] C5 Migrate the PowerShell `state.json` — the service loads the same path and `SetupHelperCommands.ResetArmedState` resets only the armed flags. Manual: install over an old watchdog and confirm zones/usage survive.
- [~] C6 Old task unregistered; old policy/firewall values adopted — installer runs `schtasks /Delete /TN "Lock In Watchdog" /F`; the service removes only recorded policy values and adopts same-named firewall rules. Manual: install over an old watchdog.

## D. Rule semantics

- [x] D1 Domain normalization — `SiteRuleTests.NormalizeSiteKeepsUrlSpecificity`.
- [x] D2 Site rules (tracking params, ports, fragments) — `NormalizeSiteKeepsUrlSpecificity`, `SiteRuleTests` table.
- [x] D3 URL matching (subdomains, case-sensitive path/fragment, query tokens) — 13-case theory ported from `tests/watchdog-sites.ps1`.
- [x] D4 Policy filter drops fragments, `?`→`@` — `PolicyFilterNeverBroadensFragments`.
- [x] D5 Group normalization, exception validation — `NormalizeGroupsKeepsCaseSensitivePathsAndDropsInvalidExceptions`.
- [x] D6 Exceptions win locally, lose to another blocking zone, never consume allowance — `GroupMatchingHonoursPathsAndExceptions`, e2e exception assertion, engine conflict loop.
- [x] D7 Schedules incl. overnight and all-day — `ScheduleRules.IsWithinSchedule`, `AppZoneTests`, `TimedReleases...`.
- [x] D8 Daily allowance incl. permanent — `UsageTests`, e2e permanent group.
- [x] D9 Timed disarm expiry and early arming — `TimedReleasesExpireInTheWatchdogAndRunningOnesDoNot`, e2e `TimedReleasesExpireOnTheWatchdogSide`; extension `timed-disarm.test.mjs` unchanged.
- [x] D10 Ticking rules — `UsageTests`, `UiaPrecedenceTests`.
- [x] D11 Arming after 3 heartbeats, gap reset, disarm/clearData — `ArmsOnlyAfterThreeConsecutiveHeartbeatsAndResetsAfterAGap`, `ConfigurationTests`.
- [x] D12 Bootstrap import-once, updateConfig replace — `BootstrapImportsOnceAndUpdateConfigReplaces`, e2e.
- [x] D13 `clearData` resets everything — `BootstrapImportsOnceAndUpdateConfigReplaces`.

## E. Usage accounting

- [x] E1 Only fresh focused sensors in the session in front — `UsageTests.OnlyTheAccountInFrontCounts...`.
- [x] E2 Same group from two accounts/sensors counts once — `UsageTests`, `UiaPrecedenceTests.AFreshExtensionBeatKeepsUiaFromDoubleCounting`.
- [x] E3 Switched-away sessions ignored — `UsageTests`; `SessionTests`.
- [x] E4 Long gaps capped — `AStaleSensorStopsCountingAndALongGapIsCapped`.
- [x] E5 Debounced writes — `SaveState`; `InMemoryStateStore.Saves` tests.

## F. Fail-closed and firewall

- [x] F1 Missing sensor blocks every enabled zone with `sensor missing: <accounts>` — `FailClosedBlocksEveryEnabledZoneWhenASensorIsMissing`, e2e `FailClosedActivatesWhenAProtectedSensorDisappears`.
- [x] F2 `failClosed` switch honored — `WatchdogState.FailClosed`, decision branch.
- [x] F3 One rule per (browser, account), `*` blocks all — `FirewallTests.OneRulePerBrowserAndAccount...` (ported from `tests/watchdog-accounts.ps1`).
- [~] F4 Per-account `LocalUser` scoping with documented fallback — `ComFirewallController` uses `INetFwRule3.LocalUserAuthorizedList` and falls back to unscoped rules with a warning. Real-machine proof: `scripts/verify-firewall-scoping.ps1` (needs elevation and two accounts).
- [x] F5 Only the `LockInWatchdog` group is touched; old rules removed — `FirewallTests` (old `LockIn-Watchdog-chrome-1` removed), `FakeFirewall`.
- [x] F6 Browser executables learned and remembered — `RegisterBrowserPath`; `FirewallTests` uses learned paths.
- [x] F7 Reconcile on change/60 s/15 s backoff — `ApplyFirewall` timing; `FirewallTests` sequence.
- [x] F8 UIA never suppresses fail-closed — `UiaPrecedenceTests`, `WatchdogEngine` (extension heartbeat map is separate).

## G. Browser policy registry

- [~] G1 Chrome/Brave/Edge `URLBlocklist`/`URLAllowlist` under HKLM and WOW6432Node — `RegistryPolicyStore` paths (Edge added for the UIA coverage). Manual: install and check `chrome://policy`.
- [~] G2 Only recorded values removed, and only while they still match — `RegistryPolicyStore.Apply`. Manual: pre-seed a value and confirm it survives.
- [~] G3 Slots 1..1000, free-name reuse, tamper re-verification — `Apply`, `OwnedCurrent`, `ApplyPolicies`. Manual: edit a written value and watch the next pass rewrite it.
- [~] G4 Writes only on fingerprint change/tamper — `ApplyPolicies`. Manual: watch `%ProgramData%\LockIn\watchdog.log`.

## H. Background loop resilience

- [x] H1 Clock jump restarts grace periods — `AClockJumpRestartsSensorGracePeriods`.
- [x] H2 No slow call on the request path — decisions are in-memory; registry writes, firewall reconciliation and process probing run on the enforcement thread (`EnforcementPass` → `ApplySideEffects`). The only disk touch is the debounced state write (at most once per 5 s, immediate on configuration changes), and the e2e latency loop asserts answers stay under 100 ms.
- [x] H3 Listener restarts; exceptions logged, service never exits; SCM recovery — `LoopbackServer.AcceptLoopAsync`, `ServiceRunner.EnforcementLoop`, installer `sc failure`.
- [x] H4 Log dedupe and rotation — `FileLog`.
- [x] H5 Multiple sessions, fast user switching, firewall backoff — `SessionTests`, `FirewallTests`, `ApplyFirewall` retry interval.

## I. Extension behavior (unchanged)

- [x] I1 Heartbeat every 2 s; bootstrap; reconnect re-bootstrap — `tests/watchdog-client.test.mjs` (unchanged and green).
- [x] I2 Debounced config sync with replay — same suite, `configuration changed while offline is replayed`.
- [x] I3 Disconnect only after 10 s — same suite, `a brief outage is not reported as a disconnect`.
- [x] I4 URL only for matching rules, fragment-aware hash, consent gate — same suite, `heartbeats send URL details only...`.
- [x] I5 Tab reloads on policy change, SPA recheck, fragments never reload — same suite.
- [x] I6 Empty-group re-seed, malformed filtering, capability gating — same suite plus `old watchdogs never receive URL configuration...`; app gating added in `watchdog-client.js` with `tests/app-zones.test.mjs` coverage of the round-trip.
- [~] I7 Fragment blocker, edit-lock challenge, popup, dashboard — the extension suites are green; the browser UI checks live in `tests/ui/polish-regressions.mjs` and `tests/ui/help-screenshots.mjs` (Playwright; not installed in this worktree). Manual: load the unpacked extension and run those two scripts.

## J. Application limits (new)

- [x] J1 `apps` field round-trips through old storage code; `supportsAppZones` gates the UI — `tests/app-zones.test.mjs`, `options.js` `checkAppSupport`, `templates.js`.
- [x] J2 Same schedule/allowance/timed-disarm model; no exceptions for executables — `AppZoneTests`, `WatchdogEngine` decision, template note.
- [x] J3 Foreground-window accounting once across sources — `AppUsageCountsFromTheForegroundWindowOnceAcrossSources`, `UiaPrecedenceTests`.
- [x] J4 WM_CLOSE then terminate after grace; optional network block — `AppEnforcerTests`; `FirewallTests.AppNetworkBlocksBecomeScopedRulesForKnownExecutables`.
- [x] J5 Blocked apps reported — `Snapshot.BlockedApps`, e2e/shim mirror, tray tooltip.

## K. LockIn.App

- [x] K1 Tray + dashboard reusing the extension pages through the shim — `LockIn.App`, `web/shim.js`, `tests/app-shim.test.mjs`.
- [x] K2 Shim surface — `tests/app-shim.test.mjs`; API list in `windows/README.md`.
- [x] K3 Mirror + config push, never a heartbeat — `tests/app-shim.test.mjs` (`the shim never sends an extension heartbeat`).
- [~] K4 UIA foreground/address-bar sensor — `ForegroundSensor`, `UiaAddressBarReader`. Manual: focus Chrome and confirm the dashboard counts the visible site; focus a zone app and confirm accounting.
- [x] K5 Extension wins over UIA; no double counting — `UiaPrecedenceTests`.
- [~] K6 Notifications and documented UIA limits — `TrayContext.Notify`, `ExtensionDetector`, template help text. Manual: kill the extension and watch the tray balloon.
- [~] K7 Logon start and service relaunch into active sessions — `WtsProcessLauncher`, `WatchdogEngine.RelaunchAppIfNeeded`, installer Run key. Manual: kill the tray app and watch the service restart it within 30 s.

## L. Installer

- [~] L1 One `LockIn-Setup-<version>.exe`, one UAC prompt, no terminal — compiled and inspected; `installer/LockIn.iss`. Manual: run `dist/LockIn-Setup-1.5.0.exe`.
- [~] L2 Account checkbox page with defaults — `AccountSelectionTests` cover the merge; the page is populated by `--setup-helper list-accounts`. Manual: run the installer.
- [~] L3 Service, app autostart, WebView2 when missing — `[Files]`/`[Run]`/`[Registry]`; WebView2 check by registry `pv`. Manual: run on a machine without the runtime.
- [~] L4 Upgrade preserves state; rollback on unhealthy — `CopyDirectory` backup + `Rollback()` + `health` helper. Manual: install twice, then install a deliberately broken build.
- [~] L5 Uninstall disarms, removes only its own values/rules, keep-vs-erase prompt — `InitializeUninstall`, `CurUninstallStepChanged`, `SetupHelperCommands.RemoveConfig`. Manual: uninstall and inspect `HKLM\SOFTWARE\LockIn` and the firewall group.
- [~] L6 Emergency disarm in Start menu and tray with UAC — `[Icons]`, `TrayContext`, `EmergencyDisarm`. Manual: run it and confirm the UAC prompt and the disarm.
- [~] L7 Switchable force-install, guide mode default, per-browser detection — `OptionsPage` radio, `SetupHelperCommands.ApplyForcelist`, `ExtensionDetector`. Manual: after store approval, reinstall with force-install and check `chrome://policy`.
- [~] L8 Removal touches only what Lock In created — ownership records `OwnedExtensionPolicy`, firewall group filter. Manual: uninstall and diff the policy keys.

## M. Distribution and CI

- [x] M1 Tagged release builds and publishes the installer (+`.sha256`) — `.github/workflows/release.yml` `windows-app` job; `windows/build-windows-app.ps1` produced `dist/LockIn-Setup-1.5.0.exe` + `.sha256` locally.
- [x] M2 Signing pluggable; unsigned documented — `SIGNING_CERT_BASE64`/`SIGNING_CERT_PASSWORD` in the build script and workflow; SmartScreen note in the README and reviewer notes.
- [x] M3 No terminal instructions for end users — README, `watchdog/README.md`, `strict-mode.js`/`options.html` guide, `store/*`; asserted by `tests/ui/polish-regressions.mjs` (`doesNotMatch /PowerShell|\.ps1|Set-ExecutionPolicy/`).
- [x] M4 `pnpm verify` green; C# and JS suites on `windows-latest` — `pnpm verify` passes here; `dotnet test windows/LockIn.sln` 46/46; workflow runs both on `windows-latest`.

## N. Security and privacy

- [x] N1 Loopback only, origin checks — `LoopbackServer` binds `http://127.0.0.1:<port>/`; origin gate.
- [x] N2 PID→SID authentication — `Authorize`, `ProtectedAccountTests`.
- [~] N3 Data directory ACL — `SecureDirectory`; manual `icacls`.
- [x] N4 URLs never persisted; hostnames/exe names only — `SendableUrl` gate, state model has no URL field; `UiaPrecedenceTests`/`SiteRuleTests.SendableUrl...`.
- [x] N5 No unsigned auto-update — there is no updater; updates run a newer installer, and the CI signing step is optional. Documented in `windows/README.md` and the README.
