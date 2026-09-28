using System.Diagnostics;
using LockIn.Engine.Engine;

namespace LockIn.App;

/// <summary>
/// The real process handling behind app-zone enforcement: WM_CLOSE first,
/// then Terminate after the grace period. Only processes in this user's own
/// session are touched; another account's copy of the app is that account's
/// app's business.
/// </summary>
public sealed class WindowsAppProcessController : IAppProcessController
{
    public IReadOnlyList<AppProcess> FindRunning(string executableName)
    {
        var name = Path.GetFileNameWithoutExtension(executableName);
        if (name.Length == 0) return Array.Empty<AppProcess>();
        var sessionId = Process.GetCurrentProcess().SessionId;
        var result = new List<AppProcess>();
        Process[] processes;
        try { processes = Process.GetProcessesByName(name); }
        catch { return result; }
        foreach (var process in processes)
        {
            try
            {
                if (process.SessionId == sessionId) result.Add(new AppProcess(process.Id, executableName));
            }
            catch
            {
                // A process that exited mid-enumeration is not a failure.
            }
            finally
            {
                process.Dispose();
            }
        }
        return result;
    }

    public void CloseGracefully(AppProcess process)
    {
        try
        {
            using var target = Process.GetProcessById(process.ProcessId);
            target.CloseMainWindow();
        }
        catch
        {
            // Already gone, or no main window to close.
        }
    }

    public void Terminate(AppProcess process)
    {
        try
        {
            using var target = Process.GetProcessById(process.ProcessId);
            target.Kill();
        }
        catch
        {
            // Already gone, or protected by another account.
        }
    }
}
