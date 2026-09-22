# Lock In Windows watchdog 1.4.1

This bundle contains the local PowerShell enforcement component for Lock In.
It contains no custom executable and requires no certificate or online account.

## Install

Extract the complete archive. Open PowerShell as administrator in the extracted folder and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-windows-watchdog.ps1 -ProtectedWindowsUser 'user1,user2'
```

Only those Windows accounts can configure the watchdog. Each active protected account must maintain its own heartbeat; a Lock In copy running under another account cannot prevent fail-closed enforcement.

The watchdog identifies Brave and Chrome processes by their Windows owner SID across sessions, reevaluates policy every 250 ms, and reconciles its firewall rules continuously. This keeps account coverage independent of display names and avoids waiting for a browser or dashboard refresh after a rule changes.

Reload Lock In 1.4.1 in Brave or Chrome. The dashboard must show **Windows enforcement armed** after three heartbeats.

## Emergency recovery

```powershell
.\disarm-windows-watchdog.ps1
```

This disarms Lock In and disables only the emergency firewall rules in the `LockInWatchdog` group.

## Uninstall

```powershell
.\uninstall-windows-watchdog.ps1
```

Add `-PurgeData` only to permanently remove the protected configuration and usage stored under `C:\ProgramData\LockIn`.

## Timed releases

A zone can be disarmed for a chosen length of time instead of indefinitely. The
extension stores the deadline on the zone as `disarmedUntil`; this watchdog arms
the zone again as soon as that moment passes, whether or not a browser is
running, and reports `supportsTimedDisarm` so older installations are never
offered a release they could not end.

## Domain and URL rules

Enter a domain, a section such as `youtube.com/shorts/`, or a page such as
`youtube.com/watch?v=ABC` in a zone. Existing domain rules remain unchanged.
URL paths are case-sensitive prefixes, not exact-path matches. HTTP and HTTPS
and subdomains are covered. Query tokens must match but may be reordered or
accompanied by additional tokens. Fragments are case-sensitive prefixes too,
so `chatgpt.com/#settings/Personalization` covers that client-side section
without blocking the rest of ChatGPT. Common tracking parameters are removed
from configured rules. Encode literal commas as %2C in the list.

A zone may also contain always-allowed paths. They must be specific paths or
query-based pages inside one of that zone's contained rules. They stay open
during scheduled containment and after an allowance is spent, and time on them
is not counted. Whole-domain and fragment exceptions are rejected. If another
active zone contains the same page, its explicit block wins.

Update the watchdog with `pnpm watchdog:update` from the repository and accept
the UAC prompt, then reload the extension. The updater backs up the installed
script, restarts the task, and verifies its health. Older watchdogs cannot
accept URL rules; the dashboard and bridge reject those writes until the
watchdog advertises support.

Only pages matching configured URL rules send their path, query, and fragment over
loopback. The active URL is held in memory, not written to the state file.
