namespace Blog.Domain;

/// <summary>
/// The content languages: Spanish (the main one) and English. This is the only place in the API that defines them.
/// There are two fixed ones on purpose (no generalization to N languages): that is why the English texts of settings and
/// hero are fields with an En suffix.
/// </summary>
public static class Language
{
    public const string Spanish = "es";
    public const string English = "en";

    /// <summary>The one of posts that do not say otherwise (and of the main text of settings and hero).</summary>
    public const string Default = Spanish;

    /// <summary>" EN " -> "en".</summary>
    /// <exception cref="DomainException">If it is neither "es" nor "en" (also when empty).</exception>
    public static string Parse(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        Spanish => Spanish,
        English => English,
        _ => throw new DomainException(MessageKeys.LanguageInvalid, ("spanish", Spanish), ("english", English)),
    };

    /// <summary>
    /// For messages to the admin: "en" -> "inglés" (or "English"). It is a nested message and not a text: the name of
    /// the language is also written in the reader's language.
    /// </summary>
    public static UserMessage NameOf(string language) => language switch
    {
        Spanish => new UserMessage(MessageKeys.LanguageSpanish),
        English => new UserMessage(MessageKeys.LanguageEnglish),
        _ => throw new ArgumentOutOfRangeException(nameof(language), language, "Unvalidated language: pass it through Parse first."),
    };
}
