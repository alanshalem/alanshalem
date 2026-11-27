namespace Blog.Domain;

/// <summary>
/// A message for the admin without its text: the <see cref="MessageCatalog"/> key and the value of each {placeholder}.
/// This way the domain and the use cases do not choose a language; whoever shows the message does.
/// </summary>
/// <remarks>
/// Arguments can be another <see cref="UserMessage"/> (for example, the name of a language, which is translated too),
/// seconds as double (written with the language's decimal separator) or integers and texts (as is).
/// </remarks>
public sealed class UserMessage
{
    public UserMessage(string key, params (string Name, object Value)[] arguments)
    {
        Key = key;
        Arguments = arguments.ToDictionary(argument => argument.Name, argument => argument.Value, StringComparer.Ordinal);
    }

    /// <summary>One of <see cref="MessageKeys"/>. It is the stable "code" of the API errors.</summary>
    public string Key { get; }

    public IReadOnlyDictionary<string, object> Arguments { get; }

    /// <summary>The text in the default language: the one of the logs and of <see cref="Exception.Message"/>.</summary>
    public override string ToString() => MessageCatalog.Format(this, Language.Default);
}

/// <summary>
/// Base of the errors shown to the admin. <see cref="Exception.Message"/> is the Spanish text (the one of the logs, as
/// always); <see cref="UserMessage"/> lets it be written in the reader's language.
/// </summary>
public abstract class UserMessageException(UserMessage userMessage) : Exception(userMessage.ToString())
{
    public UserMessage UserMessage { get; } = userMessage;
}
