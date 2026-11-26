namespace Blog.Domain;

/// <summary>
/// Un mensaje para el admin sin el texto: la clave del <see cref="MessageCatalog"/> y el valor de cada {marcador}. Así
/// el dominio y los casos de uso no eligen idioma; lo elige quien muestra el mensaje.
/// </summary>
/// <remarks>
/// Los argumentos pueden ser otro <see cref="UserMessage"/> (por ejemplo, el nombre de un idioma, que también se
/// traduce), segundos como double (se escriben con el separador decimal del idioma) o enteros y textos (tal cual).
/// </remarks>
public sealed class UserMessage
{
    public UserMessage(string key, params (string Name, object Value)[] arguments)
    {
        Key = key;
        Arguments = arguments.ToDictionary(argument => argument.Name, argument => argument.Value, StringComparer.Ordinal);
    }

    /// <summary>Una de <see cref="MessageKeys"/>. Es el "code" estable de los errores de la API.</summary>
    public string Key { get; }

    public IReadOnlyDictionary<string, object> Arguments { get; }

    /// <summary>El texto en el idioma por defecto: el de los logs y el de <see cref="Exception.Message"/>.</summary>
    public override string ToString() => MessageCatalog.Format(this, Language.Default);
}

/// <summary>
/// Base de los errores que se le muestran al admin. <see cref="Exception.Message"/> es el texto en español (el de los
/// logs, como siempre); <see cref="UserMessage"/> permite escribirlo en el idioma de quien lo lee.
/// </summary>
public abstract class UserMessageException(UserMessage userMessage) : Exception(userMessage.ToString())
{
    public UserMessage UserMessage { get; } = userMessage;
}
