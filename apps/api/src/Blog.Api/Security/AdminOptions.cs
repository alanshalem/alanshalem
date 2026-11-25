namespace Blog.Api.Security;

public sealed class AdminOptions
{
    /// <summary>
    /// Hash PBKDF2 de la contraseña del admin. Se genera con:
    ///   dotnet run --project src/Blog.Api -- hash-password
    /// y se pasa por la variable de entorno Admin__PasswordHash. La contraseña en claro nunca se guarda.
    /// </summary>
    public string PasswordHash { get; set; } = string.Empty;
}
