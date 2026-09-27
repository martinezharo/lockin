# Read-only health report. Works from any PowerShell window; run it elevated to
# also see the scheduled task and the watchdog's own log.
[CmdletBinding()]
param([int]$LogLines = 25)

$ErrorActionPreference = 'Continue'
$timer = [Diagnostics.Stopwatch]::StartNew()
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/health' -TimeoutSec 10
  $timer.Stop()
  $data = $health.data
  Write-Host "Watchdog answering in $($timer.ElapsedMilliseconds) ms."
  [pscustomobject]@{
    Armed              = $data.enforcementArmed
    Reason             = $data.enforcementReason
    FailClosed         = $data.failClosedActive
    FirewallBlocked    = $data.firewallBlocked
    ProtectedAccounts  = $data.protectedWindowsAccount
    LastHeartbeatAgo   = if ($data.lastHeartbeatMs) { '{0:N0} s' -f (([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $data.lastHeartbeatMs) / 1000) } else { 'never' }
    Zones              = @($data.groups).Count
  } | Format-List
  $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  @($data.sensors) | ForEach-Object {
    [pscustomobject]@{
      Account        = $_.account
      LastHeartbeat  = if ($_.lastHeartbeatMs) { '{0:N0} s ago' -f (($nowMs - $_.lastHeartbeatMs) / 1000) } else { 'never' }
      InFront        = $_.activeSession
      BrowserRunning = $_.browserRunning
    }
  } | Format-Table -AutoSize
} catch {
  Write-Warning "The watchdog is not answering on 127.0.0.1:8765: $($_.Exception.Message)"
}

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Run this from an elevated PowerShell window to also see the task state and the log.'
  return
}
$info = Get-ScheduledTaskInfo -TaskName 'Lock In Watchdog' -ErrorAction SilentlyContinue
if ($info) {
  $task = Get-ScheduledTask -TaskName 'Lock In Watchdog'
  Write-Host "Task: $($task.State); last run $($info.LastRunTime); last result $($info.LastTaskResult)"
} else {
  Write-Warning 'The Lock In Watchdog task is not installed.'
}
$log = Join-Path $env:ProgramData 'LockIn\watchdog.log'
if (Test-Path -LiteralPath $log) {
  Write-Host "`nLast $LogLines log lines ($log):"
  Get-Content -LiteralPath $log -Tail $LogLines
}
