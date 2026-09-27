[CmdletBinding()]
param(
  [string]$DataDirectory = "$env:ProgramData\LockIn",
  [int]$Port = 8765,
  [int]$HeartbeatTimeoutSeconds = 60,
  [string]$ProtectedUserSids = '',
  [string]$ProtectedUserSid = '',
  [int]$EvaluationIntervalMilliseconds = 250,
  [switch]$TestMode,
  [switch]$AssumeBrowserRunning
)

$ErrorActionPreference = 'Stop'
$statePath = Join-Path $DataDirectory 'state.json'
$logPath = Join-Path $DataDirectory 'watchdog.log'
$policyPaths = [ordered]@{
  chrome   = 'HKLM:\SOFTWARE\Policies\Google\Chrome\URLBlocklist'
  brave    = 'HKLM:\SOFTWARE\Policies\BraveSoftware\Brave\URLBlocklist'
  chrome32 = 'HKLM:\SOFTWARE\WOW6432Node\Policies\Google\Chrome\URLBlocklist'
  brave32  = 'HKLM:\SOFTWARE\WOW6432Node\Policies\BraveSoftware\Brave\URLBlocklist'
}
$allowPolicyPaths = [ordered]@{
  chrome   = 'HKLM:\SOFTWARE\Policies\Google\Chrome\URLAllowlist'
  brave    = 'HKLM:\SOFTWARE\Policies\BraveSoftware\Brave\URLAllowlist'
  chrome32 = 'HKLM:\SOFTWARE\WOW6432Node\Policies\Google\Chrome\URLAllowlist'
  brave32  = 'HKLM:\SOFTWARE\WOW6432Node\Policies\BraveSoftware\Brave\URLAllowlist'
}
$firewallGroup = 'LockInWatchdog'
$script:ConsecutiveHeartbeatsBySid = @{}
$script:BrowserSeenAtMsBySid = @{}
$script:SensorHeartbeatMsBySid = @{}
# What each protected account's sensor last reported, keyed like the maps
# above: host, url, focused, active (its Windows session is the one in front)
# and the heartbeat time. Held in memory only; nothing here is worth keeping
# across a restart, and URLs never touch the disk.
$script:Sensors = @{}
$script:BlockedDomains = @()
$script:AllowedDomains = @()
$script:EnforcementReason = 'not armed'
$script:FailClosedActive = $false
$script:FirewallBlocked = $null
# The accounts whose browsers are currently cut off, as a sorted key; '*' means
# every protected account. $null until the first reconcile.
$script:FirewallKey = $null
$script:FirewallRulesStale = $true
$script:LastPolicyFingerprint = $null
# Dirty means "worth saving soon" (usage ticks); SaveUrgent means "save on
# this pass" (configuration and owned registry values). Usage alone is written
# at most every $SaveIntervalMs so the loop never spends its time on disk.
$script:Dirty = $false
$script:SaveUrgent = $false
$script:LastSaveMs = 0L
$script:SaveIntervalMs = 5000L
$script:ProtectedAccounts = [ordered]@{}
$script:CurrentRequestUserSid = ''
$script:CurrentRequestSessionActive = $true
$script:RunningProtectedUserSids = @()
$script:BrowserOwnerLookupFailed = $false
$script:NextBrowserProbeMs = 0L
$script:BrowserProbeIntervalMs = 2000L
# Get-NetFirewallRule costs about a second, so the rules are touched only when
# the desired state changes, and re-verified against tampering on this cadence.
$script:NextFirewallReconcileMs = 0L
$script:FirewallReconcileIntervalMs = 60000L
# Usage accrues only while heartbeats are fresh. This is deliberately much
# shorter than the fail-closed grace: a sensor that went quiet stops counting
# time long before its absence is treated as an escape attempt.
$script:UsageStaleMs = 10000L
$script:LastLoopMs = 0L
$script:LogLastWrittenMs = @{}

if ([string]::IsNullOrWhiteSpace($ProtectedUserSids)) { $ProtectedUserSids = $ProtectedUserSid }
foreach ($protectedSidValue in @($ProtectedUserSids -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)) {
  try {
    $sid = [Security.Principal.SecurityIdentifier]::new($protectedSidValue)
  } catch {
    throw "ProtectedUserSids contains an invalid Windows account SID: $protectedSidValue"
  }
  # A name is only for display. An account that cannot be resolved right now
  # (a domain controller out of reach, say) is still protected by its SID.
  try { $script:ProtectedAccounts[$protectedSidValue] = $sid.Translate([Security.Principal.NTAccount]).Value }
  catch { $script:ProtectedAccounts[$protectedSidValue] = $protectedSidValue }
}

function Get-NowMs {
  return [long]([DateTime]::UtcNow - [DateTime]'1970-01-01').TotalMilliseconds
}

function Write-WatchdogLog([string]$Message) {
  try {
    # The same complaint once a second would bury everything else.
    $now = Get-NowMs
    if ($script:LogLastWrittenMs.ContainsKey($Message) -and ($now - [long]$script:LogLastWrittenMs[$Message]) -lt 60000) { return }
    if ($script:LogLastWrittenMs.Count -gt 500) { $script:LogLastWrittenMs.Clear() }
    $script:LogLastWrittenMs[$Message] = $now
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 1MB) {
      Move-Item -LiteralPath $logPath -Destination "$logPath.old" -Force
    }
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message" -Encoding utf8
  } catch { }
}

function Initialize-Native {
  if ('LockIn.Native' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
namespace LockIn {
  public static class Native {
    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQuerySessionInformation(IntPtr server, int session, int info, out IntPtr buffer, out int bytes);
    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr buffer);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("iphlpapi.dll")]
    private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sorted, int family, int tableClass, int reserved);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr process, int flags, System.Text.StringBuilder name, ref int size);

    // WTSConnectState (info class 8): 0 = WTSActive, 4 = WTSDisconnected.
    // -1 when the state cannot be read.
    public static int SessionState(int session) {
      IntPtr buffer;
      int bytes;
      if (!WTSQuerySessionInformation(IntPtr.Zero, session, 8, out buffer, out bytes)) return -1;
      try { return bytes < 4 ? -1 : Marshal.ReadInt32(buffer); }
      finally { WTSFreeMemory(buffer); }
    }

    // An unknown state must remain protected, including failures during a
    // session transition.
    public static bool RequiresSensor(int session) {
      return SessionState(session) != 4;
    }

    public static string ProcessImagePath(int processId) {
      IntPtr process = OpenProcess(0x1000, false, processId); // PROCESS_QUERY_LIMITED_INFORMATION
      if (process == IntPtr.Zero) return "";
      try {
        System.Text.StringBuilder name = new System.Text.StringBuilder(1024);
        int size = name.Capacity;
        return QueryFullProcessImageName(process, 0, name, ref size) ? name.ToString() : "";
      } finally { CloseHandle(process); }
    }

    // Microseconds, where the WMI equivalent takes a large fraction of a second.
    public static string ProcessOwnerSid(int processId) {
      IntPtr process = OpenProcess(0x1000, false, processId); // PROCESS_QUERY_LIMITED_INFORMATION
      if (process == IntPtr.Zero) return "";
      try {
        IntPtr token;
        if (!OpenProcessToken(process, 0x0008, out token)) return ""; // TOKEN_QUERY
        try {
          using (WindowsIdentity identity = new WindowsIdentity(token)) {
            return identity.User == null ? "" : identity.User.Value;
          }
        } finally { CloseHandle(token); }
      } catch { return ""; }
      finally { CloseHandle(process); }
    }

    // The process on the client side of an established IPv4 loopback
    // connection to serverPort, or 0 when there is none.
    public static int LoopbackClientProcessId(int clientPort, int serverPort) {
      int size = 0;
      GetExtendedTcpTable(IntPtr.Zero, ref size, false, 2, 5, 0); // AF_INET, TCP_TABLE_OWNER_PID_ALL
      for (int attempt = 0; attempt < 4; attempt++) {
        size += 4096;
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
          uint result = GetExtendedTcpTable(buffer, ref size, false, 2, 5, 0);
          if (result == 122) continue; // ERROR_INSUFFICIENT_BUFFER: the table grew
          if (result != 0) return 0;
          int count = Marshal.ReadInt32(buffer);
          for (int index = 0; index < count; index++) {
            int offset = 4 + index * 24; // MIB_TCPROW_OWNER_PID is six DWORDs
            int state = Marshal.ReadInt32(buffer, offset);
            int localAddress = Marshal.ReadInt32(buffer, offset + 4);
            int localPort = PortOf(Marshal.ReadInt32(buffer, offset + 8));
            int remotePort = PortOf(Marshal.ReadInt32(buffer, offset + 16));
            if (state == 5 && localAddress == 0x0100007F && localPort == clientPort && remotePort == serverPort) {
              return Marshal.ReadInt32(buffer, offset + 20);
            }
          }
          return 0;
        } finally { Marshal.FreeHGlobal(buffer); }
      }
      return 0;
    }

    private static int PortOf(int raw) { return ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF); }
  }
}
'@
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
    ownedPolicyValues = [pscustomobject]@{ chrome = @(); brave = @(); chrome32 = @(); brave32 = @() }
    ownedAllowPolicyValues = [pscustomobject]@{ chrome = @(); brave = @(); chrome32 = @(); brave32 = @() }
    # Brave/Chrome executables seen so far. Emergency firewall rules are kept
    # for each one, so a per-user install in another account is covered too.
    browserPaths = @()
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
  $Value.browserPaths = @($Value.browserPaths | Where-Object { $_ } | ForEach-Object { [string]$_ })
  if ($null -eq $Value.ownedPolicyValues) {
    $Value.ownedPolicyValues = [pscustomobject]@{ chrome = @(); brave = @(); chrome32 = @(); brave32 = @() }
  }
  if ($null -eq $Value.ownedAllowPolicyValues) {
    $Value.ownedAllowPolicyValues = [pscustomobject]@{ chrome = @(); brave = @(); chrome32 = @(); brave32 = @() }
  }
  foreach ($browser in $policyPaths.Keys) {
    if ($null -eq $Value.ownedPolicyValues.PSObject.Properties[$browser]) {
      $Value.ownedPolicyValues | Add-Member -NotePropertyName $browser -NotePropertyValue @()
    }
    if ($null -eq $Value.ownedAllowPolicyValues.PSObject.Properties[$browser]) {
      $Value.ownedAllowPolicyValues | Add-Member -NotePropertyName $browser -NotePropertyValue @()
    }
  }
  return $Value
}

function Request-Save {
  $script:Dirty = $true
  $script:SaveUrgent = $true
}

function Save-State([switch]$Force) {
  if (-not $script:Dirty) { return }
  $now = Get-NowMs
  if (-not $Force -and -not $script:SaveUrgent -and ($now - $script:LastSaveMs) -lt $script:SaveIntervalMs) { return }
  # A backup or antivirus scan can hold the file for a moment. Nothing is lost
  # by failing here: the state stays dirty and the next pass tries again.
  try {
    $temporary = "$statePath.tmp"
    [IO.File]::WriteAllText($temporary, ($script:State | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $statePath -Force
    $script:Dirty = $false
    $script:SaveUrgent = $false
  } catch {
    Write-WatchdogLog "Could not save state (will retry): $($_.Exception.Message)"
  }
  $script:LastSaveMs = $now
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


function Normalize-Site([string]$Raw) {
  if ([string]::IsNullOrWhiteSpace($Raw)) { return '' }
  $value = $Raw.Trim()
  if ($value -match '^[a-z][a-z0-9+.-]*://' -and $value -notmatch '^https?://') { throw 'Only HTTP(S) site rules are supported.' }
  if ($value -notmatch '^https?://') { $value = "https://$value" }
  $uri = [Uri]$value
  if (-not $uri.IsAbsoluteUri -or $uri.UserInfo -or ($uri.Host + $uri.AbsolutePath + $uri.Query + $uri.Fragment) -match '[\s*@]') { throw 'Invalid site rule.' }
  $hostName = Normalize-Domain $uri.Host
  if ($hostName -notmatch '^[a-z0-9.-]+$' -or $hostName.StartsWith('.') -or $hostName.Contains('..')) { throw 'Invalid site hostname.' }
  $portPart = if ($uri.IsDefaultPort) { '' } else { ':' + $uri.Port }
  $queryParts = @($uri.Query.TrimStart('?').Split('&') | Where-Object { $_ -and ($_ -split '=', 2)[0] -notmatch '^(utm_.+|fbclid|gclid|msclkid)$' })
  $queryPart = if ($queryParts.Count) { '?' + ($queryParts -join '&') } else { '' }
  $fragmentPart = if ($uri.Fragment -eq '#') { '' } else { $uri.Fragment }
  $pathPart = if ($uri.AbsolutePath -eq '/' -and -not $queryPart -and -not $fragmentPart) { '' } else { $uri.AbsolutePath }
  return "$hostName$portPart$pathPart$queryPart$fragmentPart"
}

function ConvertTo-PolicyFilter([string]$Rule) {
  # Chromium explicitly ignores # and everything after it. Fragment-specific
  # rules are enforced by the extension and must never broaden into a domain
  # or path policy here.
  if ($Rule.Contains('#')) { return '' }
  # Chromium separates the query filter from the path with @.
  return $Rule.Replace('?', '@')
}

function Test-SiteMatches([string]$Page, [string]$Rule) {
  try {
    $url = [Uri]$Page
    $listed = [Uri]("https://$Rule")
    if (-not $url.IsAbsoluteUri -or $url.Scheme -notin @('http', 'https')) { return $false }
    $hostName = Normalize-Domain $url.Host
    if ($hostName -ne $listed.Host -and -not $hostName.EndsWith('.' + $listed.Host, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    if (-not $listed.IsDefaultPort -and $url.Port -ne $listed.Port) { return $false }
    if (-not $url.AbsolutePath.StartsWith($listed.AbsolutePath, [StringComparison]::Ordinal)) { return $false }
    foreach ($token in $listed.Query.TrimStart('?').Split('&')) {
      if (-not $token) { continue }
      $wanted = $token -split '=', 2
      $matched = $false
      foreach ($actualToken in $url.Query.TrimStart('?').Split('&')) {
        $actual = $actualToken -split '=', 2
        $sameKey = [Uri]::UnescapeDataString($actual[0].Replace('+', ' ')) -ceq [Uri]::UnescapeDataString($wanted[0].Replace('+', ' '))
        $actualValue = if ($actual.Count -gt 1) { $actual[1] } else { '' }
        $wantedValue = if ($wanted.Count -gt 1) { $wanted[1] } else { '' }
        if ($sameKey -and [Uri]::UnescapeDataString($actualValue.Replace('+', ' ')) -ceq [Uri]::UnescapeDataString($wantedValue.Replace('+', ' '))) { $matched = $true; break }
      }
      if (-not $matched) { return $false }
    }
    if ($listed.Fragment -and -not $url.Fragment.StartsWith($listed.Fragment, [StringComparison]::Ordinal)) { return $false }
    return $true
  } catch { return $false }
}

function Normalize-Groups($Groups) {
  $result = @()
  foreach ($group in @($Groups)) {
    if ($null -eq $group -or [string]::IsNullOrWhiteSpace([string]$group.id)) { continue }
    $domains = @($group.domains | ForEach-Object { Normalize-Site ([string]$_) } | Where-Object { $_ } | Sort-Object -Unique -CaseSensitive)
    $group.domains = $domains
    $exceptions = @($group.exceptions | ForEach-Object { Normalize-Site ([string]$_) } | Where-Object { $_ } | Sort-Object -Unique -CaseSensitive)
    $validExceptions = @()
    foreach ($exception in $exceptions) {
      $candidate = [Uri]("https://$exception")
      $fits = @($domains | Where-Object { Test-SiteMatches ("https://$exception") ([string]$_) }).Count -gt 0
      if (-not $candidate.Fragment -and ($candidate.AbsolutePath -ne '/' -or $candidate.Query) -and $fits) { $validExceptions += $exception }
    }
    if ($null -eq $group.PSObject.Properties['exceptions']) {
      $group | Add-Member -NotePropertyName exceptions -NotePropertyValue @($validExceptions)
    } else {
      $group.exceptions = @($validExceptions)
    }
    if ([string]::IsNullOrWhiteSpace([string]$group.name)) { $group.name = 'Unnamed zone' }
    $result += $group
  }
  return @($result)
}

# A timed release carries its own deadline. The watchdog is the side that is
# always running, so it is the side that has to notice: when the moment passes
# it arms the zone again here, and a closed browser cannot stretch a
# fifteen-minute release into a whole evening. The extension reaches the same
# conclusion from the same number, so both sides agree without negotiating.
function Update-DisarmExpiry([long]$Now) {
  foreach ($group in @($script:State.groups)) {
    if ($null -eq $group -or $group.enabled -eq $true) { continue }
    $property = $group.PSObject.Properties['disarmedUntil']
    if ($null -eq $property -or $null -eq $property.Value) { continue }
    $until = 0L
    try { $until = [long]$property.Value } catch { $until = 0L }
    if ($until -le 0 -or $Now -lt $until) { continue }
    $group | Add-Member -NotePropertyName enabled -NotePropertyValue $true -Force
    # The property is known to exist here, so it is cleared in place rather
    # than through Add-Member, which will not bind a null value.
    $property.Value = $null
    Request-Save
    Write-WatchdogLog "Timed release expired; re-armed zone $([string]$group.id)."
  }
}

function Get-TodayKey([long]$Now) {
  return ([DateTime]'1970-01-01').AddMilliseconds($Now).ToLocalTime().ToString('yyyy-MM-dd')
}

function Test-WithinSchedule($Schedule, [long]$Now) {
  if ($null -eq $Schedule -or $null -eq $Schedule.days -or @($Schedule.days).Count -eq 0) { return $false }
  $local = ([DateTime]'1970-01-01').AddMilliseconds($Now).ToLocalTime()
  $day = [int]$local.DayOfWeek
  $minutes = $local.Hour * 60 + $local.Minute
  $days = @($Schedule.days | ForEach-Object { [int]$_ })
  $windows = @($Schedule.windows)
  if ($windows.Count -eq 0 -and ($null -ne $Schedule.start -or $null -ne $Schedule.end)) {
    $windows = @([pscustomobject]@{ start = $Schedule.start; end = $Schedule.end })
  }
  foreach ($window in $windows) {
    $start = [int]$window.start
    $end = [int]$window.end
    if ($start -eq $end -and $days -contains $day) { return $true }
    if ($start -lt $end -and ($days -contains $day) -and $minutes -ge $start -and $minutes -lt $end) { return $true }
    if ($start -gt $end) {
      $previous = ($day + 6) % 7
      if ((($days -contains $day) -and $minutes -ge $start) -or (($days -contains $previous) -and $minutes -lt $end)) { return $true }
    }
  }
  return $false
}

function Test-GroupMatchesHost($Group, [string]$HostName, [string]$Url = '') {
  foreach ($exception in @($Group.exceptions)) {
    if (Test-SiteMatches $Url ([string]$exception)) { return $false }
  }
  foreach ($domain in @($Group.domains)) {
    if ($domain -match '[/?:]') {
      if (Test-SiteMatches $Url ([string]$domain)) { return $true }
      continue
    }
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

function Get-TickingGroups([string]$HostName, [string]$Url, [long]$Now) {
  return @($script:State.groups | Where-Object {
    $_.enabled -eq $true -and $null -ne $_.limit -and
    -not (Test-WithinSchedule $_.schedule $Now) -and
    (Get-RemainingMs $_ $Now) -gt 0 -and
    (Test-GroupMatchesHost $_ $HostName $Url)
  })
}

# Sensors whose report should count as someone looking at the page right now:
# fresh, focused, and in the Windows session that is actually in front. A
# browser left running in a switched-away account keeps reporting its last
# focused tab, and must not keep spending the allowance.
function Get-WatchingSensors([long]$Now) {
  return @($script:Sensors.Values | Where-Object {
    $_.focused -and $_.active -and -not [string]::IsNullOrWhiteSpace($_.host) -and
    ($Now - [long]$_.heartbeatMs) -le $script:UsageStaleMs
  })
}

# Group ids ticking for the given sensors. The allowance belongs to the person,
# not the account, so two accounts on the same site count the time once.
function Get-TickingGroupIds($Sensors, [long]$Now) {
  $ids = New-Object 'System.Collections.Generic.List[string]'
  foreach ($sensor in @($Sensors)) {
    foreach ($group in Get-TickingGroups ([string]$sensor.host) ([string]$sensor.url) $Now) {
      if (-not $ids.Contains([string]$group.id)) { $ids.Add([string]$group.id) }
    }
  }
  return @($ids)
}

function Add-ElapsedUsage([long]$Now) {
  $last = [long]$script:State.lastSampleMs
  $script:State.lastSampleMs = $Now
  $script:Dirty = $true
  if ($last -le 0) { return }
  # Passes run every quarter second; anything much longer is a pause (sleep,
  # a stalled machine) that nobody spent browsing.
  $elapsed = [Math]::Min([Math]::Max(0L, $Now - $last), $script:UsageStaleMs)
  if ($elapsed -le 0) { return }
  foreach ($groupId in Get-TickingGroupIds (Get-WatchingSensors $Now) $Now) {
    $entry = Get-UsageEntry $groupId $Now -Create
    $entry.ms = [long]$entry.ms + $elapsed
  }
}

function Test-InteractiveBrowserSession([int]$SessionId) {
  Initialize-Native
  return [LockIn.Native]::RequiresSensor($SessionId)
}

function Get-ProcessOwnerSid([int]$ProcessId) {
  try {
    Initialize-Native
    return [LockIn.Native]::ProcessOwnerSid($ProcessId)
  } catch { return '' }
}

function Get-BrowserProcesses {
  return @([Diagnostics.Process]::GetProcessesByName('chrome')) + @([Diagnostics.Process]::GetProcessesByName('brave')) |
    ForEach-Object { [pscustomobject]@{ Id = $_.Id; SessionId = $_.SessionId } }
}

function Get-ProcessImagePath([int]$ProcessId) {
  try {
    Initialize-Native
    return [LockIn.Native]::ProcessImagePath($ProcessId)
  } catch { return '' }
}

# Remembers a browser executable so emergency firewall rules exist for it.
# Chrome installed without admin rights lives in each account's own AppData,
# so the second account's copy is only discovered once it runs.
function Register-BrowserPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $known = @($script:State.browserPaths | Where-Object { $_ })
  if ($known -contains $Path) { return }
  $script:State.browserPaths = @($known + $Path | Sort-Object -Unique)
  $script:FirewallRulesStale = $true
  Request-Save
  Write-WatchdogLog "Learned browser executable $Path."
}

function Register-InstalledBrowsers {
  $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)})
  try {
    foreach ($profileKey in @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList' -ErrorAction Stop)) {
      $profilePath = [string]$profileKey.GetValue('ProfileImagePath')
      if ($profileKey.PSChildName -like 'S-1-5-21-*' -and $profilePath) { $roots += Join-Path $profilePath 'AppData\Local' }
    }
  } catch { }
  foreach ($root in $roots) {
    if (-not $root) { continue }
    foreach ($relative in @('BraveSoftware\Brave-Browser\Application\brave.exe', 'Google\Chrome\Application\chrome.exe')) {
      $candidate = Join-Path $root $relative
      if (Test-Path -LiteralPath $candidate) { Register-BrowserPath $candidate }
    }
  }
}

function Test-ProcessAlive([int]$ProcessId) {
  try { return -not ([Diagnostics.Process]::GetProcessById($ProcessId)).HasExited } catch { return $false }
}

function Get-RunningProtectedUserSids([long]$Now) {
  if ($AssumeBrowserRunning) {
    if ($script:ProtectedAccounts.Count -gt 0) { return @($script:ProtectedAccounts.Keys) }
    return @('__legacy__')
  }

  if ($Now -lt $script:NextBrowserProbeMs) {
    return @($script:RunningProtectedUserSids)
  }
  $script:NextBrowserProbeMs = $Now + $script:BrowserProbeIntervalMs
  $script:BrowserOwnerLookupFailed = $false

  $processes = @(Get-BrowserProcesses)
  if ($script:ProtectedAccounts.Count -eq 0) {
    $script:RunningProtectedUserSids = if ($processes.Count -gt 0) { @('__legacy__') } else { @() }
    return @($script:RunningProtectedUserSids)
  }

  $running = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  # Every browser subprocess in a Windows session has the same owner, so one
  # live process per session is enough. Trying the next one when a process
  # exits mid-lookup keeps normal browser churn from looking like an
  # unverifiable owner.
  foreach ($session in @($processes | Group-Object SessionId)) {
    foreach ($process in @($session.Group)) {
      $imagePath = Get-ProcessImagePath ([int]$process.Id)
      if ($imagePath) { Register-BrowserPath $imagePath; break }
    }
    # Fast user switching leaves browsers running in disconnected sessions.
    # Their missing sensors must not activate the machine-wide firewall.
    # A reconnected session is probed again and receives a fresh grace period.
    if (-not (Test-InteractiveBrowserSession ([int]$session.Name))) { continue }
    $ownerSid = ''
    $liveLookupFailed = $false
    foreach ($process in @($session.Group)) {
      $ownerSid = Get-ProcessOwnerSid ([int]$process.Id)
      if (-not [string]::IsNullOrWhiteSpace($ownerSid)) { break }
      if (Test-ProcessAlive ([int]$process.Id)) { $liveLookupFailed = $true }
    }
    if (-not [string]::IsNullOrWhiteSpace($ownerSid)) {
      if ($script:ProtectedAccounts.Contains($ownerSid)) { [void]$running.Add([string]$ownerSid) }
    } elseif ($liveLookupFailed) {
      $script:BrowserOwnerLookupFailed = $true
    }
  }

  if ($script:BrowserOwnerLookupFailed) {
    [void]$running.Add('__unknown__')
    Write-WatchdogLog 'Could not verify the owner SID of at least one browser process; fail-closed protection will be used.'
  }
  $script:RunningProtectedUserSids = @($running)
  return @($script:RunningProtectedUserSids)
}

function Get-FirewallRuleName([string]$Path, [string]$Sid) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes("$($Path.ToLowerInvariant())|$Sid")) }
  finally { $sha.Dispose() }
  return 'LockIn-' + ([BitConverter]::ToString($hash, 0, 8)).Replace('-', '')
}

# Keeps one outbound block rule per (browser executable, protected account)
# and enables exactly those for the accounts in $BlockedSids ('*' = all).
# Each rule is scoped to its account with -LocalUser, so a missing sensor in
# one account cuts off that account's browser and leaves the other's alone.
function Set-FirewallBlocked([string[]]$BlockedSids, [long]$Now) {
  $BlockedSids = @($BlockedSids | Where-Object { $_ } | Sort-Object -Unique)
  $key = $BlockedSids -join ','
  $changed = $key -cne $script:FirewallKey
  if ($TestMode) {
    if ($changed) { Write-WatchdogLog "Emergency browser firewall block: $(if ($key) { $key } else { 'none' })" }
    $script:FirewallKey = $key
    $script:FirewallBlocked = $BlockedSids.Count -gt 0
    return
  }
  # Querying the firewall costs about a second, so it happens only when the
  # wanted state or the set of browsers changes, or the tamper check is due.
  if (-not $changed -and -not $script:FirewallRulesStale -and $Now -lt $script:NextFirewallReconcileMs) { return }
  $script:NextFirewallReconcileMs = $Now + $script:FirewallReconcileIntervalMs

  $blockAll = $BlockedSids -contains '*'
  $ruleSids = if ($script:ProtectedAccounts.Count -gt 0) { @($script:ProtectedAccounts.Keys) } else { @('*') }
  $desired = @{}
  foreach ($path in @($script:State.browserPaths | Where-Object { $_ })) {
    foreach ($sid in $ruleSids) {
      $desired[(Get-FirewallRuleName $path $sid)] = [pscustomobject]@{
        Path = $path
        Sid = $sid
        Enabled = if ($blockAll -or $BlockedSids -contains $sid) { 'True' } else { 'False' }
      }
    }
  }

  $failed = $false
  $existing = @{}
  foreach ($rule in @(Get-NetFirewallRule -Group $firewallGroup -ErrorAction SilentlyContinue)) { $existing[[string]$rule.Name] = $rule }
  foreach ($name in @($existing.Keys)) {
    if ($desired.ContainsKey($name)) { continue }
    # Older installs made one rule per browser for every account at once.
    try { Remove-NetFirewallRule -Name $name -ErrorAction Stop } catch { $failed = $true; Write-WatchdogLog "Could not remove firewall rule ${name}: $($_.Exception.Message)" }
  }
  foreach ($name in @($desired.Keys)) {
    $want = $desired[$name]
    try {
      if ($existing.ContainsKey($name)) {
        if ([string]$existing[$name].Enabled -ne $want.Enabled) { Set-NetFirewallRule -Name $name -Enabled $want.Enabled -ErrorAction Stop }
        continue
      }
      $leaf = [IO.Path]::GetFileNameWithoutExtension($want.Path)
      $account = if ($want.Sid -eq '*') { 'all accounts' } else { ([string]$script:ProtectedAccounts[$want.Sid] -split '\\')[-1] }
      $ruleArguments = @{
        Name = $name
        DisplayName = "Lock In emergency block ($leaf, $account)"
        Group = $firewallGroup
        Direction = 'Outbound'
        Action = 'Block'
        Program = $want.Path
        Profile = 'Any'
        Enabled = $want.Enabled
        ErrorAction = 'Stop'
      }
      if ($want.Sid -ne '*') { $ruleArguments.LocalUser = "D:(A;;CC;;;$($want.Sid))" }
      New-NetFirewallRule @ruleArguments | Out-Null
    } catch {
      $failed = $true
      Write-WatchdogLog "Could not update firewall rule for $($want.Path): $($_.Exception.Message)"
    }
  }
  if ($desired.Count -eq 0 -and $BlockedSids.Count -gt 0) {
    Write-WatchdogLog 'No Brave or Chrome executable is known yet; the emergency firewall block has nothing to apply to.'
  }
  if ($changed) { Write-WatchdogLog "Emergency browser firewall block: $(if ($key) { $key } else { 'none' })" }
  $script:FirewallKey = $key
  # A failure (the firewall service stopped, say) is retried after a short
  # pause rather than on every pass: each attempt costs about a second, and
  # retrying constantly would starve the sensor's requests again.
  $script:FirewallRulesStale = $false
  if ($failed) { $script:NextFirewallReconcileMs = $Now + 15000L }
  $script:FirewallBlocked = $BlockedSids.Count -gt 0
}

function Test-RequestOrigin($Context) {
  $origin = [string]$Context.Request.Headers['Origin']
  if ([string]::IsNullOrWhiteSpace($origin)) { return $true }
  return $origin -match '^chrome-extension://[a-p]{32}$'
}

function Get-RequestUserSid($Context) {
  try {
    Initialize-Native
    $processId = [LockIn.Native]::LoopbackClientProcessId([int]$Context.Request.RemoteEndPoint.Port, $Port)
    if ($processId -le 0) { return '' }
    # Is the sending browser in the session that is actually in front? With
    # fast user switching, the other account's browser keeps running (and
    # reporting) behind the lock screen. An unreadable state counts as active.
    try {
      $sessionId = ([Diagnostics.Process]::GetProcessById($processId)).SessionId
      $script:CurrentRequestSessionActive = [LockIn.Native]::SessionState($sessionId) -in @(0, -1)
    } catch { $script:CurrentRequestSessionActive = $true }
    return Get-ProcessOwnerSid $processId
  } catch {
    Write-WatchdogLog "Could not identify loopback client SID: $($_.Exception.Message)"
    return ''
  }
}

function Test-ProtectedAccountRequest($Context, $Request) {
  $script:CurrentRequestUserSid = ''
  $script:CurrentRequestSessionActive = $true
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
  Request-Save
}

function Apply-BrowserAllowPolicy([string]$Browser, [string[]]$Domains) {
  if ($TestMode) { return }
  $path = $allowPolicyPaths[$Browser]
  if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null }
  $key = Get-Item -LiteralPath $path
  $previous = @($script:State.ownedAllowPolicyValues.$Browser)
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
    if ($candidate -gt 1000) { throw 'Chrome URLAllowlist has no free policy slots.' }
    $name = [string]$candidate
    New-ItemProperty -LiteralPath $path -Name $name -Value $domain -PropertyType String -Force | Out-Null
    $occupied += $name
    $owned += [pscustomobject]@{ name = $name; value = $domain }
    $candidate++
  }
  $script:State.ownedAllowPolicyValues.$Browser = @($owned)
  Request-Save
}

function Test-OwnedPoliciesCurrent([string[]]$Domains) {
  if ($TestMode) { return $true }
  foreach ($browser in $policyPaths.Keys) {
    $path = $policyPaths[$browser]
    $owned = @($script:State.ownedPolicyValues.$browser)
    if ($owned.Count -ne $Domains.Count) { return $false }
    if ($owned.Count -eq 0) { continue }
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    $key = Get-Item -LiteralPath $path
    foreach ($entry in $owned) {
      $current = $key.GetValue([string]$entry.name, $null)
      if ($current -isnot [string] -or $current -ne [string]$entry.value) { return $false }
    }
  }
  return $true
}

function Test-OwnedAllowPoliciesCurrent([string[]]$Domains) {
  if ($TestMode) { return $true }
  foreach ($browser in $allowPolicyPaths.Keys) {
    $path = $allowPolicyPaths[$browser]
    $owned = @($script:State.ownedAllowPolicyValues.$browser)
    if ($owned.Count -ne $Domains.Count) { return $false }
    if ($owned.Count -eq 0) { continue }
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    $key = Get-Item -LiteralPath $path
    foreach ($entry in $owned) {
      $current = $key.GetValue([string]$entry.name, $null)
      if ($current -isnot [string] -or $current -ne [string]$entry.value) { return $false }
    }
  }
  return $true
}

function Apply-Policies([string[]]$Domains, [string[]]$AllowedDomains) {
  $fingerprint = ($Domains -join "`n") + "`n---ALLOW---`n" + ($AllowedDomains -join "`n")
  if ($script:LastPolicyFingerprint -ceq $fingerprint -and (Test-OwnedPoliciesCurrent $Domains) -and (Test-OwnedAllowPoliciesCurrent $AllowedDomains)) { return }
  foreach ($browser in $policyPaths.Keys) {
    Apply-BrowserPolicy $browser $Domains
    Apply-BrowserAllowPolicy $browser $AllowedDomains
  }
  $script:LastPolicyFingerprint = $fingerprint
}

function Evaluate-Enforcement([long]$Now) {
  Update-DisarmExpiry $Now
  $domains = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  $reasons = New-Object 'System.Collections.Generic.List[string]'
  $script:FailClosedActive = $false
  $missingSids = @()
  $enabledGroups = @($script:State.groups | Where-Object { $_.enabled -eq $true })
  $blockingGroups = @()

  if ($script:State.enforcementArmed -eq $true) {
    foreach ($group in $enabledGroups) {
      if (Test-WithinSchedule $group.schedule $Now) {
        $blockingGroups += $group
        foreach ($domain in @($group.domains)) { [void]$domains.Add([string]$domain) }
        if (-not $reasons.Contains('schedule')) { $reasons.Add('schedule') }
      } elseif ($null -ne $group.limit -and (Get-RemainingMs $group $Now) -le 0) {
        $blockingGroups += $group
        foreach ($domain in @($group.domains)) { [void]$domains.Add([string]$domain) }
        if (-not $reasons.Contains('allowance spent')) { $reasons.Add('allowance spent') }
      }
    }

    $runningUserSids = @(Get-RunningProtectedUserSids $Now)
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
        $accountName = if ($script:ProtectedAccounts.Contains($runningUserSid)) {
          [string]$script:ProtectedAccounts[$runningUserSid]
        } elseif ($runningUserSid -eq '__unknown__') {
          'unverified browser owner'
        } else { 'browser' }
        $missingAccounts += ($accountName -split '\\')[-1]
        # Only a known protected account can be cut off on its own; an owner
        # that could not be verified cuts off every protected account.
        $missingSids += if ($script:ProtectedAccounts.Contains($runningUserSid)) { $runningUserSid } else { '*' }
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
  $allowed = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  if (-not $script:FailClosedActive) {
    foreach ($group in $blockingGroups) {
      foreach ($exception in @($group.exceptions)) {
        $conflict = $false
        foreach ($otherGroup in $blockingGroups) {
          if ($otherGroup.id -eq $group.id) { continue }
          foreach ($otherRule in @($otherGroup.domains)) {
            if (Test-SiteMatches ("https://$exception") ([string]$otherRule)) { $conflict = $true; break }
          }
          if ($conflict) { break }
        }
        if (-not $conflict) { [void]$allowed.Add([string]$exception) }
      }
    }
  }
  $script:AllowedDomains = @($allowed | Sort-Object)
  if ($script:State.enforcementArmed -ne $true) { $script:EnforcementReason = 'not armed' }
  elseif ($reasons.Count -eq 0) { $script:EnforcementReason = 'open' }
  else { $script:EnforcementReason = $reasons -join ', ' }
  Apply-Policies @($script:BlockedDomains | ForEach-Object { ConvertTo-PolicyFilter $_ } | Where-Object { $_ }) @($script:AllowedDomains | ForEach-Object { ConvertTo-PolicyFilter $_ } | Where-Object { $_ })
  $blockedSids = if ($script:FailClosedActive) { @($missingSids) } else { @() }
  Set-FirewallBlocked $blockedSids $Now
}

# $SensorKey scopes the "ticking now" hint to the account asking, so each
# dashboard counts down only for what its own browser is showing.
function Get-Snapshot([long]$Now, [string]$SensorKey = '') {
  $watching = @(Get-WatchingSensors $Now)
  if ($SensorKey) { $watching = @($watching | Where-Object { $_.key -eq $SensorKey }) }
  $ticking = @(Get-TickingGroupIds $watching $Now)
  $sensors = @(foreach ($sid in @($script:ProtectedAccounts.Keys)) {
    $sensor = $script:Sensors[$sid]
    [pscustomobject][ordered]@{
      account = ([string]$script:ProtectedAccounts[$sid] -split '\\')[-1]
      lastHeartbeatMs = if ($sensor) { [long]$sensor.heartbeatMs } else { 0L }
      activeSession = [bool]($sensor -and $sensor.active)
      browserRunning = @($script:RunningProtectedUserSids) -contains $sid
    }
  })
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
    groups = @($script:State.groups | Where-Object { $null -ne $_ })
    usage = $script:State.usage
    usageSession = $session
    lockMode = $script:State.lockMode -eq $true
    privacyConsent = $script:State.privacyConsent -eq $true
    supportsUrlRules = $true
    supportsExceptions = $true
    supportsTimedDisarm = $true
    blockedDomains = @($script:BlockedDomains)
    allowedDomains = @($script:AllowedDomains)
    enforcementReason = $script:EnforcementReason
    protectedWindowsAccount = (@($script:ProtectedAccounts.Values) -join ', ')
    protectedWindowsAccounts = @($script:ProtectedAccounts.Values)
    sensors = $sensors
  }
}

function Handle-Request($Request, [string]$RequestUserSid = '') {
  $now = Get-NowMs
  switch ([string]$Request.type) {
    'bootstrap' {
      if ($script:State.configured -ne $true) {
        $script:State.groups = @(Normalize-Groups $Request.payload.groups)
        if ($null -ne $Request.payload.usage) { $script:State.usage = $Request.payload.usage }
        $script:State.lockMode = $Request.payload.lockMode -eq $true
        $script:State.privacyConsent = $Request.payload.privacyConsent -eq $true
        $script:State.configured = $true
        Request-Save
      }
      $script:State.lastSampleMs = $now
    }
    'updateConfig' {
      Add-ElapsedUsage $now
      $script:State.groups = @(Normalize-Groups $Request.payload.groups)
      $script:State.lockMode = $Request.payload.lockMode -eq $true
      $script:State.privacyConsent = $Request.payload.privacyConsent -eq $true
      $script:State.configured = $true
      Request-Save
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
      $script:Sensors[$sensorKey] = [pscustomobject]@{
        key = $sensorKey
        host = Normalize-Domain ([string]$Request.payload.host)
        url = [string]$Request.payload.url
        focused = $Request.payload.focused -eq $true
        active = $TestMode -or $script:CurrentRequestSessionActive -ne $false
        heartbeatMs = $now
      }
      if ($script:State.configured -eq $true -and $script:State.enforcementArmed -ne $true -and [int]$script:ConsecutiveHeartbeatsBySid[$sensorKey] -ge 3) {
        $script:State.enforcementArmed = $true
        Request-Save
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
      $script:Sensors.Clear()
      $script:ConsecutiveHeartbeatsBySid.Clear()
      $script:SensorHeartbeatMsBySid.Clear()
      Request-Save
    }
    'disarm' {
      $script:State.enforcementArmed = $false
      $script:ConsecutiveHeartbeatsBySid.Clear()
      Request-Save
    }
    default { throw "Unknown request type: $($Request.type)" }
  }
  # The request itself has been applied. If enforcement cannot be brought up
  # to date this instant, the main loop retries in a moment; the sensor must
  # still get its answer, or it would report a disconnect that never happened.
  try { Evaluate-Enforcement $now }
  catch { Write-WatchdogLog "Enforcement after $($Request.type) failed: $($_.Exception.Message)" }
  Save-State
  $sensorKey = if ([string]::IsNullOrWhiteSpace($RequestUserSid)) { '__legacy__' } else { $RequestUserSid }
  return Get-Snapshot $now $sensorKey
}

function Write-JsonResponse($Context, [int]$StatusCode, $Body) {
  # The client may already have given up on this request. A response nobody
  # reads is not a watchdog failure, so nothing here is allowed to throw.
  try {
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
  } catch {
    Write-WatchdogLog "Could not answer a request: $($_.Exception.Message)"
  } finally {
    try { $Context.Response.Close() } catch { }
  }
}

function Invoke-HttpRequest($Context) {
  try {
    if (-not (Test-RequestOrigin $Context)) {
      Write-JsonResponse $Context 403 ([pscustomobject]@{ ok = $false; error = 'Only a Chrome extension origin may use this endpoint.' })
      return
    }
    if ($Context.Request.HttpMethod -eq 'OPTIONS') { Write-JsonResponse $Context 204 $null; return }
    if ($Context.Request.HttpMethod -eq 'GET' -and $Context.Request.Url.AbsolutePath -eq '/health') {
      Write-JsonResponse $Context 200 ([pscustomobject]@{ ok = $true; data = Get-Snapshot (Get-NowMs) })
      return
    }
    if ($Context.Request.HttpMethod -ne 'POST' -or $Context.Request.Url.AbsolutePath -ne '/api/request') {
      Write-JsonResponse $Context 404 ([pscustomobject]@{ ok = $false; error = 'Not found' })
      return
    }
    $reader = [IO.StreamReader]::new($Context.Request.InputStream, $Context.Request.ContentEncoding)
    try { $request = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if (-not (Test-ProtectedAccountRequest $Context $request)) {
      Write-JsonResponse $Context 403 ([pscustomobject]@{ ok = $false; error = 'This Windows account is not the protected Lock In sensor.' })
      return
    }
    $data = Handle-Request $request $script:CurrentRequestUserSid
    Write-JsonResponse $Context 200 ([pscustomobject]@{ ok = $true; requestId = $request.requestId; data = $data })
  } catch {
    Write-WatchdogLog "Request failed: $($_.Exception.Message)"
    Write-JsonResponse $Context 400 ([pscustomobject]@{ ok = $false; error = $_.Exception.Message })
  }
}

function Start-Listener {
  $listener = [Net.HttpListener]::new()
  $listener.Prefixes.Add("http://127.0.0.1:$Port/")
  $listener.Start()
  return $listener
}

function Stop-Listener($Listener) {
  if ($null -eq $Listener) { return }
  try { if ($Listener.IsListening) { $Listener.Stop() } } catch { }
  try { $Listener.Close() } catch { }
}

# One pass of the enforcement engine. Everything it calls is cheap on the
# common path; the slow system queries run on their own cadences.
function Invoke-EnforcementPass {
  $now = Get-NowMs
  # A sleeping or hibernating machine resumes with every clock jumped forward.
  # Without this, the sensor would be declared missing the instant the machine
  # wakes, before the browser has had a chance to send a single heartbeat.
  if ($script:LastLoopMs -gt 0 -and ($now - $script:LastLoopMs) -gt 15000) {
    Write-WatchdogLog "Clock jumped $([long](($now - $script:LastLoopMs) / 1000)) s (sleep or resume); restarting sensor grace periods."
    foreach ($key in @($script:BrowserSeenAtMsBySid.Keys)) { $script:BrowserSeenAtMsBySid[$key] = $now }
    $script:NextBrowserProbeMs = 0L
  }
  $script:LastLoopMs = $now
  Add-ElapsedUsage $now
  Evaluate-Enforcement $now
  Save-State
}

New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
if (Test-Path -LiteralPath $statePath) {
  try { $script:State = Ensure-StateShape (Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json) }
  catch { Write-WatchdogLog "State load failed, starting safely disarmed: $($_.Exception.Message)"; $script:State = New-DefaultState }
} else { $script:State = New-DefaultState }
Request-Save
Initialize-Native
try { Register-InstalledBrowsers } catch { Write-WatchdogLog "Could not look for installed browsers: $($_.Exception.Message)" }

# The watchdog must outlive any single failure: a registry hiccup, a firewall
# cmdlet timing out, a client hanging up mid-response, or even the listener
# itself dying. Each is logged and the loop carries on; only the process being
# killed stops it, and the scheduled task brings it back from that.
$listener = $null
$pending = $null
$announced = $false
try {
  while ($true) {
    try { Invoke-EnforcementPass }
    catch { Write-WatchdogLog "Enforcement pass failed: $($_.Exception.Message)" }

    try {
      if ($null -eq $listener -or -not $listener.IsListening) {
        Stop-Listener $listener
        $pending = $null
        $listener = Start-Listener
        Write-WatchdogLog "Watchdog listening on loopback port $Port."
        if (-not $announced) { Write-Output 'LOCKIN_WATCHDOG_READY'; $announced = $true }
      }
      if ($null -eq $pending) { $pending = $listener.GetContextAsync() }
      if (-not $pending.Wait([Math]::Max(50, $EvaluationIntervalMilliseconds))) { continue }
      $context = $pending.Result
      $pending = $listener.GetContextAsync()
      Invoke-HttpRequest $context
    } catch {
      Write-WatchdogLog "Listener failed, restarting it: $($_.Exception.Message)"
      Stop-Listener $listener
      $listener = $null
      $pending = $null
      Start-Sleep -Milliseconds 1000
    }
  }
} finally {
  Save-State -Force
  Stop-Listener $listener
}
