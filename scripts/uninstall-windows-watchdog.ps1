[CmdletBinding()]
param(
  [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this uninstaller from an elevated PowerShell window.'
}

& (Join-Path $PSScriptRoot 'disarm-windows-watchdog.ps1')
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
