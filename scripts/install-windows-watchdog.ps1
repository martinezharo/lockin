# Installs or updates the Lock In watchdog. Run it from any PowerShell window:
# it asks for elevation itself and adds the account that launched it to the
# protected accounts of any existing install, so running it once from each
# Windows account you use protects all of them. A failed update puts the
# previous copy back.
[CmdletBinding()]
param(
  # Comma-separated Windows accounts to protect, replacing the current set.
  # Leave empty to keep the current set and add the account running this.
  [string]$ProtectedWindowsUser = '',
  # Internal: the account that launched the unelevated half.
  [string]$LaunchingUser = '',
  [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
$taskName = 'Lock In Watchdog'
$healthUrl = 'http://127.0.0.1:8765/health'

function Test-Administrator {
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Wait-WatchdogHealthy([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
      if ($health.ok -eq $true) { return $health }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

if (-not (Test-Administrator)) {
  if ($Elevated) { throw 'The installer could not obtain administrator privileges.' }
  # Record who is browsing before elevating: UAC may run the elevated half as a
  # different administrator account.
  $powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
    '-LaunchingUser', "`"$([Security.Principal.WindowsIdentity]::GetCurrent().Name)`"", '-Elevated')
  if (-not [string]::IsNullOrWhiteSpace($ProtectedWindowsUser)) {
    $arguments += @('-ProtectedWindowsUser', "`"$ProtectedWindowsUser`"")
  }
  Write-Host 'Asking Windows for administrator rights (one UAC prompt)...'
  try {
    $process = Start-Process -FilePath $powerShellExe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  } catch {
    throw 'The installation was cancelled at the UAC prompt.'
  }
  if ($process.ExitCode -ne 0) {
    throw "The installer failed (exit code $($process.ExitCode)). Details: $(Join-Path $env:ProgramData 'LockIn\install.log')"
  }
  $health = Wait-WatchdogHealthy 10
  if ($null -eq $health) { throw 'The watchdog installed but does not answer on 127.0.0.1:8765.' }
  Write-Host 'Lock In watchdog is installed and answering.'
  Write-Host "Protected account(s): $($health.data.protectedWindowsAccount)"
  Write-Host 'Reload the extension; the dashboard shows "Windows enforcement armed" a few seconds later.'
  return
}

$dataRoot = Join-Path $env:ProgramData 'LockIn'
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
Start-Transcript -Path (Join-Path $dataRoot 'install.log') -Force | Out-Null
try {
  $projectRoot = Split-Path -Parent $PSScriptRoot
  $source = Join-Path $projectRoot 'watchdog\LockInWatchdog.ps1'
  if (-not (Test-Path -LiteralPath $source)) { $source = Join-Path $PSScriptRoot 'LockInWatchdog.ps1' }
  if (-not (Test-Path -LiteralPath $source)) { throw 'LockInWatchdog.ps1 was not found next to the installer.' }
  $tokens = $null
  $parseErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw "LockInWatchdog.ps1 does not parse: $($parseErrors[0])" }

  $installRoot = Join-Path $env:ProgramFiles 'Lock In'
  $installedScript = Join-Path $installRoot 'LockInWatchdog.ps1'
  $firewallGroup = 'LockInWatchdog'
  $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

  # Protected accounts: an explicit -ProtectedWindowsUser list replaces the
  # current set. Without one, the account running the installer is added to
  # whatever an existing install already protects, so running it once from
  # each Windows account you use covers all of them.
  $sids = New-Object 'System.Collections.Generic.List[string]'
  if ([string]::IsNullOrWhiteSpace($ProtectedWindowsUser)) {
    if ($existingTask) {
      $previous = [regex]::Match([string]$existingTask.Actions[0].Arguments, '-ProtectedUserSids\s+(\S+)')
      if ($previous.Success) { foreach ($sid in $previous.Groups[1].Value -split ',') { if ($sid -and -not $sids.Contains($sid)) { $sids.Add($sid) } } }
    }
    $ProtectedWindowsUser = if ($LaunchingUser) { $LaunchingUser } else { [Security.Principal.WindowsIdentity]::GetCurrent().Name }
  }
  foreach ($userName in @($ProtectedWindowsUser -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    try {
      $account = if ($userName -match '\\') {
        [Security.Principal.NTAccount]::new(($userName -replace '^\.\\', ($env:COMPUTERNAME + '\')))
      } else {
        [Security.Principal.NTAccount]::new($env:COMPUTERNAME, $userName)
      }
      $sid = $account.Translate([Security.Principal.SecurityIdentifier]).Value
    } catch {
      throw "Windows account '$userName' was not found on this machine."
    }
    if (-not $sids.Contains($sid)) { $sids.Add($sid) }
  }
  if ($sids.Count -eq 0) { throw 'At least one protected Windows account is required.' }
  $protectedUserSids = $sids -join ','

  $backup = $null
  if ($existingTask) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    # The task may take a moment to let go of the port and the state file.
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
      Where-Object { $_.CommandLine -like "*$installedScript*" } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
    if (Test-Path -LiteralPath $installedScript) {
      $backup = "$installedScript.previous"
      Copy-Item -LiteralPath $installedScript -Destination $backup -Force
    }
  }

  New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
  Copy-Item -LiteralPath $source -Destination $installedScript -Force

  # A reinstall or protected-account change must earn three fresh heartbeats
  # before fail-closed enforcement can activate again.
  $statePath = Join-Path $dataRoot 'state.json'
  if (Test-Path -LiteralPath $statePath) {
    try {
      $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
      foreach ($reset in @{ enforcementArmed = $false; lastHeartbeatMs = 0; lastSampleMs = 0 }.GetEnumerator()) {
        $state | Add-Member -NotePropertyName $reset.Key -NotePropertyValue $reset.Value -Force
      }
      $state | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $statePath -Encoding utf8
    } catch {
      Write-Warning "Could not reset the stored state; the watchdog will start from a fresh one. $($_.Exception.Message)"
      Move-Item -LiteralPath $statePath -Destination "$statePath.unreadable" -Force
    }
  }

  & icacls.exe $installRoot '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not protect the Lock In installation directory.' }
  & icacls.exe $dataRoot '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not protect the Lock In data directory.' }

  # The watchdog owns the emergency firewall rules: one per browser executable
  # and protected account, created as it discovers browsers (including per-user
  # installs in another account's AppData). Rules from older installs, which
  # blocked every account at once, are cleared here and rebuilt by it.
  Get-NetFirewallRule -Group $firewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule

  $powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installedScript`" -ProtectedUserSids $protectedUserSids"
  $action = New-ScheduledTaskAction -Execute $powerShellExe -Argument $arguments
  # Start at boot, and check every minute afterwards. MultipleInstances
  # IgnoreNew turns that check into a no-op while the watchdog is running and a
  # restart within a minute if anything ever killed it.
  $triggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
  )
  $principalTask = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  # Priority 4 is normal. The default (7) is below normal and lets a busy
  # machine starve the watchdog until the browser's sensor times out.
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -Priority 4 `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principalTask -Settings $settings `
    -Description 'Lock In usage accounting and fail-closed browser watchdog.' -Force | Out-Null

  Start-ScheduledTask -TaskName $taskName
  $health = Wait-WatchdogHealthy 30
  if ($null -eq $health) {
    if ($backup) {
      Write-Warning 'The new watchdog did not start; restoring the previous one.'
      Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      Copy-Item -LiteralPath $backup -Destination $installedScript -Force
      Start-ScheduledTask -TaskName $taskName
    }
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    throw "The watchdog did not become healthy. LastTaskResult=$($info.LastTaskResult). See $(Join-Path $dataRoot 'watchdog.log')."
  }

  Write-Host 'Lock In watchdog installed and running as SYSTEM.'
  Write-Host "Protected account(s): $($health.data.protectedWindowsAccount)"
  Write-Host 'Enforcement arms itself after three heartbeats from the extension.'
} finally {
  Stop-Transcript | Out-Null
}
