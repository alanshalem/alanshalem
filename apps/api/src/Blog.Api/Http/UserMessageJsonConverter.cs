using System.Text.Json;
using System.Text.Json.Serialization;
using Blog.Domain;

namespace Blog.Api.Http;

/// <summary>
/// Writes a <see cref="UserMessage"/> that travels inside a response (the size warnings of a hero video) as text in
/// the language of the request, with the same rule as errors (<see cref="RequestLanguage"/>). The domain and the use
/// cases return the key and its arguments; the API picks the language because it knows who reads. Output only: no
/// request carries a message.
/// </summary>
internal sealed class UserMessageJsonConverter(IHttpContextAccessor http) : JsonConverter<UserMessage>
{
    public override UserMessage Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        throw new NotSupportedException("A user message is only written.");

    public override void Write(Utf8JsonWriter writer, UserMessage value, JsonSerializerOptions options) =>
        writer.WriteStringValue(MessageCatalog.Format(value, RequestLanguage.Of(http)));
}
