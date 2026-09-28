using System.Text.Json;
using LockIn.Engine.Models;

namespace LockIn.Engine.Engine;

public interface IStateStore
{
    WatchdogState? Load();
    void Save(WatchdogState state);
}

/// <summary>
/// `state.json` next to the watchdog log, written atomically so a crash or a
/// scanner holding the file can never leave a half-written state behind.
/// </summary>
public sealed class FileStateStore : IStateStore
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never,
        WriteIndented = false
    };

    private readonly string _path;

    public FileStateStore(string dataDirectory)
    {
        _path = Path.Combine(dataDirectory, "state.json");
    }

    public WatchdogState? Load()
    {
        if (!File.Exists(_path)) return null;
        var json = File.ReadAllText(_path);
        var state = JsonSerializer.Deserialize<WatchdogState>(json, Options);
        if (state is null) throw new InvalidDataException("state.json held no object.");
        return state;
    }

    public void Save(WatchdogState state)
    {
        var temporary = _path + ".tmp";
        var json = JsonSerializer.Serialize(state, Options);
        File.WriteAllText(temporary, json, new System.Text.UTF8Encoding(false));
        File.Move(temporary, _path, overwrite: true);
    }
}
