[CmdletBinding()]
param(
  [string]$DataDirectory = "$env:ProgramData\LockIn",
  [int]$Port = 8765,
  [int]$HeartbeatTimeoutSeconds = 30,
  [string]$ProtectedUserSids = '',
  [string]$ProtectedUserSid = '',
  [switch]$TestMode,
  [switch]$AssumeBrowserRunning
)

$ErrorActionPreference = 'Stop'
$statePath = Join-Path $DataDirectory 'state.json'
$logPath = Join-Path $DataDirectory 'watchdog.log'
$policyPaths = [ordered]@{
  chrome = 'HKLM:\SOFTWARE\Policies\Google\Chrome\URLBlocklist'
  brave = 'HKLM:\SOFTWARE\Policies\BraveSoftware\Brave\URLBlocklist'
}
$firewallGroup = 'LockInWatchdog'
$script:ConsecutiveHeartbeatsBySid = @{}
$script:BrowserSeenAtMsBySid = @{}
$script:SensorHeartbeatMsBySid = @{}
$script:BlockedDomains = @()
$script:EnforcementReason = 'not armed'
$script:FailClosedActive = $false
$script:FirewallBlocked = $null
$script:LastPolicyFingerprint = $null
$script:Dirty = $false
$script:ProtectedAccounts = [ordered]@{}
$script:CurrentRequestUserSid = ''

if ([string]::IsNullOrWhiteSpace($ProtectedUserSids)) { $ProtectedUserSids = $ProtectedUserSid }
foreach ($protectedSidValue in @($ProtectedUserSids -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)) {
  try {
    $sid = [Security.Principal.SecurityIdentifier]::new($protectedSidValue)
    $script:ProtectedAccounts[$protectedSidValue] = $sid.Translate([Security.Principal.NTAccount]).Value
  } catch {
    throw "ProtectedUserSids contains an invalid local Windows account SID: $protectedSidValue"
  }
}

function Get-NowMs {
  return [long]([DateTime]::UtcNow - [DateTime]'1970-01-01').TotalMilliseconds
}

function Write-WatchdogLog([string]$Message) {
  try {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message" -Encoding utf8
  } catch { }
}

function New-DefaultState {
  return [pscustomobject][ordered]@{
    schemaVersion = 2
    configured = $false
    enforcementArmed = $false
    failClosed = $true
    heartbeatTimeoutSeconds = $HeartbeatTimeoutSeconds
    groups = @()
    usage = [pscustomobject]@{}
    lockMode = $false
    privacyConsent = $false
    lastHeartbeatMs = 0L
    lastSampleMs = 0L
    lastHost = ''
    lastFocused = $false
    ownedPolicyValues = [pscustomobject]@{ chrome = @(); brave = @() }
  }
}

function Ensure-StateShape($Value) {
  if ($null -eq $Value) { return New-DefaultState }
  $defaults = New-DefaultState
  foreach ($property in $defaults.PSObject.Properties) {
    if ($null -eq $Value.PSObject.Properties[$property.Name]) {
      $Value | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value
    }
  }
  $Value.heartbeatTimeoutSeconds = $HeartbeatTimeoutSeconds
  if ($null -eq $Value.usage) { $Value.usage = [pscustomobject]@{} }
  if ($null -eq $Value.groups) { $Value.groups = @() }
  if ($null -eq $Value.ownedPolicyValues) {
    $Value.ownedPolicyValues = [pscustomobject]@{ chrome = @(); brave = @() }
  }
  foreach ($browser in $policyPaths.Keys) {
    if ($null -eq $Value.ownedPolicyValues.PSObject.Properties[$browser]) {
      $Value.ownedPolicyValues | Add-Member -NotePropertyName $browser -NotePropertyValue @()
    }
  }
  return $Value
}

function Save-State {
  if (-not $script:Dirty) { return }
  $temporary = "$statePath.tmp"
  $script:State | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $temporary -Encoding utf8
  Move-Item -LiteralPath $temporary -Destination $statePath -Force
  $script:Dirty = $false
}

function Normalize-Domain([string]$Raw) {
  if ([string]::IsNullOrWhiteSpace($Raw)) { return '' }
  $value = $Raw.Trim().ToLowerInvariant()
  try {
    if ($value -notmatch '^[a-z]+://') { $value = "https://$value" }
    $value = ([Uri]$value).Host.ToLowerInvariant()
  } catch {
    $value = $Raw.Trim().ToLowerInvariant().Split('/')[0]
  }
  $value = $value.Trim('.')
  if ($value.StartsWith('www.')) { $value = $value.Substring(4) }
  return $value
}

function Normalize-Groups($Groups) {
  $result = @()
  foreach ($group in @($Groups)) {
    if ($null -eq $group -or [string]::IsNullOrWhiteSpace([string]$group.id)) { continue }
    $domains = @($group.domains | ForEach-Object { Normalize-Domain ([string]$_) } | Where-Object { $_ } | Sort-Object -Unique)
    $group.domains = $domains
    if ([string]::IsNullOrWhiteSpace([string]$group.name)) { $group.name = 'Unnamed zone' }
    $result += $group
  }
  return @($result)
}

function Get-TodayKey([long]$Now) {
  return ([DateTime]'1970-01-01').AddMilliseconds($Now).ToLocalTime().ToString('yyyy-MM-dd')
}

function Test-WithinSchedule($Schedule, [long]$Now) {
  if ($null -eq $Schedule -or $null -eq $Schedule.days -or @($Schedule.days).Count -eq 0) { return $false }
  $local = ([DateTime]'1970-01-01').AddMilliseconds($Now).ToLocalTime()
  $day = [int]$local.DayOfWeek
  $minutes = $local.Hour * 60 + $local.Minute
  $start = [int]$Schedule.start
  $end = [int]$Schedule.end
  $days = @($Schedule.days | ForEach-Object { [int]$_ })
  if ($start -eq $end) { return $days -contains $day }
  if ($start -lt $end) { return ($days -contains $day) -and $minutes -ge $start -and $minutes -lt $end }
  $previous = ($day + 6) % 7
  return (($days -contains $day) -and $minutes -ge $start) -or (($days -contains $previous) -and $minutes -lt $end)
}

function Test-GroupMatchesHost($Group, [string]$HostName) {
  foreach ($domain in @($Group.domains)) {
    if ($HostName -eq $domain -or $HostName.EndsWith(".$domain", [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Get-UsageEntry([string]$GroupId, [long]$Now, [switch]$Create) {
  $property = $script:State.usage.PSObject.Properties[$GroupId]
  $today = Get-TodayKey $Now
  if ($null -ne $property -and $null -ne $property.Value -and $property.Value.date -eq $today) { return $property.Value }
  if (-not $Create) { return $null }
  $entry = [pscustomobject]@{ date = $today; ms = 0L }
  $script:State.usage | Add-Member -NotePropertyName $GroupId -NotePropertyValue $entry -Force
  return $entry
}

function Get-RemainingMs($Group, [long]$Now) {
  if ($null -eq $Group.limit) { return [long]::MaxValue }
  $entry = Get-UsageEntry ([string]$Group.id) $Now
  $used = 0L
  if ($null -ne $entry) { $used = [Math]::Max(0L, [long]$entry.ms) }
  $limit = [long]([Math]::Max(0.0, [double]$Group.limit.minutes) * 60000.0)
  return [Math]::Max(0L, $limit - $used)
}

function Get-TickingGroups([string]$HostName, [long]$Now) {
  return @($script:State.groups | Where-Object {
    $_.enabled -eq $true -and $null -ne $_.limit -and
    -not (Test-WithinSchedule $_.schedule $Now) -and
    (Get-RemainingMs $_ $Now) -gt 0 -and
    (Test-GroupMatchesHost $_ $HostName)
  })
}

function Add-ElapsedUsage([long]$Now) {
  if ([long]$script:State.lastSampleMs -le 0) {
    $script:State.lastSampleMs = $Now
    $script:Dirty = $true
    return
  }
  $deadline = [long]$script:State.lastHeartbeatMs + [long]$script:State.heartbeatTimeoutSeconds * 1000L
  $until = [Math]::Min($Now, $deadline)
  $elapsed = [Math]::Max(0L, $until - [long]$script:State.lastSampleMs)
  if ($elapsed -gt 0 -and $script:State.lastFocused -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$script:State.lastHost)) {
    foreach ($group in Get-TickingGroups ([string]$script:State.lastHost) $until) {
      $entry = Get-UsageEntry ([string]$group.id) $until -Create
      $entry.ms = [long]$entry.ms + $elapsed
      $script:Dirty = $true
    }
  }
  if ($until -gt [long]$script:State.lastSampleMs) {
    $script:State.lastSampleMs = $until
    $script:Dirty = $true
  }
}

function Get-RunningProtectedUserSids {
  if ($AssumeBrowserRunning) {
    if ($script:ProtectedAccounts.Count -gt 0) { return @($script:ProtectedAccounts.Keys) }
    return @('__legacy__')
  }
  $processes = @(Get-Process chrome, brave -IncludeUserName -ErrorAction SilentlyContinue)
  if ($script:ProtectedAccounts.Count -eq 0) {
    if ($processes.Count -gt 0) { return @('__legacy__') }
    return @()
  }
  $running = @()
  foreach ($protectedSidValue in $script:ProtectedAccounts.Keys) {
    $account = [string]$script:ProtectedAccounts[$protectedSidValue]
    if ($null -ne ($processes | Where-Object { $_.UserName -ieq $account } | Select-Object -First 1)) {
      $running += [string]$protectedSidValue
    }
  }
  return @($running)
}

function Set-FirewallBlocked([bool]$Blocked) {
  if ($script:FirewallBlocked -eq $Blocked) { return }
  if (-not $TestMode) {
    $rules = @(Get-NetFirewallRule -Group $firewallGroup -ErrorAction SilentlyContinue)
    if ($rules.Count -gt 0) {
      $rules | Set-NetFirewallRule -Enabled $(if ($Blocked) { 'True' } else { 'False' })
    }
  }
  $script:FirewallBlocked = $Blocked
  Write-WatchdogLog "Emergency browser firewall block: $Blocked"
}

function Test-RequestOrigin($Context) {
  $origin = [string]$Context.Request.Headers['Origin']
  if ([string]::IsNullOrWhiteSpace($origin)) { return $true }
  return $origin -match '^chrome-extension://[a-p]{32}$'
}

function Get-ProcessOwnerSid([int]$ProcessId) {
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    if ($null -eq $process) { return '' }
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop
    if ([int]$owner.ReturnValue -ne 0) { return '' }
    return [string]$owner.Sid
  } catch { return '' }
}

function Get-RequestUserSid($Context) {
  try {
    $clientPort = [int]$Context.Request.RemoteEndPoint.Port
    $connection = Get-NetTCPConnection `
      -LocalAddress '127.0.0.1' `
      -LocalPort $clientPort `
      -RemoteAddress '127.0.0.1' `
      -RemotePort $Port `
      -State Established `
      -ErrorAction Stop | Select-Object -First 1
    if ($null -eq $connection) { return '' }
    return Get-ProcessOwnerSid ([int]$connection.OwningProcess)
  } catch {
    Write-WatchdogLog "Could not identify loopback client SID: $($_.Exception.Message)"
    return ''
  }
}

function Test-ProtectedAccountRequest($Context, $Request) {
  $script:CurrentRequestUserSid = ''
  if ($script:ProtectedAccounts.Count -eq 0) { return $true }
  $origin = [string]$Context.Request.Headers['Origin']
  if ([string]$Request.type -eq 'disarm' -and [string]::IsNullOrWhiteSpace($origin)) { return $true }
  $requestUserSid = Get-RequestUserSid $Context
  if ($script:ProtectedAccounts.Contains($requestUserSid)) {
    $script:CurrentRequestUserSid = $requestUserSid
    return $true
  }
  $protectedNames = @($script:ProtectedAccounts.Values) -join ', '
  Write-WatchdogLog "Rejected $($Request.type) request from SID '$requestUserSid'; protected accounts are '$protectedNames'."
  return $false
}

function Apply-BrowserPolicy([string]$Browser, [string[]]$Domains) {
  if ($TestMode) { return }
  $path = $policyPaths[$Browser]
  if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null }
  $key = Get-Item -LiteralPath $path
  $previous = @($script:State.ownedPolicyValues.$Browser)
  foreach ($entry in $previous) {
    $current = $key.GetValue([string]$entry.name, $null)
    if ($current -is [string] -and $current -eq [string]$entry.value) {
      Remove-ItemProperty -LiteralPath $path -Name ([string]$entry.name) -ErrorAction SilentlyContinue
    }
  }
  $occupied = @((Get-Item -LiteralPath $path).GetValueNames())
  $owned = @()
  $candidate = 1
  foreach ($domain in $Domains) {
    while ($candidate -le 1000 -and $occupied -contains [string]$candidate) { $candidate++ }
    if ($candidate -gt 1000) { throw 'Chrome URLBlocklist has no free policy slots.' }
    $name = [string]$candidate
    New-ItemProperty -LiteralPath $path -Name $name -Value $domain -PropertyType String -Force | Out-Null
    $occupied += $name
    $owned += [pscustomobject]@{ name = $name; value = $domain }
    $candidate++
  }
  $script:State.ownedPolicyValues.$Browser = @($owned)
  $script:Dirty = $true
}

function Apply-Policies([string[]]$Domains) {
  $fingerprint = ($Domains -join "`n")
  if ($script:LastPolicyFingerprint -eq $fingerprint) { return }
  foreach ($browser in $policyPaths.Keys) { Apply-BrowserPolicy $browser $Domains }
  $script:LastPolicyFingerprint = $fingerprint
}

function Evaluate-Enforcement([long]$Now) {
  $domains = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $reasons = New-Object 'System.Collections.Generic.List[string]'
  $script:FailClosedActive = $false
  $enabledGroups = @($script:State.groups | Where-Object { $_.enabled -eq $true })

  if ($script:State.enforcementArmed -eq $true) {
    foreach ($group in $enabledGroups) {
      if (Test-WithinSchedule $group.schedule $Now) {
        foreach ($domain in @($group.domains)) { [void]$domains.Add([string]$domain) }
        if (-not $reasons.Contains('schedule')) { $reasons.Add('schedule') }
      } elseif ($null -ne $group.limit -and (Get-RemainingMs $group $Now) -le 0) {
        foreach ($domain in @($group.domains)) { [void]$domains.Add([string]$domain) }
        if (-not $reasons.Contains('allowance spent')) { $reasons.Add('allowance spent') }
      }
    }

    $runningUserSids = @(Get-RunningProtectedUserSids)
    $runningSet = @{}
    $missingAccounts = @()
    foreach ($runningUserSid in $runningUserSids) {
      $runningSet[$runningUserSid] = $true
      if (-not $script:BrowserSeenAtMsBySid.ContainsKey($runningUserSid)) { $script:BrowserSeenAtMsBySid[$runningUserSid] = $Now }
      $lastSensorHeartbeat = if ($script:SensorHeartbeatMsBySid.ContainsKey($runningUserSid)) {
        [long]$script:SensorHeartbeatMsBySid[$runningUserSid]
      } else { 0L }
      $graceStart = [Math]::Max([long]$script:BrowserSeenAtMsBySid[$runningUserSid], $lastSensorHeartbeat)
      if ($enabledGroups.Count -gt 0 -and $graceStart -gt 0 -and ($Now - $graceStart) -gt ([long]$script:State.heartbeatTimeoutSeconds * 1000L)) {
        $accountName = if ($script:ProtectedAccounts.Contains($runningUserSid)) { [string]$script:ProtectedAccounts[$runningUserSid] } else { 'browser' }
        $missingAccounts += ($accountName -split '\\')[-1]
      }
    }
    foreach ($knownSid in @($script:BrowserSeenAtMsBySid.Keys)) {
      if (-not $runningSet.ContainsKey($knownSid)) { $script:BrowserSeenAtMsBySid.Remove($knownSid) }
    }
    if ($script:State.failClosed -eq $true -and $missingAccounts.Count -gt 0) {
      foreach ($group in $enabledGroups) {
        foreach ($domain in @($group.domains)) { [void]$domains.Add([string]$domain) }
      }
      $reasons.Add("sensor missing: $($missingAccounts -join ', ')")
      $script:FailClosedActive = $true
    }
  }

  $script:BlockedDomains = @($domains | Sort-Object)
  if ($script:State.enforcementArmed -ne $true) { $script:EnforcementReason = 'not armed' }
  elseif ($reasons.Count -eq 0) { $script:EnforcementReason = 'open' }
  else { $script:EnforcementReason = $reasons -join ', ' }
  Apply-Policies $script:BlockedDomains
  Set-FirewallBlocked $script:FailClosedActive
}

function Get-Snapshot([long]$Now) {
  $ticking = @()
  if ($script:State.lastFocused -eq $true -and ($Now - [long]$script:State.lastHeartbeatMs) -le ([long]$script:State.heartbeatTimeoutSeconds * 1000L)) {
    $ticking = @(Get-TickingGroups ([string]$script:State.lastHost) $Now | ForEach-Object { [string]$_.id })
  }
  $session = $null
  if ($ticking.Count -gt 0) { $session = [pscustomobject]@{ groupIds = $ticking; startedAt = $Now } }
  return [pscustomobject][ordered]@{
    connected = $true
    configured = $script:State.configured -eq $true
    enforcementArmed = $script:State.enforcementArmed -eq $true
    failClosed = $script:State.failClosed -eq $true
    failClosedActive = $script:FailClosedActive
    firewallBlocked = $script:FirewallBlocked -eq $true
    heartbeatTimeoutSeconds = [int]$script:State.heartbeatTimeoutSeconds
    lastHeartbeatMs = [long]$script:State.lastHeartbeatMs
    groups = @($script:State.groups)
    usage = $script:State.usage
    usageSession = $session
    lockMode = $script:State.lockMode -eq $true
    privacyConsent = $script:State.privacyConsent -eq $true
    blockedDomains = @($script:BlockedDomains)
    enforcementReason = $script:EnforcementReason
    protectedWindowsAccount = (@($script:ProtectedAccounts.Values) -join ', ')
    protectedWindowsAccounts = @($script:ProtectedAccounts.Values)
  }
}

function Handle-Request($Request, [string]$RequestUserSid = '') {
  $now = Get-NowMs
  switch ([string]$Request.type) {
    'bootstrap' {
      if ($script:State.configured -ne $true) {
        $script:State.groups = Normalize-Groups $Request.payload.groups
        if ($null -ne $Request.payload.usage) { $script:State.usage = $Request.payload.usage }
        $script:State.lockMode = $Request.payload.lockMode -eq $true
        $script:State.privacyConsent = $Request.payload.privacyConsent -eq $true
        $script:State.configured = $true
        $script:Dirty = $true
      }
      $script:State.lastSampleMs = $now
    }
    'updateConfig' {
      Add-ElapsedUsage $now
      $script:State.groups = Normalize-Groups $Request.payload.groups
      $script:State.lockMode = $Request.payload.lockMode -eq $true
      $script:State.privacyConsent = $Request.payload.privacyConsent -eq $true
      $script:State.configured = $true
      $script:Dirty = $true
    }
    'heartbeat' {
      Add-ElapsedUsage $now
      $sensorKey = if ([string]::IsNullOrWhiteSpace($RequestUserSid)) { '__legacy__' } else { $RequestUserSid }
      $previousSensorHeartbeat = if ($script:SensorHeartbeatMsBySid.ContainsKey($sensorKey)) { [long]$script:SensorHeartbeatMsBySid[$sensorKey] } else { 0L }
      if ($previousSensorHeartbeat -eq 0 -or ($now - $previousSensorHeartbeat) -gt ([long]$script:State.heartbeatTimeoutSeconds * 2000L)) {
        $script:ConsecutiveHeartbeatsBySid[$sensorKey] = 0
      }
      $script:ConsecutiveHeartbeatsBySid[$sensorKey] = [int]$script:ConsecutiveHeartbeatsBySid[$sensorKey] + 1
      $script:SensorHeartbeatMsBySid[$sensorKey] = $now
      $script:State.lastHeartbeatMs = $now
      $script:State.lastSampleMs = $now
      $script:State.lastHost = Normalize-Domain ([string]$Request.payload.host)
      $script:State.lastFocused = $Request.payload.focused -eq $true
      if ($script:State.configured -eq $true -and $script:State.enforcementArmed -ne $true -and [int]$script:ConsecutiveHeartbeatsBySid[$sensorKey] -ge 3) {
        $script:State.enforcementArmed = $true
      }
      $script:Dirty = $true
    }
    'getState' { Add-ElapsedUsage $now }
    'clearData' {
      $script:State.groups = @()
      $script:State.usage = [pscustomobject]@{}
      $script:State.lockMode = $false
      $script:State.privacyConsent = $false
      $script:State.configured = $false
      $script:State.enforcementArmed = $false
      $script:State.lastHeartbeatMs = $now
      $script:State.lastSampleMs = $now
      $script:State.lastHost = ''
      $script:State.lastFocused = $false
      $script:ConsecutiveHeartbeatsBySid.Clear()
      $script:SensorHeartbeatMsBySid.Clear()
      $script:Dirty = $true
    }
    'disarm' {
      $script:State.enforcementArmed = $false
      $script:ConsecutiveHeartbeatsBySid.Clear()
      $script:Dirty = $true
    }
    default { throw "Unknown request type: $($Request.type)" }
  }
  Evaluate-Enforcement $now
  Save-State
  return Get-Snapshot $now
}

function Write-JsonResponse($Context, [int]$StatusCode, $Body) {
  $Context.Response.StatusCode = $StatusCode
  $origin = [string]$Context.Request.Headers['Origin']
  if ($origin -match '^chrome-extension://[a-p]{32}$') {
    $Context.Response.Headers['Access-Control-Allow-Origin'] = $origin
    $Context.Response.Headers['Vary'] = 'Origin'
  }
  $Context.Response.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
  if ($Context.Request.Headers['Access-Control-Request-Private-Network'] -eq 'true') {
    $Context.Response.Headers['Access-Control-Allow-Private-Network'] = 'true'
  }
  $Context.Response.Headers['Cache-Control'] = 'no-store'
  if ($null -ne $Body) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 20 -Compress))
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  }
  $Context.Response.Close()
}

New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
if (Test-Path -LiteralPath $statePath) {
  try { $script:State = Ensure-StateShape (Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json) }
  catch { Write-WatchdogLog "State load failed, starting safely disarmed: $($_.Exception.Message)"; $script:State = New-DefaultState }
} else { $script:State = New-DefaultState }
$script:Dirty = $true

$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try {
  Evaluate-Enforcement (Get-NowMs)
  Save-State
  $listener.Start()
  Write-WatchdogLog "Watchdog started on loopback port $Port."
  Write-Output 'LOCKIN_WATCHDOG_READY'
  $pending = $listener.GetContextAsync()
  while ($listener.IsListening) {
    $now = Get-NowMs
    Add-ElapsedUsage $now
    Evaluate-Enforcement $now
    Save-State
    if (-not $pending.Wait(1000)) { continue }
    $context = $pending.Result
    $pending = $listener.GetContextAsync()
    try {
      if (-not (Test-RequestOrigin $context)) {
        Write-JsonResponse $context 403 ([pscustomobject]@{ ok = $false; error = 'Only a Chrome extension origin may use this endpoint.' })
        continue
      }
      if ($context.Request.HttpMethod -eq 'OPTIONS') { Write-JsonResponse $context 204 $null; continue }
      if ($context.Request.HttpMethod -eq 'GET' -and $context.Request.Url.AbsolutePath -eq '/health') {
        Write-JsonResponse $context 200 ([pscustomobject]@{ ok = $true; data = Get-Snapshot (Get-NowMs) })
        continue
      }
      if ($context.Request.HttpMethod -ne 'POST' -or $context.Request.Url.AbsolutePath -ne '/api/request') {
        Write-JsonResponse $context 404 ([pscustomobject]@{ ok = $false; error = 'Not found' })
        continue
      }
      $reader = [IO.StreamReader]::new($context.Request.InputStream, $context.Request.ContentEncoding)
      try { $request = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
      if (-not (Test-ProtectedAccountRequest $context $request)) {
        Write-JsonResponse $context 403 ([pscustomobject]@{ ok = $false; error = 'This Windows account is not the protected Lock In sensor.' })
        continue
      }
      $data = Handle-Request $request $script:CurrentRequestUserSid
      Write-JsonResponse $context 200 ([pscustomobject]@{ ok = $true; requestId = $request.requestId; data = $data })
    } catch {
      Write-WatchdogLog "Request failed: $($_.Exception.Message)"
      Write-JsonResponse $context 400 ([pscustomobject]@{ ok = $false; error = $_.Exception.Message })
    }
  }
} catch {
  Write-WatchdogLog "Fatal watchdog error: $($_.Exception)"
  throw
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
