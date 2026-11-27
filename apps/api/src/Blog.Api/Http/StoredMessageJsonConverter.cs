using System.Text.Json;
using System.Text.Json.Serialization;
using Blog.Domain;

namespace Blog.Api.Http;

/// <summary>
/// Escribe un <see cref="StoredMessage"/> (el error guardado de un video) como texto en el idioma del pedido, con la
/// misma regla que los errores (<see cref="RequestLanguage"/>). Los casos de uso devuelven la clave y no eligen idioma:
/// lo elige la API, que es la que sabe quién lee. Solo de salida: ningún pedido trae un mensaje guardado.
/// </summary>
internal sealed class StoredMessageJsonConverter(IHttpContextAccessor http) : JsonConverter<StoredMessage>
{
    public override StoredMessage Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        throw new NotSupportedException("Un mensaje guardado solo se escribe.");

    public override void Write(Utf8JsonWriter writer, StoredMessage value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.In(RequestLanguage.Of(http)));
}
