using LockIn.Engine.Engine;
using LockIn.Engine.Platform;

namespace LockIn.Service;

/// <summary>
/// Wires the engine, the loopback listener and the enforcement loop together.
/// The loop is the only place that touches the registry or the firewall, which
/// is what keeps every request answer fast.
/// </summary>
public sealed class ServiceRunner : IDisposable
{
    private readonly EngineOptions _options;
    private readonly FileLog _log;
    private WatchdogEngine? _engine;
    private LoopbackServer? _server;
    private Thread? _loopThread;
    private volatile bool _stopping;

    public ServiceRunner(EngineOptions options)
    {
        _options = options;
        Directory.CreateDirectory(options.DataDirectory);
        _log = new FileLog(Path.Combine(options.DataDirectory, "watchdog.log"));
    }

    public WatchdogEngine Engine => _engine ?? throw new InvalidOperationException("The runner has not started.");
    public FileLog Log => _log;

    public async Task StartAsync()
    {
        var probe = new NativeProbe();
        _engine = new WatchdogEngine(
            _options,
            new SystemClock(),
            probe,
            _options.TestMode ? new NullRegistryPolicyStore() : new RegistryPolicyStore(),
            _options.TestMode ? new NullFirewallController() : new ComFirewallController(),
            new FileStateStore(_options.DataDirectory),
            _log,
            _options.TestMode ? new NullProcessLauncher() : new WtsProcessLauncher());
        _server = new LoopbackServer(_engine, probe, _log, _options.Port);
        _server.Start();
        _loopThread = new Thread(EnforcementLoop)
        {
            IsBackground = true,
            Name = "LockIn enforcement"
        };
        _loopThread.Start();
        await _server.Ready.ConfigureAwait(false);
    }

    private void EnforcementLoop()
    {
        // The PowerShell loop answered clients between passes; this one is a
        // dedicated thread, and every pass is wrapped so nothing can stop it.
        while (!_stopping)
        {
            try
            {
                _engine!.EnforcementPass();
            }
            catch (Exception error)
            {
                _log.Write($"Enforcement pass failed: {error.Message}");
            }
            try { Thread.Sleep(Math.Max(50, _options.EvaluationIntervalMilliseconds)); }
            catch (ThreadInterruptedException) { }
        }
    }

    public void Stop()
    {
        if (_stopping) return;
        _stopping = true;
        try { _loopThread?.Join(TimeSpan.FromSeconds(3)); } catch { }
        try { _engine?.SaveForced(); } catch { }
        _server?.Stop();
    }

    public void Dispose()
    {
        Stop();
        _server?.Dispose();
    }
}
