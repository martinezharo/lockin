using System.Diagnostics;
using System.Security.Principal;
using LockIn.Engine.Platform;

namespace LockIn.App;

/// <summary>
/// Emergency disarm: one UAC prompt, then the service is told to disarm and the
/// emergency firewall rules are disabled directly, so recovery works even when
/// the service itself is the thing misbehaving.
/// </summary>
public static class EmergencyDisarm
{
    public static int Run(bool elevated)
    {
        var isAdministrator = new WindowsPrincipal(WindowsIdentity.GetCurrent())
            .IsInRole(WindowsBuiltInRole.Administrator);
        if (!isAdministrator)
        {
            try
            {
                Process.Start(new ProcessStartInfo(Environment.ProcessPath!)
                {
                    UseShellExecute = true,
                    Verb = "runas",
                    Arguments = "--emergency-disarm --elevated"
                });
            }
            catch
            {
                // The UAC prompt was dismissed; nothing was changed.
            }
            return 0;
        }

        var settings = AppSettings.Load();
        using var bridge = new ServiceBridge(settings.Port);
        var disarmed = bridge.DisarmAsync().GetAwaiter().GetResult();
        new ComFirewallController().DisableAll();
        MessageBox.Show(
            disarmed
                ? "Lock In is disarmed and its emergency browser firewall rules are disabled. Everything stays installed; arm a zone again from the dashboard to restore containment."
                : "The Lock In service did not answer, but its emergency browser firewall rules are disabled. Check that the LockInWatchdog service is running before relying on containment.",
            "Lock In emergency disarm",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
        return 0;
    }
}
