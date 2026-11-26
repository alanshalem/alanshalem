using Blog.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;

namespace Blog.Api.Cli;

/// <summary>
/// Respaldo de la base para el script del VPS (docker compose exec api dotnet Blog.Api.dll backup /carpeta): imprime la
/// ruta de la copia en la salida estándar, así el script sabe qué archivo rotar o subir.
/// </summary>
internal static class BackupCommand
{
    /// <returns>0 si la copia quedó escrita; 1 si no (con el motivo en la salida de errores).</returns>
    public static async Task<int> RunAsync(
        string directory, string connectionString, DateTime nowUtc, TextWriter output, TextWriter error, CancellationToken cancellationToken)
    {
        try
        {
            output.WriteLine(await DatabaseBackup.CreateAsync(connectionString, directory, nowUtc, cancellationToken));
            return 0;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or SqliteException)
        {
            error.WriteLine($"No se pudo hacer la copia de respaldo: {exception.Message}");
            return 1;
        }
    }
}
