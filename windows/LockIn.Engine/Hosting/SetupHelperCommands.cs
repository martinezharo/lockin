using System.Diagnostics;
using System.Net.Http;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using LockIn.Engine.Engine;
using LockIn.Engine.Installer;
using LockIn.Engine.Platform;
using Microsoft.Win32;

namespace LockIn.Engine.Hosting;

/// <summary>
/// The elevated work the Inno Setup wizard cannot do by itself, exposed from
/// the service executable as `--setup-helper ...` so the installer has one
/// self-contained binary to run: enumerate the local accounts for the checkbox
/// page, merge the protected set, write the service configuration, own the
/// force-install policy values, and check that the service became healthy.
/// </summary>
public static class SetupHelperCommands
{
    public const string RegistryPath = @"SOFTWARE\LockIn";
    public const string ExtensionId = "ceggfchogfcdgnobpekajiojobghcggi";
    private const string UpdateUrl = "https://clients2.google.com/service/update2/crx";
    private const string ForcelistOwnershipValue = "OwnedExtensionPolicy";

    private static readonly (string Browser, string Path)[] ForcelistPaths =
    {
        ("chrome", @"SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist"),
        ("brave", @"SOFTWARE\Policies\BraveSoftware\Brave\ExtensionInstallForcelist")
    };

    public static int Run(string[] args)
    {
        if (args.Length == 0) return Usage();
        var options = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var flags = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 1; index < args.Length; index++)
        {
            if (!args[index].StartsWith("--", StringComparison.Ordinal)) continue;
            var name = args[index][2..];
            if (index + 1 < args.Length && !args[index + 1].StartsWith("--", StringComparison.Ordinal))
            {
                options[name] = args[++index];
            }
            else
            {
                flags.Add(name);
            }
        }
        try
        {
            return args[0].ToLowerInvariant() switch
            {
                "list-accounts" => ListAccounts(options),
                "apply-config" => ApplyConfig(options),
                "disarm" => Disarm(flags),
                "remove-config" => RemoveConfig(),
                "health" => Health(options),
                _ => Usage()
            };
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static int Usage()
    {
        Console.Error.WriteLine("usage: LockIn.Service.exe --setup-helper <list-accounts|apply-config|disarm|remove-config|health> [options]");
        return 2;
    }

    private static int ListAccounts(Dictionary<string, string> options)
    {
        var outPath = options.GetValueOrDefault("out");
        var launchingSid = options.GetValueOrDefault("launching-sid") ?? "";
        if (launchingSid.Length == 0 && options.TryGetValue("launching-name", out var launchingName) && launchingName.Length > 0)
        {
            launchingSid = ResolveSid(launchingName);
        }
        var currentSid = WindowsIdentity.GetCurrent().User?.Value ?? "";
        if (launchingSid.Length == 0) launchingSid = currentSid;
        var protectedSids = ReadProtectedSids();

        var accounts = new List<(string Sid, string Name)>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using (var profileList = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                   .OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList"))
        {
            if (profileList is not null)
            {
                foreach (var name in profileList.GetSubKeyNames())
                {
                    if (!name.StartsWith("S-1-5-21-", StringComparison.Ordinal)) continue;
                    using var key = profileList.OpenSubKey(name);
                    if (key?.GetValue("ProfileImagePath") is not string profilePath || profilePath.Length == 0) continue;
                    if (!seen.Add(name)) continue;
                    accounts.Add((name, DisplayName(name)));
                }
            }
        }
        foreach (var extra in new[] { currentSid, launchingSid })
        {
            if (AccountSelection.IsValidSid(extra) && seen.Add(extra))
            {
                accounts.Add((extra, DisplayName(extra)));
            }
        }

        var lines = accounts.Select(account => string.Join('\t',
            account.Sid,
            account.Name,
            protectedSids.Contains(account.Sid, StringComparer.OrdinalIgnoreCase) ? "1" : "0",
            account.Sid.Equals(launchingSid, StringComparison.OrdinalIgnoreCase) ? "1" : "0"));
        var content = string.Join(Environment.NewLine, lines) + Environment.NewLine;
        if (outPath is not null) File.WriteAllText(outPath, content, new UTF8Encoding(false));
        else Console.Write(content);
        return 0;
    }

    private static string DisplayName(string sid)
    {
        try { return new SecurityIdentifier(sid).Translate(typeof(NTAccount)).Value; }
        catch { return sid; }
    }

    private static string ResolveSid(string name)
    {
        try
        {
            var normalized = name.Contains('\\') ? name : $"{Environment.MachineName}\\{name}";
            return new NTAccount(normalized).Translate(typeof(SecurityIdentifier)).Value;
        }
        catch
        {
            return "";
        }
    }

    private static int ApplyConfig(Dictionary<string, string> options)
    {
        var launchingSid = options.GetValueOrDefault("launching");
        List<string>? selected = null;
        if (options.TryGetValue("sids", out var sids) && sids.Length > 0)
        {
            selected = sids.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
        }
        var protectedSids = AccountSelection.Merge(ReadProtectedSids(), launchingSid, selected);
        if (protectedSids.Count == 0) throw new InvalidOperationException("At least one protected Windows account is required.");

        var dataDirectory = options.GetValueOrDefault("data-dir")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "LockIn");
        var installDirectory = options.GetValueOrDefault("install-dir")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Lock In");
        var appPath = options.GetValueOrDefault("app-path") ?? Path.Combine(installDirectory, "LockIn.App.exe");
        var forceExtension = options.GetValueOrDefault("force-extension") == "1";

        using (var key = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                   .CreateSubKey(RegistryPath, writable: true)!)
        {
            key.SetValue("ProtectedUserSids", protectedSids.ToArray(), RegistryValueKind.MultiString);
            key.SetValue("Port", 8765, RegistryValueKind.DWord);
            key.SetValue("AppExecutablePath", appPath, RegistryValueKind.String);
            key.SetValue("ForceInstallExtension", forceExtension ? 1 : 0, RegistryValueKind.DWord);
        }

        Directory.CreateDirectory(dataDirectory);
        ResetArmedState(dataDirectory);
        SecureDirectory(installDirectory);
        SecureDirectory(dataDirectory);
        ApplyForcelist(forceExtension);
        return 0;
    }

    private static void ResetArmedState(string dataDirectory)
    {
        try
        {
            var store = new FileStateStore(dataDirectory);
            var state = store.Load();
            if (state is null) return;
            // A reinstall or protected-account change must earn three fresh
            // heartbeats before fail-closed enforcement can activate again.
            state.EnforcementArmed = false;
            state.LastHeartbeatMs = 0;
            state.LastSampleMs = 0;
            store.Save(state);
        }
        catch
        {
            // An unreadable state is left for the service to replace safely.
        }
    }

    private static void SecureDirectory(string path)
    {
        if (!Directory.Exists(path)) return;
        var startInfo = new ProcessStartInfo("icacls.exe")
        {
            Arguments = $"\"{path}\" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        using var process = Process.Start(startInfo);
        process?.WaitForExit(15000);
    }

    private static void ApplyForcelist(bool enabled)
    {
        using var config = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
            .CreateSubKey(RegistryPath, writable: true)!;
        var owned = config.GetValue(ForcelistOwnershipValue) as string[] ?? Array.Empty<string>();
        RemoveOwnedForcelist(owned);
        if (!enabled)
        {
            config.SetValue(ForcelistOwnershipValue, Array.Empty<string>(), RegistryValueKind.MultiString);
            return;
        }
        var nextOwned = new List<string>();
        foreach (var (browser, path) in ForcelistPaths)
        {
            using var key = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                .CreateSubKey(path, writable: true)!;
            var occupied = new HashSet<string>(key.GetValueNames(), StringComparer.Ordinal);
            var candidate = 900;
            while (candidate < 1000 && occupied.Contains(candidate.ToString())) candidate++;
            if (candidate >= 1000) continue;
            key.SetValue(candidate.ToString(), $"{ExtensionId};{UpdateUrl}", RegistryValueKind.String);
            nextOwned.Add($"{browser}|{candidate}");
        }
        config.SetValue(ForcelistOwnershipValue, nextOwned.ToArray(), RegistryValueKind.MultiString);
    }

    private static void RemoveOwnedForcelist(IEnumerable<string> owned)
    {
        foreach (var entry in owned)
        {
            var parts = entry.Split('|');
            if (parts.Length != 2) continue;
            var match = ForcelistPaths.FirstOrDefault(candidate => candidate.Browser == parts[0]);
            if (match.Path is null) continue;
            using var key = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                .OpenSubKey(match.Path, writable: true);
            if (key?.GetValue(parts[1]) is string value && value.StartsWith(ExtensionId + ";", StringComparison.OrdinalIgnoreCase))
            {
                key.DeleteValue(parts[1], throwOnMissingValue: false);
            }
        }
    }

    private static int Disarm(HashSet<string> flags)
    {
        var port = ReadPort();
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            var body = JsonSerializer.Serialize(new { type = "disarm", requestId = Guid.NewGuid().ToString("N"), payload = new { } });
            using var content = new StringContent(body, Encoding.UTF8, "application/json");
            http.PostAsync($"http://127.0.0.1:{port}/api/request", content).GetAwaiter().GetResult();
        }
        catch
        {
            // The service may already be stopped; the firewall is still handled.
        }
        var firewall = new ComFirewallController();
        if (flags.Contains("remove-rules")) firewall.Reconcile(Array.Empty<FirewallRuleSpec>());
        else firewall.DisableAll();
        return 0;
    }

    private static int RemoveConfig()
    {
        ApplyForcelist(enabled: false);
        new ComFirewallController().Reconcile(Array.Empty<FirewallRuleSpec>());
        try
        {
            RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                .DeleteSubKeyTree(RegistryPath, throwOnMissingSubKey: false);
        }
        catch
        {
            // A missing key is already removed.
        }
        return 0;
    }

    private static int Health(Dictionary<string, string> options)
    {
        var timeout = int.TryParse(options.GetValueOrDefault("timeout"), out var seconds) ? seconds : 30;
        var port = ReadPort();
        var deadline = DateTime.UtcNow.AddSeconds(timeout);
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var response = http.GetAsync($"http://127.0.0.1:{port}/health").GetAwaiter().GetResult();
                if (response.IsSuccessStatusCode)
                {
                    var document = JsonDocument.Parse(response.Content.ReadAsStringAsync().GetAwaiter().GetResult());
                    if (document.RootElement.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True)
                    {
                        return 0;
                    }
                }
            }
            catch
            {
                // Not up yet.
            }
            Thread.Sleep(500);
        }
        return 1;
    }

    private static int ReadPort()
    {
        try
        {
            using var key = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64).OpenSubKey(RegistryPath);
            if (key?.GetValue("Port") is int port and > 0 and < 65536) return port;
        }
        catch
        {
            // Fall through to the default.
        }
        return 8765;
    }

    private static List<string> ReadProtectedSids()
    {
        try
        {
            using var key = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64).OpenSubKey(RegistryPath);
            if (key?.GetValue("ProtectedUserSids") is string[] sids)
            {
                return sids.Where(AccountSelection.IsValidSid).ToList();
            }
        }
        catch
        {
            // No configuration yet.
        }
        return new List<string>();
    }
}
