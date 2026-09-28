using System.ServiceProcess;
using LockIn.Engine.Engine;

namespace LockIn.Service;

public sealed class LockInWindowsService : ServiceBase
{
    private readonly ServiceRunner _runner;

    public LockInWindowsService(ServiceRunner runner)
    {
        _runner = runner;
        ServiceName = ServiceConfiguration.ServiceName;
        CanStop = true;
        CanShutdown = true;
        AutoLog = true;
    }

    protected override void OnStart(string[] args)
    {
        try
        {
            _runner.StartAsync().GetAwaiter().GetResult();
        }
        catch (Exception error)
        {
            _runner.Log.Write($"Service failed to start: {error}");
            throw;
        }
    }

    protected override void OnStop() => _runner.Stop();

    protected override void OnShutdown() => _runner.Stop();
}

public static class Program
{
    public static int Main(string[] args)
    {
        var options = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var flags = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index++)
        {
            var argument = args[index];
            if (!argument.StartsWith("--", StringComparison.Ordinal)) continue;
            var name = argument[2..];
            if (index + 1 < args.Length && !args[index + 1].StartsWith("--", StringComparison.Ordinal))
            {
                options[name] = args[++index];
            }
            else
            {
                flags.Add(name);
            }
        }

        var testMode = flags.Contains("test-mode");
        var engineOptions = ServiceConfiguration.Load(
            options.GetValueOrDefault("data-dir"),
            options.TryGetValue("port", out var portValue) && int.TryParse(portValue, out var port) ? port : null,
            options.GetValueOrDefault("protected-sids"),
            testMode,
            flags.Contains("assume-browser-running"));
        if (options.TryGetValue("evaluation-interval-ms", out var intervalValue) && int.TryParse(intervalValue, out var interval))
        {
            engineOptions = new EngineOptions
            {
                DataDirectory = engineOptions.DataDirectory,
                Port = engineOptions.Port,
                HeartbeatTimeoutSeconds = engineOptions.HeartbeatTimeoutSeconds,
                ProtectedAccounts = engineOptions.ProtectedAccounts,
                TestMode = engineOptions.TestMode,
                AssumeBrowserRunning = engineOptions.AssumeBrowserRunning,
                AppExecutablePath = engineOptions.AppExecutablePath,
                EvaluationIntervalMilliseconds = interval
            };
        }

        using var runner = new ServiceRunner(engineOptions);
        if (flags.Contains("console"))
        {
            runner.StartAsync().GetAwaiter().GetResult();
            Console.WriteLine("LOCKIN_SERVICE_READY");
            var stop = new ManualResetEventSlim(false);
            Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; stop.Set(); };
            AppDomain.CurrentDomain.ProcessExit += (_, _) => stop.Set();
            stop.Wait();
            runner.Stop();
            return 0;
        }

        ServiceBase.Run(new LockInWindowsService(runner));
        return 0;
    }
}
