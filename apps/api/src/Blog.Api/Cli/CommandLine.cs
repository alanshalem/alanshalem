using Blog.Infrastructure;

namespace Blog.Api.Cli;

/// <summary>
/// Los modos de línea de comandos del mismo ejecutable de la API (en el contenedor no hay curl ni sqlite3):
/// <code>
///   dotnet Blog.Api.dll hash-password      hash de la contraseña del admin (≥ 12 caracteres; sin eco en una consola)
///   dotnet Blog.Api.dll healthcheck        0 si /api/health/ready responde 200; si no, 1 (healthcheck de compose)
///   dotnet Blog.Api.dll backup &lt;carpeta&gt;   copia consistente de la base a &lt;carpeta&gt;/blog-{UTC}.db; 0 o 1
/// </code>
/// Cualquier otro argumento arranca la API (por ejemplo --urls).
/// </summary>
internal static class CommandLine
{
    /// <param name="readHiddenKey">Para leer la contraseña sin eco en una consola; null si la entrada está redirigida.</param>
    /// <returns>El código de salida del modo pedido, o null si los argumentos no piden ninguno.</returns>
    public static async Task<int?> RunAsync(
        string[] args, TextReader input, TextWriter output, TextWriter error, Func<ConsoleKeyInfo>? readHiddenKey = null) => args switch
    {
        ["hash-password"] => HashPasswordCommand.Run(input, output, error, readHiddenKey),
        ["healthcheck"] => await HealthCheckCommand.RunAsync(
            HealthCheckCommand.ReadyUrl, new HttpClientHandler(), HealthCheckCommand.RequestTimeout, error),
        ["backup", var directory] => await BackupCommand.RunAsync(
            directory, ConfiguredConnectionString(), DateTime.UtcNow, output, error, CancellationToken.None),
        ["backup", ..] => Usage(error, "Uso: backup <carpeta>"),
        _ => null,
    };

    private static int Usage(TextWriter error, string usage)
    {
        error.WriteLine(usage);
        return 1;
    }

    // La misma configuración que la API (appsettings, variables de entorno, user-secrets en Development), sin los
    // argumentos del modo: el backup copia la base que usa la API, no otra.
    private static string ConfiguredConnectionString() =>
        DependencyInjection.ConnectionStringOf(WebApplication.CreateBuilder(new WebApplicationOptions()).Configuration);
}
