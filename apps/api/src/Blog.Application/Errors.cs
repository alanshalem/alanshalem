using Blog.Domain;

namespace Blog.Application;

/// <summary>The requested resource does not exist (HTTP 404).</summary>
public sealed class NotFoundException : UserMessageException
{
    /// <param name="key">One of <see cref="MessageKeys"/>.</param>
    public NotFoundException(string key, params (string Name, object Value)[] arguments)
        : base(new UserMessage(key, arguments))
    {
    }
}

/// <summary>The change clashes with the current state, for example a repeated slug (HTTP 409).</summary>
public sealed class ConflictException : UserMessageException
{
    /// <param name="key">One of <see cref="MessageKeys"/>.</param>
    public ConflictException(string key, params (string Name, object Value)[] arguments)
        : base(new UserMessage(key, arguments))
    {
    }
}
