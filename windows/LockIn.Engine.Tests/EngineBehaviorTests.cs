using LockIn.Engine.Engine;
using LockIn.Engine.Models;
using Xunit;

namespace LockIn.Engine.Tests;

public sealed class ArmingTests
{
    private static (WatchdogEngine Engine, FakeClock Clock) Create(bool assumeBrowserRunning = false, int timeoutSeconds = 60)
    {
        var options = new EngineOptions
        {
            TestMode = true,
            AssumeBrowserRunning = assumeBrowserRunning,
            ScanInstalledBrowsers = false,
            HeartbeatTimeoutSeconds = timeoutSeconds,
            DataDirectory = Path.Combine(Path.GetTempPath(), "lockin-tests", Guid.NewGuid().ToString("N")),
            ProtectedAccounts = new[]
            {
                new ProtectedAccount("alice", "PC\\alice"),
                new ProtectedAccount("SYSTEM", "NT AUTHORITY\\SYSTEM")
            }
        };
        var state = new WatchdogState
        {
            Configured = true,
            Groups = new List<Group>
            {
                new() { Id = "blocked", Name = "Blocked", Domains = new List<string> { "example.com" }, Enabled = true }
            }
        };
        var (engine, clock, _, _, _, _) = TestEngineFactory.Create(options, state);
        state.LastSampleMs = clock.NowMs;
        return (engine, clock);
    }

    private static Snapshot Heartbeat(WatchdogEngine engine, string sid, string host = "example.com") =>
        engine.HandleRequest(TestRequests.Create("heartbeat", new { host, focused = true }), sid, true);

    [Fact]
    public void ArmsOnlyAfterThreeConsecutiveHeartbeatsAndResetsAfterAGap()
    {
        var (engine, clock) = Create();
        Assert.False(Heartbeat(engine, "alice").EnforcementArmed);
        Assert.False(Heartbeat(engine, "alice").EnforcementArmed);
        Assert.True(Heartbeat(engine, "alice").EnforcementArmed);

        // A disarmed watchdog needs three fresh heartbeats again after a gap.
        engine.HandleRequest(TestRequests.Create("disarm", new { }), "alice", true);
        Heartbeat(engine, "alice");
        Heartbeat(engine, "alice");
        clock.Advance(121_000);
        Assert.False(Heartbeat(engine, "alice").EnforcementArmed);
        Heartbeat(engine, "alice");
        Assert.True(Heartbeat(engine, "alice").EnforcementArmed);
    }

    [Fact]
    public void FailClosedBlocksEveryEnabledZoneWhenASensorIsMissing()
    {
        var (engine, clock) = Create(assumeBrowserRunning: true, timeoutSeconds: 2);
        Heartbeat(engine, "alice");
        Heartbeat(engine, "alice");
        Heartbeat(engine, "alice");
        clock.Advance(3000);
        Heartbeat(engine, "alice");
        clock.Advance(1000);
        var decision = engine.Evaluate(clock.NowMs);
        Assert.True(decision.FailClosedActive);
        Assert.Equal(new[] { "example.com" }, decision.BlockedDomains);
        Assert.Contains("SYSTEM", decision.MissingSids);
        Assert.Contains("sensor missing: SYSTEM", engine.BuildSnapshot().EnforcementReason);
    }

    [Fact]
    public void AClockJumpRestartsSensorGracePeriods()
    {
        var (engine, clock) = Create(assumeBrowserRunning: true, timeoutSeconds: 2);
        Heartbeat(engine, "alice");
        Heartbeat(engine, "alice");
        Heartbeat(engine, "alice");
        engine.EnforcementPass();
        Assert.False(engine.Evaluate(clock.NowMs).FailClosedActive);

        // A sleep/resume jump must not be mistaken for a sensor that vanished.
        clock.Advance(20_000);
        engine.EnforcementPass();
        Assert.False(engine.Evaluate(clock.NowMs).FailClosedActive);

        clock.Advance(1000);
        engine.EnforcementPass();
        clock.Advance(1000);
        engine.EnforcementPass();
        clock.Advance(1000);
        engine.EnforcementPass();
        Assert.True(engine.Evaluate(clock.NowMs).FailClosedActive);
    }
}

public sealed class ConfigurationTests
{
    private static (WatchdogEngine Engine, FakeClock Clock) Create()
    {
        var options = new EngineOptions
        {
            TestMode = true,
            ScanInstalledBrowsers = false,
            DataDirectory = Path.Combine(Path.GetTempPath(), "lockin-tests", Guid.NewGuid().ToString("N"))
        };
        return TestEngineFactory.Create(options).Let(tuple => (tuple.Engine, tuple.Clock));
    }

    [Fact]
    public void BootstrapImportsOnceAndUpdateConfigReplaces()
    {
        var (engine, _) = Create();
        var bootstrap = engine.HandleRequest(TestRequests.Create("bootstrap", new
        {
            groups = new[] { new { id = "one", name = "One", domains = new[] { "one.example" }, enabled = true } },
            usage = new { },
            lockMode = false,
            privacyConsent = true
        }), "alice", true);
        Assert.True(bootstrap.Configured);
        Assert.Equal(new[] { "one" }, bootstrap.Groups.Select(group => group.Id).ToArray());

        // A second bootstrap must not overwrite an existing authoritative state.
        var second = engine.HandleRequest(TestRequests.Create("bootstrap", new
        {
            groups = new[] { new { id = "two", name = "Two", domains = new[] { "two.example" }, enabled = true } },
            usage = new { },
            lockMode = true,
            privacyConsent = true
        }), "alice", true);
        Assert.Equal(new[] { "one" }, second.Groups.Select(group => group.Id).ToArray());

        var updated = engine.HandleRequest(TestRequests.Create("updateConfig", new
        {
            groups = new[] { new { id = "two", name = "Two", domains = new[] { "two.example" }, enabled = true } },
            lockMode = true,
            privacyConsent = false
        }), "alice", true);
        Assert.Equal(new[] { "two" }, updated.Groups.Select(group => group.Id).ToArray());
        Assert.True(updated.LockMode);
        Assert.False(updated.PrivacyConsent);

        var cleared = engine.HandleRequest(TestRequests.Create("clearData", new { }), "alice", true);
        Assert.False(cleared.Configured);
        Assert.Empty(cleared.Groups);
    }

    [Fact]
    public void TimedReleasesExpireInTheWatchdogAndRunningOnesDoNot()
    {
        var (engine, clock) = Create();
        engine.HandleRequest(TestRequests.Create("bootstrap", new
        {
            groups = new[]
            {
                new
                {
                    id = "expired", name = "Expired", domains = new[] { "expired.example" }, enabled = false,
                    disarmedUntil = clock.NowMs - 1000, limit = new { minutes = 0 }
                },
                new
                {
                    id = "running", name = "Running", domains = new[] { "running.example" }, enabled = false,
                    disarmedUntil = clock.NowMs + 3600000, limit = new { minutes = 0 }
                }
            },
            usage = new { },
            lockMode = false,
            privacyConsent = true
        }), "alice", true);
        engine.StateSnapshot().EnforcementArmed = true;

        var decision = engine.Evaluate(clock.NowMs);
        var groups = engine.StateSnapshot().Groups.ToDictionary(group => group.Id!);
        Assert.True(groups["expired"].Enabled);
        Assert.Null(groups["expired"].DisarmedUntil);
        Assert.False(groups["running"].Enabled);
        Assert.Equal(clock.NowMs + 3600000, groups["running"].DisarmedUntil);
        Assert.Equal(new[] { "expired.example" }, decision.BlockedDomains);
    }
}

public sealed class AppZoneTests
{
    private static (WatchdogEngine Engine, FakeClock Clock) Create(Group group)
    {
        var options = new EngineOptions
        {
            TestMode = true,
            ScanInstalledBrowsers = false,
            DataDirectory = Path.Combine(Path.GetTempPath(), "lockin-tests", Guid.NewGuid().ToString("N"))
        };
        var state = new WatchdogState
        {
            Configured = true,
            EnforcementArmed = true,
            Groups = new List<Group> { group }
        };
        var (engine, clock, _, _, _, _) = TestEngineFactory.Create(options, state);
        state.LastSampleMs = clock.NowMs;
        return (engine, clock);
    }

    private static Group AppGroup(bool blockNetwork = false, GroupLimit? limit = null, GroupSchedule? schedule = null) => new()
    {
        Id = "app",
        Name = "App",
        Apps = new List<string> { "discord.exe" },
        Enabled = true,
        BlockNetwork = blockNetwork,
        Limit = limit,
        Schedule = schedule
    };

    [Fact]
    public void AScheduledAppZoneBlocksItsExecutables()
    {
        var allDay = new GroupSchedule
        {
            Days = new List<int> { 0, 1, 2, 3, 4, 5, 6 },
            Windows = new List<ScheduleWindow> { new() { Start = 0, End = 0 } }
        };
        var (engine, clock) = Create(AppGroup(blockNetwork: true, schedule: allDay));
        var decision = engine.Evaluate(clock.NowMs);
        Assert.Contains("discord.exe", decision.BlockedApps);
        Assert.Contains("discord.exe", decision.NetworkBlockedApps);
        Assert.Empty(decision.BlockedDomains);
    }

    [Fact]
    public void AppUsageCountsFromTheForegroundWindowOnceAcrossSources()
    {
        var group = AppGroup(limit: new GroupLimit { Minutes = 30 });
        var (engine, clock) = Create(group);

        engine.HandleRequest(TestRequests.Create("appHeartbeat", new
        {
            host = "", focused = true, foregroundExe = "discord.exe", foregroundExePath = @"C:\Apps\Discord.exe"
        }), "alice", true);
        clock.Advance(1000);
        engine.AddElapsedUsage(clock.NowMs);
        Assert.Equal(1000, engine.StateSnapshot().Usage["app"].Ms);

        // The same foreground report twice in one window is still one person.
        engine.HandleRequest(TestRequests.Create("appHeartbeat", new
        {
            host = "", focused = true, foregroundExe = "discord.exe", foregroundExePath = @"C:\Apps\Discord.exe"
        }), "alice", true);
        clock.Advance(1000);
        engine.AddElapsedUsage(clock.NowMs);
        Assert.Equal(2000, engine.StateSnapshot().Usage["app"].Ms);
    }
}

public sealed class UiaPrecedenceTests
{
    private static (WatchdogEngine Engine, FakeClock Clock) Create()
    {
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
                    Id = "video", Name = "Video", Domains = new List<string> { "youtube.com" },
                    Enabled = true, Limit = new GroupLimit { Minutes = 30 }
                }
            }
        };
        var (engine, clock, _, _, _, _) = TestEngineFactory.Create(options, state);
        state.LastSampleMs = clock.NowMs;
        return (engine, clock);
    }

    private static void ExtensionHeartbeat(WatchdogEngine engine) =>
        engine.HandleRequest(TestRequests.Create("heartbeat", new { host = "youtube.com", focused = true }), "alice", true);

    private static void UiaBrowserHeartbeat(WatchdogEngine engine) =>
        engine.HandleRequest(TestRequests.Create("appHeartbeat", new
        {
            host = "youtube.com", focused = true, foregroundExe = "chrome.exe",
            foregroundExePath = @"C:\Program Files\Google\Chrome\Application\chrome.exe"
        }), "alice", true);

    [Fact]
    public void AFreshExtensionBeatKeepsUiaFromDoubleCounting()
    {
        var (engine, clock) = Create();
        ExtensionHeartbeat(engine);
        UiaBrowserHeartbeat(engine);
        for (var second = 0; second < 12; second++)
        {
            clock.Advance(1000);
            if (second >= 9) UiaBrowserHeartbeat(engine);
            engine.AddElapsedUsage(clock.NowMs);
        }
        // Twelve seconds of one page is twelve seconds, never twenty-four.
        Assert.Equal(12000, engine.StateSnapshot().Usage["video"].Ms);
    }

    [Fact]
    public void UiaCoversABrowserWithoutTheExtension()
    {
        var (engine, clock) = Create();
        UiaBrowserHeartbeat(engine);
        clock.Advance(1000);
        engine.AddElapsedUsage(clock.NowMs);
        Assert.Equal(1000, engine.StateSnapshot().Usage["video"].Ms);
    }

    [Fact]
    public void UiaBrowserDataIsIgnoredWhileTheExtensionIsFresh()
    {
        var (engine, clock) = Create();
        ExtensionHeartbeat(engine);
        // UIA sees a different page; the extension remains the precise sensor.
        engine.HandleRequest(TestRequests.Create("appHeartbeat", new
        {
            host = "example.org", focused = true, foregroundExe = "chrome.exe",
            foregroundExePath = @"C:\Program Files\Google\Chrome\Application\chrome.exe"
        }), "alice", true);
        clock.Advance(1000);
        engine.AddElapsedUsage(clock.NowMs);
        Assert.Equal(1000, engine.StateSnapshot().Usage["video"].Ms);
    }
}

internal static class TupleExtensions
{
    public static TResult Let<T, TResult>(this T value, Func<T, TResult> map) => map(value);
}
