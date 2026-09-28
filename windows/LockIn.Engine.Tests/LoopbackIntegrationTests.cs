using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using LockIn.Engine.Engine;
using LockIn.Engine.Protocol;
using LockIn.Service;
using Xunit;

namespace LockIn.Engine.Tests;

/// <summary>
/// The end-to-end loopback test: the real service host in test mode (no
/// registry, no firewall) on a private port, driven exactly the way the
/// extension drives it.
/// </summary>
public sealed class LoopbackIntegrationTests : IAsyncLifetime
{
    private readonly int _port = FreePort();
    private readonly string _dataDirectory = Path.Combine(Path.GetTempPath(), "lockin-e2e", Guid.NewGuid().ToString("N"));
    private readonly HttpClient _client = new();
    private ServiceRunner _runner = null!;
    private string _currentUserSid = "";

    public async Task InitializeAsync()
    {
        _currentUserSid = WindowsIdentity.GetCurrent().User!.Value;
        _client.BaseAddress = new Uri($"http://127.0.0.1:{_port}");
        _runner = new ServiceRunner(new EngineOptions
        {
            DataDirectory = _dataDirectory,
            Port = _port,
            HeartbeatTimeoutSeconds = 2,
            TestMode = true,
            AssumeBrowserRunning = true,
            ScanInstalledBrowsers = false,
            ProtectedAccounts = new[]
            {
                new ProtectedAccount(_currentUserSid, "test\\user"),
                new ProtectedAccount("S-1-5-18", "NT AUTHORITY\\SYSTEM")
            }
        });
        await _runner.StartAsync();
    }

    public Task DisposeAsync()
    {
        _runner.Stop();
        _runner.Dispose();
        _client.Dispose();
        try { Directory.Delete(_dataDirectory, recursive: true); } catch { }
        return Task.CompletedTask;
    }

    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private async Task<JsonElement> Send(string type, object payload)
    {
        var requestId = $"test-{Guid.NewGuid():N}";
        var body = JsonSerializer.Serialize(new { type, requestId, payload }, JsonHelpers.Protocol);
        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/api/request", content);
        var message = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        if (!response.IsSuccessStatusCode)
        {
            Assert.Fail(message.TryGetProperty("error", out var error) ? error.GetString() : response.StatusCode.ToString());
        }
        Assert.True(message.GetProperty("ok").GetBoolean());
        Assert.Equal(requestId, message.GetProperty("requestId").GetString());
        return message.GetProperty("data");
    }

    private Task<JsonElement> Heartbeat(string host = "example.com", string url = "") =>
        Send("heartbeat", new { host, url, focused = true });

    private static string?[] TickingGroupIds(JsonElement data) =>
        data.TryGetProperty("usageSession", out var session) && session.ValueKind == JsonValueKind.Object
            ? session.GetProperty("groupIds").EnumerateArray().Select(value => value.GetString()).ToArray()
            : Array.Empty<string?>();

    [Fact]
    public async Task ArmsAfterThreeHeartbeatsAndReportsThePolicy()
    {
        var bootstrap = await Send("bootstrap", new
        {
            groups = new[]
            {
                new
                {
                    id = "permanent-test", name = "Permanent test", domains = new[] { "example.com" },
                    exceptions = new[] { "example.com/always-open" }, enabled = true, schedule = (object?)null,
                    limit = new { minutes = 0 }, createdAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), mode = "schedule"
                }
            },
            usage = new { },
            lockMode = false,
            privacyConsent = true
        });
        Assert.False(bootstrap.GetProperty("enforcementArmed").GetBoolean());

        await Heartbeat();
        await Heartbeat();
        var armed = await Heartbeat();
        Assert.True(armed.GetProperty("enforcementArmed").GetBoolean());
        Assert.False(armed.GetProperty("firewallBlocked").GetBoolean());
        Assert.Equal(new[] { "example.com" }, armed.GetProperty("blockedDomains").EnumerateArray().Select(value => value.GetString()).ToArray());
        Assert.Equal(new[] { "example.com/always-open" }, armed.GetProperty("allowedDomains").EnumerateArray().Select(value => value.GetString()).ToArray());
        Assert.True(armed.GetProperty("supportsExceptions").GetBoolean());
        Assert.True(armed.GetProperty("supportsAppZones").GetBoolean());

        // The sensor gives up on a slow answer, so every answer must be quick.
        for (var index = 0; index < 10; index++)
        {
            var stopwatch = Stopwatch.StartNew();
            await Heartbeat();
            stopwatch.Stop();
            Assert.True(stopwatch.ElapsedMilliseconds < 100, $"heartbeat took {stopwatch.ElapsedMilliseconds} ms");
        }

        // A client that hangs up mid-request must not take the service with it.
        for (var index = 0; index < 5; index++)
        {
            using var cancellation = new CancellationTokenSource(1);
            try
            {
                await _client.PostAsync("/api/request",
                    new StringContent(JsonSerializer.Serialize(new { type = "heartbeat", requestId = "abandoned", payload = new { } })),
                    cancellation.Token);
            }
            catch
            {
                // Expected: the request was abandoned.
            }
        }
        using (var garbage = new StringContent("not json"))
        {
            var response = await _client.PostAsync("/api/request", garbage);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        Assert.True((await Heartbeat()).GetProperty("enforcementArmed").GetBoolean());
    }

    [Fact]
    public async Task FailClosedActivatesWhenAProtectedSensorDisappears()
    {
        await Send("bootstrap", new
        {
            groups = new[]
            {
                new { id = "permanent", name = "Permanent", domains = new[] { "example.com" }, enabled = true, limit = new { minutes = 0 } }
            },
            usage = new { },
            lockMode = false,
            privacyConsent = true
        });
        await Heartbeat();
        await Heartbeat();
        await Heartbeat();

        await Task.Delay(3000);
        var missing = await Heartbeat();
        Assert.True(missing.GetProperty("failClosedActive").GetBoolean());
        Assert.True(missing.GetProperty("firewallBlocked").GetBoolean());
        Assert.Contains("sensor missing: SYSTEM", missing.GetProperty("enforcementReason").GetString());
        var sensors = missing.GetProperty("sensors").EnumerateArray()
            .ToDictionary(sensor => sensor.GetProperty("account").GetString()!);
        Assert.Equal(0, sensors["SYSTEM"].GetProperty("lastHeartbeatMs").GetInt64());
        Assert.True(sensors.Values.Any(sensor => sensor.GetProperty("lastHeartbeatMs").GetInt64() > 0));
    }

    [Fact]
    public async Task UrlRulesExceptionsAndCaseSensitivityMatchThePowerShellWatchdog()
    {
        await Send("bootstrap", new
        {
            groups = new[] { new { id = "seed", name = "Seed", domains = new[] { "example.com" }, enabled = true, limit = new { minutes = 0 } } },
            usage = new { },
            lockMode = false,
            privacyConsent = true
        });
        await Heartbeat();
        await Heartbeat();
        await Heartbeat();

        await Send("updateConfig", new
        {
            groups = new[]
            {
                new { id = "url", name = "URL allowance", domains = new[] { "example.com/Path?v=ABC" }, enabled = true, schedule = (object?)null, limit = new { minutes = 1 } }
            },
            privacyConsent = true,
            lockMode = false
        });
        var outside = await Heartbeat("example.com", "https://example.com/elsewhere");
        Assert.DoesNotContain("url", TickingGroupIds(outside));
        var inside = await Heartbeat("example.com", "https://example.com/Path?extra=1&v=ABC");
        Assert.Contains("url", TickingGroupIds(inside));
        Assert.Equal(new[] { "example.com/Path?v=ABC" },
            inside.GetProperty("groups")[0].GetProperty("domains").EnumerateArray().Select(value => value.GetString()).ToArray());

        await Send("updateConfig", new
        {
            groups = new[]
            {
                new { id = "excepted", name = "Excepted allowance", domains = new[] { "example.com" }, exceptions = new[] { "example.com/free" }, enabled = true, limit = new { minutes = 1 } }
            },
            privacyConsent = true,
            lockMode = false
        });
        var excepted = await Heartbeat("example.com", "https://example.com/free/report");
        Assert.DoesNotContain("excepted", TickingGroupIds(excepted));

        var caseSensitive = await Send("updateConfig", new
        {
            groups = new[]
            {
                new { id = "case", name = "Distinct paths", domains = new[] { "example.com/Path", "example.com/path" }, enabled = true, limit = new { minutes = 0 } }
            },
            privacyConsent = true,
            lockMode = false
        });
        Assert.Equal(2, caseSensitive.GetProperty("blockedDomains").GetArrayLength());
    }

    [Fact]
    public async Task TimedReleasesExpireOnTheWatchdogSide()
    {
        await Send("bootstrap", new
        {
            groups = new[] { new { id = "seed", name = "Seed", domains = new[] { "example.com" }, enabled = true, limit = new { minutes = 0 } } },
            usage = new { },
            lockMode = false,
            privacyConsent = true
        });
        await Heartbeat();
        await Heartbeat();
        await Heartbeat();

        var releases = await Send("updateConfig", new
        {
            groups = new object[]
            {
                new { id = "expired", name = "Expired release", domains = new[] { "expired.example" }, enabled = false, disarmedUntil = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 1000, limit = new { minutes = 0 } },
                new { id = "running", name = "Running release", domains = new[] { "running.example" }, enabled = false, disarmedUntil = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 3600000, limit = new { minutes = 0 } }
            },
            privacyConsent = true,
            lockMode = false
        });
        var groups = releases.GetProperty("groups").EnumerateArray().ToDictionary(group => group.GetProperty("id").GetString()!);
        Assert.True(groups["expired"].GetProperty("enabled").GetBoolean());
        Assert.Equal(JsonValueKind.Null, groups["expired"].GetProperty("disarmedUntil").ValueKind);
        Assert.False(groups["running"].GetProperty("enabled").GetBoolean());
        Assert.Equal(new[] { "expired.example" },
            releases.GetProperty("blockedDomains").EnumerateArray().Select(value => value.GetString()).ToArray());
    }
}

/// <summary>The 403 path: only a protected account's requests are accepted.</summary>
public sealed class ProtectedAccountTests : IAsyncLifetime
{
    private readonly int _port = FreePort();
    private readonly string _dataDirectory = Path.Combine(Path.GetTempPath(), "lockin-e2e", Guid.NewGuid().ToString("N"));
    private readonly HttpClient _client = new();
    private ServiceRunner _runner = null!;

    public async Task InitializeAsync()
    {
        _client.BaseAddress = new Uri($"http://127.0.0.1:{_port}");
        _runner = new ServiceRunner(new EngineOptions
        {
            DataDirectory = _dataDirectory,
            Port = _port,
            TestMode = true,
            AssumeBrowserRunning = true,
            ScanInstalledBrowsers = false,
            ProtectedAccounts = new[] { new ProtectedAccount("S-1-5-18", "NT AUTHORITY\\SYSTEM") }
        });
        await _runner.StartAsync();
    }

    public Task DisposeAsync()
    {
        _runner.Stop();
        _runner.Dispose();
        _client.Dispose();
        try { Directory.Delete(_dataDirectory, recursive: true); } catch { }
        return Task.CompletedTask;
    }

    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    [Fact]
    public async Task AnotherWindowsAccountIsRejectedButEmergencyDisarmIsNot()
    {
        var heartbeat = await Post(new { type = "heartbeat", requestId = "wrong-account", payload = new { } });
        Assert.Equal(HttpStatusCode.Forbidden, heartbeat.StatusCode);
        var message = JsonDocument.Parse(await heartbeat.Content.ReadAsStringAsync()).RootElement;
        Assert.Contains("not the protected Lock In sensor", message.GetProperty("error").GetString());

        var disarm = await Post(new { type = "disarm", requestId = "emergency", payload = new { } });
        Assert.Equal(HttpStatusCode.OK, disarm.StatusCode);
    }

    private Task<HttpResponseMessage> Post(object body) =>
        _client.PostAsync("/api/request", new StringContent(JsonSerializer.Serialize(body, JsonHelpers.Protocol), Encoding.UTF8, "application/json"));
}
