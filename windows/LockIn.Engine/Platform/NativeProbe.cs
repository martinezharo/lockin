using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace LockIn.Engine.Platform;

/// <summary>
/// The same native queries the PowerShell watchdog made: session state, a
/// process's owner SID and image path, and the client process of a loopback
/// TCP connection. Each one is microseconds, which is what keeps the request
/// path fast.
/// </summary>
public sealed class NativeProbe : INativeProbe
{
    private const int WtsConnectState = 8;
    private const int WtsActive = 0;
    private const int WtsDisconnected = 4;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint TokenQuery = 0x0008;

    public IReadOnlyList<BrowserProcess> GetBrowserProcesses()
    {
        var result = new List<BrowserProcess>();
        result.AddRange(GetProcesses("chrome"));
        result.AddRange(GetProcesses("brave"));
        return result;
    }

    public IReadOnlyList<BrowserProcess> GetProcesses(string processName)
    {
        var result = new List<BrowserProcess>();
        Process[] processes;
        try { processes = Process.GetProcessesByName(processName); }
        catch { return result; }
        foreach (var process in processes)
        {
            try
            {
                result.Add(new BrowserProcess(process.Id, process.SessionId, process.ProcessName + ".exe"));
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

    public IReadOnlyList<SessionAccount> GetActiveSessions()
    {
        var result = new List<SessionAccount>();
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out var sessions, out var count)) return result;
        try
        {
            var size = Marshal.SizeOf<WtsSessionInfo>();
            for (var index = 0; index < count; index++)
            {
                var info = Marshal.PtrToStructure<WtsSessionInfo>(sessions + index * size);
                if (info.State != WtsActive || info.SessionId == 0) continue;
                try
                {
                    if (!WTSQueryUserToken(info.SessionId, out var token)) continue;
                    try
                    {
                        using var identity = new WindowsIdentity(token);
                        var sid = identity.User?.Value ?? "";
                        if (sid.Length > 0) result.Add(new SessionAccount(info.SessionId, sid));
                    }
                    finally
                    {
                        CloseHandle(token);
                    }
                }
                catch
                {
                    // A session without a usable token is skipped, not fatal.
                }
            }
        }
        finally
        {
            WTSFreeMemory(sessions);
        }
        return result;
    }

    public string GetProcessOwnerSid(int processId)
    {
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (handle == IntPtr.Zero) return "";
        try
        {
            if (!OpenProcessToken(handle, TokenQuery, out var token)) return "";
            try
            {
                using var identity = new WindowsIdentity(token);
                return identity.User?.Value ?? "";
            }
            finally
            {
                CloseHandle(token);
            }
        }
        catch
        {
            return "";
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    public string GetProcessImagePath(int processId)
    {
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (handle == IntPtr.Zero) return "";
        try
        {
            var name = new StringBuilder(1024);
            var size = name.Capacity;
            return QueryFullProcessImageName(handle, 0, name, ref size) ? name.ToString() : "";
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    public int GetProcessSessionId(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            return process.SessionId;
        }
        catch
        {
            return -1;
        }
    }

    public int GetSessionState(int sessionId)
    {
        if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, WtsConnectState, out var buffer, out var bytes))
        {
            return -1;
        }
        try
        {
            return bytes < 4 ? -1 : Marshal.ReadInt32(buffer);
        }
        finally
        {
            WTSFreeMemory(buffer);
        }
    }

    public bool IsProcessAlive(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            return !process.HasExited;
        }
        catch
        {
            return false;
        }
    }

    public int GetLoopbackClientProcessId(int clientPort, int serverPort)
    {
        var size = 0;
        GetExtendedTcpTable(IntPtr.Zero, ref size, false, 2, 5, 0); // AF_INET, TCP_TABLE_OWNER_PID_ALL
        for (var attempt = 0; attempt < 4; attempt++)
        {
            size += 4096;
            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                var result = GetExtendedTcpTable(buffer, ref size, false, 2, 5, 0);
                if (result == 122) continue; // ERROR_INSUFFICIENT_BUFFER: the table grew
                if (result != 0) return 0;
                var count = Marshal.ReadInt32(buffer);
                for (var index = 0; index < count; index++)
                {
                    var offset = 4 + index * 24; // MIB_TCPROW_OWNER_PID is six DWORDs
                    var state = Marshal.ReadInt32(buffer, offset);
                    var localAddress = Marshal.ReadInt32(buffer, offset + 4);
                    var localPort = PortOf(Marshal.ReadInt32(buffer, offset + 8));
                    var remotePort = PortOf(Marshal.ReadInt32(buffer, offset + 16));
                    if (state == 5 && localAddress == 0x0100007F && localPort == clientPort && remotePort == serverPort)
                    {
                        return Marshal.ReadInt32(buffer, offset + 20);
                    }
                }
                return 0;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        return 0;
    }

    private static int PortOf(int raw) => ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF);

    [StructLayout(LayoutKind.Sequential)]
    private struct WtsSessionInfo
    {
        public int SessionId;
        public IntPtr WinStationName;
        public int State;
    }

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQuerySessionInformation(IntPtr server, int session, int info, out IntPtr buffer, out int bytes);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version, out IntPtr sessions, out int count);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQueryUserToken(int sessionId, out IntPtr token);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr buffer);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("iphlpapi.dll")]
    private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sorted, int family, int tableClass, int reserved);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
}
