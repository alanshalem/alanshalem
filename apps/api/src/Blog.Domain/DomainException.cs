namespace Blog.Domain;

/// <summary>Se rompió una regla del dominio (dato inválido). La API la traduce a HTTP 400.</summary>
public sealed class DomainException(string message) : Exception(message);
