using LockIn.Engine.Engine;
using LockIn.Engine.Models;
using LockIn.Engine.Platform;
using Xunit;

namespace LockIn.Engine.Tests;

/// <summary>The firewall half of tests/watchdog-accounts.ps1, driven through the engine.</summary>
public sealed class FirewallTests
{
    private static (WatchdogEngine Engine, FakeClock Clock, FakeNativeProbe Probe, FakeFirewall Firewall) Create()
    {
        var probe = new FakeNativeProbe
        {
            Browsers =
            {
                new BrowserProcess(10, 1, "chrome.exe"),
                new BrowserProcess(20, 2, "brave.exe")
            },
            OwnerSids = { [10] = "S-1-5-21-1-1001", [20] = "S-1-5-21-1-1002" },
            ImagePaths =
            {
                [10] = @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                [20] = @"C:\Users\bob\AppData\Local\BraveSoftware\Brave-Browser\Application\brave.exe"
            }
        };
        var options = new EngineOptions
        {
            TestMode = false,
            ScanInstalledBrowsers = false,
            HeartbeatTimeoutSeconds = 2,
            DataDirectory = Path.Combine(Path.GetTempPath(), "lockin-tests", Guid.NewGuid().ToString("N")),
            ProtectedAccounts = new[]
            {
                new ProtectedAccount("S-1-5-21-1-1001", "PC\\alice"),
                new ProtectedAccount("S-1-5-21-1-1002", "PC\\bob")
            }
        };
        var state = new WatchdogState
        {
            Configured = true,
            EnforcementArmed = true,
            FailClosed = true,
            Groups = new List<Group>
            {
                new() { Id = "blocked", Name = "Blocked", Domains = new List<string> { "example.com" }, Enabled = true }
            },
            BrowserPaths = new List<string>
            {
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Users\bob\AppData\Local\BraveSoftware\Brave-Browser\Application\brave.exe"
            }
        };
        var (engine, clock, _, firewall, _, _) = TestEngineFactory.Create(options, state, probe);
        state.LastSampleMs = clock.NowMs;
        return (engine, clock, probe, firewall);
    }

    private static void Heartbeat(WatchdogEngine engine, string sid) =>
        engine.HandleRequest(TestRequests.Create("heartbeat", new { host = "example.com", focused = true }), sid, true);

    [Fact]
    public void OneRulePerBrowserAndAccountAndOnlyTheMissingAccountIsCutOff()
    {
        var (engine, clock, probe, firewall) = Create();
        firewall.Rules["LockIn-Watchdog-chrome-1"] = new FakeFirewallRule { Name = "LockIn-Watchdog-chrome-1" };

        engine.EnforcementPass();
        Assert.False(firewall.Rules.ContainsKey("LockIn-Watchdog-chrome-1"));
        Assert.Equal(4, firewall.Rules.Count);
        Assert.Empty(firewall.EnabledUsers());
        Assert.DoesNotContain(firewall.Rules.Values,
            rule => rule.LocalUser is null || !System.Text.RegularExpressions.Regex.IsMatch(
                rule.LocalUser, "^D:\\(A;;CC;;;S-1-5-21-1-100[12]\\)$"));

        clock.Advance(1000);
        Heartbeat(engine, "S-1-5-21-1-1001");
        clock.Advance(2000);
        engine.EnforcementPass();

        var enabled = firewall.EnabledUsers();
        Assert.Equal(2, enabled.Count);
        Assert.All(enabled, user => Assert.EndsWith("1002)", user));

        clock.Advance(1000);
        engine.EnforcementPass();
        Assert.Equal(4, firewall.EnabledUsers().Count);

        // An owner that cannot be verified cuts off every protected account.
        // The unverified owner gets the same grace period a browser does, then
        // its absence becomes the whole machine's problem.
        probe.OwnerSids.Clear();
        clock.Advance(3000);
        engine.EnforcementPass();
        clock.Advance(3000);
        engine.EnforcementPass();
        Assert.Equal(4, firewall.EnabledUsers().Count);
    }

    [Fact]
    public void AppNetworkBlocksBecomeScopedRulesForKnownExecutables()
    {
        var probe = new FakeNativeProbe
        {
            Browsers = { new BrowserProcess(10, 1, "chrome.exe") },
            OwnerSids = { [10] = "alice" },
            ImagePaths = { [10] = @"C:\Program Files\Google\Chrome\Application\chrome.exe" }
        };
        var options = new EngineOptions
        {
            TestMode = false,
            ScanInstalledBrowsers = false,
            HeartbeatTimeoutSeconds = 60,
            DataDirectory = Path.Combine(Path.GetTempPath(), "lockin-tests", Guid.NewGuid().ToString("N")),
            ProtectedAccounts = new[] { new ProtectedAccount("alice", "PC\\alice") }
        };
        var state = new WatchdogState
        {
            Configured = true,
            EnforcementArmed = true,
            Groups = new List<Group>
            {
                new()
                {
                    Id = "app", Name = "App", Apps = new List<string> { "discord.exe" }, Enabled = true,
                    BlockNetwork = true,
                    Schedule = new GroupSchedule
                    {
                        Days = new List<int> { 0, 1, 2, 3, 4, 5, 6 },
                        Windows = new List<ScheduleWindow> { new() { Start = 0, End = 0 } }
                    }
                }
            }
        };
        var (engine, clock, _, firewall, _, _) = TestEngineFactory.Create(options, state, probe);
        state.LastSampleMs = clock.NowMs;

        engine.HandleRequest(TestRequests.Create("appHeartbeat", new
        {
            host = "", focused = true, foregroundExe = "discord.exe",
            foregroundExePath = @"C:\Users\alice\AppData\Local\Discord\Discord.exe"
        }), "alice", true);
        engine.EnforcementPass();

        var decision = engine.Evaluate(clock.NowMs);
        Assert.Contains("discord.exe", decision.BlockedApps);
        Assert.Contains("discord.exe", decision.NetworkBlockedApps);
        var appRule = firewall.Rules.Values.Single(rule => rule.Program.EndsWith("Discord.exe", StringComparison.OrdinalIgnoreCase));
        Assert.True(appRule.Enabled);
        Assert.True(appRule.NetworkBlock);
        Assert.Equal("D:(A;;CC;;;alice)", appRule.LocalUser);
    }
}
