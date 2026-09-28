using System.Net;
using System.Text;
using System.Text.Json;
using LockIn.Engine.Engine;
using LockIn.Engine.Platform;
using LockIn.Engine.Protocol;

namespace LockIn.Service;

/// <summary>
/// The loopback endpoint the extension has always talked to. The protocol is
/// byte-for-byte compatible with the PowerShell watchdog's: the same paths, the
/// same CORS answers, the same 403 for an account that is not protected.
/// </summary>
public sealed class LoopbackServer : IDisposable
{
    private static readonly System.Text.RegularExpressions.Regex ExtensionOrigin =
        new("^chrome-extension://[a-p]{32}$", System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>The app's WebView2 dashboard is served from this virtual host.</summary>
    public const string AppOrigin = "https://lockin.local";

    private readonly WatchdogEngine _engine;
    private readonly INativeProbe _probe;
    private readonly FileLog _log;
    private readonly int _port;
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly CancellationTokenSource _cancellation = new();
    private HttpListener? _listener;
    private Task? _acceptLoop;

    public LoopbackServer(WatchdogEngine engine, INativeProbe probe, FileLog log, int port)
    {
        _engine = engine;
        _probe = probe;
        _log = log;
        _port = port;
    }

    public Task Ready => _ready.Task;

    public void Start()
    {
        _acceptLoop = Task.Run(() => AcceptLoopAsync(_cancellation.Token));
    }

    public void Stop()
    {
        _cancellation.Cancel();
        try { _listener?.Stop(); } catch { }
        try { _listener?.Close(); } catch { }
        try { _acceptLoop?.Wait(TimeSpan.FromSeconds(2)); } catch { }
    }

    private async Task AcceptLoopAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            if (_listener is null || !_listener.IsListening)
            {
                try
                {
                    _listener = new HttpListener();
                    _listener.Prefixes.Add($"http://127.0.0.1:{_port}/");
                    _listener.Start();
                    _ready.TrySetResult();
                    _log.Write($"Watchdog listening on loopback port {_port}.");
                }
                catch (Exception error)
                {
                    _log.Write($"Listener failed to start, retrying: {error.Message}");
                    await Task.Delay(1000, token).ConfigureAwait(false);
                    continue;
                }
            }
            HttpListenerContext context;
            try
            {
                context = await _listener.GetContextAsync().ConfigureAwait(false);
            }
            catch (Exception error)
            {
                if (token.IsCancellationRequested) break;
                _log.Write($"Listener failed, restarting it: {error.Message}");
                try { _listener?.Close(); } catch { }
                _listener = null;
                await Task.Delay(1000, token).ConfigureAwait(false);
                continue;
            }
            _ = Task.Run(() => Handle(context), CancellationToken.None);
        }
    }

    private void Handle(HttpListenerContext context)
    {
        try
        {
            var origin = context.Request.Headers["Origin"];
            if (!string.IsNullOrWhiteSpace(origin) && !ExtensionOrigin.IsMatch(origin) && origin != AppOrigin)
            {
                WriteJson(context, 403, new { ok = false, error = "Only a Chrome extension origin may use this endpoint." });
                return;
            }
            if (context.Request.HttpMethod == "OPTIONS")
            {
                WriteJson(context, 204, null);
                return;
            }
            if (context.Request.HttpMethod == "GET" && context.Request.Url?.AbsolutePath == "/health")
            {
                WriteJson(context, 200, new { ok = true, data = _engine.BuildSnapshot() });
                return;
            }
            if (context.Request.HttpMethod != "POST" || context.Request.Url?.AbsolutePath != "/api/request")
            {
                WriteJson(context, 404, new { ok = false, error = "Not found" });
                return;
            }

            RequestEnvelope? request;
            try
            {
                using var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding);
                var body = reader.ReadToEnd();
                request = JsonSerializer.Deserialize<RequestEnvelope>(body, JsonHelpers.Protocol);
                if (request is null) throw new InvalidDataException("No request object.");
            }
            catch (Exception error)
            {
                WriteJson(context, 400, new { ok = false, error = error.Message });
                return;
            }

            var requestUserSid = "";
            var sessionActive = true;
            if (!Authorize(context, request, ref requestUserSid, ref sessionActive))
            {
                WriteJson(context, 403, new { ok = false, error = "This Windows account is not the protected Lock In sensor." });
                return;
            }

            var data = _engine.HandleRequest(request, requestUserSid, sessionActive);
            WriteJson(context, 200, new { ok = true, requestId = request.RequestId, data });
        }
        catch (Exception error)
        {
            _log.Write($"Request failed: {error.Message}");
            try { WriteJson(context, 400, new { ok = false, error = error.Message }); } catch { }
        }
    }

    private bool Authorize(HttpListenerContext context, RequestEnvelope request, ref string requestUserSid, ref bool sessionActive)
    {
        if (_engine.ProtectedAccounts.Count == 0) return true;
        var origin = context.Request.Headers["Origin"];
        if (request.Type == "disarm" && string.IsNullOrWhiteSpace(origin)) return true;
        try
        {
            var clientPort = context.Request.RemoteEndPoint.Port;
            var processId = _probe.GetLoopbackClientProcessId(clientPort, _port);
            if (processId <= 0) return false;
            var sessionId = _probe.GetProcessSessionId(processId);
            if (sessionId >= 0)
            {
                var state = _probe.GetSessionState(sessionId);
                sessionActive = state is 0 or -1;
            }
            requestUserSid = _probe.GetProcessOwnerSid(processId);
            if (_engine.ProtectedAccounts.ContainsKey(requestUserSid)) return true;
            var protectedNames = string.Join(", ", _engine.ProtectedAccounts.Values);
            _log.Write($"Rejected {request.Type} request from SID '{requestUserSid}'; protected accounts are '{protectedNames}'.");
            return false;
        }
        catch (Exception error)
        {
            _log.Write($"Could not identify loopback client SID: {error.Message}");
            return false;
        }
    }

    private static void WriteJson(HttpListenerContext context, int statusCode, object? body)
    {
        // The client may already have given up on this request. A response
        // nobody reads is not a watchdog failure, so nothing here may throw.
        try
        {
            context.Response.StatusCode = statusCode;
            var origin = context.Request.Headers["Origin"];
            if (origin is not null && ExtensionOrigin.IsMatch(origin))
            {
                context.Response.Headers["Access-Control-Allow-Origin"] = origin;
                context.Response.Headers["Vary"] = "Origin";
            }
            else if (origin == AppOrigin)
            {
                context.Response.Headers["Access-Control-Allow-Origin"] = origin;
                context.Response.Headers["Vary"] = "Origin";
            }
            context.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
            if (context.Request.Headers["Access-Control-Request-Private-Network"] == "true")
            {
                context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
            }
            context.Response.Headers["Cache-Control"] = "no-store";
            if (body is not null)
            {
                var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(body, JsonHelpers.Protocol));
                context.Response.ContentType = "application/json; charset=utf-8";
                context.Response.ContentLength64 = bytes.Length;
                context.Response.OutputStream.Write(bytes, 0, bytes.Length);
            }
        }
        catch
        {
            // Deliberately silent: see the comment above.
        }
        finally
        {
            try { context.Response.Close(); } catch { }
        }
    }

    public void Dispose()
    {
        Stop();
        _cancellation.Dispose();
    }
}
