[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProtectedWindowsUser
)

$ErrorActionPreference = 'Stop'
$installLog = Join-Path $env:TEMP 'LockIn-watchdog-install.log'
Start-Transcript -Path $installLog -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this installer from an elevated PowerShell window (Run as administrator).'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'watchdog\LockInWatchdog.ps1'
if (-not (Test-Path -LiteralPath $source)) {
  $source = Join-Path $PSScriptRoot 'LockInWatchdog.ps1'
}
if (-not (Test-Path -LiteralPath $source)) { throw 'LockInWatchdog.ps1 was not found.' }

$installRoot = Join-Path $env:ProgramFiles 'Lock In'
$dataRoot = Join-Path $env:ProgramData 'LockIn'
$installedScript = Join-Path $installRoot 'LockInWatchdog.ps1'
$taskName = 'Lock In Watchdog'
$firewallGroup = 'LockInWatchdog'

$protectedAccounts = @()
foreach ($userName in @($ProtectedWindowsUser -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)) {
  try {
    $account = if ($userName -match '\\') {
      [Security.Principal.NTAccount]::new(($userName -replace '^\.\\', ($env:COMPUTERNAME + '\')))
    } else {
      [Security.Principal.NTAccount]::new($env:COMPUTERNAME, $userName)
    }
    $sidValue = $account.Translate([Security.Principal.SecurityIdentifier]).Value
    $accountName = ([Security.Principal.SecurityIdentifier]::new($sidValue)).Translate([Security.Principal.NTAccount]).Value
    $protectedAccounts += [pscustomobject]@{ Name = $accountName; Sid = $sidValue }
  } catch {
    throw "Windows account '$userName' was not found on this machine."
  }
}
if ($protectedAccounts.Count -eq 0) { throw 'At least one protected Windows account is required.' }
$protectedUserSids = @($protectedAccounts.Sid) -join ','

$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
}

New-Item -ItemType Directory -Force -Path $installRoot, $dataRoot | Out-Null
Copy-Item -LiteralPath $source -Destination $installedScript -Force

# A reinstall or protected-account change must earn three fresh heartbeats from
# the selected accounts before fail-closed enforcement can activate again.
$statePath = Join-Path $dataRoot 'state.json'
if (Test-Path -LiteralPath $statePath) {
  try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $state.enforcementArmed = $false
    $state.lastHeartbeatMs = 0
    $state.lastSampleMs = 0
    $state.lastHost = ''
    $state.lastFocused = $false
    $state | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $statePath -Encoding utf8
  } catch {
    throw "Could not reset the watchdog state for safe re-arming: $($_.Exception.Message)"
  }
}

& icacls.exe $installRoot '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the Lock In installation directory.' }
& icacls.exe $dataRoot '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the Lock In data directory.' }

Get-NetFirewallRule -Group $firewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$browserPaths = @(
  (Join-Path $env:ProgramFiles 'BraveSoftware\Brave-Browser\Application\brave.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'BraveSoftware\Brave-Browser\Application\brave.exe'),
  (Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\Application\brave.exe'),
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Sort-Object -Unique

$ruleIndex = 0
foreach ($browserPath in $browserPaths) {
  $ruleIndex++
  $leaf = [IO.Path]::GetFileNameWithoutExtension($browserPath)
  New-NetFirewallRule `
    -Name "LockIn-Watchdog-$leaf-$ruleIndex" `
    -DisplayName "Lock In emergency block ($leaf)" `
    -Group $firewallGroup `
    -Direction Outbound `
    -Action Block `
    -Program $browserPath `
    -Profile Any `
    -Enabled False | Out-Null
}
if ($browserPaths.Count -eq 0) { throw 'Neither Brave nor Chrome was found; no emergency firewall rule could be created.' }

$powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installedScript`" -ProtectedUserSids $protectedUserSids"
$action = New-ScheduledTaskAction -Execute $powerShellExe -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$principalTask = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principalTask `
  -Settings $settings `
  -Description 'Lock In usage accounting and fail-closed browser watchdog.' `
  -Force | Out-Null

# Remove registrations from the abandoned Native Messaging prototype.
Remove-Item -LiteralPath 'HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.lockin.service' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'HKLM:\SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.lockin.service' -Recurse -Force -ErrorAction SilentlyContinue

Start-ScheduledTask -TaskName $taskName
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/health' -TimeoutSec 1
    if ($health.ok -eq $true) { $ready = $true; break }
  } catch { }
}
if (-not $ready) {
  $info = Get-ScheduledTaskInfo -TaskName $taskName
  throw "The watchdog task did not become ready. LastTaskResult=$($info.LastTaskResult)"
}

Write-Host 'Lock In PowerShell watchdog installed and running as SYSTEM.'
foreach ($protectedAccount in $protectedAccounts) {
  Write-Host "Protected Windows account: $($protectedAccount.Name) ($($protectedAccount.Sid))"
}
Write-Host "Protected script: $installedScript"
Write-Host "Emergency firewall rules created: $($browserPaths.Count)"
Write-Host 'Enforcement remains disarmed until the extension sends three heartbeats.'
Stop-Transcript | Out-Null
