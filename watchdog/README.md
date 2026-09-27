# Lock In Windows watchdog 1.4.1

This bundle contains the local PowerShell enforcement component for Lock In.
It contains no custom executable and requires no certificate or online account.

## Install

Extract the complete archive. Open PowerShell in the extracted folder and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-windows-watchdog.ps1
```

The installer asks for administrator rights itself and adds the account you ran
it from to the protected accounts, keeping any already protected. Running it again
updates the watchdog in place and restores the previous copy if the new one fails
to start. `-ProtectedWindowsUser 'user1,user2'` replaces the protected set outright.

### Several Windows accounts

Load the extension in each account and run the installer once from each (or once
with `-ProtectedWindowsUser` naming all of them). The watchdog then keeps each
account apart:

- only the account in front counts time. A browser left running behind a fast
  user switch keeps reporting its last tab, and that is ignored;
- when two accounts are on the same zone at once, the time is counted once: the
  allowance belongs to the person, not the account;
- the emergency firewall rules exist per browser *and* per account, so a missing
  sensor cuts off only that account's browser. Browsers installed into an
  account's own AppData are discovered when they first run;
- zones and usage are shared: an edit made in one account reaches the other on
  its next heartbeat.

`watchdog-status.ps1` lists every protected account with its last heartbeat.

If something looks wrong, `.\watchdog-status.ps1` shows whether the watchdog
answers and, from an elevated window, its task state and recent log.

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

Update the watchdog by running the installer again (`pnpm watchdog:update` from
the repository) and accept the UAC prompt, then reload the extension. It backs
up the installed script, restarts the task, and verifies its health. Older watchdogs cannot
accept URL rules; the dashboard and bridge reject those writes until the
watchdog advertises support.

Only pages matching configured URL rules send their path, query, and fragment over
loopback. The active URL is held in memory, not written to the state file.
