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

## Domain and URL rules

Enter a domain, a section such as `youtube.com/shorts/`, or a page such as
`youtube.com/watch?v=ABC` in a zone. Existing domain rules remain unchanged.
URL paths are case-sensitive prefixes, not exact-path matches. HTTP and HTTPS
and subdomains are covered. Query tokens must match but may be reordered or
accompanied by additional tokens. Common tracking parameters and fragments
are removed from configured rules. Encode literal commas as %2C in the list.

Update the watchdog with `scripts/update-windows-watchdog.ps1` from an elevated
PowerShell in the repository, then reload the extension. The updater backs up
the installed script. Older watchdogs cannot accept URL rules; the dashboard
and bridge reject those writes until the watchdog advertises support.

Only pages matching configured URL rules send their path and query over
loopback. The active URL is held in memory, not written to the state file.
