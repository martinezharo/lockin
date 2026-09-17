[CmdletBinding()]
param([switch]$Elevated)

$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  if ($Elevated) { throw 'The watchdog updater could not obtain administrator privileges.' }
  $powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated')
  try {
    $process = Start-Process -FilePath $powerShellExe -Verb RunAs -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
  } catch {
    throw 'The watchdog update was cancelled or could not be elevated.'
  }
  if ($process.ExitCode -ne 0) { throw "The elevated watchdog updater failed with exit code $($process.ExitCode)." }
  $health = Invoke-RestMethod http://127.0.0.1:8765/health -TimeoutSec 10
  if (-not $health.ok) { throw 'The updated watchdog did not pass its health check.' }
  Write-Output 'Watchdog updated and verified.'
  $health.data | Select-Object supportsUrlRules, supportsExceptions, enforcementArmed, failClosedActive, firewallBlocked, enforcementReason
  return
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
