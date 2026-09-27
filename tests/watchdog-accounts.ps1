$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\watchdog\LockInWatchdog.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
foreach ($name in @('Normalize-Domain', 'Test-SiteMatches', 'Get-TodayKey', 'Test-WithinSchedule', 'Test-GroupMatchesHost',
    'Get-UsageEntry', 'Get-RemainingMs', 'Get-TickingGroups', 'Get-WatchingSensors', 'Get-TickingGroupIds', 'Add-ElapsedUsage')) {
  $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  Invoke-Expression $fn.Extent.Text
}

$script:UsageStaleMs = 10000L
$script:State = [pscustomobject]@{
  groups = @([pscustomobject]@{ id = 'video'; enabled = $true; domains = @('youtube.com'); exceptions = @(); schedule = $null; limit = [pscustomobject]@{ minutes = 30 } })
  usage = [pscustomobject]@{}
  lastSampleMs = 0L
}
$script:Dirty = $false
$now = [long]([DateTime]::UtcNow - [DateTime]'1970-01-01').TotalMilliseconds

function Set-Sensor([string]$Key, [string]$HostName, [bool]$Active, [long]$HeartbeatMs = $now) {
  $script:Sensors[$Key] = [pscustomobject]@{ key = $Key; host = $HostName; url = ''; focused = $true; active = $Active; heartbeatMs = $HeartbeatMs }
}
function Get-UsedMs { $entry = Get-UsageEntry 'video' $now; if ($entry) { [long]$entry.ms } else { 0L } }
function Invoke-Second {
  $script:State.lastSampleMs = $now - 1000
  Add-ElapsedUsage $now
}

# The account left behind a fast user switch keeps reporting its last tab.
$script:Sensors = @{}
Set-Sensor 'alice' 'youtube.com' $true
Set-Sensor 'bob' 'youtube.com' $false
Invoke-Second
if ((Get-UsedMs) -ne 1000) { throw "Expected one second from the account in front, got $(Get-UsedMs) ms" }

# Two accounts in front on the same zone spend one person's time, once.
Set-Sensor 'bob' 'youtube.com' $true
Invoke-Second
if ((Get-UsedMs) -ne 2000) { throw "Two accounts double-counted the allowance: $(Get-UsedMs) ms" }

# Only the switched-away account is on the site: nothing is spent.
Set-Sensor 'alice' 'example.org' $true
Set-Sensor 'bob' 'youtube.com' $false
Invoke-Second
if ((Get-UsedMs) -ne 2000) { throw "A background account spent the allowance: $(Get-UsedMs) ms" }

# A sensor that went quiet stops counting.
Set-Sensor 'alice' 'youtube.com' $true ($now - 60000)
Invoke-Second
if ((Get-UsedMs) -ne 2000) { throw "A stale sensor spent the allowance: $(Get-UsedMs) ms" }

# A long gap (sleep) is capped instead of charged in full.
Set-Sensor 'alice' 'youtube.com' $true
$script:State.lastSampleMs = $now - 3600000
Add-ElapsedUsage $now
if ((Get-UsedMs) -ne 12000) { throw "A pause was charged as browsing: $(Get-UsedMs) ms" }

Write-Output 'Watchdog multi-account usage tests passed.'

# Firewall: one rule per (browser, account), enabled only for the account whose
# sensor is missing. The cmdlets are replaced by an in-memory rule table.
foreach ($name in @('Get-FirewallRuleName', 'Set-FirewallBlocked')) {
  $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  Invoke-Expression $fn.Extent.Text
}
$TestMode = $false
$firewallGroup = 'LockInWatchdog'
$script:FirewallReconcileIntervalMs = 60000L
$script:NextFirewallReconcileMs = 0L
$script:FirewallKey = $null
$script:FirewallRulesStale = $true
$script:ProtectedAccounts = [ordered]@{ 'S-1-5-21-1-1001' = 'PC\alice'; 'S-1-5-21-1-1002' = 'PC\bob' }
$script:State | Add-Member -NotePropertyName browserPaths -NotePropertyValue @('C:\Program Files\Google\Chrome\Application\chrome.exe', 'C:\Users\bob\AppData\Local\Google\Chrome\Application\chrome.exe')
$script:Rules = @{ 'LockIn-Watchdog-chrome-1' = [pscustomobject]@{ Name = 'LockIn-Watchdog-chrome-1'; Enabled = 'False'; LocalUser = $null } }
function Write-WatchdogLog($Message) { }
function Get-NetFirewallRule { @($script:Rules.Values) }
function Remove-NetFirewallRule([string]$Name) { $script:Rules.Remove($Name) }
function Set-NetFirewallRule([string]$Name, [string]$Enabled) { $script:Rules[$Name].Enabled = $Enabled }
function New-NetFirewallRule {
  param($Name, $DisplayName, $Group, $Direction, $Action, $Program, $Profile, $Enabled, $LocalUser)
  $script:Rules[$Name] = [pscustomobject]@{ Name = $Name; Enabled = $Enabled; LocalUser = $LocalUser; Program = $Program }
}
function Get-EnabledUsers { @($script:Rules.Values | Where-Object { $_.Enabled -eq 'True' } | ForEach-Object { $_.LocalUser }) }

Set-FirewallBlocked @() 1000
if ($script:Rules.ContainsKey('LockIn-Watchdog-chrome-1')) { throw 'An old all-accounts rule survived the reconcile' }
if ($script:Rules.Count -ne 4) { throw "Expected 4 rules (2 browsers x 2 accounts), got $($script:Rules.Count)" }
if (@(Get-EnabledUsers).Count -ne 0) { throw 'Rules enabled with every sensor present' }
if (@($script:Rules.Values | Where-Object { $_.LocalUser -notmatch '^D:\(A;;CC;;;S-1-5-21-1-100[12]\)$' }).Count) { throw 'A rule is not scoped to one account' }

Set-FirewallBlocked @('S-1-5-21-1-1002') 2000
$enabled = @(Get-EnabledUsers)
if ($enabled.Count -ne 2 -or @($enabled | Where-Object { $_ -notlike '*1002)' }).Count) { throw "Only bob's browsers should be cut off: $enabled" }

Set-FirewallBlocked @('*') 3000
if (@(Get-EnabledUsers).Count -ne 4) { throw 'An unverified owner must cut off every account' }

Set-FirewallBlocked @() 4000
if (@(Get-EnabledUsers).Count -ne 0) { throw 'Rules stayed enabled after the sensors came back' }
Write-Output 'Watchdog per-account firewall tests passed.'
