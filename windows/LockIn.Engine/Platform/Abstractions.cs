using LockIn.Engine.Models;

namespace LockIn.Engine.Platform;

public interface IClock
{
    long NowMs { get; }
}

public sealed class SystemClock : IClock
{
    public long NowMs => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

/// <summary>A process as the session probe sees it.</summary>
public sealed record BrowserProcess(int Id, int SessionId, string Name);

/// <summary>The account logged into an active Windows session.</summary>
public sealed record SessionAccount(int SessionId, string Sid);

/// <summary>
/// Every slow Windows query the engine needs, behind an interface so the same
/// decisions can be tested with deterministic fakes.
/// </summary>
public interface INativeProbe
{
    IReadOnlyList<BrowserProcess> GetBrowserProcesses();
    IReadOnlyList<BrowserProcess> GetProcesses(string processName);
    IReadOnlyList<SessionAccount> GetActiveSessions();
    string GetProcessOwnerSid(int processId);
    string GetProcessImagePath(int processId);
    int GetProcessSessionId(int processId);
    /// <summary>0 = active, 4 = disconnected, -1 = unreadable.</summary>
    int GetSessionState(int sessionId);
    bool IsProcessAlive(int processId);
    int GetLoopbackClientProcessId(int clientPort, int serverPort);
}

public interface IRegistryPolicyStore
{
    /// <summary>Writes the owned policy values, removing only values this build recorded and that still hold the recorded value.</summary>
    List<OwnedPolicyValue> Apply(string browserKey, bool allow, IReadOnlyList<string> values, IReadOnlyList<OwnedPolicyValue> previous);

    /// <summary>True when every recorded value still exists with the recorded content.</summary>
    bool OwnedCurrent(string browserKey, bool allow, IReadOnlyList<OwnedPolicyValue> owned, int expectedCount);
}

public sealed class NullRegistryPolicyStore : IRegistryPolicyStore
{
    public List<OwnedPolicyValue> Apply(string browserKey, bool allow, IReadOnlyList<string> values, IReadOnlyList<OwnedPolicyValue> previous)
    {
        return values.Select((value, index) => new OwnedPolicyValue { Name = (index + 1).ToString(), Value = value }).ToList();
    }

    public bool OwnedCurrent(string browserKey, bool allow, IReadOnlyList<OwnedPolicyValue> owned, int expectedCount) => true;
}

public sealed record FirewallRuleSpec(string Name, string Program, string? Sid, bool Enabled, string DisplayName, bool NetworkBlock = false);

public sealed record FirewallReconcileResult(bool Failed, bool PerAccountFallback, string? Warning = null)
{
    public static readonly FirewallReconcileResult Ok = new(false, false);
}

public interface IFirewallController
{
    /// <summary>
    /// Makes the firewall rules in the LockInWatchdog group match
    /// <paramref name="desired"/>, removing only rules in that group. Returns a
    /// failure instead of throwing so the engine can back off and try again.
    /// </summary>
    FirewallReconcileResult Reconcile(IReadOnlyList<FirewallRuleSpec> desired);

    /// <summary>Disables every rule in the LockInWatchdog group without removing it (emergency disarm).</summary>
    void DisableAll()
    {
    }
}

public sealed class NullFirewallController : IFirewallController
{
    public FirewallReconcileResult Reconcile(IReadOnlyList<FirewallRuleSpec> desired) => FirewallReconcileResult.Ok;
}

/// <summary>Launches the per-user app into a session; implemented by the service.</summary>
public interface IProcessLauncher
{
    bool Launch(string executablePath, int sessionId);
}

public sealed class NullProcessLauncher : IProcessLauncher
{
    public bool Launch(string executablePath, int sessionId) => true;
}
