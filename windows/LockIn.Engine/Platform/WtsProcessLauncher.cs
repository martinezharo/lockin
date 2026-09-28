using System.Runtime.InteropServices;
using System.Text;

namespace LockIn.Engine.Platform;

/// <summary>
/// Starts the per-user app inside an active session from the SYSTEM service
/// (WTSQueryUserToken + CreateProcessAsUser), which is what puts a killed tray
/// app back without waiting for the next logon.
/// </summary>
public sealed class WtsProcessLauncher : IProcessLauncher
{
    private const uint CreateUnicodeEnvironment = 0x00000400;

    public bool Launch(string executablePath, int sessionId)
    {
        IntPtr token = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;
        try
        {
            if (!WTSQueryUserToken(sessionId, out token)) return false;
            var environmentCreated = CreateEnvironmentBlock(out environment, token, false);
            var startup = new StartupInfo { cb = Marshal.SizeOf<StartupInfo>(), lpDesktop = @"winsta0\default" };
            var commandLine = new StringBuilder($"\"{executablePath}\"");
            var workingDirectory = Path.GetDirectoryName(executablePath) ?? "";
            var created = CreateProcessAsUser(
                token,
                null,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                environmentCreated ? CreateUnicodeEnvironment : 0,
                environment,
                workingDirectory,
                ref startup,
                out var processInfo);
            if (!created) return false;
            CloseHandle(processInfo.hProcess);
            CloseHandle(processInfo.hThread);
            return true;
        }
        catch
        {
            return false;
        }
        finally
        {
            if (environment != IntPtr.Zero) DestroyEnvironmentBlock(environment);
            if (token != IntPtr.Zero) CloseHandle(token);
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQueryUserToken(int sessionId, out IntPtr token);

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool DestroyEnvironmentBlock(IntPtr environment);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUser(
        IntPtr token,
        string? applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfo startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}
