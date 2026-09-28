using LockIn.Engine.Engine;
using LockIn.Engine.Rules;

namespace LockIn.App;

/// <summary>
/// The tray app: the dashboard window, the UIA fallback sensor, app-zone
/// enforcement, and the status notifications (sensor missing, extension not
/// installed, blocked by schedule).
/// </summary>
public sealed class TrayContext : ApplicationContext
{
    private static readonly TimeSpan NotifyCooldown = TimeSpan.FromMinutes(30);

    private readonly AppSettings _settings;
    private readonly ServiceBridge _bridge;
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _timer;
    private readonly ForegroundSensor _sensor;
    private readonly AppEnforcer _enforcer;
    private readonly Dictionary<string, DateTime> _notified = new();

    private Snapshot? _snapshot;
    private DashboardForm? _dashboard;
    private DashboardForm? _popup;

    public TrayContext(AppSettings settings, ServiceBridge bridge)
    {
        _settings = settings;
        _bridge = bridge;
        _tray = new NotifyIcon
        {
            Icon = DashboardForm.LoadIcon(),
            Text = "Lock In",
            Visible = true
        };
        _tray.DoubleClick += (_, _) => OpenDashboard();
        _tray.ContextMenuStrip = BuildMenu();

        _enforcer = new AppEnforcer(new WindowsAppProcessController(), new SystemClock());
        _sensor = new ForegroundSensor(new UiaAddressBarReader());
        _sensor.Reading += OnReading;
        _sensor.Start();

        _timer = new System.Windows.Forms.Timer { Interval = 2000 };
        _timer.Tick += async (_, _) => await RefreshAsync();
        _timer.Start();
        _ = RefreshAsync();
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open dashboard", null, (_, _) => OpenDashboard());
        menu.Items.Add("Open status panel", null, (_, _) => OpenPopup());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Emergency disarm…", null, (_, _) => EmergencyDisarm.Run(elevated: false));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit (the service starts it again at next logon)", null, (_, _) =>
        {
            _tray.Visible = false;
            ExitThread();
        });
        return menu;
    }

    private void OpenDashboard()
    {
        if (_dashboard is { IsDisposed: false })
        {
            _dashboard.Show();
            _dashboard.Activate();
            return;
        }
        _dashboard = new DashboardForm(_settings, "src/pages/options/options.html", OpenDashboard, new Size(1100, 820));
        _dashboard.FormClosed += (_, _) => _dashboard = null;
        _dashboard.Show();
    }

    private void OpenPopup()
    {
        if (_popup is { IsDisposed: false })
        {
            _popup.Show();
            _popup.Activate();
            return;
        }
        _popup = new DashboardForm(_settings, "src/pages/popup/popup.html", OpenDashboard, new Size(360, 560));
        _popup.FormClosed += (_, _) => _popup = null;
        _popup.Show();
    }

    private async Task RefreshAsync()
    {
        _snapshot = await _bridge.GetHealthAsync();
        try
        {
            _enforcer.Apply(_snapshot?.BlockedApps ?? new List<string>());
        }
        catch
        {
            // Enforcement is retried on the next tick.
        }
        UpdateTray();
        Notify();
    }

    private void OnReading(SensorReading reading)
    {
        var snapshot = _snapshot;
        // The privacy gate is the extension's: no consent, no browsing data.
        if (snapshot is null || !snapshot.PrivacyConsent) return;
        var url = SiteRules.SendableUrl(reading.Url, snapshot.Groups);
        _ = _bridge.SendAppHeartbeatAsync(new AppHeartbeatPayload(
            reading.Host, url, reading.Focused, reading.ForegroundExe, reading.ForegroundExePath));
    }

    private void UpdateTray()
    {
        var text = "Lock In";
        if (_snapshot is null)
        {
            text = "Lock In — service not responding";
        }
        else if (_snapshot.FailClosedActive)
        {
            text = "Lock In — sensor missing, browser networking blocked";
        }
        else if (_snapshot.BlockedApps.Count > 0)
        {
            text = $"Lock In — blocking {string.Join(", ", _snapshot.BlockedApps)}";
        }
        else if (_snapshot.BlockedDomains.Count > 0)
        {
            text = $"Lock In — containing {_snapshot.BlockedDomains.Count} site rule{(_snapshot.BlockedDomains.Count == 1 ? "" : "s")}";
        }
        else if (_snapshot.EnforcementArmed)
        {
            text = "Lock In — armed, tunnels open";
        }
        _tray.Text = text.Length > 63 ? text[..63] : text;
    }

    private void Notify()
    {
        if (_snapshot is null)
        {
            NotifyOnce("offline", "The Lock In service is not responding. Containment may be off.",
                () => OpenDashboard());
            return;
        }
        if (_snapshot.FailClosedActive)
        {
            NotifyOnce("fail-closed",
                "The Lock In sensor is missing, so browser networking is blocked. Open the dashboard for details.",
                () => OpenDashboard());
        }
        else if (_snapshot.BlockedApps.Count > 0)
        {
            NotifyOnce("apps", $"Blocked by schedule or allowance: {string.Join(", ", _snapshot.BlockedApps)}.",
                () => OpenDashboard());
        }

        if (_snapshot.Connected && _snapshot.PrivacyConsent &&
            ExtensionDetector.AnyChromiumBrowserInstalled() && !ExtensionDetector.IsExtensionInstalled())
        {
            NotifyOnce("extension",
                "The Lock In extension is not installed in Chrome or Brave. Click here for the extension page and steps.",
                () =>
                {
                    if (!ExtensionDetector.OpenExtensionsPage()) OpenDashboard();
                });
        }
    }

    private void NotifyOnce(string key, string message, Action onClick)
    {
        var now = DateTime.UtcNow;
        if (_notified.TryGetValue(key, out var last) && now - last < NotifyCooldown) return;
        _notified[key] = now;
        _tray.BalloonTipTitle = "Lock In";
        _tray.BalloonTipText = message;
        _tray.BalloonTipClicked += (_, _) => onClick();
        _tray.ShowBalloonTip(8000);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _timer.Dispose();
            _sensor.Dispose();
            _tray.Dispose();
        }
        base.Dispose(disposing);
    }
}
