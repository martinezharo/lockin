# Proves on a real machine that a per-account outbound block rule really is
# scoped to one account.
#
# This was written because the PowerShell watchdog's -LocalUser scoping was only
# ever exercised with mocked cmdlets. The C# service writes the same
# LocalUserAuthorizedList condition through the Windows Firewall COM API, and
# falls back to blocking every protected account if a scoped rule cannot be
# created.
#
# Usage, from an elevated PowerShell window:
#
#   .\scripts\verify-firewall-scoping.ps1 -AccountA 'PC\alice' -AccountB 'PC\bob'
#
# It creates a temporary outbound block rule for AccountA and a harmless
# program (curl.exe by default), then asks you to run the traffic test from
# each account:
#
#   curl.exe --max-time 5 https://example.com
#
# Expected: AccountA fails, AccountB succeeds. The script prints the rule's
# stored user condition and removes the rule afterwards.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AccountA,
  [Parameter(Mandatory = $true)][string]$AccountB,
  [string]$Program = "$env:SystemRoot\System32\curl.exe",
  [switch]$KeepRule
)

$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from an elevated PowerShell window.'
}
if (-not (Test-Path -LiteralPath $Program)) {
  throw "Test program not found: $Program. Pass -Program with an executable both accounts can run."
}

function Resolve-Sid([string]$Name) {
  $account = if ($Name -match '\\') { [Security.Principal.NTAccount]::new($Name) } else { [Security.Principal.NTAccount]::new($env:COMPUTERNAME, $Name) }
  return $account.Translate([Security.Principal.SecurityIdentifier]).Value
}

$sidA = Resolve-Sid $AccountA
$sidB = Resolve-Sid $AccountB
if ($sidA -eq $sidB) { throw 'AccountA and AccountB must be different accounts.' }

$ruleName = "LockIn-FirewallScopingCheck-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
Write-Host "Creating outbound block rule '$ruleName' for $AccountA ($sidA), program $Program ..."
New-NetFirewallRule -Name $ruleName -DisplayName 'Lock In firewall scoping check' -Group 'LockInWatchdog' `
  -Direction Outbound -Action Block -Program $Program -Profile Any -Enabled True `
  -LocalUser "D:(A;;CC;;;$sidA)" | Out-Null

try {
  $rule = Get-NetFirewallRule -Name $ruleName
  $userCondition = (Get-NetFirewallSecurityFilter -AssociatedNetFirewallRule $rule).LocalUser
  Write-Host "Stored LocalUser condition: $userCondition"
  if ($userCondition -notmatch [regex]::Escape($sidA)) {
    throw 'The rule did not store the per-account condition; the firewall stack rejected scoping.'
  }

  Write-Host ''
  Write-Host 'Now run this from each account (not elevated):' -ForegroundColor Cyan
  Write-Host "  $Program --max-time 5 https://example.com" -ForegroundColor Cyan
  Write-Host ''
  Write-Host "Expected: $AccountA fails (exit code non-zero, curl reports a timeout/refusal) and $AccountB succeeds (HTTP 200)." -ForegroundColor Cyan
  Write-Host 'If both succeed, per-account outbound scoping does not work on this machine; the service then falls back to blocking every protected account and logs it.' -ForegroundColor Yellow
  Read-Host 'Press Enter after you have run the test from both accounts'
}
finally {
  if (-not $KeepRule) {
    Remove-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    Write-Host "Removed $ruleName."
  } else {
    Write-Host "-KeepRule was set; $ruleName was left in place. Remove it with: Remove-NetFirewallRule -Name '$ruleName'"
  }
}
