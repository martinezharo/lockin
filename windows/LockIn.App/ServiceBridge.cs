using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using LockIn.Engine.Engine;
using LockIn.Engine.Protocol;
using Microsoft.Win32;

namespace LockIn.App;

public sealed class AppSettings
{
    public int Port { get; init; } = 8765;

    public static AppSettings Load()
    {
        var port = 8765;
        try
        {
            using var key = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                .OpenSubKey(@"SOFTWARE\LockIn");
            if (key?.GetValue("Port") is int stored && stored is > 0 and < 65536) port = stored;
        }
        catch
        {
            // The default port is the documented one.
        }
        return new AppSettings { Port = port };
    }

    public string WebRoot => Path.Combine(AppContext.BaseDirectory, "web");

    public string Version =>
        Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";

    public string WebViewDataFolder => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LockIn", "WebView2");
}

public sealed record AppHeartbeatPayload(string Host, string Url, bool Focused, string ForegroundExe, string ForegroundExePath);

/// <summary>
/// The app's view of the service: the same loopback endpoint the extension
/// uses, with the same JSON. Requests never carry an extension heartbeat.
/// </summary>
public sealed class ServiceBridge : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };

    public ServiceBridge(int port)
    {
        Port = port;
        _http.BaseAddress = new Uri($"http://127.0.0.1:{port}");
    }

    public int Port { get; }

    public async Task<Snapshot?> GetHealthAsync(CancellationToken token = default)
    {
        try
        {
            using var response = await _http.GetAsync("/health", token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(token).ConfigureAwait(false);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: token).ConfigureAwait(false);
            return document.RootElement.TryGetProperty("data", out var data)
                ? data.Deserialize<Snapshot>(JsonHelpers.Protocol)
                : null;
        }
        catch
        {
            return null;
        }
    }

    public async Task<bool> SendAppHeartbeatAsync(AppHeartbeatPayload payload)
    {
        try
        {
            await PostAsync("appHeartbeat", payload).ConfigureAwait(false);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task<bool> DisarmAsync()
    {
        try
        {
            await PostAsync("disarm", new { }).ConfigureAwait(false);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private async Task<JsonElement> PostAsync(string type, object payload)
    {
        var body = JsonSerializer.Serialize(new { type, requestId = Guid.NewGuid().ToString("N"), payload }, JsonHelpers.Protocol);
        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        using var response = await _http.PostAsync("/api/request", content).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        var message = JsonDocument.Parse(text).RootElement;
        if (!response.IsSuccessStatusCode || !message.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True)
        {
            var error = message.TryGetProperty("error", out var value) ? value.GetString() : $"HTTP {response.StatusCode}";
            throw new InvalidOperationException(error);
        }
        return message.TryGetProperty("data", out var data) ? data : default;
    }

    public void Dispose() => _http.Dispose();
}
