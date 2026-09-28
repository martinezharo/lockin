using System.Runtime.InteropServices;
using System.Windows.Automation;
using LockIn.Engine.Platform;
using LockIn.Engine.Rules;

namespace LockIn.App;

public sealed record SensorReading(bool Focused, string ForegroundExe, string ForegroundExePath, string Host, string Url);

public interface IAddressBarReader
{
    string TryReadUrl(IntPtr windowHandle);
}

/// <summary>
/// Reads the address bar through UI Automation. Chrome, Brave and Edge expose
/// the omnibox as an Edit control named "Address and search bar"; Firefox is
/// best effort. Fragments and single-page reloads are not visible here — the
/// extension remains the precise sensor for the browsers it runs in.
/// </summary>
public sealed class UiaAddressBarReader : IAddressBarReader
{
    public string TryReadUrl(IntPtr windowHandle)
    {
        try
        {
            var root = AutomationElement.FromHandle(windowHandle);
            if (root is null) return "";
            var edits = root.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
            var fallback = "";
            foreach (AutomationElement edit in edits)
            {
                if (!edit.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern) || pattern is not ValuePattern value)
                {
                    continue;
                }
                var text = value.Current.Value ?? "";
                if (text.Length == 0) continue;
                var name = edit.Current.Name ?? "";
                if (name.Contains("address", StringComparison.OrdinalIgnoreCase) ||
                    name.Contains("search", StringComparison.OrdinalIgnoreCase) ||
                    name.Contains("omnibox", StringComparison.OrdinalIgnoreCase))
                {
                    return text;
                }
                if (fallback.Length == 0 && LooksLikeUrl(text)) fallback = text;
            }
            return fallback;
        }
        catch
        {
            // UIA is fragile by nature: a browser update, a different profile or
            // a window mid-navigation must degrade to "no reading", never crash.
            return "";
        }
    }

    private static bool LooksLikeUrl(string text) => text.Contains('.') && !text.Contains(' ');
}

/// <summary>
/// Watches the foreground window once a second and reports the executable and,
/// for browsers, the page in the address bar. It reports every sample so the
/// service can tell a quiet foreground from a sensor that died.
/// </summary>
public sealed class ForegroundSensor : IDisposable
{
    private static readonly string[] Browsers = { "chrome.exe", "brave.exe", "msedge.exe", "firefox.exe" };

    private readonly IAddressBarReader _reader;
    private readonly NativeProbe _probe = new();
    private readonly System.Threading.Timer _timer;
    private IntPtr _lastWindow;
    private int _ticks;

    public ForegroundSensor(IAddressBarReader reader)
    {
        _reader = reader;
        _timer = new System.Threading.Timer(_ => Sample(), null, Timeout.Infinite, Timeout.Infinite);
    }

    public event Action<SensorReading>? Reading;

    public void Start() => _timer.Change(0, 1000);

    private void Sample()
    {
        try
        {
            var window = GetForegroundWindow();
            GetWindowThreadProcessId(window, out var processId);
            var path = processId != 0 ? _probe.GetProcessImagePath((int)processId) : "";
            var exe = Path.GetFileName(path).ToLowerInvariant();
            var isBrowser = Browsers.Contains(exe, StringComparer.OrdinalIgnoreCase);
            var url = "";
            if (isBrowser && (window != _lastWindow || ++_ticks % 3 == 0))
            {
                url = _reader.TryReadUrl(window);
            }
            _lastWindow = window;
            var host = "";
            if (url.Length > 0)
            {
                try { host = SiteRules.NormalizeDomain(new Uri(url).Host); }
                catch { host = ""; }
            }
            Reading?.Invoke(new SensorReading(window != IntPtr.Zero, exe, path, host, url));
        }
        catch
        {
            // A sensor that throws must never take the tray app down.
        }
    }

    public void Dispose() => _timer.Dispose();

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
