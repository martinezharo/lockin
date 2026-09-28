using System.Text.Json;
using System.Text.Json.Serialization;

namespace LockIn.Engine.Models;

/// <summary>
/// One containment zone. The model deliberately mirrors the JSON the extension
/// writes: unknown properties survive a round trip through <see cref="Extra"/>,
/// so fields this build does not know yet (app targets from a future build,
/// settings from an older one) are never dropped.
/// </summary>
public sealed class Group
{
    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("domains")] public List<string>? Domains { get; set; }
    [JsonPropertyName("exceptions")] public List<string>? Exceptions { get; set; }
    [JsonPropertyName("apps")] public List<string>? Apps { get; set; }
    [JsonPropertyName("enabled")] public bool? Enabled { get; set; }
    [JsonPropertyName("disarmedUntil")] public long? DisarmedUntil { get; set; }
    [JsonPropertyName("schedule")] public GroupSchedule? Schedule { get; set; }
    [JsonPropertyName("limit")] public GroupLimit? Limit { get; set; }
    [JsonPropertyName("blockNetwork")] public bool? BlockNetwork { get; set; }
    [JsonPropertyName("createdAt")] public long? CreatedAt { get; set; }
    [JsonPropertyName("mode")] public string? Mode { get; set; }

    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }

    public bool IsEnabled => Enabled == true;
    public bool HasRules => Schedule is not null || Limit is not null;
    public bool HasApps => Apps is { Count: > 0 };
    public bool HasDomains => Domains is { Count: > 0 };
}

public sealed class GroupSchedule
{
    [JsonPropertyName("days")] public List<int>? Days { get; set; }
    [JsonPropertyName("windows")] public List<ScheduleWindow>? Windows { get; set; }
    [JsonPropertyName("start")] public int? Start { get; set; }
    [JsonPropertyName("end")] public int? End { get; set; }

    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }

    public IReadOnlyList<ScheduleWindow> EffectiveWindows()
    {
        if (Windows is { Count: > 0 }) return Windows;
        if (Start is not null || End is not null)
        {
            return new[] { new ScheduleWindow { Start = Start ?? 0, End = End ?? 0 } };
        }
        return Array.Empty<ScheduleWindow>();
    }
}

public sealed class ScheduleWindow
{
    [JsonPropertyName("start")] public int Start { get; set; }
    [JsonPropertyName("end")] public int End { get; set; }

    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }
}

public sealed class GroupLimit
{
    [JsonPropertyName("minutes")] public double Minutes { get; set; }

    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }
}

public sealed class UsageEntry
{
    [JsonPropertyName("date")] public string? Date { get; set; }
    [JsonPropertyName("ms")] public long Ms { get; set; }
}

public sealed class OwnedPolicyValue
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("value")] public string Value { get; set; } = "";
}
