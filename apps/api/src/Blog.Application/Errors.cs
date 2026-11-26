using Blog.Domain;

namespace Blog.Application;

/// <summary>El recurso pedido no existe (HTTP 404).</summary>
public sealed class NotFoundException : UserMessageException
{
    /// <param name="key">Una de <see cref="MessageKeys"/>.</param>
    public NotFoundException(string key, params (string Name, object Value)[] arguments)
        : base(new UserMessage(key, arguments))
    {
    }
}

/// <summary>El cambio choca con el estado actual, por ejemplo un slug repetido (HTTP 409).</summary>
public sealed class ConflictException : UserMessageException
{
    /// <param name="key">Una de <see cref="MessageKeys"/>.</param>
    public ConflictException(string key, params (string Name, object Value)[] arguments)
        : base(new UserMessage(key, arguments))
    {
    }
}
