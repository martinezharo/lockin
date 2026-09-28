using System.Diagnostics;
using Microsoft.Win32;

namespace LockIn.App;

/// <summary>
/// Detects whether the Lock In extension is present in Chrome or Brave. The
/// force-install policy is the reliable signal; the profile directory is the
/// fallback for a manually installed copy.
/// </summary>
public static class ExtensionDetector
{
    public const string ExtensionId = "ceggfchogfcdgnobpekajiojobghcggi";

    public static bool AnyChromiumBrowserInstalled()
    {
        return ChromeDataRoot() is not null || BraveDataRoot() is not null ||
            FindOnPath("chrome.exe") is not null || FindOnPath("brave.exe") is not null;
    }

    public static bool IsExtensionInstalled()
    {
        if (PolicyContainsExtension(@"SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist") ||
            PolicyContainsExtension(@"SOFTWARE\Policies\BraveSoftware\Brave\ExtensionInstallForcelist") ||
            PolicyContainsExtension(@"SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"))
        {
            return true;
        }
        return ProfileHasExtension(ChromeDataRoot()) || ProfileHasExtension(BraveDataRoot());
    }

    /// <summary>Opens the extensions page of the first browser that is installed.</summary>
    public static bool OpenExtensionsPage()
    {
        foreach (var candidate in new[]
                 {
                     ("chrome.exe", "chrome://extensions"),
                     ("brave.exe", "brave://extensions"),
                     ("msedge.exe", "edge://extensions")
                 })
        {
            var path = FindOnPath(candidate.Item1);
            if (path is null) continue;
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = path,
                    Arguments = candidate.Item2,
                    UseShellExecute = true
                });
                return true;
            }
            catch
            {
                // Try the next browser.
            }
        }
        return false;
    }

    private static bool PolicyContainsExtension(string path)
    {
        try
        {
            using var key = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64).OpenSubKey(path);
            if (key is null) return false;
            return key.GetValueNames().Any(name =>
                key.GetValue(name) is string value &&
                value.StartsWith(ExtensionId + ";", StringComparison.OrdinalIgnoreCase));
        }
        catch
        {
            return false;
        }
    }

    private static bool ProfileHasExtension(string? dataRoot)
    {
        if (dataRoot is null || !Directory.Exists(dataRoot)) return false;
        try
        {
            foreach (var profile in Directory.EnumerateDirectories(dataRoot))
            {
                if (!File.Exists(Path.Combine(profile, "Preferences"))) continue;
                var extension = Path.Combine(profile, "Extensions", ExtensionId);
                if (Directory.Exists(extension)) return true;
            }
        }
        catch
        {
            return false;
        }
        return false;
    }

    private static string? ChromeDataRoot() => ExistingDirectory(
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            @"Google\Chrome\User Data"));

    private static string? BraveDataRoot() => ExistingDirectory(
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            @"BraveSoftware\Brave-Browser\User Data"));

    private static string? ExistingDirectory(string path) => Directory.Exists(path) ? path : null;

    private static string? FindOnPath(string executable)
    {
        foreach (var root in new[]
                 {
                     Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                     Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                     Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
                 })
        {
            foreach (var relative in new[]
                     {
                         Path.Combine(@"Google\Chrome\Application", executable),
                         Path.Combine(@"BraveSoftware\Brave-Browser\Application", executable),
                         Path.Combine(@"Microsoft\Edge\Application", executable)
                     })
            {
                var candidate = Path.Combine(root, relative);
                if (File.Exists(candidate)) return candidate;
            }
        }
        return null;
    }
}
