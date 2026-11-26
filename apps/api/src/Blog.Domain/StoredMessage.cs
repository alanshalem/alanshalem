namespace Blog.Domain;

/// <summary>
/// Un mensaje guardado en la base para mostrarlo después (el error de un video): la clave del <see cref="MessageCatalog"/>,
/// sin argumentos, que se escribe en el idioma de quien lee. Las filas de antes del catálogo guardaban el texto ya
/// escrito en español: ese texto no es una clave y se muestra tal cual, así ninguna fila vieja queda ilegible.
/// </summary>
public sealed record StoredMessage(string Value)
{
    /// <exception cref="ArgumentOutOfRangeException">Si el idioma no es uno de <see cref="Language"/>.</exception>
    public string In(string language) =>
        MessageCatalog.Entries.ContainsKey(Value) ? MessageCatalog.Format(new UserMessage(Value), language) : Value;
}
