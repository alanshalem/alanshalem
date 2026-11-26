namespace Blog.Domain;

/// <summary>
/// Los idiomas del contenido: español (el principal) e inglés. Es el único lugar de la API que los define. Son dos fijos a
/// propósito (no se generaliza a N idiomas): por eso los textos en inglés de ajustes y hero son campos con sufijo En.
/// </summary>
public static class Language
{
    public const string Spanish = "es";
    public const string English = "en";

    /// <summary>El de los posts que no dicen otro (y el del texto principal de ajustes y hero).</summary>
    public const string Default = Spanish;

    /// <summary>" EN " -> "en".</summary>
    /// <exception cref="DomainException">Si no es "es" ni "en" (también si viene vacío).</exception>
    public static string Parse(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        Spanish => Spanish,
        English => English,
        _ => throw new DomainException(MessageKeys.LanguageInvalid, ("spanish", Spanish), ("english", English)),
    };

    /// <summary>
    /// Para los mensajes al admin: "en" -> "inglés" (o "English"). Es un mensaje anidado y no un texto: el nombre del
    /// idioma también se escribe en el idioma de quien lee.
    /// </summary>
    public static UserMessage NameOf(string language) => language switch
    {
        Spanish => new UserMessage(MessageKeys.LanguageSpanish),
        English => new UserMessage(MessageKeys.LanguageEnglish),
        _ => throw new ArgumentOutOfRangeException(nameof(language), language, "Idioma sin validar: pasalo antes por Parse."),
    };
}
