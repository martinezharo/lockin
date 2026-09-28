using System.Security.Principal;

namespace LockIn.Engine.Installer;

/// <summary>
/// Who the installer protects. The account page offers every local account and
/// ticks the already-protected ones plus the account that launched the
/// installer; a silent or scripted run keeps the existing set and adds the
/// launching account instead.
/// </summary>
public static class AccountSelection
{
    public static bool IsValidSid(string? sid)
    {
        if (string.IsNullOrWhiteSpace(sid)) return false;
        try
        {
            _ = new SecurityIdentifier(sid);
            return true;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    /// <summary>What the account page ticks by default.</summary>
    public static List<string> Defaults(IEnumerable<string>? alreadyProtected, string? launchingSid)
    {
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var sid in (alreadyProtected ?? Enumerable.Empty<string>()).Append(launchingSid))
        {
            if (!IsValidSid(sid) || !seen.Add(sid!)) continue;
            result.Add(sid!);
        }
        return result;
    }

    /// <summary>
    /// The final protected set. A null <paramref name="selected"/> means the
    /// page never ran: keep the existing set and add the launching account.
    /// Otherwise the checked accounts are exactly the protected set, so
    /// unchecking an account really does unprotect it.
    /// </summary>
    public static List<string> Merge(IEnumerable<string>? existing, string? launchingSid, IEnumerable<string>? selected)
    {
        if (selected is null) return Defaults(existing, launchingSid);
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var sid in selected)
        {
            if (!IsValidSid(sid) || !seen.Add(sid)) continue;
            result.Add(sid);
        }
        return result;
    }
}
