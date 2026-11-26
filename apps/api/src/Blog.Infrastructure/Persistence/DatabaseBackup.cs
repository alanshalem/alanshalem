using System.Globalization;
using Microsoft.Data.Sqlite;

namespace Blog.Infrastructure.Persistence;

/// <summary>
/// Copia de respaldo de la base con la API de backup de SQLite: es una foto consistente de un instante aunque la API
/// esté escribiendo (con WAL, la lectura no frena a la escritura), cosa que copiar el archivo a mano no garantiza.
/// </summary>
public static class DatabaseBackup
{
    // Cuánto espera la copia si la base está ocupada un instante (una escritura que termina, otra conexión que la abre).
    // La API de backup no reintenta sola: sin esto, una copia que coincide con una escritura falla con "database is locked".
    private const int BusyTimeoutMilliseconds = 10_000;

    /// <summary>blog-{UTC yyyyMMddTHHmmssZ}.db: ordenado por nombre es ordenado por fecha, que es lo que rota el script.</summary>
    public static string FileNameFor(DateTime nowUtc) =>
        $"blog-{nowUtc.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture)}.db";

    /// <summary>Crea la carpeta si falta y escribe la copia en un archivo nuevo, que nunca reemplaza a otro.</summary>
    /// <returns>La ruta completa de la copia.</returns>
    /// <exception cref="IOException">Si ya existe una copia con ese nombre (no se toca) o no se puede escribir.</exception>
    /// <exception cref="FileNotFoundException">Si la base no existe (no se crea una vacía para copiarla).</exception>
    /// <exception cref="SqliteException">Si la base no se puede leer.</exception>
    public static async Task<string> CreateAsync(string connectionString, string directory, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var source = new SqliteConnectionStringBuilder(connectionString) { Mode = SqliteOpenMode.ReadWrite, Pooling = false };
        if (!File.Exists(source.DataSource))
        {
            throw new FileNotFoundException("La base de datos no existe.", Path.GetFullPath(source.DataSource));
        }

        Directory.CreateDirectory(directory);
        var path = Path.Combine(Path.GetFullPath(directory), FileNameFor(nowUtc));

        // CreateNew reserva el nombre de forma atómica: si ya hay una copia (dos corridas en el mismo segundo), falla
        // sin tocarla.
        await new FileStream(path, FileMode.CreateNew).DisposeAsync();
        try
        {
            await using var from = new SqliteConnection(source.ToString());
            await using var to = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
            await from.OpenAsync(cancellationToken);
            await to.OpenAsync(cancellationToken);
            await ExecuteAsync(from, $"PRAGMA busy_timeout={BusyTimeoutMilliseconds};", cancellationToken);
            from.BackupDatabase(to);

            // La copia trae el modo WAL de la base; en DELETE queda un solo archivo, que se mueve y se restaura tal cual.
            await ExecuteAsync(to, "PRAGMA journal_mode=DELETE;", cancellationToken);
        }
        catch
        {
            // Una copia a medias no es una copia: que no quede nada que parezca un respaldo válido.
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
