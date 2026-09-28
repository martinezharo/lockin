namespace LockIn.Engine.Engine;

public sealed record ProtectedAccount(string Sid, string DisplayName);

public sealed class EngineOptions
{
    public string DataDirectory { get; init; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "LockIn");

    public int Port { get; init; } = 8765;
    public int HeartbeatTimeoutSeconds { get; init; } = 60;
    public IReadOnlyList<ProtectedAccount> ProtectedAccounts { get; init; } = Array.Empty<ProtectedAccount>();
    public int EvaluationIntervalMilliseconds { get; init; } = 250;

    /// <summary>No registry, no firewall, no process control: safe for tests.</summary>
    public bool TestMode { get; init; }

    /// <summary>Treat a browser as running even when the probe finds none (test mode).</summary>
    public bool AssumeBrowserRunning { get; init; }

    public long SaveIntervalMs { get; init; } = 5000;
    public long UsageStaleMs { get; init; } = 10000;
    public long BrowserProbeIntervalMs { get; init; } = 2000;
    public long FirewallReconcileIntervalMs { get; init; } = 60000;
    public long FirewallRetryIntervalMs { get; init; } = 15000;
    public long ClockJumpThresholdMs { get; init; } = 15000;
    public string? AppExecutablePath { get; init; }
    public bool ScanInstalledBrowsers { get; init; } = true;
}
