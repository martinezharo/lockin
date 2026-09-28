using System.Security.Principal;
using LockIn.Engine.Engine;
using Microsoft.Win32;

namespace LockIn.Service;

/// <summary>
/// The installer's settings, kept in HKLM\SOFTWARE\LockIn. Protected accounts
/// live here rather than in the state file: the state file belongs to the
/// extension's data, while who is protected is a machine decision.
/// </summary>
public static class ServiceConfiguration
{
    public const string RegistryPath = @"SOFTWARE\LockIn";
    public const string ServiceName = "LockInWatchdog";

    public static EngineOptions Load(string? dataDirectoryOverride = null, int? portOverride = null,
        string? protectedSidsOverride = null, bool testMode = false, bool assumeBrowserRunning = false)
    {
        var dataDirectory = dataDirectoryOverride
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "LockIn");
        var port = portOverride ?? 8765;
        var timeout = 60;
        var appPath = Path.Combine(AppContext.BaseDirectory, "LockIn.App.exe");
        var protectedSids = protectedSidsOverride ?? "";

        if (!testMode)
        {
            try
            {
                using var key = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                    .OpenSubKey(RegistryPath);
                if (key is not null)
                {
                    if (key.GetValue("Port") is int storedPort and > 0 and < 65536) port = storedPort;
                    if (key.GetValue("HeartbeatTimeoutSeconds") is int storedTimeout and > 0) timeout = storedTimeout;
                    if (key.GetValue("AppExecutablePath") is string storedPath && storedPath.Length > 0) appPath = storedPath;
                    if (string.IsNullOrWhiteSpace(protectedSids) && key.GetValue("ProtectedUserSids") is string[] storedSids)
                    {
                        protectedSids = string.Join(",", storedSids);
                    }
                }
            }
            catch
            {
                // A locked registry falls back to the defaults above.
            }
        }

        var accounts = new List<ProtectedAccount>();
        foreach (var raw in protectedSids.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            try
            {
                var sid = new SecurityIdentifier(raw);
                var name = sid.Value;
                try { name = sid.Translate(typeof(NTAccount)).Value; }
                catch { /* A name is only for display. */ }
                accounts.Add(new ProtectedAccount(sid.Value, name));
            }
            catch (ArgumentException)
            {
                throw new InvalidOperationException($"ProtectedUserSids contains an invalid Windows account SID: {raw}");
            }
        }

        return new EngineOptions
        {
            DataDirectory = dataDirectory,
            Port = port,
            HeartbeatTimeoutSeconds = timeout,
            ProtectedAccounts = accounts,
            TestMode = testMode,
            AssumeBrowserRunning = assumeBrowserRunning,
            AppExecutablePath = File.Exists(appPath) ? appPath : null
        };
    }
}
