using System.Reflection;
using System.Text.RegularExpressions;
using Blog.Domain;

namespace Blog.Tests;

/// <summary>
/// El catálogo de mensajes: una entrada por clave declarada, los dos idiomas completos y con los mismos marcadores, y
/// el formato de cada idioma (números, nombres de idioma anidados). El texto en español es el de siempre.
/// </summary>
public partial class MessageCatalogTests
{
    [GeneratedRegex(@"\{(\w+)\}")]
    private static partial Regex Placeholder();

    [GeneratedRegex(@"^[a-z]+(\.[a-z][a-zA-Z]*)+$")]
    private static partial Regex KeyShape();

    private static List<string> DeclaredKeys() =>
        typeof(MessageKeys).GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(field => field.IsLiteral)
            .Select(field => (string)field.GetRawConstantValue()!)
            .ToList();

    private static SortedSet<string> PlaceholdersOf(string text) =>
        new(Placeholder().Matches(text).Select(match => match.Groups[1].Value), StringComparer.Ordinal);

    [Fact]
    public void Every_declared_key_has_one_entry_and_every_entry_is_a_declared_key()
    {
        var declared = DeclaredKeys();

        Assert.Equal(declared.Count, declared.Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(declared.Order(StringComparer.Ordinal), MessageCatalog.Entries.Keys.Order(StringComparer.Ordinal));
        Assert.All(declared, key => Assert.Matches(KeyShape(), key));
    }

    [Fact]
    public void Every_entry_has_both_texts_translated_and_with_the_same_placeholders()
    {
        Assert.All(MessageCatalog.Entries, entry =>
        {
            var (key, text) = (entry.Key, entry.Value);
            Assert.False(string.IsNullOrWhiteSpace(text.Spanish), $"{key}: falta el español");
            Assert.False(string.IsNullOrWhiteSpace(text.English), $"{key}: falta el inglés");
            Assert.Equal(text.Spanish.Trim(), text.Spanish);
            Assert.Equal(text.English.Trim(), text.English);
            Assert.NotEqual(text.Spanish, text.English);
            Assert.Equal(PlaceholdersOf(text.Spanish), PlaceholdersOf(text.English));
        });
    }

    [Fact]
    public void A_domain_error_keeps_the_spanish_text_as_its_message_and_carries_the_key_for_other_languages()
    {
        var error = Assert.Throws<DomainException>(() => PostContent.Create(" ", null, null, null, null));

        Assert.Equal("El título es obligatorio.", error.Message);
        Assert.Equal(MessageKeys.PostTitleRequired, error.UserMessage.Key);
        Assert.Equal("The title is required.", MessageCatalog.Format(error.UserMessage, Language.English));
        Assert.Equal("El título es obligatorio.", MessageCatalog.Format(error.UserMessage, Language.Spanish));
    }

    [Fact]
    public void Language_names_are_nested_messages_written_in_the_language_of_the_reader()
    {
        var message = new UserMessage(MessageKeys.PostSlugTaken, ("language", Language.NameOf(Language.English)), ("slug", "hola"));

        Assert.Equal("Ya existe un post en inglés con el slug \"hola\".", MessageCatalog.Format(message, Language.Spanish));
        Assert.Equal("There is already a post in English with the slug \"hola\".", MessageCatalog.Format(message, Language.English));
    }

    [Fact]
    public void Seconds_use_the_decimal_comma_in_spanish_and_the_point_in_english()
    {
        var tooShort = Assert.Throws<DomainException>(() => VideoEdit.Create(10, 0, 1.5, VideoFade.Loop, 1));
        var badFade = Assert.Throws<DomainException>(() => VideoEdit.Create(10, null, null, null, 0.7));

        Assert.Equal(
            "Un fundido de 1 s necesita un tramo de al menos 2 s y el elegido dura 1,5 s. Elegí un fundido más corto o un tramo más largo.",
            tooShort.Message);
        Assert.Equal(
            "A 1 s fade needs a segment of at least 2 s and the chosen one lasts 1.5 s. Choose a shorter fade or a longer segment.",
            MessageCatalog.Format(tooShort.UserMessage, Language.English));
        Assert.Equal("La duración del fundido tiene que ser 0,5, 1 o 2 s.", badFade.Message);
        Assert.Equal("The fade duration must be 0.5, 1 or 2 s.", MessageCatalog.Format(badFade.UserMessage, Language.English));
    }

    [Fact]
    public void Application_errors_carry_their_key_too()
    {
        var notFound = new Blog.Application.NotFoundException(MessageKeys.PostNotFound);
        var conflict = new Blog.Application.ConflictException(MessageKeys.SettingsSaveConflict);

        Assert.Equal(("El post no existe.", MessageKeys.PostNotFound), (notFound.Message, notFound.UserMessage.Key));
        Assert.Equal("The post doesn't exist.", MessageCatalog.Format(notFound.UserMessage, Language.English));
        Assert.Equal(MessageKeys.SettingsSaveConflict, conflict.UserMessage.Key);
    }

    [Fact]
    public void An_unknown_language_or_a_missing_argument_is_a_programming_error()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => MessageCatalog.Format(new UserMessage(MessageKeys.PostNotFound), "fr"));
        Assert.Throws<InvalidOperationException>(() => MessageCatalog.Format(new UserMessage(MessageKeys.PostTitleTooLong), Language.Spanish));
        Assert.Throws<KeyNotFoundException>(() => MessageCatalog.Format(new UserMessage("no.existe"), Language.Spanish));
    }
}
