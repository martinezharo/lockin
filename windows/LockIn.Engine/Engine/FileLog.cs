using System.Text;

namespace LockIn.Engine.Engine;

/// <summary>
/// The watchdog log: the same complaint once a minute instead of once a second,
/// and one rotation at 1 MB. Nothing here throws; a log that cannot be written
/// must never stop enforcement.
/// </summary>
public sealed class FileLog
{
    private const long MaxBytes = 1024 * 1024;
    private static readonly TimeSpan DedupeWindow = TimeSpan.FromMinutes(1);

    private readonly object _gate = new();
    private readonly Dictionary<string, long> _lastWrittenMs = new();
    private readonly string _path;

    public FileLog(string path)
    {
        _path = path;
    }

    public void Write(string message)
    {
        try
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            lock (_gate)
            {
                if (_lastWrittenMs.TryGetValue(message, out var last) && now - last < DedupeWindow.TotalMilliseconds)
                {
                    return;
                }
                if (_lastWrittenMs.Count > 500) _lastWrittenMs.Clear();
                _lastWrittenMs[message] = now;
                var directory = Path.GetDirectoryName(_path);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                if (File.Exists(_path) && new FileInfo(_path).Length > MaxBytes)
                {
                    File.Move(_path, _path + ".old", overwrite: true);
                }
                File.AppendAllText(_path, $"{DateTimeOffset.UtcNow:O} {message}{Environment.NewLine}", new UTF8Encoding(false));
            }
        }
        catch
        {
            // Losing a log line is always preferable to losing the loop.
        }
    }

    public static FileLog Null { get; } = new FileLog(Path.Combine(Path.GetTempPath(), "lockin-null.log"));
}
