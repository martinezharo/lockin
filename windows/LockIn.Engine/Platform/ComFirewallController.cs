namespace LockIn.Engine.Platform;

/// <summary>
/// Windows Firewall rules through the COM API (HNetCfg.FwPolicy2), the same
/// store `New-NetFirewallRule -LocalUser` writes. Every rule carries the group
/// `LockInWatchdog`; reconcile removes only rules in that group that this
/// watchdog no longer wants, which is how old all-account rules are cleaned up
/// and adopted.
///
/// Per-account scoping uses INetFwRule3.LocalUserAuthorizedList. When the
/// machine refuses a scoped rule (an old firewall stack, a locked-down
/// service), the rule is retried without the user condition and the caller is
/// told: the block then covers every protected account rather than silently
/// covering none.
/// </summary>
public sealed class ComFirewallController : IFirewallController
{
    public const string GroupName = "LockInWatchdog";

    private const int NetFwActionBlock = 0;
    private const int NetFwDirectionOut = 1;
    private const int NetFwProfileAll = 0x7FFFFFFF;

    public FirewallReconcileResult Reconcile(IReadOnlyList<FirewallRuleSpec> desired)
    {
        var failed = false;
        var fallback = false;
        string? warning = null;
        try
        {
            var policyType = Type.GetTypeFromProgID("HNetCfg.FwPolicy2");
            if (policyType is null) return new FirewallReconcileResult(true, false, "Windows Firewall COM API is unavailable.");
            dynamic policy = Activator.CreateInstance(policyType)!;
            dynamic rules = policy.Rules;

            var existing = new Dictionary<string, dynamic>(StringComparer.OrdinalIgnoreCase);
            try
            {
                foreach (var item in (System.Collections.IEnumerable)rules)
                {
                    dynamic rule = item;
                    try
                    {
                        var grouping = (string?)rule.Grouping;
                        if (string.Equals(grouping, GroupName, StringComparison.Ordinal))
                        {
                            existing[(string)rule.Name] = rule;
                        }
                    }
                    catch
                    {
                        // A rule that cannot be read is not one of ours to remove.
                    }
                }
            }
            catch (Exception error)
            {
                return new FirewallReconcileResult(true, false, $"Could not enumerate firewall rules: {error.Message}");
            }

            var wanted = new HashSet<string>(desired.Select(spec => spec.Name), StringComparer.OrdinalIgnoreCase);
            foreach (var name in existing.Keys.ToList())
            {
                if (wanted.Contains(name)) continue;
                try { rules.Remove(name); }
                catch (Exception error) { failed = true; warning = $"Could not remove firewall rule {name}: {error.Message}"; }
            }

            foreach (var spec in desired)
            {
                try
                {
                    if (existing.TryGetValue(spec.Name, out var current))
                    {
                        if ((bool)current.Enabled != spec.Enabled) current.Enabled = spec.Enabled;
                        continue;
                    }
                    AddRule(rules, spec, scoped: spec.Sid is not null);
                }
                catch (Exception error) when (spec.Sid is not null)
                {
                    // The machine would not accept a per-account rule. An
                    // all-account rule is a broader block, never a weaker one.
                    try
                    {
                        AddRule(rules, spec, scoped: false);
                        fallback = true;
                        warning = $"Per-account firewall rules are unavailable ({error.Message}); {spec.Program} is blocked for every protected account.";
                    }
                    catch (Exception retryError)
                    {
                        failed = true;
                        warning = $"Could not create firewall rule for {spec.Program}: {retryError.Message}";
                    }
                }
                catch (Exception error)
                {
                    failed = true;
                    warning = $"Could not create firewall rule for {spec.Program}: {error.Message}";
                }
            }
        }
        catch (Exception error)
        {
            return new FirewallReconcileResult(true, fallback, $"Windows Firewall could not be reached: {error.Message}");
        }
        return new FirewallReconcileResult(failed, fallback, warning);
    }

    public void DisableAll()
    {
        try
        {
            var policyType = Type.GetTypeFromProgID("HNetCfg.FwPolicy2");
            if (policyType is null) return;
            dynamic policy = Activator.CreateInstance(policyType)!;
            dynamic rules = policy.Rules;
            foreach (var item in (System.Collections.IEnumerable)rules)
            {
                dynamic rule = item;
                try
                {
                    if (string.Equals((string?)rule.Grouping, GroupName, StringComparison.Ordinal) && (bool)rule.Enabled)
                    {
                        rule.Enabled = false;
                    }
                }
                catch
                {
                    // A rule that cannot be read is not one of ours to touch.
                }
            }
        }
        catch
        {
            // Emergency disarm has already disarmed the service; a firewall that
            // cannot be reached here is retried by the next service pass.
        }
    }

    private static void AddRule(dynamic rules, FirewallRuleSpec spec, bool scoped)
    {
        var ruleType = Type.GetTypeFromProgID("HNetCfg.FwRule");
        if (ruleType is null) throw new InvalidOperationException("HNetCfg.FwRule is unavailable.");
        dynamic rule = Activator.CreateInstance(ruleType)!;
        rule.Name = spec.Name;
        rule.Description = spec.DisplayName;
        rule.Grouping = GroupName;
        rule.Direction = NetFwDirectionOut;
        rule.Action = NetFwActionBlock;
        rule.Enabled = spec.Enabled;
        rule.Profiles = NetFwProfileAll;
        rule.InterfaceTypes = "All";
        rule.ApplicationName = spec.Program;
        if (scoped)
        {
            rule.LocalUserAuthorizedList = $"D:(A;;CC;;;{spec.Sid})";
        }
        rules.Add(rule);
    }
}
