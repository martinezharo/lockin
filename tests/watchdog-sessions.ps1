$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\watchdog\LockInWatchdog.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
foreach ($name in @('Get-RunningProtectedUserSids', 'Test-InteractiveBrowserSession')) {
  $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  Invoke-Expression $fn.Extent.Text
}
# Exercise the actual native binding before replacing it with deterministic states.
if (-not (Test-InteractiveBrowserSession ([Diagnostics.Process]::GetCurrentProcess().SessionId))) { throw 'Current session unexpectedly disconnected' }
function Test-InteractiveBrowserSession([int]$SessionId) { return $SessionId -ne $script:DisconnectedSession }
function Get-CimInstance { return @([pscustomobject]@{ SessionId = 1; ProcessId = 10 }, [pscustomobject]@{ SessionId = 2; ProcessId = 20 }) }
function Get-CimProcessOwnerSid($Process) { return "sid-$($Process.SessionId)" }
function Write-WatchdogLog($Message) { throw $Message }
$AssumeBrowserRunning = $false
$script:ProtectedAccounts = @{ 'sid-1' = 'First'; 'sid-2' = 'Second' }
$script:NextBrowserProbeMs = 0L
$script:BrowserProbeIntervalMs = 1000L
$script:DisconnectedSession = 2
$actual = @(Get-RunningProtectedUserSids 1000)
if ($actual.Count -ne 1 -or $actual[0] -ne 'sid-1') { throw 'Disconnected account still requires a sensor' }
$script:DisconnectedSession = 1
$actual = @(Get-RunningProtectedUserSids 2000)
if ($actual.Count -ne 1 -or $actual[0] -ne 'sid-2') { throw 'User switching did not move sensor requirement' }
$script:DisconnectedSession = -1
$actual = @(Get-RunningProtectedUserSids 3000)
if ($actual.Count -ne 2) { throw 'Concurrent connected sessions must both remain protected' }
Write-Output 'Watchdog session-switch regression tests passed.'
