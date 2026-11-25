using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Application.HeroImages;
using Blog.Application.Media;
using Blog.Domain;
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

    private static Task<MediaAsset> AddAssetAsync(SqliteTestDatabase database, char hashCharacter) =>
        database.InScopeAsync(async provider =>
        {
            var assets = provider.GetRequiredService<IMediaAssetRepository>();
            var asset = MediaAsset.Create(
                new string(hashCharacter, MediaAsset.HashLength), 1200, 800, "#112233", MediaAsset.PlaceholderPrefix + "UklGRg==",
                database.Clock.UtcNow);
            assets.Add(asset);
            await assets.SaveChangesAsync(default);
            return asset;
        });

    private static Task<HeroImageDto> CreateAsync(SqliteTestDatabase database, MediaAsset asset, string alt) =>
        database.WithHeroImagesAsync(heroes => heroes.CreateAsync(new CreateHeroImageRequest(asset.Id, alt, null), default));

    private static Task<IReadOnlyList<HeroImageDto>> ListAsync(SqliteTestDatabase database) =>
        database.WithHeroImagesAsync(heroes => heroes.ListAsync(default));
}
