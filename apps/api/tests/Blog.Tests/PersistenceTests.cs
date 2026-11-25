using Blog.Application.Abstractions;
using Blog.Application.HeroImages;
using Blog.Application.Media;
using Blog.Application.Posts;
using Blog.Application.Settings;
using Blog.Domain;
using Blog.Infrastructure;
using Blog.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Tests;

/// <summary>
/// Base SQLite real en un archivo temporal (fuera del repo), armada con el mismo AddInfrastructure que usa la API.
/// Sin pooling: así no queda ningún handle abierto y la carpeta se puede borrar al terminar.
/// </summary>
internal sealed class SqliteTestDatabase : IAsyncDisposable
{
    private readonly string _directory;

    public SqliteTestDatabase()
    {
        _directory = Path.Combine(Path.GetTempPath(), "blog-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_directory);
        FilePath = Path.Combine(_directory, "blog.db");
        MediaDirectory = Path.Combine(_directory, "media");

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Blog"] = $"Data Source={FilePath};Pooling=False",
                ["Media:Directory"] = MediaDirectory,
            })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddInfrastructure(configuration);
        Services = services.BuildServiceProvider();
    }

    public string FilePath { get; }

    /// <summary>Carpeta de media de esta prueba (dentro de la carpeta temporal que se borra al terminar).</summary>
    public string MediaDirectory { get; }

    public ServiceProvider Services { get; }

    public CountingBuildTrigger Build { get; } = new();

    public FixedClock Clock { get; } = new();

    public Task InitializeAsync() => DatabaseInitializer.InitializeAsync(Services);

    /// <summary>Corre la acción en un scope nuevo (DbContext limpio): lo que lee viene de la base, no del change tracker.</summary>
    public async Task<T> InScopeAsync<T>(Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = Services.CreateAsyncScope();
        return await action(scope.ServiceProvider);
    }

    public Task<T> WithPostsAsync<T>(Func<PostService, Task<T>> action) =>
        InScopeAsync(provider => action(new PostService(provider.GetRequiredService<IPostRepository>(), Clock, Build)));

    public Task<T> WithSettingsAsync<T>(Func<SiteSettingsService, Task<T>> action) =>
        InScopeAsync(provider => action(new SiteSettingsService(provider.GetRequiredService<ISiteSettingsRepository>(), Build)));

    /// <summary>MediaService con el pipeline real (NetVips), el disco real y la base real.</summary>
    public Task<T> WithMediaAsync<T>(Func<MediaService, Task<T>> action) =>
        InScopeAsync(provider => action(new MediaService(
            provider.GetRequiredService<IImageProcessor>(),
            provider.GetRequiredService<IMediaStorage>(),
            provider.GetRequiredService<IMediaAssetRepository>(),
            Clock)));

    public Task<T> WithHeroImagesAsync<T>(Func<HeroImageService, Task<T>> action) =>
        InScopeAsync(provider => action(new HeroImageService(
            provider.GetRequiredService<IHeroImageRepository>(),
            provider.GetRequiredService<IMediaAssetRepository>(),
            Clock,
            Build)));

    /// <summary>Archivos bajo la carpeta de media, con ruta relativa y barras "/" (como en la URL).</summary>
    public IReadOnlyList<string> MediaFiles() =>
        Directory.Exists(MediaDirectory)
            ? Directory.EnumerateFiles(MediaDirectory, "*", SearchOption.AllDirectories)
                .Select(path => Path.GetRelativePath(MediaDirectory, path).Replace('\\', '/'))
                .Order(StringComparer.Ordinal)
                .ToList()
            : [];

    public async Task<IReadOnlyList<string>> ListAsync(string sql)
    {
        await using var connection = new SqliteConnection($"Data Source={FilePath};Pooling=False");
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await using var reader = await command.ExecuteReaderAsync();
        var values = new List<string>();
        while (await reader.ReadAsync())
        {
            values.Add(reader.GetString(0));
        }

        return values;
    }

    public Task<IReadOnlyList<string>> TablesAsync() =>
        ListAsync("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");

    public async Task ExecuteAsync(string sql)
    {
        await using var connection = new SqliteConnection($"Data Source={FilePath};Pooling=False");
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    public async ValueTask DisposeAsync()
    {
        await Services.DisposeAsync();
        SqliteConnection.ClearAllPools();
        Directory.Delete(_directory, recursive: true);
    }
}

public class MigrationTests
{
    [Fact]
    public async Task Initialize_applies_the_migrations_on_a_fresh_database()
    {
        await using var database = new SqliteTestDatabase();

        await database.InitializeAsync();

        var tables = await database.TablesAsync();
        Assert.Contains("__EFMigrationsHistory", tables);
        Assert.Contains("posts", tables);
        Assert.Contains("site_settings", tables);
        Assert.Contains("media_assets", tables);
        Assert.Contains("hero_images", tables);

        var postColumns = await database.ListAsync("SELECT name FROM pragma_table_info('posts')");
        Assert.Contains("CoverUrl", postColumns);
        Assert.Contains("CoverAlt", postColumns);
        Assert.DoesNotContain(await SettingsColumnsAsync(database), column => column.StartsWith("HeroImage", StringComparison.Ordinal));

        var applied = await database.ListAsync("SELECT MigrationId FROM __EFMigrationsHistory");
        Assert.Contains(applied, id => id.EndsWith("_InitialCreate", StringComparison.Ordinal));
        Assert.Contains(applied, id => id.EndsWith("_AddMediaAssetsAndHeroGallery", StringComparison.Ordinal));

        await database.InScopeAsync<bool>(async provider =>
        {
            var db = provider.GetRequiredService<BlogDbContext>();
            Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            // Si el modelo cambia sin generar una migración nueva, esto falla (y Migrate() también lo haría al arrancar).
            Assert.False(db.Database.HasPendingModelChanges());
            return true;
        });
    }

    [Fact]
    public async Task Initialize_is_idempotent()
    {
        await using var database = new SqliteTestDatabase();

        await database.InitializeAsync();
        await database.InitializeAsync();

        var applied = await database.ListAsync("SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId");
        var known = await database.InScopeAsync(provider =>
            Task.FromResult(provider.GetRequiredService<BlogDbContext>().Database.GetMigrations().ToList()));
        Assert.Equal(known, applied);
    }

    [Fact]
    public async Task Upgrading_from_InitialCreate_keeps_posts_and_settings_and_drops_the_old_hero_columns()
    {
        await using var database = new SqliteTestDatabase();
        // Base como la dejó la primera versión con migraciones, con datos reales adentro.
        await database.InScopeAsync(async provider =>
        {
            var db = provider.GetRequiredService<BlogDbContext>();
            await db.GetService<IMigrator>().MigrateAsync(db.Database.GetMigrations().First());
            return true;
        });
        Assert.Contains("HeroImageUrl", await SettingsColumnsAsync(database));
        var postId = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e0f");
        await database.ExecuteAsync($"""
            INSERT INTO posts (Id, Slug, Title, Summary, Body, Tags, CoverUrl, CoverAlt, Lang, Status, CreatedAtUtc, UpdatedAtUtc, PublishedAtUtc)
            VALUES ('{postId.ToString().ToUpperInvariant()}', 'hola', 'Hola', 'Resumen', 'Cuerpo', '["net"]', '/media/2026/11/a.png', 'Alt',
                    'es', 'Published', '2026-11-20 10:00:00', '2026-11-21 10:00:00', '2026-11-21 10:00:00');
            INSERT INTO site_settings (Id, Name, Tagline, Bio, Email, GithubUrl, LinkedinUrl, XUrl, HeroImageUrl, HeroImageAlt, HeroImageCredit)
            VALUES (1, 'Alan', 'Frase', 'Bio', 'alan@example.com', 'https://github.com/alan', NULL, NULL, '/media/hero.jpg', 'Alt', 'Crédito');
            """);

        await database.InitializeAsync();

        var post = Assert.Single(await database.WithPostsAsync(posts => posts.ListPublishedAsync(default)));
        Assert.Equal(postId, post.Id);
        Assert.Equal("Hola", post.Title);
        Assert.Equal(["net"], post.Tags);
        Assert.Equal("/media/2026/11/a.png", post.CoverUrl);
        Assert.Equal(new DateTime(2026, 11, 21, 10, 0, 0, DateTimeKind.Utc), post.PublishedAt);
        Assert.Equal(
            new SiteSettingsDto("Alan", "Frase", "Bio", "alan@example.com", "https://github.com/alan", null, null),
            await database.WithSettingsAsync(settings => settings.GetAsync(default)));
        Assert.DoesNotContain(await SettingsColumnsAsync(database), column => column.StartsWith("HeroImage", StringComparison.Ordinal));
        Assert.Empty(await database.ListAsync("SELECT Id FROM hero_images"));
    }

    private static Task<IReadOnlyList<string>> SettingsColumnsAsync(SqliteTestDatabase database) =>
        database.ListAsync("SELECT name FROM pragma_table_info('site_settings')");

    [Fact]
    public async Task Initialize_refuses_a_legacy_database_created_without_migrations()
    {
        await using var database = new SqliteTestDatabase();
        // Así creaba la base la v0.1: EnsureCreated, sin tabla de historial de migraciones.
        await database.InScopeAsync(provider => provider.GetRequiredService<BlogDbContext>().Database.EnsureCreatedAsync());

        var error = await Assert.ThrowsAsync<InvalidOperationException>(database.InitializeAsync);

        Assert.Contains("sin migraciones", error.Message, StringComparison.Ordinal);
        Assert.Contains("blog.db.bak", error.Message, StringComparison.Ordinal);
        Assert.Contains(database.FilePath, error.Message, StringComparison.Ordinal);
        // No se tocó: ni se migró ni se borró.
        Assert.True(File.Exists(database.FilePath));
        Assert.DoesNotContain("__EFMigrationsHistory", await database.TablesAsync());
    }
}

public class PostPersistenceTests
{
    private static SavePostRequest WithCover(string title, string? coverUrl, string? coverAlt) =>
        new(title, null, "resumen", "cuerpo", ["net"], coverUrl, coverAlt);

    [Fact]
    public async Task The_cover_round_trips_through_save_get_lists_and_the_internal_list()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();

        var created = await database.WithPostsAsync(posts => posts.CreateAsync(WithCover("Con portada", "/media/2026/11/a.png", "Un gráfico"), default));
        await database.WithPostsAsync(posts => posts.PublishAsync(created.Id, default));
        await database.WithPostsAsync(posts => posts.CreateAsync(WithCover("Sin portada", null, null), default));

        var loaded = await database.WithPostsAsync(posts => posts.GetAsync(created.Id, default));
        Assert.Equal("/media/2026/11/a.png", loaded.CoverUrl);
        Assert.Equal("Un gráfico", loaded.CoverAlt);

        var summaries = await database.WithPostsAsync(posts => posts.ListAsync(default));
        var withCover = Assert.Single(summaries, summary => summary.Id == created.Id);
        Assert.Equal("/media/2026/11/a.png", withCover.CoverUrl);
        Assert.Equal("Un gráfico", withCover.CoverAlt);
        var withoutCover = Assert.Single(summaries, summary => summary.Id != created.Id);
        Assert.Null(withoutCover.CoverUrl);
        Assert.Null(withoutCover.CoverAlt);

        var published = Assert.Single(await database.WithPostsAsync(posts => posts.ListPublishedAsync(default)));
        Assert.Equal("/media/2026/11/a.png", published.CoverUrl);
        Assert.Equal("Un gráfico", published.CoverAlt);

        var updated = await database.WithPostsAsync(posts => posts.UpdateAsync(
            created.Id, WithCover("Con portada", "https://images.example.com/b.jpg", null), default));
        Assert.Equal("https://images.example.com/b.jpg", updated.CoverUrl);
        Assert.Null(updated.CoverAlt);
        // Equivalent y no Equal: Tags es una lista nueva en cada lectura (el record la compararía por referencia).
        Assert.Equivalent(updated, await database.WithPostsAsync(posts => posts.GetAsync(created.Id, default)), strict: true);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("//evil.com/x.png")]
    [InlineData("data:image/png;base64,iVBORw0KGgo=")]
    public async Task A_rejected_cover_leaves_the_stored_post_unchanged(string coverUrl)
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        var created = await database.WithPostsAsync(posts => posts.CreateAsync(WithCover("Original", "/media/x.png", "Alt"), default));
        await database.WithPostsAsync(posts => posts.PublishAsync(created.Id, default));
        var before = await database.WithPostsAsync(posts => posts.GetAsync(created.Id, default));
        var buildsBefore = database.Build.Requests;
        database.Clock.UtcNow = database.Clock.UtcNow.AddHours(1);

        await Assert.ThrowsAsync<DomainException>(() => database.WithPostsAsync(posts => posts.UpdateAsync(
            created.Id, WithCover("Cambiado", coverUrl, "Otro"), default)));

        Assert.Equivalent(before, await database.WithPostsAsync(posts => posts.GetAsync(created.Id, default)), strict: true);
        Assert.Equal(buildsBefore, database.Build.Requests);
    }
}

public class SiteSettingsPersistenceTests
{
    [Fact]
    public async Task Defaults_without_a_row_then_save_and_get_round_trip()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();

        var defaults = await database.WithSettingsAsync(settings => settings.GetAsync(default));
        Assert.Equal("Mi blog", defaults.Name);
        Assert.Equal("Notas sobre software, ideas y cosas que estoy aprendiendo.", defaults.Tagline);
        Assert.Empty(await database.ListAsync("SELECT Name FROM site_settings"));

        var saved = await database.WithSettingsAsync(settings => settings.SaveAsync(SiteSettingsServiceTests.FullRequest(), default));
        Assert.Equal(saved, await database.WithSettingsAsync(settings => settings.GetAsync(default)));
        Assert.Equal(1, database.Build.Requests);

        var resaved = await database.WithSettingsAsync(settings =>
            settings.SaveAsync(SiteSettingsServiceTests.FullRequest("Otro") with { Bio = null }, default));
        Assert.Equal(resaved, await database.WithSettingsAsync(settings => settings.GetAsync(default)));
        Assert.Null(resaved.Bio);
        Assert.Equal(new[] { "Otro" }, await database.ListAsync("SELECT Name FROM site_settings"));
    }

    [Fact]
    public async Task Rejected_settings_leave_the_stored_ones_unchanged()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        var saved = await database.WithSettingsAsync(settings => settings.SaveAsync(SiteSettingsServiceTests.FullRequest(), default));

        await Assert.ThrowsAsync<DomainException>(() => database.WithSettingsAsync(settings =>
            settings.SaveAsync(SiteSettingsServiceTests.FullRequest("Cambiado") with { Email = "no-es-mail" }, default)));

        Assert.Equal(saved, await database.WithSettingsAsync(settings => settings.GetAsync(default)));
        Assert.Equal(1, database.Build.Requests);
    }
}
