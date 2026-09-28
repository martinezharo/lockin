using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LockIn.App;

/// <summary>
/// The dashboard window: WebView2 pointed at the extension's own options page
/// or popup, served from a virtual host with the chrome.* shim injected. The
/// extension pages stay the single source of UI truth.
/// </summary>
public sealed class DashboardForm : Form
{
    private readonly AppSettings _settings;
    private readonly string _page;
    private readonly Action _openDashboard;
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };

    public DashboardForm(AppSettings settings, string page, Action openDashboard, Size size)
    {
        _settings = settings;
        _page = page;
        _openDashboard = openDashboard;
        Text = "Lock In";
        Icon = LoadIcon();
        ClientSize = size;
        MinimumSize = new Size(420, 320);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(_webView);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null, _settings.WebViewDataFolder);
            await _webView.EnsureCoreWebView2Async(environment);
            var core = _webView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.SetVirtualHostNameToFolderMapping("lockin.local", _settings.WebRoot, CoreWebView2HostResourceAccessKind.Allow);
            core.WebMessageReceived += OnWebMessage;
            var shim = await File.ReadAllTextAsync(Path.Combine(_settings.WebRoot, "shim.js"));
            var appInfo = $"window.__LOCKIN_APP__ = {{ port: {_settings.Port}, version: '{_settings.Version}' }};";
            await core.AddScriptToExecuteOnDocumentCreatedAsync(appInfo + Environment.NewLine + shim);
            core.Navigate($"https://lockin.local/{_page}");
        }
        catch (Exception error)
        {
            MessageBox.Show(this,
                $"The Lock In dashboard could not start.\n\n{error.Message}",
                "Lock In", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            if (e.TryGetWebMessageAsString().Contains("lockin-open-options", StringComparison.Ordinal))
            {
                _openDashboard();
            }
        }
        catch
        {
            // A message the shim did not send is not worth a dialog.
        }
    }

    public static Icon LoadIcon()
    {
        try
        {
            var path = Environment.ProcessPath;
            if (path is not null)
            {
                var icon = Icon.ExtractAssociatedIcon(path);
                if (icon is not null) return icon;
            }
        }
        catch
        {
            // Fall through to the default icon.
        }
        return SystemIcons.Shield;
    }
}
