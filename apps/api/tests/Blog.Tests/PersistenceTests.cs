using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Application.HeroImages;
using Blog.Application.Media;
using Blog.Application.Posts;
using Blog.Application.Settings;
using Blog.Application.Videos;
using Blog.Domain;
using Blog.Infrastructure;
using Blog.Infrastructure.Persistence;
using Blog.Infrastructure.Scheduling;
using Blog.Infrastructure.Videos;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Blog.Tests;

/// <summary>
/// Base SQLite real en un archivo temporal (fuera del repo), armada con el mismo AddInfrastructure que usa la API.
/// Sin pooling: así no queda ningún handle abierto y la carpeta se puede borrar al terminar.
/// </summary>
internal sealed class SqliteTestDatabase : IAsyncDisposable
{
    private readonly string _directory;

    /// <param name="configure">Reemplazos para la prueba (dobles, registradores de logs), aplicados después de AddInfrastructure.</param>
    public SqliteTestDatabase(Action<IServiceCollection>? configure = null)
    {
        _directory = Path.Combine(Path.GetTempPath(), "blog-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_directory);
        FilePath = Path.Combine(_directory, "blog.db");
        MediaDirectory = Path.Combine(_directory, "media");
        VideoWorkDirectory = Path.Combine(_directory, "video-work");

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Blog"] = $"Data Source={FilePath};Pooling=False",
                ["Media:Directory"] = MediaDirectory,
                ["Video:WorkDirectory"] = VideoWorkDirectory,
            })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddInfrastructure(configuration);
        services.AddSingleton<ILoggerProvider>(Logs);

        // Los casos de uso que el proceso en segundo plano saca del contenedor (como en Program.cs), con el reloj y
        // el builder de la prueba.
        services.AddSingleton<IClock>(Clock);
        services.AddSingleton<ISiteBuildTrigger>(Build);
        services.AddScoped<PostService>();
        services.AddScoped<MediaService>();
        services.AddScoped<VideoService>();
        services.AddScoped<VideoProcessor>();
        configure?.Invoke(services);
        Services = services.BuildServiceProvider();
    }

    public string FilePath { get; }

    /// <summary>Carpeta de media de esta prueba (dentro de la carpeta temporal que se borra al terminar).</summary>
    public string MediaDirectory { get; }

    /// <summary>Originales de video en espera y salidas de ffmpeg de esta prueba.</summary>
    public string VideoWorkDirectory { get; }

    public ServiceProvider Services { get; }

    /// <summary>El proceso de videos en segundo plano, tal como lo registra AddInfrastructure (sin arrancar).</summary>
    public IHostedService VideoWorker => Services.GetServices<IHostedService>().OfType<VideoProcessingWorker>().Single();

    /// <summary>El que publica los posts programados, tal como lo registra AddInfrastructure (sin arrancar).</summary>
    public ScheduledPublishingWorker SchedulerWorker => Services.GetServices<IHostedService>().OfType<ScheduledPublishingWorker>().Single();

    public CountingBuildTrigger Build { get; } = new();

    /// <summary>Todo lo que registran los servicios de esta prueba.</summary>
    public CapturingLoggerProvider Logs { get; } = new();

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
            provider.GetRequiredService<IVideoAssetRepository>(),
            Clock,
            Build)));

    public Task<T> WithVideosAsync<T>(Func<VideoService, Task<T>> action) =>
        InScopeAsync(provider => action(provider.GetRequiredService<VideoService>()));

    public Task<T> WithVideoProcessorAsync<T>(Func<VideoProcessor, Task<T>> action) =>
        InScopeAsync(provider => action(provider.GetRequiredService<VideoProcessor>()));

    /// <summary>Lo que hay en la carpeta de trabajo de video (originales en espera, salidas de ffmpeg).</summary>
    public IReadOnlyList<string> VideoWorkFiles() =>
        Directory.Exists(VideoWorkDirectory)
            ? Directory.EnumerateFileSystemEntries(VideoWorkDirectory, "*", SearchOption.AllDirectories).ToList()
            : [];

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
        Assert.Contains("video_assets", tables);
        Assert.Contains("VideoAssetId", await database.ListAsync("SELECT name FROM pragma_table_info('hero_images')"));
        Assert.Contains("IsAnimated", await database.ListAsync("SELECT name FROM pragma_table_info('media_assets')"));
        var videoColumns = await database.ListAsync("SELECT name FROM pragma_table_info('video_assets')");
        Assert.Superset(new HashSet<string> { "TrimStart", "TrimEnd", "Fade", "FadeSeconds" }, videoColumns.ToHashSet());
        Assert.DoesNotContain("DurationSeconds", videoColumns);

        var postColumns = await database.ListAsync("SELECT name FROM pragma_table_info('posts')");
        Assert.Contains("CoverUrl", postColumns);
        Assert.Contains("CoverAlt", postColumns);
        Assert.Contains("TranslationGroupId", postColumns);
        Assert.Contains("ScheduledAtUtc", postColumns);
        Assert.Contains("post_revisions", tables);
        Assert.Superset(new HashSet<string> { "TaglineEn", "BioEn" }, (await SettingsColumnsAsync(database)).ToHashSet());
        Assert.Superset(
            new HashSet<string> { "AltEn", "CreditEn" }, (await database.ListAsync("SELECT name FROM pragma_table_info('hero_images')")).ToHashSet());
        Assert.DoesNotContain(await SettingsColumnsAsync(database), column => column.StartsWith("HeroImage", StringComparison.Ordinal));

        var applied = await database.ListAsync("SELECT MigrationId FROM __EFMigrationsHistory");
        Assert.Contains(applied, id => id.EndsWith("_InitialCreate", StringComparison.Ordinal));
        Assert.Contains(applied, id => id.EndsWith("_AddMediaAssetsAndHeroGallery", StringComparison.Ordinal));
        Assert.Contains(applied, id => id.EndsWith("_AddHeroVideos", StringComparison.Ordinal));
        Assert.Contains(applied, id => id.EndsWith("_AddVideoEdit", StringComparison.Ordinal));
        Assert.Contains(applied, id => id.EndsWith("_AddTranslations", StringComparison.Ordinal));
        Assert.Contains(applied, id => id.EndsWith("_AddPostRevisionsAndScheduling", StringComparison.Ordinal));
        Assert.Contains(applied, id => id.EndsWith("_AddPostContentUpdatedAt", StringComparison.Ordinal));
        Assert.Contains("ContentUpdatedAtUtc", postColumns);

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
            new SiteSettingsDto("Alan", "Frase", "Bio", "alan@example.com", "https://github.com/alan", null, null, null, null, null),
            await database.WithSettingsAsync(settings => settings.GetAsync(default)));
        Assert.DoesNotContain(await SettingsColumnsAsync(database), column => column.StartsWith("HeroImage", StringComparison.Ordinal));
        Assert.Empty(await database.ListAsync("SELECT Id FROM hero_images"));
    }

    [Fact]
    public async Task Upgrading_from_the_photo_gallery_keeps_its_assets_and_photos_as_non_animated_photos_without_video()
    {
        await using var database = new SqliteTestDatabase();
        await database.InScopeAsync(async provider =>
        {
            var db = provider.GetRequiredService<BlogDbContext>();
            await db.GetService<IMigrator>().MigrateAsync("AddMediaAssetsAndHeroGallery");
            return true;
        });
        Assert.DoesNotContain("video_assets", await database.TablesAsync());
        var assetId = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e01");
        var heroId = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e02");
        var hash = new string('a', MediaAsset.HashLength);
        await database.ExecuteAsync($"""
            INSERT INTO media_assets (Id, Hash, Width, Height, Color, Placeholder, CreatedAtUtc)
            VALUES ('{assetId.ToString().ToUpperInvariant()}', '{hash}', 1600, 900, '#102030', 'data:image/webp;base64,UklGRg==',
                    '2026-11-25 10:00:00');
            INSERT INTO hero_images (Id, MediaAssetId, Alt, Credit, CreatedAtUtc)
            VALUES ('{heroId.ToString().ToUpperInvariant()}', '{assetId.ToString().ToUpperInvariant()}', 'Nebulosa', 'Foto: Ana',
                    '2026-11-25 11:00:00');
            """);

        await database.InitializeAsync();

        var hero = Assert.Single(await database.WithHeroImagesAsync(heroes => heroes.ListForSiteAsync(default)));
        Assert.Equal((heroId, "Nebulosa", "Foto: Ana"), (hero.Id, hero.Alt, hero.Credit));
        Assert.Equal(new DateTime(2026, 11, 25, 11, 0, 0, DateTimeKind.Utc), hero.CreatedAt);
        Assert.Null(hero.Video);
        Assert.Equal((assetId, 1600, 900, "#102030"), (hero.Media.Id, hero.Media.Width, hero.Media.Height, hero.Media.Color));
        // Una foto existente no es animada: sigue teniendo sus variantes AVIF y WebP.
        Assert.Equal(
            MediaVariant.For(1600).Select(variant => variant.Format),
            hero.Media.Variants.Select(variant => variant.Format));
        Assert.Empty(await database.ListAsync("SELECT Id FROM video_assets"));
    }

    [Fact]
    public async Task Upgrading_from_hero_videos_keeps_processed_videos_whole_without_fade_and_with_their_files()
    {
        await using var database = new SqliteTestDatabase();
        await database.InScopeAsync(async provider =>
        {
            var db = provider.GetRequiredService<BlogDbContext>();
            await db.GetService<IMigrator>().MigrateAsync("AddHeroVideos");
            return true;
        });
        var posterId = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e11");
        var videoId = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e12");
        var contentHash = new string('e', MediaAsset.HashLength);
        // $$: las llaves sueltas son el JSON de las fuentes; las dobles, los valores de la prueba.
        await database.ExecuteAsync($$"""
            INSERT INTO media_assets (Id, Hash, Width, Height, IsAnimated, Color, Placeholder, CreatedAtUtc)
            VALUES ('{{posterId.ToString().ToUpperInvariant()}}', '{{new string('f', MediaAsset.HashLength)}}', 1920, 1080, 0, '#102030',
                    'data:image/webp;base64,UklGRg==', '2026-11-25 10:00:00');
            INSERT INTO video_assets (Id, Hash, Width, Height, DurationSeconds, Status, Error, PosterId, Sources, CreatedAtUtc)
            VALUES ('{{videoId.ToString().ToUpperInvariant()}}', '{{contentHash}}', 1920, 1080, 12.5, 'Ready', NULL,
                    '{{posterId.ToString().ToUpperInvariant()}}', '[{"Codec":"Av1","Height":1080,"Bytes":100}]', '2026-11-25 10:00:00');
            """);

        await database.InitializeAsync();

        var video = await database.WithVideosAsync(videos => videos.GetAsync(videoId, default));
        Assert.Equal(VideoStatus.Ready, video.Status);
        Assert.Equal(new VideoEditDto(0, 12.5, VideoFade.None, 1), video.Edit);
        Assert.Equal(12.5, video.DurationSeconds);
        // Conserva el hash del original: sus archivos siguen en la misma ruta.
        Assert.Equal($"/media/videos/{contentHash}/1080.av1.mp4", Assert.Single(video.Sources).Url);
        Assert.DoesNotContain("DurationSeconds", await database.ListAsync("SELECT name FROM pragma_table_info('video_assets')"));
    }

    [Fact]
    public async Task Upgrading_from_video_edit_keeps_posts_settings_and_hero_and_puts_each_post_in_its_own_group()
    {
        await using var database = new SqliteTestDatabase();
        await database.InScopeAsync(async provider =>
        {
            var db = provider.GetRequiredService<BlogDbContext>();
            await db.GetService<IMigrator>().MigrateAsync("AddVideoEdit");
            return true;
        });
        var firstId = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e21");
        var secondId = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e22");
        var assetId = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e23");
        var heroId = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e24");
        await database.ExecuteAsync($"""
            INSERT INTO posts (Id, Slug, Title, Summary, Body, Tags, CoverUrl, CoverAlt, Lang, Status, CreatedAtUtc, UpdatedAtUtc, PublishedAtUtc)
            VALUES ('{firstId.ToString().ToUpperInvariant()}', 'uno', 'Uno', 'R1', 'Cuerpo 1', '["net"]', NULL, NULL,
                    'es', 'Published', '2026-11-20 10:00:00', '2026-11-21 10:00:00', '2026-11-21 10:00:00'),
                   ('{secondId.ToString().ToUpperInvariant()}', 'dos', 'Dos', 'R2', 'Cuerpo 2', '[]', NULL, NULL,
                    'es', 'Draft', '2026-11-22 10:00:00', '2026-11-22 10:00:00', NULL);
            INSERT INTO site_settings (Id, Name, Tagline, Bio, Email, GithubUrl, LinkedinUrl, XUrl)
            VALUES (1, 'Alan', 'Frase', 'Bio', NULL, NULL, NULL, NULL);
            INSERT INTO media_assets (Id, Hash, Width, Height, IsAnimated, Color, Placeholder, CreatedAtUtc)
            VALUES ('{assetId.ToString().ToUpperInvariant()}', '{new string('b', MediaAsset.HashLength)}', 1920, 1080, 0, '#102030',
                    'data:image/webp;base64,UklGRg==', '2026-11-25 10:00:00');
            INSERT INTO hero_images (Id, MediaAssetId, VideoAssetId, Alt, Credit, CreatedAtUtc)
            VALUES ('{heroId.ToString().ToUpperInvariant()}', '{assetId.ToString().ToUpperInvariant()}', NULL, 'Nebulosa', 'Foto: Ana',
                    '2026-11-25 11:00:00');
            """);

        await database.InitializeAsync();

        var first = await database.WithPostsAsync(posts => posts.GetAsync(firstId, default));
        var second = await database.WithPostsAsync(posts => posts.GetAsync(secondId, default));
        Assert.Equal(("uno", "Uno", "Cuerpo 1", "es", PostStatus.Published), (first.Slug, first.Title, first.Body, first.Lang, first.Status));
        Assert.Equal(("dos", "Dos", "es", PostStatus.Draft), (second.Slug, second.Title, second.Lang, second.Status));
        Assert.NotEqual(Guid.Empty, first.TranslationGroupId);
        Assert.NotEqual(Guid.Empty, second.TranslationGroupId);
        Assert.NotEqual(first.TranslationGroupId, second.TranslationGroupId);
        Assert.Empty(first.Translations);
        Assert.Empty(second.Translations);
        Assert.Equal(
            new SiteSettingsDto("Alan", "Frase", "Bio", null, null, null, null, null, null, null),
            await database.WithSettingsAsync(settings => settings.GetAsync(default)));
        var hero = Assert.Single(await database.WithHeroImagesAsync(heroes => heroes.ListAsync(default)));
        Assert.Equal((heroId, "Nebulosa", "Foto: Ana", null, null), (hero.Id, hero.Alt, hero.Credit, hero.AltEn, hero.CreditEn));

        // Un post existente ya puede sumar su versión en inglés con el mismo slug.
        var english = await database.WithPostsAsync(posts => posts.CreateTranslationAsync(firstId, new CreateTranslationRequest("en"), default));
        Assert.Equal((first.TranslationGroupId, "uno"), (english.TranslationGroupId, english.Slug));
    }

    [Fact]
    public async Task Upgrading_from_translations_keeps_posts_unscheduled_with_their_current_content_as_revision_1()
    {
        await using var database = new SqliteTestDatabase();
        await database.InScopeAsync(async provider =>
        {
            var db = provider.GetRequiredService<BlogDbContext>();
            await db.GetService<IMigrator>().MigrateAsync("AddTranslations");
            return true;
        });
        var firstId = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e31");
        var secondId = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e32");
        await database.ExecuteAsync($"""
            INSERT INTO posts (Id, TranslationGroupId, Slug, Title, Summary, Body, Tags, CoverUrl, CoverAlt, Lang, Status, CreatedAtUtc, UpdatedAtUtc, PublishedAtUtc)
            VALUES ('{firstId.ToString().ToUpperInvariant()}', '{firstId.ToString().ToUpperInvariant()}', 'uno', 'Uno', 'R1', 'Cuerpo 1', '["net"]',
                    '/media/a.png', 'Alt', 'es', 'Published', '2026-11-20 10:00:00', '2026-11-21 10:00:00', '2026-11-21 10:00:00'),
                   ('{secondId.ToString().ToUpperInvariant()}', '{secondId.ToString().ToUpperInvariant()}', 'two', 'Two', '', 'Body 2', '[]',
                    NULL, NULL, 'en', 'Draft', '2026-11-22 10:00:00', '2026-11-22 11:00:00', NULL);
            """);

        await database.InitializeAsync();

        var first = await database.WithPostsAsync(posts => posts.GetAsync(firstId, default));
        var second = await database.WithPostsAsync(posts => posts.GetAsync(secondId, default));
        Assert.Equal(("Uno", "Cuerpo 1", PostStatus.Published, (DateTime?)null), (first.Title, first.Body, first.Status, first.ScheduledAt));
        Assert.Equal(("Two", "en", PostStatus.Draft, (DateTime?)null), (second.Title, second.Lang, second.Status, second.ScheduledAt));
        var revision = Assert.Single(await database.WithPostsAsync(posts => posts.ListRevisionsAsync(firstId, default)));
        var snapshot = await database.WithPostsAsync(posts => posts.GetRevisionAsync(firstId, revision.Id, default));
        Assert.Equal(
            new PostRevisionDto(revision.Id, 1, new DateTime(2026, 11, 21, 10, 0, 0, DateTimeKind.Utc), "Uno", "uno", "R1", "Cuerpo 1", snapshot.Tags, "/media/a.png", "Alt"),
            snapshot);
        Assert.Equal(["net"], snapshot.Tags);
        var other = Assert.Single(await database.WithPostsAsync(posts => posts.ListRevisionsAsync(secondId, default)));
        Assert.Equal((1, "Two"), (other.Number, other.Title));

        // El primer guardado después de actualizar ya se puede deshacer: sigue la numeración.
        await database.WithPostsAsync(posts => posts.UpdateAsync(firstId, new SavePostRequest("Uno 2", "uno", null, "x", null), default));
        Assert.Equal([2, 1], (await database.WithPostsAsync(posts => posts.ListRevisionsAsync(firstId, default))).Select(item => item.Number));
    }

    [Fact]
    public async Task Upgrading_from_revisions_dates_each_posts_content_at_its_latest_revision_or_else_its_last_update()
    {
        await using var database = new SqliteTestDatabase();
        await database.InScopeAsync(async provider =>
        {
            var db = provider.GetRequiredService<BlogDbContext>();
            await db.GetService<IMigrator>().MigrateAsync("AddPostRevisionsAndScheduling");
            return true;
        });
        // "editado" se editó el 22 y se publicó el 24: UpdatedAtUtc es la publicación, la última versión es la edición.
        var edited = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e41").ToString().ToUpperInvariant();
        var withoutRevisions = Guid.Parse("0195f0a4-1c2b-7d3e-8f40-5a6b7c8d9e42").ToString().ToUpperInvariant();
        await database.ExecuteAsync($"""
            INSERT INTO posts (Id, TranslationGroupId, Slug, Title, Summary, Body, Tags, Lang, Status, CreatedAtUtc, UpdatedAtUtc, PublishedAtUtc)
            VALUES ('{edited}', '{edited}', 'editado', 'Editado', '', 'v2', '[]', 'es', 'Published',
                    '2026-11-20 10:00:00', '2026-11-24 10:00:00', '2026-11-24 10:00:00'),
                   ('{withoutRevisions}', '{withoutRevisions}', 'suelto', 'Suelto', '', 'x', '[]', 'es', 'Draft',
                    '2026-11-20 10:00:00', '2026-11-23 10:00:00', NULL);
            INSERT INTO post_revisions (Id, PostId, Number, Title, Slug, Summary, Body, Tags, CreatedAtUtc)
            VALUES ('{Guid.NewGuid().ToString().ToUpperInvariant()}', '{edited}', 1, 'Editado', 'editado', '', 'v1', '[]', '2026-11-20 10:00:00'),
                   ('{Guid.NewGuid().ToString().ToUpperInvariant()}', '{edited}', 2, 'Editado', 'editado', '', 'v2', '[]', '2026-11-22 10:00:00');
            """);

        await database.InitializeAsync();

        var first = await database.WithPostsAsync(posts => posts.GetAsync(Guid.Parse(edited), default));
        var second = await database.WithPostsAsync(posts => posts.GetAsync(Guid.Parse(withoutRevisions), default));
        Assert.Equal(
            (new DateTime(2026, 11, 24, 10, 0, 0, DateTimeKind.Utc), new DateTime(2026, 11, 22, 10, 0, 0, DateTimeKind.Utc)),
            (first.UpdatedAt, first.ContentUpdatedAt));
        Assert.Equal(new DateTime(2026, 11, 23, 10, 0, 0, DateTimeKind.Utc), second.ContentUpdatedAt);
        Assert.Equal(DateTimeKind.Utc, first.ContentUpdatedAt.Kind);
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

public class TranslationPersistenceTests
{
    [Fact]
    public async Task Versions_round_trip_through_get_lists_and_delete_against_the_real_database()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        var original = await database.WithPostsAsync(posts => posts.CreateAsync(new SavePostRequest("Hola", null, "Resumen", "cuerpo", ["net"]), default));

        var english = await database.WithPostsAsync(posts => posts.CreateTranslationAsync(original.Id, new CreateTranslationRequest("en"), default));

        Assert.Equivalent(english, await database.WithPostsAsync(posts => posts.GetAsync(english.Id, default)), strict: true);
        var loaded = await database.WithPostsAsync(posts => posts.GetAsync(original.Id, default));
        Assert.Equal([new PostTranslationDto(english.Id, "en", "hola", PostStatus.Draft, english.UpdatedAt, english.ContentUpdatedAt)], loaded.Translations);
        var list = (await database.WithPostsAsync(posts => posts.ListAsync(default))).ToDictionary(summary => summary.Id);
        Assert.Equal(("en", original.TranslationGroupId), (list[english.Id].Lang, list[english.Id].TranslationGroupId));
        Assert.Equal([original.Id], list[english.Id].Translations.Select(version => version.Id));

        await database.WithPostsAsync(async posts =>
        {
            await posts.DeleteAsync(original.Id, default);
            return true;
        });

        var kept = await database.WithPostsAsync(posts => posts.GetAsync(english.Id, default));
        Assert.Equal((original.TranslationGroupId, "en"), (kept.TranslationGroupId, kept.Lang));
        Assert.Empty(kept.Translations);
    }

    [Fact]
    public async Task The_slug_is_unique_per_language_and_a_rejected_duplicate_leaves_the_database_unchanged()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        await database.WithPostsAsync(posts => posts.CreateAsync(new SavePostRequest("Hola", "hola", null, "cuerpo", null), default));
        await database.WithPostsAsync(posts => posts.CreateAsync(new SavePostRequest("Hello", "hola", null, "body", null, Lang: "en"), default));
        var before = await database.ListAsync("SELECT Lang || ':' || Slug || ':' || Title FROM posts ORDER BY Lang");

        var error = await Assert.ThrowsAsync<ConflictException>(() => database.WithPostsAsync(posts =>
            posts.CreateAsync(new SavePostRequest("Otro", "hola", null, "x", null, Lang: "en"), default)));

        Assert.Equal("Ya existe un post en inglés con el slug \"hola\".", error.Message);
        Assert.Equal(["en:hola:Hello", "es:hola:Hola"], before);
        Assert.Equal(before, await database.ListAsync("SELECT Lang || ':' || Slug || ':' || Title FROM posts ORDER BY Lang"));
    }

    [Fact]
    public async Task The_database_itself_refuses_a_second_version_in_the_same_language_or_slug()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        var original = await database.WithPostsAsync(posts => posts.CreateAsync(new SavePostRequest("Hola", null, null, "cuerpo", null), default));
        var group = original.TranslationGroupId.ToString().ToUpperInvariant();

        // Lo que dejaría pasar una carrera entre dos pedidos: los índices únicos tienen la última palabra.
        var sameLanguage = await Assert.ThrowsAsync<SqliteException>(() => database.ExecuteAsync($"""
            INSERT INTO posts (Id, TranslationGroupId, Slug, Title, Summary, Body, Tags, Lang, Status, CreatedAtUtc, UpdatedAtUtc)
            VALUES ('{Guid.NewGuid().ToString().ToUpperInvariant()}', '{group}', 'otro', 'Otro', '', '', '[]', 'es', 'Draft',
                    '2026-11-25 10:00:00', '2026-11-25 10:00:00');
            """));
        var sameSlug = await Assert.ThrowsAsync<SqliteException>(() => database.ExecuteAsync($"""
            INSERT INTO posts (Id, TranslationGroupId, Slug, Title, Summary, Body, Tags, Lang, Status, CreatedAtUtc, UpdatedAtUtc)
            VALUES ('{Guid.NewGuid().ToString().ToUpperInvariant()}', '{Guid.NewGuid().ToString().ToUpperInvariant()}', 'hola', 'Otro',
                    '', '', '[]', 'es', 'Draft', '2026-11-25 10:00:00', '2026-11-25 10:00:00');
            """));

        Assert.Contains("posts.TranslationGroupId, posts.Lang", sameLanguage.Message, StringComparison.Ordinal);
        Assert.Contains("posts.Lang, posts.Slug", sameSlug.Message, StringComparison.Ordinal);
        Assert.Single(await database.ListAsync("SELECT Slug FROM posts"));
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

    [Fact]
    public async Task The_english_name_tagline_and_bio_round_trip_and_a_rejected_one_leaves_them_unchanged()
    {
        await using var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        var request = SiteSettingsServiceTests.FullRequest() with
        {
            NameEn = " Alan S. ", TaglineEn = " I write about .NET ", BioEn = "Hi, I'm **Alan**.",
        };

        var saved = await database.WithSettingsAsync(settings => settings.SaveAsync(request, default));
        var tooLongName = await Assert.ThrowsAsync<DomainException>(() => database.WithSettingsAsync(settings =>
            settings.SaveAsync(request with { NameEn = new string('a', SiteSettingsContent.MaxNameLength + 1) }, default)));
        await Assert.ThrowsAsync<DomainException>(() => database.WithSettingsAsync(settings =>
            settings.SaveAsync(request with { BioEn = new string('a', SiteSettingsContent.MaxBioLength + 1) }, default)));

        Assert.Equal(("Alan S.", "I write about .NET", "Hi, I'm **Alan**."), (saved.NameEn, saved.TaglineEn, saved.BioEn));
        Assert.Equal("El nombre en inglés no puede superar 100 caracteres.", tooLongName.Message);
        Assert.Equal(saved, await database.WithSettingsAsync(settings => settings.GetAsync(default)));
        Assert.Equal(1, database.Build.Requests);
    }
}
