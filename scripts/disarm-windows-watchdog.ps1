[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this recovery script from an elevated PowerShell window.'
}

try {
  $body = @{ type = 'disarm'; requestId = [guid]::NewGuid().ToString(); payload = @{} } | ConvertTo-Json
  Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/request' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 3 | Out-Null
} catch {
  Write-Warning 'The watchdog did not answer; disabling its firewall rules directly.'
}

Get-NetFirewallRule -Group 'LockInWatchdog' -ErrorAction SilentlyContinue | Set-NetFirewallRule -Enabled False
Write-Host 'Lock In is disarmed and its emergency browser firewall rules are disabled.'
