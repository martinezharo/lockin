using System.Text.Json;
using LockIn.Engine.Models;
using LockIn.Engine.Platform;
using LockIn.Engine.Protocol;
using LockIn.Engine.Rules;

namespace LockIn.Engine.Engine;

/// <summary>What the rule engine decided this pass; side effects are applied separately.</summary>
public sealed class EnforcementDecision
{
    public List<string> BlockedDomains { get; init; } = new();
    public List<string> AllowedDomains { get; init; } = new();
    public List<string> BlockedApps { get; init; } = new();
    public List<string> NetworkBlockedApps { get; init; } = new();
    public List<string> MissingSids { get; init; } = new();
    public bool FailClosedActive { get; init; }
}

public sealed class UsageSessionSnapshot
{
    public List<string> GroupIds { get; init; } = new();
    public long StartedAt { get; init; }
}

public sealed class SensorSnapshot
{
    public string Account { get; init; } = "";
    public long LastHeartbeatMs { get; init; }
    public bool ActiveSession { get; init; }
    public bool BrowserRunning { get; init; }
    public long UiaLastHeartbeatMs { get; init; }
    public string ForegroundExe { get; init; } = "";
    public string ForegroundHost { get; init; } = "";
}

public sealed class Snapshot
{
    public bool Connected { get; init; } = true;
    public bool Configured { get; init; }
    public bool EnforcementArmed { get; init; }
    public bool FailClosed { get; init; }
    public bool FailClosedActive { get; init; }
    public bool FirewallBlocked { get; init; }
    public int HeartbeatTimeoutSeconds { get; init; }
    public long LastHeartbeatMs { get; init; }
    public List<Group> Groups { get; init; } = new();
    public Dictionary<string, UsageEntry> Usage { get; init; } = new();
    public UsageSessionSnapshot? UsageSession { get; init; }
    public bool LockMode { get; init; }
    public bool PrivacyConsent { get; init; }
    public bool SupportsUrlRules { get; init; } = true;
    public bool SupportsExceptions { get; init; } = true;
    public bool SupportsTimedDisarm { get; init; } = true;
    public bool SupportsAppZones { get; init; } = true;
    public List<string> BlockedDomains { get; init; } = new();
    public List<string> AllowedDomains { get; init; } = new();
    public List<string> BlockedApps { get; init; } = new();
    public string EnforcementReason { get; init; } = "not armed";
    public string ProtectedWindowsAccount { get; init; } = "";
    public List<string> ProtectedWindowsAccounts { get; init; } = new();
    public List<SensorSnapshot> Sensors { get; init; } = new();
}

/// <summary>
/// The authoritative rule engine: zones, usage, schedules, allowances,
/// fail-closed and the state file. It is an exact port of the PowerShell
/// watchdog's decisions; everything slow (registry, firewall, process probing)
/// sits behind an interface and runs off the request path.
/// </summary>
public sealed class WatchdogEngine
{
    private static readonly string[] BrowserExecutables = { "chrome.exe", "brave.exe", "msedge.exe", "firefox.exe" };

    private sealed class ExtensionSensor
    {
        public string Key = "";
        public string Host = "";
        public string Url = "";
        public bool Focused;
        public bool Active;
        public long HeartbeatMs;
    }

    private sealed class UiaSensor
    {
        public string Key = "";
        public string Host = "";
        public string Url = "";
        public bool Focused;
        public bool Active;
        public long HeartbeatMs;
        public string ForegroundExe = "";
        public string ForegroundPath = "";
    }

    private sealed class SideEffectPlan
    {
        public List<string> BlockedPolicy { get; init; } = new();
        public List<string> AllowedPolicy { get; init; } = new();
        public string Fingerprint { get; init; } = "";
        public List<string> BlockedSids { get; init; } = new();
        public List<string> NetworkBlockedApps { get; init; } = new();
        public List<string> BrowserPaths { get; init; } = new();
        public List<string> AppPaths { get; init; } = new();
        public long NextFirewallReconcileAtMs { get; init; }
    }

    private readonly object _gate = new();
    private readonly object _sideEffectGate = new();
    private readonly EngineOptions _options;
    private readonly IClock _clock;
    private readonly INativeProbe _probe;
    private readonly IRegistryPolicyStore _policy;
    private readonly IFirewallController _firewall;
    private readonly IProcessLauncher _launcher;
    private readonly IStateStore _stateStore;
    private readonly FileLog _log;

    private readonly Dictionary<string, int> _consecutiveHeartbeatsBySid = new(StringComparer.Ordinal);
    private readonly Dictionary<string, long> _browserSeenAtMsBySid = new(StringComparer.Ordinal);
    private readonly Dictionary<string, long> _sensorHeartbeatMsBySid = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ExtensionSensor> _sensors = new(StringComparer.Ordinal);
    private readonly Dictionary<string, UiaSensor> _uiaSensors = new(StringComparer.Ordinal);

    private WatchdogState _state;
    private List<string> _blockedDomains = new();
    private List<string> _allowedDomains = new();
    private List<string> _blockedApps = new();
    private string _enforcementReason = "not armed";
    private bool _failClosedActive;
    private bool _firewallBlocked;
    private string? _firewallKey;
    private bool _firewallRulesStale = true;
    private string? _lastPolicyFingerprint;
    private bool _dirty;
    private bool _saveUrgent;
    private long _lastSaveMs;
    private List<string> _runningProtectedUserSids = new();
    private bool _browserOwnerLookupFailed;
    private long _nextBrowserProbeMs;
    private long _nextFirewallReconcileMs;
    private long _lastLoopMs;
    private long _lastAppRelaunchMs;
    private long _lastSaveAttemptMs;

    public WatchdogEngine(
        EngineOptions options,
        IClock clock,
        INativeProbe probe,
        IRegistryPolicyStore policy,
        IFirewallController firewall,
        IStateStore stateStore,
        FileLog log,
        IProcessLauncher? launcher = null)
    {
        _options = options;
        _clock = clock;
        _probe = probe;
        _policy = policy;
        _firewall = firewall;
        _stateStore = stateStore;
        _log = log;
        _launcher = launcher ?? new NullProcessLauncher();
        _state = LoadState();
        _state.EnsureShape(options.HeartbeatTimeoutSeconds);
        if (options.ProtectedAccounts.Count > 0)
        {
            // A protected-account list exists, so map it over the state.
            foreach (var account in options.ProtectedAccounts)
            {
                if (!_protectedAccounts.ContainsKey(account.Sid))
                {
                    _protectedAccounts[account.Sid] = account.DisplayName;
                }
            }
        }
        RequestSave();
        if (!options.TestMode && options.ScanInstalledBrowsers)
        {
            try
            {
                RegisterInstalledBrowsers();
            }
            catch (Exception error)
            {
                _log.Write($"Could not look for installed browsers: {error.Message}");
            }
        }
    }

    private readonly Dictionary<string, string> _protectedAccounts = new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyDictionary<string, string> ProtectedAccounts
    {
        get
        {
            lock (_gate) return new Dictionary<string, string>(_protectedAccounts, StringComparer.OrdinalIgnoreCase);
        }
    }

    public long NowMs => _clock.NowMs;

    public WatchdogState StateSnapshot()
    {
        lock (_gate) return _state;
    }

    private WatchdogState LoadState()
    {
        try
        {
            var loaded = _stateStore.Load();
            if (loaded is not null) return loaded;
        }
        catch (Exception error)
        {
            _log.Write($"State load failed, starting safely disarmed: {error.Message}");
        }
        return new WatchdogState
        {
            HeartbeatTimeoutSeconds = _options.HeartbeatTimeoutSeconds,
            LastHeartbeatMs = 0,
            LastSampleMs = 0
        };
    }

    private void RequestSave()
    {
        _dirty = true;
        _saveUrgent = true;
    }

    private void SaveState(bool force = false)
    {
        if (!_dirty) return;
        var now = _clock.NowMs;
        if (!force && !_saveUrgent && now - _lastSaveMs < _options.SaveIntervalMs) return;
        _lastSaveAttemptMs = now;
        try
        {
            var copy = CloneForSave();
            _stateStore.Save(copy);
            _dirty = false;
            _saveUrgent = false;
        }
        catch (Exception error)
        {
            _log.Write($"Could not save state (will retry): {error.Message}");
        }
        _lastSaveMs = now;
    }

    private WatchdogState CloneForSave()
    {
        // Serializing under the lock and writing outside it keeps a slow disk
        // from holding the request path. Handing the store a snapshot object
        // also means a concurrent request cannot mutate a state being written.
        var json = JsonSerializer.Serialize(_state, JsonHelpers.Protocol);
        return JsonSerializer.Deserialize<WatchdogState>(json, JsonHelpers.Protocol)!;
    }

    public void SaveForced() => SaveState(force: true);

    /* ------------------------------------------------------------------ */
    /* Request handling                                                    */
    /* ------------------------------------------------------------------ */

    public Snapshot HandleRequest(RequestEnvelope request, string requestUserSid, bool sessionActive)
    {
        var now = _clock.NowMs;
        var type = request.Type ?? "";
        lock (_gate)
        {
            switch (type)
            {
                case "bootstrap":
                    if (!_state.Configured)
                    {
                        _state.Groups = SiteRules.NormalizeGroups(ReadGroups(request.Payload));
                        if (JsonHelpers.TryGet(request.Payload, "usage", out var usage) && usage.ValueKind == JsonValueKind.Object)
                        {
                            _state.Usage = DeserializeUsage(usage);
                        }
                        _state.LockMode = request.Payload.Bool("lockMode");
                        _state.PrivacyConsent = request.Payload.Bool("privacyConsent");
                        _state.Configured = true;
                        RequestSave();
                    }
                    _state.LastSampleMs = now;
                    break;
                case "updateConfig":
                    AddElapsedUsage(now);
                    _state.Groups = SiteRules.NormalizeGroups(ReadGroups(request.Payload));
                    _state.LockMode = request.Payload.Bool("lockMode");
                    _state.PrivacyConsent = request.Payload.Bool("privacyConsent");
                    _state.Configured = true;
                    RequestSave();
                    break;
                case "heartbeat":
                    HandleExtensionHeartbeat(request, requestUserSid, sessionActive, now);
                    break;
                case "appHeartbeat":
                    HandleAppHeartbeat(request, requestUserSid, sessionActive, now);
                    break;
                case "getState":
                    AddElapsedUsage(now);
                    break;
                case "clearData":
                    _state.Groups = new List<Group>();
                    _state.Usage = new Dictionary<string, UsageEntry>();
                    _state.LockMode = false;
                    _state.PrivacyConsent = false;
                    _state.Configured = false;
                    _state.EnforcementArmed = false;
                    _state.LastHeartbeatMs = now;
                    _state.LastSampleMs = now;
                    _sensors.Clear();
                    _uiaSensors.Clear();
                    _consecutiveHeartbeatsBySid.Clear();
                    _sensorHeartbeatMsBySid.Clear();
                    RequestSave();
                    break;
                case "disarm":
                    _state.EnforcementArmed = false;
                    _consecutiveHeartbeatsBySid.Clear();
                    RequestSave();
                    break;
                default:
                    throw new InvalidOperationException($"Unknown request type: {type}");
            }

            try
            {
                Evaluate(now);
            }
            catch (Exception error)
            {
                _log.Write($"Enforcement after {type} failed: {error.Message}");
            }
            SaveState();
            var sensorKey = string.IsNullOrWhiteSpace(requestUserSid) ? "__legacy__" : requestUserSid;
            return BuildSnapshotLocked(now, sensorKey);
        }
    }

    private static List<Group?> ReadGroups(JsonElement payload)
    {
        if (!JsonHelpers.TryGet(payload, "groups", out var groups) || groups.ValueKind != JsonValueKind.Array)
        {
            return new List<Group?>();
        }
        return JsonSerializer.Deserialize<List<Group?>>(groups.GetRawText(), JsonHelpers.Protocol) ?? new List<Group?>();
    }

    private static Dictionary<string, UsageEntry> DeserializeUsage(JsonElement usage)
    {
        return JsonSerializer.Deserialize<Dictionary<string, UsageEntry>>(usage.GetRawText(), JsonHelpers.Protocol)
            ?? new Dictionary<string, UsageEntry>();
    }

    private void HandleExtensionHeartbeat(RequestEnvelope request, string requestUserSid, bool sessionActive, long now)
    {
        AddElapsedUsage(now);
        var sensorKey = string.IsNullOrWhiteSpace(requestUserSid) ? "__legacy__" : requestUserSid;
        var previous = _sensorHeartbeatMsBySid.TryGetValue(sensorKey, out var last) ? last : 0L;
        if (previous == 0 || now - previous > (long)_state.HeartbeatTimeoutSeconds * 2000L)
        {
            _consecutiveHeartbeatsBySid[sensorKey] = 0;
        }
        _consecutiveHeartbeatsBySid[sensorKey] = _consecutiveHeartbeatsBySid.TryGetValue(sensorKey, out var count) ? count + 1 : 1;
        _sensorHeartbeatMsBySid[sensorKey] = now;
        _state.LastHeartbeatMs = now;
        _sensors[sensorKey] = new ExtensionSensor
        {
            Key = sensorKey,
            Host = SiteRules.NormalizeDomain(request.Payload.String("host")),
            Url = request.Payload.String("url"),
            Focused = request.Payload.Bool("focused"),
            Active = _options.TestMode || sessionActive,
            HeartbeatMs = now
        };
        TryArm(sensorKey);
        _dirty = true;
    }

    private void HandleAppHeartbeat(RequestEnvelope request, string requestUserSid, bool sessionActive, long now)
    {
        AddElapsedUsage(now);
        var sensorKey = string.IsNullOrWhiteSpace(requestUserSid) ? "__legacy__" : requestUserSid;
        var exe = SiteRules.NormalizeAppTarget(request.Payload.String("foregroundExe"));
        var path = request.Payload.String("foregroundExePath");
        _state.LastHeartbeatMs = now;
        _uiaSensors[sensorKey] = new UiaSensor
        {
            Key = sensorKey,
            Host = SiteRules.NormalizeDomain(request.Payload.String("host")),
            Url = request.Payload.String("url"),
            Focused = request.Payload.Bool("focused"),
            Active = _options.TestMode || sessionActive,
            HeartbeatMs = now,
            ForegroundExe = exe,
            ForegroundPath = path
        };
        if (path.Length > 0) RegisterAppPath(path);
        // The UIA reports count toward arming, but they must never refresh the
        // extension heartbeat: fail-closed has to keep seeing a missing
        // extension exactly as it always did.
        var previous = _sensorHeartbeatMsBySid.TryGetValue(sensorKey, out var last) ? last : 0L;
        if (previous == 0 || now - previous > (long)_state.HeartbeatTimeoutSeconds * 2000L)
        {
            _consecutiveHeartbeatsBySid[sensorKey] = 0;
        }
        _consecutiveHeartbeatsBySid[sensorKey] = _consecutiveHeartbeatsBySid.TryGetValue(sensorKey, out var count) ? count + 1 : 1;
        TryArm(sensorKey);
        _dirty = true;
    }

    private void TryArm(string sensorKey)
    {
        if (_state.Configured && !_state.EnforcementArmed &&
            _consecutiveHeartbeatsBySid.TryGetValue(sensorKey, out var count) && count >= 3)
        {
            _state.EnforcementArmed = true;
            RequestSave();
        }
    }

    /* ------------------------------------------------------------------ */
    /* The enforcement loop                                                */
    /* ------------------------------------------------------------------ */

    /// <summary>One pass of the engine. <paramref name="allowSideEffects"/> is false in tests that only inspect decisions.</summary>
    public void EnforcementPass()
    {
        EnforcementDecision decision;
        SideEffectPlan plan;
        long now;
        lock (_gate)
        {
            now = _clock.NowMs;
            if (_lastLoopMs > 0 && now - _lastLoopMs > _options.ClockJumpThresholdMs)
            {
                _log.Write($"Clock jumped {(now - _lastLoopMs) / 1000} s (sleep or resume); restarting sensor grace periods.");
                foreach (var key in _browserSeenAtMsBySid.Keys.ToList()) _browserSeenAtMsBySid[key] = now;
                _nextBrowserProbeMs = 0;
            }
            _lastLoopMs = now;
            AddElapsedUsage(now);
            decision = Evaluate(now);
            SaveState();
            plan = BuildPlan(decision, now);
        }
        ApplySideEffects(plan, now);
        RelaunchAppIfNeeded(now);
    }

    private SideEffectPlan BuildPlan(EnforcementDecision decision, long now)
    {
        return new SideEffectPlan
        {
            BlockedPolicy = decision.BlockedDomains
                .Select(SiteRules.PolicyFilter)
                .Where(rule => rule.Length > 0)
                .ToList(),
            AllowedPolicy = decision.AllowedDomains
                .Select(SiteRules.PolicyFilter)
                .Where(rule => rule.Length > 0)
                .ToList(),
            Fingerprint = string.Join("\n", decision.BlockedDomains) + "\n---ALLOW---\n" + string.Join("\n", decision.AllowedDomains),
            BlockedSids = decision.FailClosedActive ? decision.MissingSids : new List<string>(),
            NetworkBlockedApps = decision.NetworkBlockedApps,
            BrowserPaths = _state.BrowserPaths.ToList(),
            AppPaths = _state.AppPaths.ToList(),
            NextFirewallReconcileAtMs = _nextFirewallReconcileMs
        };
    }

    private void ApplySideEffects(SideEffectPlan plan, long now)
    {
        if (!Monitor.TryEnter(_sideEffectGate)) return;
        try
        {
            ApplyPolicies(plan);
            ApplyFirewall(plan, now);
        }
        finally
        {
            Monitor.Exit(_sideEffectGate);
        }
    }

    private void ApplyPolicies(SideEffectPlan plan)
    {
        var upToDate = _lastPolicyFingerprint == plan.Fingerprint;
        if (upToDate)
        {
            foreach (var browser in WatchdogState.PolicyBrowsers)
            {
                if (!_policy.OwnedCurrent(browser, false, _state.OwnedPolicyValues[browser], plan.BlockedPolicy.Count) ||
                    !_policy.OwnedCurrent(browser, true, _state.OwnedAllowPolicyValues[browser], plan.AllowedPolicy.Count))
                {
                    upToDate = false;
                    break;
                }
            }
        }
        if (upToDate) return;

        try
        {
            foreach (var browser in WatchdogState.PolicyBrowsers)
            {
                var owned = _policy.Apply(browser, false, plan.BlockedPolicy, _state.OwnedPolicyValues[browser]);
                var ownedAllow = _policy.Apply(browser, true, plan.AllowedPolicy, _state.OwnedAllowPolicyValues[browser]);
                lock (_gate)
                {
                    _state.OwnedPolicyValues[browser] = owned;
                    _state.OwnedAllowPolicyValues[browser] = ownedAllow;
                }
            }
            _lastPolicyFingerprint = plan.Fingerprint;
            RequestSave();
            SaveState(force: true);
        }
        catch (Exception error)
        {
            _log.Write($"Could not write browser policy: {error.Message}");
        }
    }

    private static string FirewallRuleName(string path, string sid)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes($"{path.ToLowerInvariant()}|{sid}"));
        return "LockIn-" + Convert.ToHexString(bytes, 0, 8);
    }

    private void ApplyFirewall(SideEffectPlan plan, long now)
    {
        var blockedSids = plan.BlockedSids.Where(sid => !string.IsNullOrWhiteSpace(sid)).Distinct().OrderBy(sid => sid).ToList();
        var networkApps = plan.NetworkBlockedApps.Where(app => !string.IsNullOrWhiteSpace(app)).Distinct().OrderBy(app => app).ToList();
        var key = string.Join(",", blockedSids) + "|apps:" + string.Join(",", networkApps);
        var changed = key != _firewallKey;

        var ruleSids = _protectedAccounts.Count > 0
            ? _protectedAccounts.Keys.ToList()
            : new List<string> { "*" };
        var blockAll = blockedSids.Contains("*");
        var desired = new List<FirewallRuleSpec>();
        foreach (var path in plan.BrowserPaths.Where(path => !string.IsNullOrWhiteSpace(path)))
        {
            foreach (var sid in ruleSids)
            {
                var enabled = blockAll || blockedSids.Contains(sid);
                var account = sid == "*" ? "all accounts" : DisplayNameOf(sid);
                desired.Add(new FirewallRuleSpec(
                    FirewallRuleName(path, sid),
                    path,
                    sid == "*" ? null : sid,
                    enabled,
                    $"Lock In emergency block ({Path.GetFileNameWithoutExtension(path)}, {account})"));
            }
        }
        foreach (var app in networkApps)
        {
            var path = plan.AppPaths.FirstOrDefault(candidate =>
                string.Equals(Path.GetFileName(candidate), app, StringComparison.OrdinalIgnoreCase));
            if (path is null)
            {
                _log.Write($"No executable path is known for {app}; its network block cannot be applied yet.");
                continue;
            }
            foreach (var sid in ruleSids)
            {
                var account = sid == "*" ? "all accounts" : DisplayNameOf(sid);
                desired.Add(new FirewallRuleSpec(
                    FirewallRuleName(path, sid),
                    path,
                    sid == "*" ? null : sid,
                    true,
                    $"Lock In app block ({Path.GetFileNameWithoutExtension(path)}, {account})",
                    NetworkBlock: true));
            }
        }

        if (_options.TestMode)
        {
            if (changed) _log.Write($"Emergency browser firewall block: {(blockedSids.Count > 0 ? string.Join(",", blockedSids) : "none")}");
            lock (_gate)
            {
                _firewallKey = key;
                _firewallRulesStale = false;
                _firewallBlocked = blockedSids.Count > 0;
                _nextFirewallReconcileMs = now + _options.FirewallReconcileIntervalMs;
            }
            return;
        }

        if (!changed && !_firewallRulesStale && now < plan.NextFirewallReconcileAtMs) return;

        var result = _firewall.Reconcile(desired);
        if (result.PerAccountFallback || result.Warning is not null)
        {
            _log.Write(result.Warning ?? "Per-account firewall rules are unavailable; the block covers every protected account.");
        }
        if (result.Failed)
        {
            _log.Write("Firewall reconcile failed; retrying shortly.");
        }
        if (desired.Count == 0 && blockedSids.Count > 0)
        {
            _log.Write("No Brave or Chrome executable is known yet; the emergency firewall block has nothing to apply to.");
        }
        if (changed) _log.Write($"Emergency browser firewall block: {(blockedSids.Count > 0 ? string.Join(",", blockedSids) : "none")}");
        lock (_gate)
        {
            _firewallKey = key;
            _firewallRulesStale = false;
            _firewallBlocked = blockedSids.Count > 0;
            _nextFirewallReconcileMs = now + (result.Failed ? _options.FirewallRetryIntervalMs : _options.FirewallReconcileIntervalMs);
        }
    }

    private string DisplayNameOf(string sid) =>
        _protectedAccounts.TryGetValue(sid, out var name) ? name.Split('\\').Last() : sid;

    /// <summary>
    /// The app runs at logon through a machine Run entry; this is the belt to
    /// that braces, putting it back into an active session of a protected
    /// account when it has been killed.
    /// </summary>
    private void RelaunchAppIfNeeded(long now)
    {
        if (_options.TestMode || _options.AppExecutablePath is null) return;
        if (now - _lastAppRelaunchMs < 30000) return;
        _lastAppRelaunchMs = now;
        if (_protectedAccounts.Count == 0) return;
        if (!File.Exists(_options.AppExecutablePath)) return;
        try
        {
            var running = _probe.GetProcesses("LockIn.App");
            foreach (var session in _probe.GetActiveSessions())
            {
                if (!_protectedAccounts.ContainsKey(session.Sid)) continue;
                var alreadyRunning = running.Any(process => process.SessionId == session.SessionId);
                if (alreadyRunning) continue;
                if (_launcher.Launch(_options.AppExecutablePath, session.SessionId))
                {
                    _log.Write($"Started the Lock In app in session {session.SessionId}.");
                }
            }
        }
        catch (Exception error)
        {
            _log.Write($"Could not check for a running Lock In app: {error.Message}");
        }
    }

    /* ------------------------------------------------------------------ */
    /* Decisions                                                           */
    /* ------------------------------------------------------------------ */

    public EnforcementDecision Evaluate(long now)
    {
        UpdateDisarmExpiry(now);
        var domains = new HashSet<string>(StringComparer.Ordinal);
        var reasons = new List<string>();
        _failClosedActive = false;
        var missingSids = new List<string>();
        var enabledGroups = _state.Groups.Where(group => group.Enabled == true).ToList();
        var blockingGroups = new List<Group>();
        var localNow = ScheduleRules.LocalNow(now);

        if (_state.EnforcementArmed)
        {
            foreach (var group in enabledGroups)
            {
                if (ScheduleRules.IsWithinSchedule(group.Schedule, localNow))
                {
                    blockingGroups.Add(group);
                    foreach (var domain in group.Domains ?? new List<string>()) domains.Add(domain);
                    if (!reasons.Contains("schedule")) reasons.Add("schedule");
                }
                else if (group.Limit is not null && RemainingMs(group, now) <= 0)
                {
                    blockingGroups.Add(group);
                    foreach (var domain in group.Domains ?? new List<string>()) domains.Add(domain);
                    if (!reasons.Contains("allowance spent")) reasons.Add("allowance spent");
                }
            }

            var runningUserSids = GetRunningProtectedUserSids(now);
            var runningSet = new HashSet<string>(StringComparer.Ordinal);
            var missingAccounts = new List<string>();
            foreach (var runningSid in runningUserSids)
            {
                runningSet.Add(runningSid);
                if (!_browserSeenAtMsBySid.ContainsKey(runningSid)) _browserSeenAtMsBySid[runningSid] = now;
                var lastSensorHeartbeat = _sensorHeartbeatMsBySid.TryGetValue(runningSid, out var sensorMs) ? sensorMs : 0L;
                var graceStart = Math.Max(_browserSeenAtMsBySid[runningSid], lastSensorHeartbeat);
                if (enabledGroups.Count > 0 && graceStart > 0 &&
                    now - graceStart > (long)_state.HeartbeatTimeoutSeconds * 1000L)
                {
                    var accountName =
                        _protectedAccounts.TryGetValue(runningSid, out var name) ? name
                        : runningSid == "__unknown__" ? "unverified browser owner"
                        : "browser";
                    missingAccounts.Add(accountName.Split('\\').Last());
                    missingSids.Add(_protectedAccounts.ContainsKey(runningSid) ? runningSid : "*");
                }
            }
            foreach (var knownSid in _browserSeenAtMsBySid.Keys.ToList())
            {
                if (!runningSet.Contains(knownSid)) _browserSeenAtMsBySid.Remove(knownSid);
            }
            if (_state.FailClosed && missingAccounts.Count > 0)
            {
                foreach (var group in enabledGroups)
                {
                    foreach (var domain in group.Domains ?? new List<string>()) domains.Add(domain);
                }
                reasons.Add($"sensor missing: {string.Join(", ", missingAccounts)}");
                _failClosedActive = true;
            }
        }

        _blockedDomains = domains.OrderBy(domain => domain, StringComparer.Ordinal).ToList();

        var allowed = new HashSet<string>(StringComparer.Ordinal);
        if (!_failClosedActive)
        {
            foreach (var group in blockingGroups)
            {
                foreach (var exception in group.Exceptions ?? new List<string>())
                {
                    var conflict = false;
                    foreach (var otherGroup in blockingGroups)
                    {
                        if (otherGroup.Id == group.Id) continue;
                        foreach (var otherRule in otherGroup.Domains ?? new List<string>())
                        {
                            if (SiteRules.TestSiteMatches("https://" + exception, otherRule)) { conflict = true; break; }
                        }
                        if (conflict) break;
                    }
                    if (!conflict) allowed.Add(exception);
                }
            }
        }
        _allowedDomains = allowed.OrderBy(domain => domain, StringComparer.Ordinal).ToList();

        var blockedApps = new HashSet<string>(StringComparer.Ordinal);
        var networkBlockedApps = new HashSet<string>(StringComparer.Ordinal);
        if (_state.EnforcementArmed)
        {
            foreach (var group in enabledGroups)
            {
                if (!group.HasApps) continue;
                var blocked = _failClosedActive ||
                    ScheduleRules.IsWithinSchedule(group.Schedule, localNow) ||
                    (group.Limit is not null && RemainingMs(group, now) <= 0);
                if (!blocked) continue;
                foreach (var app in group.Apps!)
                {
                    blockedApps.Add(app);
                    if (group.BlockNetwork == true) networkBlockedApps.Add(app);
                }
            }
        }
        _blockedApps = blockedApps.OrderBy(app => app, StringComparer.Ordinal).ToList();

        _enforcementReason = _state.EnforcementArmed
            ? (reasons.Count == 0 ? "open" : string.Join(", ", reasons))
            : "not armed";

        return new EnforcementDecision
        {
            BlockedDomains = _blockedDomains,
            AllowedDomains = _allowedDomains,
            BlockedApps = _blockedApps,
            NetworkBlockedApps = networkBlockedApps.OrderBy(app => app, StringComparer.Ordinal).ToList(),
            MissingSids = missingSids,
            FailClosedActive = _failClosedActive
        };
    }

    private void UpdateDisarmExpiry(long now)
    {
        foreach (var group in _state.Groups)
        {
            if (group is null || group.Enabled == true) continue;
            if (group.DisarmedUntil is not { } until) continue;
            if (until <= 0 || now < until) continue;
            group.Enabled = true;
            group.DisarmedUntil = null;
            RequestSave();
            _log.Write($"Timed release expired; re-armed zone {group.Id}.");
        }
    }

    /* ------------------------------------------------------------------ */
    /* Usage                                                               */
    /* ------------------------------------------------------------------ */

    public UsageEntry? GetUsageEntry(string groupId, long now, bool create)
    {
        _state.Usage.TryGetValue(groupId, out var entry);
        var today = ScheduleRules.TodayKey(now);
        if (entry is not null && entry.Date == today) return entry;
        if (!create) return null;
        entry = new UsageEntry { Date = today, Ms = 0 };
        _state.Usage[groupId] = entry;
        return entry;
    }

    public long RemainingMs(Group group, long now)
    {
        if (group.Limit is null) return long.MaxValue;
        var entry = GetUsageEntry(group.Id ?? "", now, create: false);
        var used = Math.Max(0L, entry?.Ms ?? 0L);
        var limit = (long)(Math.Max(0d, group.Limit.Minutes) * 60000d);
        return Math.Max(0L, limit - used);
    }

    public List<Group> TickingGroups(string? host, string? url, long now)
    {
        var localNow = ScheduleRules.LocalNow(now);
        return _state.Groups.Where(group =>
            group.Enabled == true && group.Limit is not null &&
            !ScheduleRules.IsWithinSchedule(group.Schedule, localNow) &&
            RemainingMs(group, now) > 0 &&
            SiteRules.TestGroupMatchesHost(group, host, url ?? "")).ToList();
    }

    public List<Group> TickingAppGroups(string app, long now)
    {
        if (app.Length == 0) return new List<Group>();
        var localNow = ScheduleRules.LocalNow(now);
        return _state.Groups.Where(group =>
            group.Enabled == true && group.Limit is not null &&
            !ScheduleRules.IsWithinSchedule(group.Schedule, localNow) &&
            RemainingMs(group, now) > 0 &&
            (group.Apps ?? new List<string>()).Contains(app, StringComparer.Ordinal)).ToList();
    }

    public void AddElapsedUsage(long now)
    {
        var last = _state.LastSampleMs;
        _state.LastSampleMs = now;
        _dirty = true;
        if (last <= 0) return;
        var elapsed = Math.Min(Math.Max(0L, now - last), _options.UsageStaleMs);
        if (elapsed <= 0) return;
        foreach (var groupId in GetTickingGroupIds(now))
        {
            var entry = GetUsageEntry(groupId, now, create: true)!;
            entry.Ms += elapsed;
        }
    }

    private List<string> GetTickingGroupIds(long now)
    {
        var ids = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var sensor in _sensors.Values)
        {
            if (!sensor.Focused || !sensor.Active || string.IsNullOrWhiteSpace(sensor.Host)) continue;
            if (now - sensor.HeartbeatMs > _options.UsageStaleMs) continue;
            foreach (var group in TickingGroups(sensor.Host, sensor.Url, now))
            {
                if (seen.Add(group.Id ?? "")) ids.Add(group.Id ?? "");
            }
        }
        foreach (var sensor in _uiaSensors.Values)
        {
            if (!sensor.Focused || !sensor.Active) continue;
            if (now - sensor.HeartbeatMs > _options.UsageStaleMs) continue;
            var app = sensor.ForegroundExe;
            var isBrowser = BrowserExecutables.Contains(app, StringComparer.OrdinalIgnoreCase);
            if (isBrowser)
            {
                // The extension is the precise sensor for a browser it watches:
                // when its heartbeat is fresh for this account, UIA stays out.
                var extensionFresh = _sensorHeartbeatMsBySid.TryGetValue(sensor.Key, out var extensionMs) &&
                    now - extensionMs <= _options.UsageStaleMs;
                if (extensionFresh) continue;
                if (string.IsNullOrWhiteSpace(sensor.Host)) continue;
                foreach (var group in TickingGroups(sensor.Host, sensor.Url, now))
                {
                    if (seen.Add(group.Id ?? "")) ids.Add(group.Id ?? "");
                }
            }
            else if (app.Length > 0)
            {
                foreach (var group in TickingAppGroups(app, now))
                {
                    if (seen.Add(group.Id ?? "")) ids.Add(group.Id ?? "");
                }
            }
        }
        return ids;
    }

    /* ------------------------------------------------------------------ */
    /* Process probing                                                     */
    /* ------------------------------------------------------------------ */

    private List<string> GetRunningProtectedUserSids(long now)
    {
        if (_options.AssumeBrowserRunning)
        {
            return _protectedAccounts.Count > 0
                ? _protectedAccounts.Keys.ToList()
                : new List<string> { "__legacy__" };
        }
        if (now < _nextBrowserProbeMs) return _runningProtectedUserSids;
        _nextBrowserProbeMs = now + _options.BrowserProbeIntervalMs;
        _browserOwnerLookupFailed = false;

        var processes = _probe.GetBrowserProcesses();
        if (_protectedAccounts.Count == 0)
        {
            _runningProtectedUserSids = processes.Count > 0
                ? new List<string> { "__legacy__" }
                : new List<string>();
            return _runningProtectedUserSids;
        }

        var running = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var session in processes.GroupBy(process => process.SessionId))
        {
            foreach (var process in session)
            {
                var imagePath = _probe.GetProcessImagePath(process.Id);
                if (imagePath.Length > 0)
                {
                    RegisterBrowserPath(imagePath);
                    break;
                }
            }
            if (_probe.GetSessionState(session.Key) == 4) continue;
            var ownerSid = "";
            var liveLookupFailed = false;
            foreach (var process in session)
            {
                ownerSid = _probe.GetProcessOwnerSid(process.Id);
                if (!string.IsNullOrWhiteSpace(ownerSid)) break;
                if (_probe.IsProcessAlive(process.Id)) liveLookupFailed = true;
            }
            if (!string.IsNullOrWhiteSpace(ownerSid))
            {
                if (_protectedAccounts.ContainsKey(ownerSid)) running.Add(ownerSid);
            }
            else if (liveLookupFailed)
            {
                _browserOwnerLookupFailed = true;
            }
        }

        if (_browserOwnerLookupFailed)
        {
            running.Add("__unknown__");
            _log.Write("Could not verify the owner SID of at least one browser process; fail-closed protection will be used.");
        }
        _runningProtectedUserSids = running.OrderBy(sid => sid, StringComparer.Ordinal).ToList();
        return _runningProtectedUserSids;
    }

    private void RegisterBrowserPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        if (_state.BrowserPaths.Contains(path, StringComparer.OrdinalIgnoreCase)) return;
        _state.BrowserPaths.Add(path);
        _state.BrowserPaths.Sort(StringComparer.OrdinalIgnoreCase);
        _firewallRulesStale = true;
        RequestSave();
        _log.Write($"Learned browser executable {path}.");
    }

    private void RegisterAppPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        if (_state.AppPaths.Contains(path, StringComparer.OrdinalIgnoreCase)) return;
        _state.AppPaths.Add(path);
        _state.AppPaths.Sort(StringComparer.OrdinalIgnoreCase);
        _firewallRulesStale = true;
        RequestSave();
    }

    private void RegisterInstalledBrowsers()
    {
        var roots = new List<string?>
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)
        };
        try
        {
            using var profileList = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList");
            if (profileList is not null)
            {
                foreach (var name in profileList.GetSubKeyNames())
                {
                    if (!name.StartsWith("S-1-5-21-", StringComparison.Ordinal)) continue;
                    using var key = profileList.OpenSubKey(name);
                    if (key?.GetValue("ProfileImagePath") is string profilePath && profilePath.Length > 0)
                    {
                        roots.Add(Path.Combine(profilePath, @"AppData\Local"));
                    }
                }
            }
        }
        catch
        {
            // A locked-down registry read is not a reason to skip Program Files.
        }
        foreach (var root in roots.Where(root => !string.IsNullOrWhiteSpace(root)))
        {
            foreach (var relative in new[]
                     {
                         @"BraveSoftware\Brave-Browser\Application\brave.exe",
                         @"Google\Chrome\Application\chrome.exe"
                     })
            {
                var candidate = Path.Combine(root!, relative);
                if (File.Exists(candidate)) RegisterBrowserPath(candidate);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Snapshot                                                            */
    /* ------------------------------------------------------------------ */

    private Snapshot BuildSnapshotLocked(long now, string sensorKey)
    {
        var extensionWatching = _sensors.Values
            .Where(sensor => sensor.Focused && sensor.Active && !string.IsNullOrWhiteSpace(sensor.Host) &&
                now - sensor.HeartbeatMs <= _options.UsageStaleMs)
            .ToList();
        if (sensorKey.Length > 0)
        {
            extensionWatching = extensionWatching.Where(sensor => sensor.Key == sensorKey).ToList();
        }
        var uiaWatching = _uiaSensors.Values
            .Where(sensor => sensor.Focused && sensor.Active && now - sensor.HeartbeatMs <= _options.UsageStaleMs)
            .Where(sensor => sensorKey.Length == 0 || sensor.Key == sensorKey)
            .ToList();

        var ticking = new List<string>();
        var tickingSeen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var sensor in extensionWatching)
        {
            foreach (var group in TickingGroups(sensor.Host, sensor.Url, now))
            {
                if (tickingSeen.Add(group.Id ?? "")) ticking.Add(group.Id ?? "");
            }
        }
        foreach (var sensor in uiaWatching)
        {
            var isBrowser = BrowserExecutables.Contains(sensor.ForegroundExe, StringComparer.OrdinalIgnoreCase);
            if (isBrowser)
            {
                var extensionFresh = _sensorHeartbeatMsBySid.TryGetValue(sensor.Key, out var extensionMs) &&
                    now - extensionMs <= _options.UsageStaleMs;
                if (extensionFresh || string.IsNullOrWhiteSpace(sensor.Host)) continue;
                foreach (var group in TickingGroups(sensor.Host, sensor.Url, now))
                {
                    if (tickingSeen.Add(group.Id ?? "")) ticking.Add(group.Id ?? "");
                }
            }
            else if (sensor.ForegroundExe.Length > 0)
            {
                foreach (var group in TickingAppGroups(sensor.ForegroundExe, now))
                {
                    if (tickingSeen.Add(group.Id ?? "")) ticking.Add(group.Id ?? "");
                }
            }
        }

        var sensors = new List<SensorSnapshot>();
        foreach (var sid in _protectedAccounts.Keys)
        {
            _sensors.TryGetValue(sid, out var sensor);
            _uiaSensors.TryGetValue(sid, out var uia);
            sensors.Add(new SensorSnapshot
            {
                Account = _protectedAccounts[sid].Split('\\').Last(),
                LastHeartbeatMs = sensor?.HeartbeatMs ?? 0,
                ActiveSession = sensor?.Active ?? false,
                BrowserRunning = _runningProtectedUserSids.Contains(sid, StringComparer.OrdinalIgnoreCase),
                UiaLastHeartbeatMs = uia?.HeartbeatMs ?? 0,
                ForegroundExe = uia?.ForegroundExe ?? "",
                ForegroundHost = uia?.Host ?? ""
            });
        }

        return new Snapshot
        {
            Configured = _state.Configured,
            EnforcementArmed = _state.EnforcementArmed,
            FailClosed = _state.FailClosed,
            FailClosedActive = _failClosedActive,
            FirewallBlocked = _firewallBlocked,
            HeartbeatTimeoutSeconds = _state.HeartbeatTimeoutSeconds,
            LastHeartbeatMs = _state.LastHeartbeatMs,
            Groups = _state.Groups.Where(group => group is not null).ToList(),
            Usage = _state.Usage,
            UsageSession = ticking.Count > 0 ? new UsageSessionSnapshot { GroupIds = ticking, StartedAt = now } : null,
            LockMode = _state.LockMode,
            PrivacyConsent = _state.PrivacyConsent,
            BlockedDomains = _blockedDomains,
            AllowedDomains = _allowedDomains,
            BlockedApps = _blockedApps,
            EnforcementReason = _enforcementReason,
            ProtectedWindowsAccount = string.Join(", ", _protectedAccounts.Values),
            ProtectedWindowsAccounts = _protectedAccounts.Values.ToList(),
            Sensors = sensors
        };
    }

    public Snapshot BuildSnapshot(string sensorKey = "")
    {
        lock (_gate) return BuildSnapshotLocked(_clock.NowMs, sensorKey);
    }
}
