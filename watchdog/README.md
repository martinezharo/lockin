# Lock In Windows watchdog — legacy PowerShell build

> **Deprecated.** The product now installs `LockIn.Service`, a C# Windows service, through
> `LockIn-Setup-<version>.exe`. The service implements the same loopback protocol, the same rule
> semantics, the same state file and the same per-account firewall behavior, with SCM recovery
> actions instead of a scheduled task. See the root `README.md` and `windows/README.md`.
>
> This PowerShell watchdog is kept because its tests still describe behavior the service must
> preserve (`pnpm watchdog:test`, `tests/watchdog-*.ps1`), and because the reproducible
> `lock-in-<version>-windows-watchdog.zip` bundle remains buildable for anyone still running it.
> Installing it is no longer part of the end-user flow; the C# installer removes its scheduled task
> and migrates its `state.json` when it upgrades a machine.

## Domain and URL rules

Enter a domain, a section such as `youtube.com/shorts/`, or a page such as
`youtube.com/watch?v=ABC` in a zone. URL paths are case-sensitive prefixes, not exact-path matches.
HTTP and HTTPS and subdomains are covered. Query tokens must match but may be reordered or
accompanied by additional tokens. Fragments are case-sensitive prefixes too, so
`chatgpt.com/#settings/Personalization` covers that client-side section without blocking the rest of
ChatGPT. Common tracking parameters are removed from configured rules. Encode literal commas as %2C
in the list.

A zone may also contain always-allowed paths. They must be specific paths or query-based pages
inside one of that zone's contained rules. They stay open during scheduled containment and after an
allowance is spent, and time on them is not counted. Whole-domain and fragment exceptions are
rejected. If another active zone contains the same page, its explicit block wins.

Only pages matching configured URL rules send their path, query, and fragment over loopback. The
active URL is held in memory, not written to the state file.

## Timed releases

A zone can be disarmed for a chosen length of time instead of indefinitely. The extension stores the
deadline on the zone as `disarmedUntil`; this watchdog arms the zone again as soon as that moment
passes, whether or not a browser is running, and reports `supportsTimedDisarm` so older installations
are never offered a release they could not end.

## Developer commands

From the repository:

```powershell
pnpm watchdog:test       # safe-mode end-to-end test (no registry, no firewall)
pnpm watchdog:bundle     # reproducible lock-in-<version>-windows-watchdog.zip
pnpm watchdog:install    # install or update the legacy watchdog (UAC)
pnpm watchdog:status     # health, latency, task state and log tail
```

The legacy bundle's own README (shipped inside the archive) documents
`install-windows-watchdog.ps1`, `disarm-windows-watchdog.ps1`,
`uninstall-windows-watchdog.ps1` and `watchdog-status.ps1` for machines still running it. End users
should use `LockIn-Setup-<version>.exe` instead; nothing in the current setup flow asks anyone to open
a terminal.
