namespace Blog.Domain;

/// <summary>Se rompió una regla del dominio (dato inválido). La API la traduce a HTTP 400.</summary>
public sealed class DomainException : UserMessageException
{
    /// <param name="key">Una de <see cref="MessageKeys"/>.</param>
    /// <param name="arguments">El valor de cada {marcador} del texto.</param>
    public DomainException(string key, params (string Name, object Value)[] arguments)
        : this(new UserMessage(key, arguments))
    {
    }

    public DomainException(UserMessage message)
        : base(message)
    {
    }
}
