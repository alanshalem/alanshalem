using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Application.HeroImages;
using Blog.Application.Media;
using Blog.Application.Videos;
using Blog.Domain;
using Blog.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Tests;

/// <summary>Galería del hero contra la base SQLite real (los assets se insertan directo: el pipeline se prueba aparte).</summary>
public class HeroImageServiceTests
{
    private const string UnknownImageMessage = "La foto del hero no existe.";

    [Fact]
    public async Task Create_stores_the_photo_with_its_media_and_requests_a_rebuild()
    {
        await using var database = await CreateDatabaseAsync();
        var asset = await AddAssetAsync(database, '1');

        var created = await database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(asset.Id, "  Nebulosa de Orión ", " Foto: Ana "), default));

        Assert.NotEqual(Guid.Empty, created.Id);
        Assert.Equivalent(asset.ToDto(), created.Media, strict: true);
        Assert.Equal("Nebulosa de Orión", created.Alt);
        Assert.Equal("Foto: Ana", created.Credit);
        Assert.Equal(database.Clock.UtcNow, created.CreatedAt);
        Assert.Equivalent(new[] { created }, await ListAsync(database), strict: true);
        Assert.Equal(1, database.Build.Requests);
    }

    [Fact]
    public async Task Create_without_credit_stores_null()
    {
        await using var database = await CreateDatabaseAsync();
        var asset = await AddAssetAsync(database, '1');

        var created = await database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(asset.Id, "Alt", "   "), default));

        Assert.Null(created.Credit);
        Assert.Null(Assert.Single(await ListAsync(database)).Credit);
    }

    [Theory]
    [InlineData(null, null, "El texto alternativo es obligatorio.")]
    [InlineData("   ", "Foto: Ana", "El texto alternativo es obligatorio.")]
    [InlineData("long-alt", null, "El texto alternativo no puede superar 300 caracteres.")]
    [InlineData("Alt", "long-credit", "El crédito no puede superar 200 caracteres.")]
    public async Task Invalid_create_is_rejected_stores_nothing_and_does_not_rebuild(string? alt, string? credit, string expectedMessage)
    {
        await using var database = await CreateDatabaseAsync();
        var asset = await AddAssetAsync(database, '1');
        var request = new CreateHeroImageRequest(asset.Id, Expand(alt), Expand(credit));

        var error = await Assert.ThrowsAsync<DomainException>(() => database.WithHeroImagesAsync(heroes => heroes.CreateAsync(request, default)));

        Assert.Equal(expectedMessage, error.Message);
        Assert.Empty(await ListAsync(database));
        Assert.Equal(0, database.Build.Requests);
    }

    [Fact]
    public async Task Create_with_an_unknown_media_is_rejected_and_stores_nothing()
    {
        await using var database = await CreateDatabaseAsync();

        var error = await Assert.ThrowsAsync<DomainException>(() => database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(Guid.NewGuid(), "Alt", null), default)));

        Assert.Equal("La imagen elegida no existe. Subila de nuevo.", error.Message);
        Assert.Empty(await ListAsync(database));
        Assert.Equal(0, database.Build.Requests);
    }

    [Theory]
    [InlineData(1080, 1920, "Mide 1080×1920 y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. Ideal: 1920×1080 o más, horizontal 16:9.")]
    [InlineData(1500, 1500, "Mide 1500×1500 y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. Ideal: 1920×1080 o más, horizontal 16:9.")]
    [InlineData(1439, 1200, "Mide 1439×1200 y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. Ideal: 1920×1080 o más, horizontal 16:9.")]
    [InlineData(1279, 720, "Mide 1279×720 y el mínimo es 1280×720. Ideal: 1920×1080 o más, horizontal 16:9.")]
    [InlineData(1280, 719, "Mide 1280×719 y el mínimo es 1280×720. Ideal: 1920×1080 o más, horizontal 16:9.")]
    public async Task A_photo_that_is_not_landscape_or_is_too_small_is_rejected_stores_nothing_and_does_not_rebuild(
        int width, int height, string expectedMessage)
    {
        await using var database = await CreateDatabaseAsync();
        var asset = await AddAssetAsync(database, '1', width, height);

        var error = await Assert.ThrowsAsync<DomainException>(() => database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(asset.Id, "Alt", null), default)));

        Assert.Equal(expectedMessage, error.Message);
        Assert.Empty(await ListAsync(database));
        Assert.Equal(0, database.Build.Requests);
    }

    [Theory]
    [InlineData(1280, 720)]
    [InlineData(1440, 1200)]
    [InlineData(2560, 1000)]
    public async Task A_photo_at_the_minimum_size_and_landscape_ratio_is_accepted(int width, int height)
    {
        await using var database = await CreateDatabaseAsync();
        var asset = await AddAssetAsync(database, '1', width, height);

        var created = await CreateAsync(database, asset, "Alt");

        Assert.Equal((width, height), (created.Media.Width, created.Media.Height));
        Assert.Equivalent(new[] { created }, await ListAsync(database), strict: true);
    }

    [Fact]
    public async Task Create_with_a_ready_video_uses_its_poster_as_media_and_requests_a_rebuild()
    {
        await using var database = await CreateDatabaseAsync();
        var video = await AddVideoAsync(database, '5', VideoStatus.Ready);
        var expectedVideo = await database.WithVideosAsync(videos => videos.GetAsync(video.Id, default));

        var created = await database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(null, " Aurora ", "Video: Ana", video.Id), default));

        Assert.Equal("Aurora", created.Alt);
        Assert.Equal("Video: Ana", created.Credit);
        Assert.Equivalent(expectedVideo, created.Video, strict: true);
        Assert.Equivalent(expectedVideo.Poster, created.Media, strict: true);
        Assert.Equal(VideoStatus.Ready, created.Video!.Status);
        Assert.Equivalent(new[] { created }, await ListAsync(database), strict: true);
        Assert.Equivalent(new[] { created }, await database.WithHeroImagesAsync(heroes => heroes.ListForSiteAsync(default)), strict: true);
        Assert.Equal(1, database.Build.Requests);
    }

    [Fact]
    public async Task A_photo_has_no_video()
    {
        await using var database = await CreateDatabaseAsync();

        var created = await CreateAsync(database, await AddAssetAsync(database, '1'), "Alt");

        Assert.Null(created.Video);
    }

    [Theory]
    [InlineData(VideoStatus.Processing, "El video todavía se está procesando: esperá a que esté listo.")]
    [InlineData(VideoStatus.Failed, "El video no se pudo procesar. Subilo de nuevo.")]
    public async Task Create_with_a_video_that_is_not_ready_is_rejected_and_stores_nothing(VideoStatus status, string expectedMessage)
    {
        await using var database = await CreateDatabaseAsync();
        var video = await AddVideoAsync(database, '5', status);

        var error = await Assert.ThrowsAsync<DomainException>(() => database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(null, "Alt", null, video.Id), default)));

        Assert.Equal(expectedMessage, error.Message);
        Assert.Empty(await ListAsync(database));
        Assert.Equal(0, database.Build.Requests);
    }

    [Fact]
    public async Task Create_needs_exactly_one_of_photo_or_video_and_the_video_must_exist()
    {
        await using var database = await CreateDatabaseAsync();
        var asset = await AddAssetAsync(database, '1');
        var video = await AddVideoAsync(database, '5', VideoStatus.Ready);

        var neither = await Assert.ThrowsAsync<DomainException>(() => database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(null, "Alt", null), default)));
        var both = await Assert.ThrowsAsync<DomainException>(() => database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(asset.Id, "Alt", null, video.Id), default)));
        var unknown = await Assert.ThrowsAsync<DomainException>(() => database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(null, "Alt", null, Guid.NewGuid()), default)));

        Assert.Equal("Elegí una foto o un video para el hero.", neither.Message);
        Assert.Equal("Elegí una foto o un video para el hero.", both.Message);
        Assert.Equal("El video elegido no existe. Subilo de nuevo.", unknown.Message);
        Assert.Empty(await ListAsync(database));
        Assert.Equal(0, database.Build.Requests);
    }

    [Fact]
    public async Task The_site_list_leaves_out_items_whose_video_is_not_ready_and_the_admin_list_keeps_them()
    {
        await using var database = await CreateDatabaseAsync();
        var photo = await CreateAsync(database, await AddAssetAsync(database, '1'), "Foto");
        var readyVideo = await AddVideoAsync(database, '5', VideoStatus.Ready);
        var stuckVideo = await AddVideoAsync(database, '6', VideoStatus.Ready);
        var ready = await database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(null, "Listo", null, readyVideo.Id), default));
        var stuck = await database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(null, "Trabado", null, stuckVideo.Id), default));
        // Un video listo vuelve a "processing" si se sube de nuevo y le faltan archivos en disco: mientras tanto el
        // sitio no debe publicar un ítem sin archivos de video.
        await database.ExecuteAsync($"UPDATE video_assets SET Status = 'Processing' WHERE Id = '{stuckVideo.Id.ToString().ToUpperInvariant()}'");

        var site = await database.WithHeroImagesAsync(heroes => heroes.ListForSiteAsync(default));
        var admin = await ListAsync(database);

        Assert.Equal([photo.Id, ready.Id], site.Select(image => image.Id));
        Assert.Equal([photo.Id, ready.Id, stuck.Id], admin.Select(image => image.Id));
    }

    [Fact]
    public async Task IsPublishable_decides_by_the_stored_video_id_and_refuses_a_video_item_read_without_its_video()
    {
        await using var database = await CreateDatabaseAsync();
        var photo = await CreateAsync(database, await AddAssetAsync(database, '1'), "Foto");
        var video = await AddVideoAsync(database, '5', VideoStatus.Ready);
        var videoItem = await database.WithHeroImagesAsync(heroes =>
            heroes.CreateAsync(new CreateHeroImageRequest(null, "Video", null, video.Id), default));

        // Como lo leería una consulta que se olvidó de incluir el video: la navegación queda en null.
        var withoutVideo = await database.InScopeAsync(provider => provider.GetRequiredService<BlogDbContext>().HeroImages
            .Include(image => image.Media)
            .AsNoTracking()
            .ToDictionaryAsync(image => image.Id));

        Assert.True(withoutVideo[photo.Id].IsPublishable);
        var error = Assert.Throws<InvalidOperationException>(() => withoutVideo[videoItem.Id].IsPublishable);
        Assert.Equal("El ítem del hero es un video y se leyó sin cargar el video: incluí la relación Video en la consulta.", error.Message);
    }

    [Fact]
    public async Task Update_changes_alt_and_credit_keeps_the_rest_and_requests_a_rebuild()
    {
        await using var database = await CreateDatabaseAsync();
        var created = await CreateAsync(database, await AddAssetAsync(database, '1'), "Antes");
        database.Clock.UtcNow = database.Clock.UtcNow.AddHours(1);

        var updated = await database.WithHeroImagesAsync(heroes =>
            heroes.UpdateAsync(created.Id, new UpdateHeroImageRequest(" Después ", "Foto: Ana"), default));

        Assert.Equivalent(created with { Alt = "Después", Credit = "Foto: Ana" }, updated, strict: true);
        Assert.Equivalent(new[] { updated }, await ListAsync(database), strict: true);
        Assert.Equal(2, database.Build.Requests);
    }

    [Theory]
    [InlineData("   ", null)]
    [InlineData("long-alt", null)]
    [InlineData("Alt", "long-credit")]
    public async Task Invalid_update_leaves_the_stored_photo_unchanged_and_does_not_rebuild(string alt, string? credit)
    {
        await using var database = await CreateDatabaseAsync();
        var created = await CreateAsync(database, await AddAssetAsync(database, '1'), "Original");

        await Assert.ThrowsAsync<DomainException>(() => database.WithHeroImagesAsync(heroes =>
            heroes.UpdateAsync(created.Id, new UpdateHeroImageRequest(Expand(alt), Expand(credit)), default)));

        Assert.Equivalent(new[] { created }, await ListAsync(database), strict: true);
        Assert.Equal(1, database.Build.Requests);
    }

    [Fact]
    public async Task Delete_removes_the_photo_keeps_the_media_asset_and_requests_a_rebuild()
    {
        await using var database = await CreateDatabaseAsync();
        var asset = await AddAssetAsync(database, '1');
        var kept = await CreateAsync(database, asset, "Se queda");
        var deleted = await CreateAsync(database, asset, "Se va");

        await database.WithHeroImagesAsync(async heroes =>
        {
            await heroes.DeleteAsync(deleted.Id, default);
            return true;
        });

        Assert.Equivalent(new[] { kept }, await ListAsync(database), strict: true);
        Assert.Equivalent(new[] { asset.ToDto() }, await database.WithMediaAsync(media => media.ListAsync(default)), strict: true);
        Assert.Equal(3, database.Build.Requests);
    }

    [Fact]
    public async Task The_english_alt_and_credit_round_trip_through_create_update_and_both_lists()
    {
        await using var database = await CreateDatabaseAsync();
        var asset = await AddAssetAsync(database, '1');

        var created = await database.WithHeroImagesAsync(heroes => heroes.CreateAsync(
            new CreateHeroImageRequest(asset.Id, "Nebulosa", "Foto: Ana", AltEn: " Nebula ", CreditEn: " Photo: Ana "), default));
        var updated = await database.WithHeroImagesAsync(heroes =>
            heroes.UpdateAsync(created.Id, new UpdateHeroImageRequest("Nebulosa", "Foto: Ana", "Orion nebula", "  "), default));

        Assert.Equal(("Nebula", "Photo: Ana"), (created.AltEn, created.CreditEn));
        Assert.Equal(("Orion nebula", null), (updated.AltEn, updated.CreditEn));
        Assert.Equivalent(new[] { updated }, await ListAsync(database), strict: true);
        Assert.Equivalent(new[] { updated }, await database.WithHeroImagesAsync(heroes => heroes.ListForSiteAsync(default)), strict: true);
    }

    [Fact]
    public async Task A_too_long_english_alt_or_credit_is_rejected_and_leaves_the_stored_item_unchanged()
    {
        await using var database = await CreateDatabaseAsync();
        var asset = await AddAssetAsync(database, '1');
        var created = await database.WithHeroImagesAsync(heroes => heroes.CreateAsync(
            new CreateHeroImageRequest(asset.Id, "Nebulosa", null, AltEn: "Nebula"), default));

        var onCreate = await Assert.ThrowsAsync<DomainException>(() => database.WithHeroImagesAsync(heroes => heroes.CreateAsync(
            new CreateHeroImageRequest(asset.Id, "Otra", null, AltEn: new string('a', HeroImageContent.MaxAltLength + 1)), default)));
        var onUpdate = await Assert.ThrowsAsync<DomainException>(() => database.WithHeroImagesAsync(heroes => heroes.UpdateAsync(
            created.Id, new UpdateHeroImageRequest("Cambiada", null, null, new string('c', HeroImageContent.MaxCreditLength + 1)), default)));

        Assert.Equal("El texto alternativo en inglés no puede superar 300 caracteres.", onCreate.Message);
        Assert.Equal("El crédito en inglés no puede superar 200 caracteres.", onUpdate.Message);
        Assert.Equivalent(new[] { created }, await ListAsync(database), strict: true);
        Assert.Equal(1, database.Build.Requests);
    }

    [Fact]
    public async Task Update_or_delete_of_an_unknown_photo_is_not_found_and_does_not_rebuild()
    {
        await using var database = await CreateDatabaseAsync();
        var unknown = Guid.NewGuid();

        var update = await Assert.ThrowsAsync<NotFoundException>(() => database.WithHeroImagesAsync(heroes =>
            heroes.UpdateAsync(unknown, new UpdateHeroImageRequest("Alt", null), default)));
        var delete = await Assert.ThrowsAsync<NotFoundException>(() => database.WithHeroImagesAsync(async heroes =>
        {
            await heroes.DeleteAsync(unknown, default);
            return true;
        }));

        Assert.Equal(UnknownImageMessage, update.Message);
        Assert.Equal(UnknownImageMessage, delete.Message);
        Assert.Equal(0, database.Build.Requests);
    }

    [Fact]
    public async Task List_is_ordered_by_creation_date_oldest_first()
    {
        await using var database = await CreateDatabaseAsync();
        var asset = await AddAssetAsync(database, '1');
        var start = database.Clock.UtcNow;
        database.Clock.UtcNow = start.AddHours(2);
        var newest = await CreateAsync(database, asset, "Más nueva");
        database.Clock.UtcNow = start;
        var oldest = await CreateAsync(database, await AddAssetAsync(database, '2'), "Más vieja");
        database.Clock.UtcNow = start.AddHours(1);
        var middle = await CreateAsync(database, asset, "Del medio");

        var listed = await ListAsync(database);

        Assert.Equal([oldest.Id, middle.Id, newest.Id], listed.Select(image => image.Id));
    }

    private static async Task<SqliteTestDatabase> CreateDatabaseAsync()
    {
        var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        return database;
    }

    /// <summary>"long-alt" y "long-credit" se expanden a un carácter más que el máximo permitido.</summary>
    private static string? Expand(string? value) => value switch
    {
        "long-alt" => new string('a', HeroImageContent.MaxAltLength + 1),
        "long-credit" => new string('c', HeroImageContent.MaxCreditLength + 1),
        _ => value,
    };

    /// <summary>Por defecto 1920×1080: el tamaño ideal del hero (la regla de tamaño se prueba aparte).</summary>
    private static Task<MediaAsset> AddAssetAsync(SqliteTestDatabase database, char hashCharacter, int width = 1920, int height = 1080) =>
        database.InScopeAsync(async provider =>
        {
            var assets = provider.GetRequiredService<IMediaAssetRepository>();
            var asset = MediaAsset.Create(
                new string(hashCharacter, MediaAsset.HashLength), width, height, "#112233", MediaAsset.PlaceholderPrefix + "UklGRg==",
                database.Clock.UtcNow);
            assets.Add(asset);
            await assets.SaveChangesAsync(default);
            return asset;
        });

    /// <summary>Video de 1920×1080 en el estado pedido; si está listo, con póster y sus cuatro fuentes.</summary>
    private static async Task<VideoAsset> AddVideoAsync(SqliteTestDatabase database, char hashCharacter, VideoStatus status)
    {
        var poster = await AddAssetAsync(database, (char)(hashCharacter + 1));
        return await database.InScopeAsync(async provider =>
        {
            var videos = provider.GetRequiredService<IVideoAssetRepository>();
            var trackedPoster = await provider.GetRequiredService<IMediaAssetRepository>().GetByIdAsync(poster.Id, default);
            var video = VideoAsset.Create(new string(hashCharacter, MediaAsset.HashLength), 1920, 1080, VideoEdit.DefaultFor(8), database.Clock.UtcNow);
            switch (status)
            {
                case VideoStatus.Ready:
                    video.MarkReady(trackedPoster!, [.. VideoVariant.For(1080).Select(variant => new VideoSource(variant.Codec, variant.Height, 1000))]);
                    break;
                case VideoStatus.Failed:
                    video.MarkFailed("ffmpeg falló");
                    break;
            }

            videos.Add(video);
            await videos.SaveChangesAsync(default);
            return video;
        });
    }

    private static Task<HeroImageDto> CreateAsync(SqliteTestDatabase database, MediaAsset asset, string alt) =>
        database.WithHeroImagesAsync(heroes => heroes.CreateAsync(new CreateHeroImageRequest(asset.Id, alt, null), default));

    private static Task<IReadOnlyList<HeroImageDto>> ListAsync(SqliteTestDatabase database) =>
        database.WithHeroImagesAsync(heroes => heroes.ListAsync(default));
}
