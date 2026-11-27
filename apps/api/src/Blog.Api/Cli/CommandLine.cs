using Blog.Infrastructure;

namespace Blog.Api.Cli;

/// <summary>
/// The command-line modes of the API's own executable (the container has no curl or sqlite3):
/// <code>
///   dotnet Blog.Api.dll hash-password      admin password hash (≥ 12 characters; no echo in a console)
///   dotnet Blog.Api.dll healthcheck        0 if /api/health/ready answers 200; otherwise 1 (compose healthcheck)
///   dotnet Blog.Api.dll backup &lt;dir&gt;       consistent copy of the database to &lt;dir&gt;/blog-{UTC}.db; 0 or 1
/// </code>
/// Any other argument starts the API (for example --urls).
/// </summary>
internal static class CommandLine
{
    /// <param name="readHiddenKey">To read the password without echo in a console; null if the input is redirected.</param>
    /// <returns>The exit code of the requested mode, or null if the arguments request none.</returns>
    public static async Task<int?> RunAsync(
        string[] args, TextReader input, TextWriter output, TextWriter error, Func<ConsoleKeyInfo>? readHiddenKey = null) => args switch
    {
        ["hash-password"] => HashPasswordCommand.Run(input, output, error, readHiddenKey),
        ["healthcheck"] => await HealthCheckCommand.RunAsync(
            HealthCheckCommand.ReadyUrl, new HttpClientHandler(), HealthCheckCommand.RequestTimeout, error),
        ["backup", var directory] => await BackupCommand.RunAsync(
            directory, ConfiguredConnectionString(), DateTime.UtcNow, output, error, CancellationToken.None),
        ["backup", ..] => Usage(error, "Usage: backup <dir>"),
        _ => null,
    };

    private static int Usage(TextWriter error, string usage)
    {
        error.WriteLine(usage);
        return 1;
    }

    // The same configuration as the API (appsettings, environment variables, user-secrets in Development), without the
    // mode's arguments: the backup copies the database the API uses, not another one.
    private static string ConfiguredConnectionString() =>
        DependencyInjection.ConnectionStringOf(WebApplication.CreateBuilder(new WebApplicationOptions()).Configuration);
}
