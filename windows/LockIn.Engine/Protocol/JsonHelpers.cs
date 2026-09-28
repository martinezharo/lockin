using System.Text.Json;

namespace LockIn.Engine.Protocol;

public sealed class RequestEnvelope
{
    public string? Type { get; set; }
    public string? RequestId { get; set; }
    public JsonElement Payload { get; set; }
}

public static class JsonHelpers
{
    public static readonly JsonSerializerOptions Protocol = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never
    };

    public static string String(this JsonElement element, string name)
    {
        return TryGet(element, name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";
    }

    public static bool Bool(this JsonElement element, string name)
    {
        return TryGet(element, name, out var value) && value.ValueKind == JsonValueKind.True;
    }

    public static bool TryGet(JsonElement element, string name, out JsonElement value)
    {
        value = default;
        return element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out value);
    }

    public static bool Has(this JsonElement element, string name)
    {
        return element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out _);
    }

    public static string ToJson(object value) => JsonSerializer.Serialize(value, Protocol);
}
