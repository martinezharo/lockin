using System.Text.Json;
using LockIn.Engine.Engine;
using LockIn.Engine.Models;
using LockIn.Engine.Platform;
using LockIn.Engine.Protocol;
using Xunit;

namespace LockIn.Engine.Tests;

public static class TestRequests
{
    public static RequestEnvelope Create(string type, object payload) => new()
    {
        Type = type,
        RequestId = "test",
        Payload = JsonSerializer.SerializeToElement(payload, JsonHelpers.Protocol)
    };
}

/// <summary>The cases from tests/watchdog-accounts.ps1 (usage half).</summary>
public sealed class UsageTests
{
    private static (WatchdogEngine Engine, FakeClock Clock) Create()
    {
        var options = new EngineOptions
        {
            TestMode = false,
            ScanInstalledBrowsers = false,
            HeartbeatTimeoutSeconds = 60,
            DataDirectory = Path.Combine(Path.GetTempPath(), "lockin-tests", Guid.NewGuid().ToString("N")),
            ProtectedAccounts = new[]
            {
                new ProtectedAccount("alice", "PC\\alice"),
                new ProtectedAccount("bob", "PC\\bob")
            }
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

    private static void Heartbeat(WatchdogEngine engine, string sid, string host, bool sessionActive, bool focused = true)
    {
        engine.HandleRequest(TestRequests.Create("heartbeat", new { host, url = "", focused }), sid, sessionActive);
    }

    private static long UsedMs(WatchdogEngine engine) => engine.StateSnapshot().Usage["video"].Ms;

    [Fact]
    public void OnlyTheAccountInFrontCountsAndTheGroupCountsOnce()
    {
        var (engine, clock) = Create();

        Heartbeat(engine, "alice", "youtube.com", sessionActive: true);
        clock.Advance(1000);
        Heartbeat(engine, "bob", "youtube.com", sessionActive: false);
        Assert.Equal(1000, UsedMs(engine));

        // Two accounts in front on the same zone spend one person's time, once.
        clock.Advance(1000);
        Heartbeat(engine, "bob", "youtube.com", sessionActive: true);
        Assert.Equal(2000, UsedMs(engine));

        // Only the switched-away account is on the site: nothing is spent.
        Heartbeat(engine, "bob", "youtube.com", sessionActive: false);
        Heartbeat(engine, "alice", "example.org", sessionActive: true);
        clock.Advance(1000);
        Heartbeat(engine, "alice", "example.org", sessionActive: true);
        Assert.Equal(2000, UsedMs(engine));
    }

    [Fact]
    public void AStaleSensorStopsCountingAndALongGapIsCapped()
    {
        var (engine, clock) = Create();
        Heartbeat(engine, "alice", "youtube.com", sessionActive: true);
        clock.Advance(1000);
        Heartbeat(engine, "alice", "youtube.com", sessionActive: true);
        Assert.Equal(1000, UsedMs(engine));

        clock.Advance(60000);
        engine.AddElapsedUsage(clock.NowMs);
        Assert.Equal(1000, UsedMs(engine));

        Heartbeat(engine, "alice", "youtube.com", sessionActive: true);
        var before = UsedMs(engine);
        engine.StateSnapshot().LastSampleMs = clock.NowMs - 3600000;
        engine.AddElapsedUsage(clock.NowMs);
        Assert.Equal(before + 10000, UsedMs(engine));
    }
}

/// <summary>The cases from tests/watchdog-sessions.ps1.</summary>
public sealed class SessionTests
{
    private static (WatchdogEngine Engine, FakeClock Clock, FakeNativeProbe Probe) Create(FakeNativeProbe probe)
    {
        var options = new EngineOptions
        {
            TestMode = false,
            ScanInstalledBrowsers = false,
            HeartbeatTimeoutSeconds = 2,
            DataDirectory = Path.Combine(Path.GetTempPath(), "lockin-tests", Guid.NewGuid().ToString("N")),
            ProtectedAccounts = new[]
            {
                new ProtectedAccount("sid-1", "First"),
                new ProtectedAccount("sid-2", "Second")
            }
        };
        var state = new WatchdogState
        {
            Configured = true,
            EnforcementArmed = true,
            Groups = new List<Group>
            {
                new() { Id = "blocked", Name = "Blocked", Domains = new List<string> { "example.com" }, Enabled = true }
            }
        };
        var (engine, clock, _, _, _, _) = TestEngineFactory.Create(options, state, probe);
        state.LastSampleMs = clock.NowMs;
        return (engine, clock, probe);
    }

    private static FakeNativeProbe TwoBrowsers() => new()
    {
        Browsers =
        {
            new BrowserProcess(10, 1, "chrome.exe"),
            new BrowserProcess(20, 2, "brave.exe")
        },
        OwnerSids = { [10] = "sid-1", [20] = "sid-2" },
        ImagePaths = { [10] = @"C:\Program Files\Google\Chrome\Application\chrome.exe" }
    };

    [Fact]
    public void DisconnectedSessionsDoNotRequireASensorAndSwitchingMovesTheRequirement()
    {
        var probe = TwoBrowsers();
        probe.SessionStates[2] = 4;
        var (engine, clock, _) = Create(probe);

        engine.Evaluate(clock.NowMs);
        clock.Advance(3000);
        var missing = engine.Evaluate(clock.NowMs).MissingSids;
        Assert.Equal(new[] { "sid-1" }, missing);

        probe.SessionStates.Clear();
        probe.SessionStates[1] = 4;
        clock.Advance(3000);
        engine.Evaluate(clock.NowMs);
        clock.Advance(3000);
        missing = engine.Evaluate(clock.NowMs).MissingSids;
        Assert.Equal(new[] { "sid-2" }, missing);

        probe.SessionStates.Clear();
        clock.Advance(3000);
        engine.Evaluate(clock.NowMs);
        clock.Advance(3000);
        missing = engine.Evaluate(clock.NowMs).MissingSids;
        Assert.Equal(new[] { "sid-1", "sid-2" }, missing);
    }

    [Fact]
    public void AnUnverifiableBrowserOwnerFailsClosed()
    {
        var probe = TwoBrowsers();
        probe.OwnerSids.Clear();
        var (engine, clock, _) = Create(probe);

        engine.Evaluate(clock.NowMs);
        clock.Advance(3000);
        var missing = engine.Evaluate(clock.NowMs).MissingSids;
        Assert.Contains("*", missing);
    }
}
