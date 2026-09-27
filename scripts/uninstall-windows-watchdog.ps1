# Removes the watchdog task, its firewall rules and the installed copy.
# -PurgeData also erases the zones and usage kept in ProgramData.
[CmdletBinding()]
param(
  [switch]$PurgeData,
  [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  if ($Elevated) { throw 'Could not obtain administrator privileges.' }
  $powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated')
  if ($PurgeData) { $arguments += '-PurgeData' }
  $process = Start-Process -FilePath $powerShellExe -Verb RunAs -Wait -PassThru -ArgumentList $arguments
  if ($process.ExitCode -ne 0) { throw "Uninstalling failed (exit code $($process.ExitCode))." }
  Write-Host 'Lock In watchdog task and firewall rules were removed.'
  return
}

# Policy values written by the watchdog are removed by disarming it first.
& (Join-Path $PSScriptRoot 'disarm-windows-watchdog.ps1')
Start-Sleep -Seconds 1
$taskName = 'Lock In Watchdog'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Get-NetFirewallRule -Group 'LockInWatchdog' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

$installRoot = Join-Path $env:ProgramFiles 'Lock In'
if (Test-Path -LiteralPath $installRoot) {
  $resolved = (Resolve-Path -LiteralPath $installRoot).Path
  $expected = [IO.Path]::GetFullPath((Join-Path $env:ProgramFiles 'Lock In'))
  if ($resolved -ne $expected) { throw "Refusing to remove unexpected path: $resolved" }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

if ($PurgeData) {
  $dataRoot = Join-Path $env:ProgramData 'LockIn'
  if (Test-Path -LiteralPath $dataRoot) {
    $resolved = (Resolve-Path -LiteralPath $dataRoot).Path
    $expected = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'LockIn'))
    if ($resolved -ne $expected) { throw "Refusing to remove unexpected path: $resolved" }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}

Write-Host 'Lock In watchdog task and firewall rules were removed.'
if (-not $PurgeData) { Write-Host 'Configuration remains in ProgramData. Use -PurgeData to remove it.' }
