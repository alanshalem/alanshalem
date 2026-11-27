using System.Globalization;
using Microsoft.Data.Sqlite;

namespace Blog.Infrastructure.Persistence;

/// <summary>
/// Backup copy of the database with SQLite's backup API: it is a consistent snapshot of one instant even while the API
/// is writing (with WAL, reading does not block writing), which copying the file by hand does not guarantee.
/// </summary>
public static class DatabaseBackup
{
    // How long the copy waits if the database is busy for a moment (a write finishing, another connection opening it).
    // The backup API does not retry by itself: without this, a copy that coincides with a write fails with "database is
    // locked".
    private const int BusyTimeoutMilliseconds = 10_000;

    /// <summary>blog-{UTC yyyyMMddTHHmmssZ}.db: sorted by name is sorted by date, which is what the script rotates.</summary>
    public static string FileNameFor(DateTime nowUtc) =>
        $"blog-{nowUtc.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture)}.db";

    /// <summary>Creates the folder if missing and writes the copy to a new file, which never replaces another one.</summary>
    /// <returns>The full path of the copy.</returns>
    /// <exception cref="IOException">If a copy with that name already exists (it is not touched) or it cannot be written.</exception>
    /// <exception cref="FileNotFoundException">If the database does not exist (an empty one is not created to copy it).</exception>
    /// <exception cref="SqliteException">If the database cannot be read.</exception>
    public static async Task<string> CreateAsync(string connectionString, string directory, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var source = new SqliteConnectionStringBuilder(connectionString) { Mode = SqliteOpenMode.ReadWrite, Pooling = false };
        if (!File.Exists(source.DataSource))
        {
            throw new FileNotFoundException("The database does not exist.", Path.GetFullPath(source.DataSource));
        }

        Directory.CreateDirectory(directory);
        var path = Path.Combine(Path.GetFullPath(directory), FileNameFor(nowUtc));

        // CreateNew reserves the name atomically: if there is already a copy (two runs in the same second), it fails
        // without touching it.
        await new FileStream(path, FileMode.CreateNew).DisposeAsync();
        try
        {
            await using var from = new SqliteConnection(source.ToString());
            await using var to = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
            await from.OpenAsync(cancellationToken);
            await to.OpenAsync(cancellationToken);
            await ExecuteAsync(from, $"PRAGMA busy_timeout={BusyTimeoutMilliseconds};", cancellationToken);
            from.BackupDatabase(to);

            // The copy brings the database's WAL mode; in DELETE it is a single file, which is moved and restored as is.
            await ExecuteAsync(to, "PRAGMA journal_mode=DELETE;", cancellationToken);
        }
        catch
        {
            // A half-written copy is not a copy: nothing that looks like a valid backup must be left behind.
            File.Delete(path);
            throw;
        }

        return path;
    }

    private static async Task ExecuteAsync(SqliteConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
