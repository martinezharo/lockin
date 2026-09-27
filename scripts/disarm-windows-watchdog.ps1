# Emergency recovery: stop enforcing now, leave everything installed.
[CmdletBinding()]
param([switch]$Elevated)

$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  if ($Elevated) { throw 'Could not obtain administrator privileges.' }
  $powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $process = Start-Process -FilePath $powerShellExe -Verb RunAs -Wait -PassThru `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated')
  if ($process.ExitCode -ne 0) { throw "Disarming failed (exit code $($process.ExitCode))." }
  Write-Host 'Lock In is disarmed and its emergency browser firewall rules are disabled.'
  return
}

try {
  $body = @{ type = 'disarm'; requestId = [guid]::NewGuid().ToString(); payload = @{} } | ConvertTo-Json
  Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/request' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 5 | Out-Null
} catch {
  Write-Warning 'The watchdog did not answer; disabling its firewall rules directly.'
}

Get-NetFirewallRule -Group 'LockInWatchdog' -ErrorAction SilentlyContinue | Set-NetFirewallRule -Enabled False
Write-Host 'Lock In is disarmed and its emergency browser firewall rules are disabled.'
