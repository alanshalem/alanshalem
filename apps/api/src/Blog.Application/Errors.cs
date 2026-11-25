namespace Blog.Application;

/// <summary>El recurso pedido no existe (HTTP 404).</summary>
public sealed class NotFoundException(string message) : Exception(message);

/// <summary>El cambio choca con el estado actual, por ejemplo un slug repetido (HTTP 409).</summary>
public sealed class ConflictException(string message) : Exception(message);
