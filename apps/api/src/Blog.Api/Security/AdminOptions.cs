namespace Blog.Api.Security;

public sealed class AdminOptions
{
    /// <summary>
    /// PBKDF2 hash of the admin password. Generated with:
    ///   dotnet run --project src/Blog.Api -- hash-password
    /// and passed through the Admin__PasswordHash environment variable. The plain-text password is never stored.
    /// </summary>
    public string PasswordHash { get; set; } = string.Empty;
}
