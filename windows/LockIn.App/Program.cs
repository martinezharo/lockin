namespace LockIn.App;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);

        if (args.Contains("--emergency-disarm"))
        {
            return EmergencyDisarm.Run(args.Contains("--elevated"));
        }

        // One tray per signed-in account; the service starts another only when
        // this one is gone.
        using var mutex = new Mutex(true, @"Local\LockIn.App", out var created);
        if (!created) return 0;

        var settings = AppSettings.Load();
        using var bridge = new ServiceBridge(settings.Port);
        Application.Run(new TrayContext(settings, bridge));
        return 0;
    }
}
