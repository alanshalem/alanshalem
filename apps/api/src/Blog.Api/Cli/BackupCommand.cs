using Blog.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;

namespace Blog.Api.Cli;

/// <summary>
/// Database backup for the VPS script (docker compose exec api dotnet Blog.Api.dll backup /folder): prints the path of
/// the copy on standard output, so the script knows which file to rotate or upload.
/// </summary>
internal static class BackupCommand
{
    /// <returns>0 if the copy was written; 1 if not (with the reason on standard error).</returns>
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
            error.WriteLine($"Backup failed: {exception.Message}");
            return 1;
        }
    }
}
