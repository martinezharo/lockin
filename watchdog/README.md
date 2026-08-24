# Lock In Windows watchdog 1.4.0

This bundle contains the local PowerShell enforcement component for Lock In.
It contains no custom executable and requires no certificate or online account.

## Install

Extract the complete archive. Open PowerShell as administrator in the extracted folder and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-windows-watchdog.ps1
```

Reload Lock In 1.4.0 in Brave or Chrome. The dashboard must show **Windows enforcement armed** after three heartbeats.

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
