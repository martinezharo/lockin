using LockIn.Engine.Models;

namespace LockIn.Engine.Rules;

/// <summary>
/// Domain and URL rules, ported instruction for instruction from the
/// PowerShell watchdog so the two implementations decide the same pages.
/// </summary>
public static class SiteRules
{
    private static readonly string[] TrackingParameters = { "fbclid", "gclid", "msclkid" };

    public static string NormalizeDomain(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var value = raw.Trim().ToLowerInvariant();
        try
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(value, "^[a-z]+://"))
            {
                value = "https://" + value;
            }
            value = new Uri(value).Host.ToLowerInvariant();
        }
        catch
        {
            value = raw.Trim().ToLowerInvariant().Split('/')[0];
        }
        value = value.Trim('.');
        if (value.StartsWith("www.", StringComparison.Ordinal)) value = value[4..];
        return value;
    }

    /// <summary>
    /// Turns a typed site rule into the canonical stored form. Throws with the
    /// message the dashboard shows when the input cannot be a rule.
    /// </summary>
    public static string NormalizeSite(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var value = raw.Trim();
        if (System.Text.RegularExpressions.Regex.IsMatch(value, "^[a-z][a-z0-9+.-]*://") &&
            !System.Text.RegularExpressions.Regex.IsMatch(value, "^https?://"))
        {
            throw new InvalidOperationException("Only HTTP(S) site rules are supported.");
        }
        if (!System.Text.RegularExpressions.Regex.IsMatch(value, "^https?://"))
        {
            value = "https://" + value;
        }
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || !string.IsNullOrEmpty(uri.UserInfo) ||
            System.Text.RegularExpressions.Regex.IsMatch(uri.Host + uri.AbsolutePath + uri.Query + uri.Fragment, "[\\s*@]"))
        {
            throw new InvalidOperationException("Invalid site rule.");
        }
        var hostName = NormalizeDomain(uri.Host);
        if (hostName.Length == 0 || !System.Text.RegularExpressions.Regex.IsMatch(hostName, "^[a-z0-9.-]+$") ||
            hostName.StartsWith('.') || hostName.Contains(".."))
        {
            throw new InvalidOperationException("Invalid site hostname.");
        }
        var portPart = uri.IsDefaultPort ? "" : ":" + uri.Port.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var query = uri.Query.TrimStart('?');
        var queryParts = query
            .Split('&')
            .Where(part => part.Length > 0)
            .Where(part => !IsTrackingParameter(part.Split('=', 2)[0]))
            .ToList();
        var queryPart = queryParts.Count > 0 ? "?" + string.Join("&", queryParts) : "";
        var fragmentPart = uri.Fragment == "#" ? "" : uri.Fragment;
        var pathPart = uri.AbsolutePath == "/" && queryPart.Length == 0 && fragmentPart.Length == 0
            ? ""
            : uri.AbsolutePath;
        return hostName + portPart + pathPart + queryPart + fragmentPart;
    }

    private static bool IsTrackingParameter(string key)
    {
        if (key.Equals("fbclid", StringComparison.OrdinalIgnoreCase) ||
            key.Equals("gclid", StringComparison.OrdinalIgnoreCase) ||
            key.Equals("msclkid", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        return key.StartsWith("utm_", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Chromium ignores fragments in URL policy. A fragment rule is enforced by
    /// the extension and must never become a broader browser block.
    /// </summary>
    public static string PolicyFilter(string rule)
    {
        if (rule.Contains('#')) return "";
        return rule.Replace('?', '@');
    }

    public static bool TestSiteMatches(string? page, string? rule)
    {
        if (string.IsNullOrWhiteSpace(page) || string.IsNullOrWhiteSpace(rule)) return false;
        try
        {
            if (!Uri.TryCreate(page, UriKind.Absolute, out var url)) return false;
            if (url.Scheme != "http" && url.Scheme != "https") return false;
            var listed = new Uri("https://" + rule);
            var hostName = NormalizeDomain(url.Host);
            if (!hostName.Equals(listed.Host, StringComparison.OrdinalIgnoreCase) &&
                !hostName.EndsWith("." + listed.Host, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            if (!listed.IsDefaultPort && url.Port != listed.Port) return false;
            if (!url.AbsolutePath.StartsWith(listed.AbsolutePath, StringComparison.Ordinal)) return false;

            foreach (var token in listed.Query.TrimStart('?').Split('&'))
            {
                if (token.Length == 0) continue;
                var wanted = token.Split('=', 2);
                var matched = false;
                foreach (var actualToken in url.Query.TrimStart('?').Split('&'))
                {
                    var actual = actualToken.Split('=', 2);
                    var sameKey = Unescape(actual[0]) == Unescape(wanted[0]);
                    var actualValue = actual.Length > 1 ? actual[1] : "";
                    var wantedValue = wanted.Length > 1 ? wanted[1] : "";
                    if (sameKey && Unescape(actualValue) == Unescape(wantedValue))
                    {
                        matched = true;
                        break;
                    }
                }
                if (!matched) return false;
            }

            if (listed.Fragment.Length > 0 && !url.Fragment.StartsWith(listed.Fragment, StringComparison.Ordinal))
            {
                return false;
            }
            return true;
        }
        catch
        {
            return false;
        }
    }

    // The watchdog compares decoded token values, and a form-encoded space
    // arrives as '+', so both sides are normalized before the compare.
    private static string Unescape(string value)
    {
        return Uri.UnescapeDataString(value.Replace('+', ' '));
    }

    public static bool TestGroupMatchesHost(Group group, string? hostName, string url = "")
    {
        foreach (var exception in group.Exceptions ?? new List<string>())
        {
            if (TestSiteMatches(url, exception)) return false;
        }
        foreach (var domain in group.Domains ?? new List<string>())
        {
            if (System.Text.RegularExpressions.Regex.IsMatch(domain, "[/?:]"))
            {
                if (TestSiteMatches(url, domain)) return true;
                continue;
            }
            if (hostName is not null && (hostName == domain ||
                hostName.EndsWith("." + domain, StringComparison.OrdinalIgnoreCase)))
            {
                return true;
            }
        }
        return false;
    }

    public static List<Group> NormalizeGroups(IEnumerable<Group?>? groups)
    {
        var result = new List<Group>();
        foreach (var group in groups ?? Enumerable.Empty<Group?>())
        {
            if (group is null || string.IsNullOrWhiteSpace(group.Id)) continue;
            group.Domains = (group.Domains ?? new List<string>())
                .Select(NormalizeSite)
                .Where(rule => rule.Length > 0)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(rule => rule, StringComparer.Ordinal)
                .ToList();
            group.Exceptions = (group.Exceptions ?? new List<string>())
                .Select(NormalizeSite)
                .Where(rule => rule.Length > 0)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(rule => rule, StringComparer.Ordinal)
                .ToList();
            group.Apps = (group.Apps ?? new List<string>())
                .Select(NormalizeAppTarget)
                .Where(app => app.Length > 0)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(app => app, StringComparer.Ordinal)
                .ToList();
            var validExceptions = new List<string>();
            foreach (var exception in group.Exceptions)
            {
                if (!Uri.TryCreate("https://" + exception, UriKind.Absolute, out var candidate)) continue;
                var fits = group.Domains.Any(domain => TestSiteMatches("https://" + exception, domain));
                var isPathOrQuery = candidate.Fragment.Length == 0 &&
                    (candidate.AbsolutePath != "/" || candidate.Query.Length > 0);
                if (isPathOrQuery && fits) validExceptions.Add(exception);
            }
            group.Exceptions = validExceptions;
            if (string.IsNullOrWhiteSpace(group.Name)) group.Name = "Unnamed zone";
            result.Add(group);
        }
        return result;
    }

    /// <summary>
    /// Executable targets are matched by file name, because Windows paths in an
    /// app zone would break the moment the app updates. The stored form is a
    /// bare lowercase file name such as `discord.exe`.
    /// </summary>
    public static string NormalizeAppTarget(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var value = raw.Trim().Replace('/', '\\');
        var lastSlash = value.LastIndexOf('\\');
        if (lastSlash >= 0) value = value[(lastSlash + 1)..];
        value = value.ToLowerInvariant();
        if (value.Length == 0) return "";
        if (!value.Contains('.')) value += ".exe";
        return value;
    }
}
