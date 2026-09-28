using LockIn.Engine.Models;
using Microsoft.Win32;

namespace LockIn.Engine.Platform;

/// <summary>
/// Chrome, Brave and Edge URLBlocklist/URLAllowlist under HKLM, including the
/// WOW6432Node views. Exactly the PowerShell watchdog's ownership rules: a
/// value is removed only when this watchdog wrote it and it still holds the
/// recorded content, so somebody else's policy survives every reconcile.
/// </summary>
public sealed class RegistryPolicyStore : IRegistryPolicyStore
{
    private static readonly Dictionary<string, string> BlockPaths = new()
    {
        ["chrome"] = @"SOFTWARE\Policies\Google\Chrome\URLBlocklist",
        ["brave"] = @"SOFTWARE\Policies\BraveSoftware\Brave\URLBlocklist",
        ["edge"] = @"SOFTWARE\Policies\Microsoft\Edge\URLBlocklist",
        ["chrome32"] = @"SOFTWARE\WOW6432Node\Policies\Google\Chrome\URLBlocklist",
        ["brave32"] = @"SOFTWARE\WOW6432Node\Policies\BraveSoftware\Brave\URLBlocklist",
        ["edge32"] = @"SOFTWARE\WOW6432Node\Policies\Microsoft\Edge\URLBlocklist"
    };

    private static readonly Dictionary<string, string> AllowPaths = new()
    {
        ["chrome"] = @"SOFTWARE\Policies\Google\Chrome\URLAllowlist",
        ["brave"] = @"SOFTWARE\Policies\BraveSoftware\Brave\URLAllowlist",
        ["edge"] = @"SOFTWARE\Policies\Microsoft\Edge\URLAllowlist",
        ["chrome32"] = @"SOFTWARE\WOW6432Node\Policies\Google\Chrome\URLAllowlist",
        ["brave32"] = @"SOFTWARE\WOW6432Node\Policies\BraveSoftware\Brave\URLAllowlist",
        ["edge32"] = @"SOFTWARE\WOW6432Node\Policies\Microsoft\Edge\URLAllowlist"
    };

    private static RegistryKey? Open(string path, bool writable)
    {
        var baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
        return writable ? baseKey.CreateSubKey(path, writable: true) : baseKey.OpenSubKey(path);
    }

    public List<OwnedPolicyValue> Apply(string browserKey, bool allow, IReadOnlyList<string> values, IReadOnlyList<OwnedPolicyValue> previous)
    {
        var path = (allow ? AllowPaths : BlockPaths)[browserKey];
        using var key = Open(path, writable: true)
            ?? throw new InvalidOperationException($"Could not open {path}.");
        foreach (var entry in previous)
        {
            if (key.GetValue(entry.Name) is string current && current == entry.Value)
            {
                key.DeleteValue(entry.Name, throwOnMissingValue: false);
            }
        }
        var occupied = new HashSet<string>(key.GetValueNames(), StringComparer.Ordinal);
        var owned = new List<OwnedPolicyValue>();
        var candidate = 1;
        foreach (var value in values)
        {
            while (candidate <= 1000 && occupied.Contains(candidate.ToString())) candidate++;
            if (candidate > 1000) throw new InvalidOperationException("URL policy has no free slots.");
            var name = candidate.ToString();
            key.SetValue(name, value, RegistryValueKind.String);
            occupied.Add(name);
            owned.Add(new OwnedPolicyValue { Name = name, Value = value });
            candidate++;
        }
        return owned;
    }

    public bool OwnedCurrent(string browserKey, bool allow, IReadOnlyList<OwnedPolicyValue> owned, int expectedCount)
    {
        if (owned.Count != expectedCount) return false;
        if (owned.Count == 0) return true;
        var path = (allow ? AllowPaths : BlockPaths)[browserKey];
        using var key = Open(path, writable: false);
        if (key is null) return false;
        foreach (var entry in owned)
        {
            if (key.GetValue(entry.Name) is not string current || current != entry.Value) return false;
        }
        return true;
    }
}
