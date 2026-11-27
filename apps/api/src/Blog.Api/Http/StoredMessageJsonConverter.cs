using System.Text.Json;
using System.Text.Json.Serialization;
using Blog.Domain;

namespace Blog.Api.Http;

/// <summary>
/// Writes a <see cref="StoredMessage"/> (a video's stored error) as text in the language of the request, with the same
/// rule as errors (<see cref="RequestLanguage"/>). The use cases return the key and do not choose a language: the API
/// does, because it knows who reads. Output only: no request carries a stored message.
/// </summary>
internal sealed class StoredMessageJsonConverter(IHttpContextAccessor http) : JsonConverter<StoredMessage>
{
    public override StoredMessage Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        throw new NotSupportedException("A stored message is only written.");

    public override void Write(Utf8JsonWriter writer, StoredMessage value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.In(RequestLanguage.Of(http)));
}
