using LockIn.Engine.Platform;

namespace LockIn.Engine.Engine;

public sealed record AppProcess(int ProcessId, string ExecutableName);

public interface IAppProcessController
{
    IReadOnlyList<AppProcess> FindRunning(string executableName);
    void CloseGracefully(AppProcess process);
    void Terminate(AppProcess process);
}

/// <summary>
/// App-zone enforcement: a blocked executable is asked to close politely
/// (WM_CLOSE), and terminated after a grace period if it is still there. The
/// process handling itself is behind an interface so the policy can be tested
/// without touching a real process.
/// </summary>
public sealed class AppEnforcer
{
    private readonly IAppProcessController _controller;
    private readonly IClock _clock;
    private readonly long _graceMs;
    private readonly Dictionary<int, long> _firstSeenMs = new();

    public AppEnforcer(IAppProcessController controller, IClock clock, long graceMs = 5000)
    {
        _controller = controller;
        _clock = clock;
        _graceMs = graceMs;
    }

    public List<AppProcess> Closed { get; } = new();
    public List<AppProcess> Terminated { get; } = new();

    public void Apply(IReadOnlyList<string> blockedApps)
    {
        var blocked = new HashSet<string>(blockedApps, StringComparer.OrdinalIgnoreCase);
        var now = _clock.NowMs;
        var alive = new HashSet<int>();
        foreach (var app in blocked)
        {
            foreach (var process in _controller.FindRunning(app))
            {
                alive.Add(process.ProcessId);
                if (!_firstSeenMs.TryGetValue(process.ProcessId, out var firstSeen))
                {
                    _firstSeenMs[process.ProcessId] = now;
                    _controller.CloseGracefully(process);
                    Closed.Add(process);
                    continue;
                }
                if (now - firstSeen < _graceMs) continue;
                _controller.Terminate(process);
                Terminated.Add(process);
                _firstSeenMs[process.ProcessId] = now;
            }
        }
        foreach (var processId in _firstSeenMs.Keys.ToList())
        {
            if (!alive.Contains(processId)) _firstSeenMs.Remove(processId);
        }
    }
}
