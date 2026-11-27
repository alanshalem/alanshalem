namespace Blog.Domain;

/// <summary>A domain rule was broken (invalid data). The API turns it into HTTP 400.</summary>
public sealed class DomainException : UserMessageException
{
    /// <param name="key">One of <see cref="MessageKeys"/>.</param>
    /// <param name="arguments">The value of each {placeholder} in the text.</param>
    public DomainException(string key, params (string Name, object Value)[] arguments)
        : this(new UserMessage(key, arguments))
    {
    }

    public DomainException(UserMessage message)
        : base(message)
    {
    }
}
