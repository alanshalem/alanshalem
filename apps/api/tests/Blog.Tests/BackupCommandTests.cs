using Blog.Api.Cli;
using Blog.Application.Posts;
using Microsoft.Data.Sqlite;

namespace Blog.Tests;

/// <summary>
/// El modo backup de la línea de comandos: copia consistente de la base (API de backup de SQLite) a
/// {carpeta}/blog-{UTC}.db, aunque la API esté escribiendo, sin pisar nunca una copia existente. Exit 0 o 1.
/// </summary>
public class BackupCommandTests
{
    private static readonly DateTime Now = new(2026, 11, 26, 15, 30, 45, DateTimeKind.Utc);
    private const string ExpectedFileName = "blog-20261126T153045Z.db";

    [Fact]
    public async Task Backup_copies_every_row_into_a_new_timestamped_file_and_creates_the_folder()
    {
        await using var database = await CreateDatabaseAsync();
        var ids = new List<Guid>();
        for (var i = 0; i < 3; i++)
        {
            ids.Add((await CreatePostAsync(database, $"Respaldado {i}")).Id);
        }

        using var scratch = new ScratchDirectory();
        var target = Path.Combine(scratch.Path, "respaldos", "diarios");
        using var output = new StringWriter();
        using var error = new StringWriter();

        var exitCode = await BackupCommand.RunAsync(target, ConnectionStringOf(database), Now, output, error, default);

        var backup = Path.Combine(target, ExpectedFileName);
        Assert.Equal((0, string.Empty), (exitCode, error.ToString()));
        Assert.Equal(backup, output.ToString().Trim());
        Assert.Equal("ok", await ScalarAsync(backup, "PRAGMA integrity_check"));
        Assert.Equal(ids.Order(), (await PostIdsAsync(backup)).Order());
        // Un solo archivo autosuficiente: sin -wal ni -shm al lado que haya que copiar también.
        Assert.Equal([ExpectedFileName], Directory.GetFiles(target).Select(Path.GetFileName));
    }

    [Fact]
    public async Task Backup_is_consistent_while_the_api_keeps_writing()
    {
        await using var database = await CreateDatabaseAsync();
        for (var i = 0; i < 20; i++)
        {
            await CreatePostAsync(database, $"Antes {i}");
        }

        using var scratch = new ScratchDirectory();
        using var stop = new CancellationTokenSource();
        var inserted = 0;
        var writer = Task.Run(async () =>
        {
            while (!stop.IsCancellationRequested)
            {
                await CreatePostAsync(database, $"Durante {inserted}");
                inserted++;
            }
        });
        while (Volatile.Read(ref inserted) < 3)
        {
            await Task.Delay(10);
        }

        using var error = new StringWriter();
        var exitCode = await BackupCommand.RunAsync(scratch.Path, ConnectionStringOf(database), Now, TextWriter.Null, error, default);
        await stop.CancelAsync();
        await writer;

        var backup = Path.Combine(scratch.Path, ExpectedFileName);
        Assert.Equal((0, string.Empty), (exitCode, error.ToString()));
        Assert.Equal("ok", await ScalarAsync(backup, "PRAGMA integrity_check"));
        Assert.Equal(string.Empty, await ScalarAsync(backup, "PRAGMA foreign_key_check") ?? string.Empty);
        var copied = await PostIdsAsync(backup);
        var source = await PostIdsAsync(database.FilePath);
        // Una foto de un instante: tiene todo lo de antes, y lo que trae de durante existe en la base.
        Assert.InRange(copied.Count, 20 + 3, source.Count);
        Assert.Subset(source.ToHashSet(), copied.ToHashSet());
    }

    [Fact]
    public async Task Backup_never_overwrites_an_existing_copy()
    {
        await using var database = await CreateDatabaseAsync();
        using var scratch = new ScratchDirectory();
        var existing = Path.Combine(scratch.Path, ExpectedFileName);
        await File.WriteAllTextAsync(existing, "copia previa");
        using var output = new StringWriter();
        using var error = new StringWriter();

        var exitCode = await BackupCommand.RunAsync(scratch.Path, ConnectionStringOf(database), Now, output, error, default);

        Assert.Equal(1, exitCode);
        Assert.Equal("copia previa", await File.ReadAllTextAsync(existing));
        Assert.Equal(string.Empty, output.ToString());
        Assert.Contains(ExpectedFileName, error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Backup_of_a_missing_database_fails_without_creating_it_or_a_copy()
    {
        using var scratch = new ScratchDirectory();
        var missing = Path.Combine(scratch.Path, "no-existe.db");
        var target = Path.Combine(scratch.Path, "respaldos");
        using var error = new StringWriter();

        var exitCode = await BackupCommand.RunAsync(target, $"Data Source={missing};Pooling=False", Now, TextWriter.Null, error, default);

        Assert.Equal(1, exitCode);
        Assert.False(File.Exists(missing));
        Assert.Empty(Directory.Exists(target) ? Directory.GetFiles(target) : []);
        Assert.NotEqual(string.Empty, error.ToString());
    }

    [Fact]
    public async Task The_command_line_rejects_backup_without_a_folder()
    {
        using var error = new StringWriter();

        var exitCode = await CommandLine.RunAsync(["backup"], TextReader.Null, TextWriter.Null, error);

        Assert.Equal(1, exitCode);
        Assert.Contains("backup <carpeta>", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_command_line_lets_anything_else_start_the_api()
    {
        Assert.Null(await CommandLine.RunAsync([], TextReader.Null, TextWriter.Null, TextWriter.Null));
        Assert.Null(await CommandLine.RunAsync(["--urls", "http://localhost:5090"], TextReader.Null, TextWriter.Null, TextWriter.Null));
    }

    private static async Task<SqliteTestDatabase> CreateDatabaseAsync()
    {
        var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        return database;
    }

    private static Task<PostDto> CreatePostAsync(SqliteTestDatabase database, string title) =>
        database.WithPostsAsync(posts => posts.CreateAsync(new SavePostRequest(title, null, null, "cuerpo", null), default));

    private static string ConnectionStringOf(SqliteTestDatabase database) => $"Data Source={database.FilePath};Pooling=False";

    private static async Task<string?> ScalarAsync(string file, string sql)
    {
        await using var connection = new SqliteConnection($"Data Source={file};Mode=ReadOnly;Pooling=False");
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return (await command.ExecuteScalarAsync())?.ToString();
    }

    private static async Task<List<Guid>> PostIdsAsync(string file)
    {
        await using var connection = new SqliteConnection($"Data Source={file};Mode=ReadOnly;Pooling=False");
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id FROM posts";
        await using var reader = await command.ExecuteReaderAsync();
        var ids = new List<Guid>();
        while (await reader.ReadAsync())
        {
            ids.Add(reader.GetGuid(0));
        }

        return ids;
    }

    /// <summary>Carpeta temporal propia de la prueba, que se borra al terminar.</summary>
    private sealed class ScratchDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "blog-backup-tests-" + Guid.NewGuid().ToString("N"));

        public ScratchDirectory() => Directory.CreateDirectory(Path);

        public void Dispose()
        {
            SqliteConnection.ClearAllPools();
            Directory.Delete(Path, recursive: true);
        }
    }
}
