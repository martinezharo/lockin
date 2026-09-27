$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\watchdog\LockInWatchdog.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
foreach ($name in @('Initialize-Native', 'Get-RunningProtectedUserSids', 'Test-InteractiveBrowserSession', 'Get-ProcessOwnerSid', 'Get-BrowserProcesses', 'Test-ProcessAlive')) {
  $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  Invoke-Expression $fn.Extent.Text
}

# Exercise the actual native bindings before replacing them with deterministic states.
$current = [Diagnostics.Process]::GetCurrentProcess()
# The current session may itself be disconnected (fast user switching), so only
# the binding is checked here; the states are covered deterministically below.
if ((Test-InteractiveBrowserSession $current.SessionId) -isnot [bool]) { throw 'Session state lookup did not return a boolean' }
$mySid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ((Get-ProcessOwnerSid $current.Id) -ne $mySid) { throw 'Native owner lookup did not return the current user' }
if ((Get-ProcessOwnerSid 0) -ne '') { throw 'Owner lookup of an impossible process must be empty' }
if (-not (Test-ProcessAlive $current.Id)) { throw 'Current process reported as exited' }
[void]@(Get-BrowserProcesses)

# The loopback identity lookup must find the client of a real connection.
$server = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$server.Start()
try {
  $serverPort = $server.LocalEndpoint.Port
  $client = [Net.Sockets.TcpClient]::new()
  $client.Connect([Net.IPAddress]::Loopback, $serverPort)
  $accepted = $server.AcceptTcpClient()
  $clientPort = $client.Client.LocalEndPoint.Port
  if ([LockIn.Native]::LoopbackClientProcessId($clientPort, $serverPort) -ne $current.Id) { throw 'Loopback client lookup missed the current process' }
  if ([LockIn.Native]::LoopbackClientProcessId($clientPort, $serverPort + 1) -ne 0) { throw 'Loopback client lookup matched the wrong server port' }
  $accepted.Dispose(); $client.Dispose()
} finally { $server.Stop() }

function Test-InteractiveBrowserSession([int]$SessionId) { return $SessionId -ne $script:DisconnectedSession }
function Get-BrowserProcesses { return @([pscustomobject]@{ SessionId = 1; Id = 10 }, [pscustomobject]@{ SessionId = 2; Id = 20 }) }
function Get-ProcessOwnerSid([int]$ProcessId) { return "sid-$($ProcessId / 10)" }
function Get-ProcessImagePath([int]$ProcessId) { return '' }
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

# A live browser whose owner cannot be read is treated as unverified, not ignored.
function Get-ProcessOwnerSid([int]$ProcessId) { return '' }
function Test-ProcessAlive([int]$ProcessId) { return $true }
function Write-WatchdogLog($Message) { }
$actual = @(Get-RunningProtectedUserSids 4000)
if ($actual -notcontains '__unknown__') { throw 'Unverifiable browser owner did not fail closed' }
Write-Output 'Watchdog session-switch regression tests passed.'
