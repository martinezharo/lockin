using System.Text.Json;
using System.Text.Json.Serialization;

namespace LockIn.Engine.Models;

/// <summary>
/// The protected state file, field for field compatible with the PowerShell
/// watchdog's schema version 2, plus the app-zone additions.
/// </summary>
public sealed class WatchdogState
{
    public static readonly string[] PolicyBrowsers = { "chrome", "brave", "edge", "chrome32", "brave32", "edge32" };

    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; } = 2;
    [JsonPropertyName("configured")] public bool Configured { get; set; }
    [JsonPropertyName("enforcementArmed")] public bool EnforcementArmed { get; set; }
    [JsonPropertyName("failClosed")] public bool FailClosed { get; set; } = true;
    [JsonPropertyName("heartbeatTimeoutSeconds")] public int HeartbeatTimeoutSeconds { get; set; } = 60;
    [JsonPropertyName("groups")] public List<Group> Groups { get; set; } = new();
    [JsonPropertyName("usage")] public Dictionary<string, UsageEntry> Usage { get; set; } = new();
    [JsonPropertyName("lockMode")] public bool LockMode { get; set; }
    [JsonPropertyName("privacyConsent")] public bool PrivacyConsent { get; set; }
    [JsonPropertyName("lastHeartbeatMs")] public long LastHeartbeatMs { get; set; }
    [JsonPropertyName("lastSampleMs")] public long LastSampleMs { get; set; }

    [JsonPropertyName("ownedPolicyValues")]
    public Dictionary<string, List<OwnedPolicyValue>> OwnedPolicyValues { get; set; } = EmptyOwned();

    [JsonPropertyName("ownedAllowPolicyValues")]
    public Dictionary<string, List<OwnedPolicyValue>> OwnedAllowPolicyValues { get; set; } = EmptyOwned();

    [JsonPropertyName("browserPaths")] public List<string> BrowserPaths { get; set; } = new();

    /// <summary>Executables an app-zone sensor has seen, so firewall rules can name them.</summary>
    [JsonPropertyName("appPaths")] public List<string> AppPaths { get; set; } = new();

    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }

    public static Dictionary<string, List<OwnedPolicyValue>> EmptyOwned()
    {
        var map = new Dictionary<string, List<OwnedPolicyValue>>();
        foreach (var browser in PolicyBrowsers) map[browser] = new List<OwnedPolicyValue>();
        return map;
    }

    /// <summary>
    /// The equivalent of the PowerShell Ensure-StateShape: a state file written
    /// by another build, or a hand-edited one, is filled in rather than
    /// rejected. A malformed file is rejected by the caller, which starts from
    /// a safe default instead.
    /// </summary>
    public void EnsureShape(int heartbeatTimeoutSeconds)
    {
        HeartbeatTimeoutSeconds = heartbeatTimeoutSeconds;
        Groups ??= new List<Group>();
        Usage ??= new Dictionary<string, UsageEntry>();
        BrowserPaths = (BrowserPaths ?? new List<string>())
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(path => path.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        AppPaths = (AppPaths ?? new List<string>())
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(path => path.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        OwnedPolicyValues = EnsureOwned(OwnedPolicyValues);
        OwnedAllowPolicyValues = EnsureOwned(OwnedAllowPolicyValues);
        for (var index = Groups.Count - 1; index >= 0; index--)
        {
            if (Groups[index] is null) Groups.RemoveAt(index);
        }
    }

    private static Dictionary<string, List<OwnedPolicyValue>> EnsureOwned(Dictionary<string, List<OwnedPolicyValue>>? source)
    {
        var map = new Dictionary<string, List<OwnedPolicyValue>>();
        foreach (var browser in PolicyBrowsers)
        {
            map[browser] = source is not null && source.TryGetValue(browser, out var values) && values is not null
                ? values
                : new List<OwnedPolicyValue>();
        }
        return map;
    }
}
