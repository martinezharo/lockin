using LockIn.Engine.Engine;
using LockIn.Engine.Models;
using LockIn.Engine.Platform;

namespace LockIn.Engine.Tests;

public sealed class FakeClock : IClock
{
    public long NowMs { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public void Advance(long ms) => NowMs += ms;
}

public sealed class InMemoryStateStore : IStateStore
{
    public WatchdogState? State { get; set; }
    public int Saves { get; private set; }

    public WatchdogState? Load() => State;

    public void Save(WatchdogState state)
    {
        Saves++;
        State = state;
    }
}

public sealed class FakeNativeProbe : INativeProbe
{
    public List<BrowserProcess> Browsers { get; } = new();
    public List<BrowserProcess> Processes { get; } = new();
    public Dictionary<int, string> OwnerSids { get; } = new();
    public Dictionary<int, string> ImagePaths { get; } = new();
    public Dictionary<int, int> SessionStates { get; } = new();
    public Dictionary<int, int> ProcessSessions { get; } = new();
    public HashSet<int> DeadProcesses { get; } = new();
    public List<SessionAccount> ActiveSessions { get; } = new();
    public int LoopbackClientPid { get; set; }

    public IReadOnlyList<BrowserProcess> GetBrowserProcesses() => Browsers;
    public IReadOnlyList<BrowserProcess> GetProcesses(string processName) =>
        Processes.Where(process => process.Name.Equals(processName + ".exe", StringComparison.OrdinalIgnoreCase) ||
            process.Name.Equals(processName, StringComparison.OrdinalIgnoreCase)).ToList();

    public IReadOnlyList<SessionAccount> GetActiveSessions() => ActiveSessions;

    public string GetProcessOwnerSid(int processId) => OwnerSids.GetValueOrDefault(processId, "");
    public string GetProcessImagePath(int processId) => ImagePaths.GetValueOrDefault(processId, "");

    public int GetProcessSessionId(int processId) => ProcessSessions.GetValueOrDefault(processId, -1);

    public int GetSessionState(int sessionId) => SessionStates.GetValueOrDefault(sessionId, 0);

    public bool IsProcessAlive(int processId) => !DeadProcesses.Contains(processId);

    public int GetLoopbackClientProcessId(int clientPort, int serverPort) => LoopbackClientPid;
}

public sealed class FakeFirewallRule
{
    public string Name { get; set; } = "";
    public bool Enabled { get; set; }
    public string? LocalUser { get; set; }
    public string Program { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public bool NetworkBlock { get; set; }
}

/// <summary>The in-memory firewall table the PowerShell tests used, same expectations.</summary>
public sealed class FakeFirewall : IFirewallController
{
    public Dictionary<string, FakeFirewallRule> Rules { get; } = new(StringComparer.OrdinalIgnoreCase);
    public int Reconciles { get; private set; }
    public FirewallReconcileResult NextResult { get; set; } = FirewallReconcileResult.Ok;

    public FirewallReconcileResult Reconcile(IReadOnlyList<FirewallRuleSpec> desired)
    {
        Reconciles++;
        var wanted = new HashSet<string>(desired.Select(spec => spec.Name), StringComparer.OrdinalIgnoreCase);
        foreach (var name in Rules.Keys.ToList())
        {
            if (!wanted.Contains(name)) Rules.Remove(name);
        }
        foreach (var spec in desired)
        {
            if (Rules.TryGetValue(spec.Name, out var existing))
            {
                existing.Enabled = spec.Enabled;
                continue;
            }
            Rules[spec.Name] = new FakeFirewallRule
            {
                Name = spec.Name,
                Enabled = spec.Enabled,
                LocalUser = spec.Sid is null ? null : $"D:(A;;CC;;;{spec.Sid})",
                Program = spec.Program,
                DisplayName = spec.DisplayName,
                NetworkBlock = spec.NetworkBlock
            };
        }
        return NextResult;
    }

    public List<string> EnabledUsers() => Rules.Values
        .Where(rule => rule.Enabled)
        .Select(rule => rule.LocalUser ?? "*")
        .ToList();
}

public sealed class FakeProcessLauncher : IProcessLauncher
{
    public List<(string Path, int SessionId)> Launched { get; } = new();

    public bool Launch(string executablePath, int sessionId)
    {
        Launched.Add((executablePath, sessionId));
        return true;
    }
}

public static class TestEngineFactory
{
    public static (WatchdogEngine Engine, FakeClock Clock, FakeNativeProbe Probe, FakeFirewall Firewall,
        InMemoryStateStore Store, FileLog Log) Create(
        EngineOptions? options = null,
        WatchdogState? state = null,
        FakeNativeProbe? probe = null)
    {
        var clock = new FakeClock();
        var fakeProbe = probe ?? new FakeNativeProbe();
        var firewall = new FakeFirewall();
        var store = new InMemoryStateStore { State = state };
        var log = FileLog.Null;
        var engineOptions = options ?? new EngineOptions
        {
            TestMode = true,
            ScanInstalledBrowsers = false,
            DataDirectory = Path.Combine(Path.GetTempPath(), "lockin-tests", Guid.NewGuid().ToString("N"))
        };
        var engine = new WatchdogEngine(engineOptions, clock, fakeProbe, new NullRegistryPolicyStore(), firewall, store, log);
        return (engine, clock, fakeProbe, firewall, store, log);
    }
}
