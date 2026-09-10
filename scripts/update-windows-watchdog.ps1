[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this updater from an elevated PowerShell window.'
}

$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'watchdog\LockInWatchdog.ps1'
$target = Join-Path $env:ProgramFiles 'Lock In\LockInWatchdog.ps1'
$backup = "$target.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
$task = Get-ScheduledTask -TaskName 'Lock In Watchdog' -ErrorAction Stop
$tokens = $null
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw $parseErrors[0] }
Copy-Item -LiteralPath $target -Destination $backup
Stop-ScheduledTask -InputObject $task
Start-Sleep -Seconds 2
try {
  Copy-Item -LiteralPath $source -Destination $target -Force
  Start-ScheduledTask -InputObject $task
  Start-Sleep -Seconds 4
  $health = Invoke-RestMethod http://127.0.0.1:8765/health -TimeoutSec 10
  if (-not $health.ok) { throw 'Watchdog health check failed.' }
  Write-Output "Watchdog updated. Backup: $backup"
  $health.data | Select-Object enforcementArmed, failClosedActive, firewallBlocked, enforcementReason
} catch {
  Stop-ScheduledTask -InputObject $task
  Start-Sleep -Seconds 2
  Copy-Item -LiteralPath $backup -Destination $target -Force
  Start-ScheduledTask -InputObject $task
  throw
}
