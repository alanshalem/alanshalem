using System.Security.Cryptography;
using Blog.Application.Media;
using Blog.Domain;
using NetVips;

namespace Blog.Tests;

/// <summary>End-to-end image upload: real pipeline (NetVips), real disk and real SQLite database.</summary>
public class MediaPipelineTests
{
    private const string UnsupportedFormatMessage = "Formato no soportado. Subí una imagen PNG, JPG, GIF, WebP o AVIF.";
    private const string UnreadableMessage = "No se pudo leer la imagen: el archivo está dañado o incompleto.";

    [Fact]
    public async Task Upload_generates_avif_and_webp_at_every_standard_width_up_to_the_original()
    {
        await using var database = await CreateDatabaseAsync();
        using var photo = TestImages.Gradient(3000, 2000);
        var original = TestImages.Jpeg(photo);
        var hash = Convert.ToHexStringLower(SHA256.HashData(original));

        var asset = await UploadAsync(database, original);

        Assert.NotEqual(Guid.Empty, asset.Id);
        Assert.Equal($"/media/{hash}/1600.webp", asset.Url);
        Assert.Equal((3000, 2000), (asset.Width, asset.Height));
        Assert.Equal(database.Clock.UtcNow, asset.CreatedAt);
        int[] widths = [640, 1024, 1600, 2400];
        var expected = MediaVariant.Formats
            .SelectMany(format => widths.Select(width => new MediaVariantDto(format, width, $"/media/{hash}/{width}.{Extension(format)}")))
            .ToList();
        Assert.Equal(expected, asset.Variants);
        Assert.Equal(expected.Select(variant => variant.Url[WebUrl.MediaPrefix.Length..]).Order(StringComparer.Ordinal), database.MediaFiles());

        foreach (var variant in asset.Variants)
        {
            using var file = LoadFile(database, variant.Url);
            Assert.Equal(variant.Format == MediaFormat.Avif ? "heifload_buffer" : "webpload_buffer", file.Get("vips-loader"));
            Assert.Equal(variant.Width, file.Width);
            Assert.Equal((int)Math.Round(variant.Width * 2000.0 / 3000), file.Height);
        }
    }

    [Theory]
    [InlineData(500, new[] { 500 })]
    [InlineData(640, new[] { 640 })]
    [InlineData(1200, new[] { 640, 1024 })]
    [InlineData(2400, new[] { 640, 1024, 1600, 2400 })]
    public async Task Upload_never_upscales_and_always_produces_at_least_one_width(int originalWidth, int[] expectedWidths)
    {
        await using var database = await CreateDatabaseAsync();
        using var image = TestImages.Gradient(originalWidth, 300);

        var asset = await UploadAsync(database, TestImages.Png(image));

        foreach (var format in MediaVariant.Formats)
        {
            Assert.Equal(expectedWidths, asset.Variants.Where(variant => variant.Format == format).Select(variant => variant.Width));
        }

        Assert.All(asset.Variants, variant =>
        {
            using var file = LoadFile(database, variant.Url);
            Assert.Equal(variant.Width, file.Width);
        });
        Assert.EndsWith($"/{expectedWidths.Where(width => width <= MediaAsset.MaxDefaultWidth).Max()}.webp", asset.Url);
    }

    [Fact]
    public async Task Output_is_upright_and_strips_every_metadata_block_even_when_the_original_has_EXIF_GPS()
    {
        await using var database = await CreateDatabaseAsync();
        using var photo = TestImages.Gradient(1200, 800);
        var original = TestImages.JpegWithGpsAndOrientation(photo);
        using (var fixture = Image.NewFromBuffer(original))
        {
            // The test is only valid if the original really carries GPS and orientation.
            Assert.Contains("exif-ifd3-GPSLatitude", fixture.GetFields());
            Assert.Equal(6, fixture.Get("orientation"));
        }

        var asset = await UploadAsync(database, original);

        Assert.Equal((800, 1200), (asset.Width, asset.Height));
        Assert.All(asset.Variants, variant =>
        {
            var bytes = File.ReadAllBytes(PathOf(database, variant.Url));
            Assert.Equal(-1, bytes.AsSpan().IndexOf("Exif"u8));
            using var file = Image.NewFromBuffer(bytes);
            Assert.Equal((variant.Width, variant.Width * 3 / 2), (file.Width, file.Height));
            Assert.DoesNotContain(file.GetFields(), field =>
                field.StartsWith("exif-", StringComparison.Ordinal)
                || field is "xmp-data" or "iptc-data" or "icc-profile-data" or "orientation");
        });
    }

    [Fact]
    public async Task Placeholder_is_a_tiny_webp_data_uri_even_for_a_noisy_photo()
    {
        await using var database = await CreateDatabaseAsync();
        using var noise = Image.Gaussnoise(1600, 1000, sigma: 60, mean: 128);
        using var bands = noise.Bandjoin(noise.Rot180(), noise.FlipHor());
        using var photo = bands.Cast(Enums.BandFormat.Uchar).Copy(interpretation: Enums.Interpretation.Srgb);

        var asset = await UploadAsync(database, TestImages.Jpeg(photo));

        Assert.StartsWith(MediaAsset.PlaceholderPrefix, asset.Placeholder);
        Assert.True(asset.Placeholder.Length <= MediaAsset.MaxPlaceholderLength, $"Mide {asset.Placeholder.Length} caracteres.");
        using var placeholder = Image.NewFromBuffer(Convert.FromBase64String(asset.Placeholder[MediaAsset.PlaceholderPrefix.Length..]));
        Assert.Equal("webpload_buffer", placeholder.Get("vips-loader"));
        Assert.Equal(16, Math.Max(placeholder.Width, placeholder.Height));
    }

    [Fact]
    public async Task Placeholder_stays_within_the_limit_even_when_every_preview_pixel_is_a_different_color()
    {
        await using var database = await CreateDatabaseAsync();
        // 16 × 16 random color blocks: when shrinking to 16 px every pixel differs from its neighbors (the worst for WebP).
        using var noise = Image.Gaussnoise(16, 16, sigma: 120, mean: 128);
        using var bands = noise.Bandjoin(noise.Rot90(), noise.FlipVer());
        using var blocks = bands.Cast(Enums.BandFormat.Uchar).Copy(interpretation: Enums.Interpretation.Srgb);
        using var photo = blocks.Zoom(100, 100);

        var asset = await UploadAsync(database, TestImages.Png(photo));

        Assert.StartsWith(MediaAsset.PlaceholderPrefix, asset.Placeholder);
        Assert.True(asset.Placeholder.Length <= MediaAsset.MaxPlaceholderLength, $"Mide {asset.Placeholder.Length} caracteres.");
        using var placeholder = Image.NewFromBuffer(Convert.FromBase64String(asset.Placeholder[MediaAsset.PlaceholderPrefix.Length..]));
        Assert.Equal("webpload_buffer", placeholder.Get("vips-loader"));
        Assert.InRange(Math.Max(placeholder.Width, placeholder.Height), 8, 16);
    }

    [Theory]
    [InlineData("jpg")]
    [InlineData("png")]
    public async Task Rejects_a_truncated_image_whose_header_is_intact_instead_of_publishing_it_degraded(string format)
    {
        await using var database = await CreateDatabaseAsync();
        using var photo = TestImages.Gradient(1200, 800);
        var complete = format == "jpg" ? TestImages.Jpeg(photo) : TestImages.Png(photo);
        var truncated = complete[..(complete.Length * 6 / 10)];
        using (var header = Image.NewFromBuffer(truncated))
        {
            // The test is only valid if the header is still read correctly: what was cut are the pixels.
            Assert.Equal((1200, 800), (header.Width, header.Height));
        }

        var error = await Assert.ThrowsAsync<DomainException>(() => UploadAsync(database, truncated));

        Assert.Equal(UnreadableMessage, error.Message);
        await AssertNothingStoredAsync(database);
    }

    [Fact]
    public async Task A_decoding_failure_is_logged_for_the_operator_while_the_user_gets_the_damaged_file_message()
    {
        await using var database = await CreateDatabaseAsync();
        byte[] fakePng = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, .. "this is not a PNG"u8];

        var error = await Assert.ThrowsAsync<DomainException>(() => UploadAsync(database, fakePng));

        Assert.Equal(UnreadableMessage, error.Message);
        var entry = Assert.Single(database.Logs.Entries, entry => entry.Category.EndsWith(".NetVipsImageProcessor", StringComparison.Ordinal));
        Assert.Equal(Microsoft.Extensions.Logging.LogLevel.Warning, entry.Level);
        Assert.IsType<VipsException>(entry.Exception);
    }

    [Fact]
    public async Task An_animated_gif_keeps_its_animation_as_animated_webp_only()
    {
        await using var database = await CreateDatabaseAsync();
        var original = TestImages.AnimatedGif(800, 600, [220, 30, 30], [30, 30, 220]);
        var hash = Convert.ToHexStringLower(SHA256.HashData(original));

        var asset = await UploadAsync(database, original);

        Assert.Equal((800, 600), (asset.Width, asset.Height));
        Assert.Equal([new MediaVariantDto(MediaFormat.Webp, 640, $"/media/{hash}/640.webp")], asset.Variants);
        Assert.Equal($"/media/{hash}/640.webp", asset.Url);
        Assert.Equal([$"{hash}/640.webp"], database.MediaFiles());
        using var file = Image.NewFromBuffer(File.ReadAllBytes(PathOf(database, asset.Url)), "n=-1");
        Assert.Equal("webpload_buffer", file.Get("vips-loader"));
        Assert.Equal(2, file.Get("n-pages"));
        Assert.Equal((640, 480), (file.Width, file.PageHeight));
        // Each frame keeps its color: the animation was not flattened into the first one.
        Assert.True(file.Getpoint(320, 240)[0] > 150, "The first frame should be red.");
        Assert.True(file.Getpoint(320, 480 + 240)[2] > 150, "The second frame should be blue.");
        Assert.Equal("#dc1e1e", asset.Color);
    }

    [Fact]
    public async Task Uploading_again_regenerates_variant_files_that_went_missing_from_disk()
    {
        await using var database = await CreateDatabaseAsync();
        using var image = TestImages.Gradient(900, 600);
        var original = TestImages.Png(image);
        var first = await UploadAsync(database, original);
        var files = database.MediaFiles();
        File.Delete(Path.Combine(database.MediaDirectory, files[0]));

        var second = await UploadAsync(database, original);

        Assert.Equivalent(first, second, strict: true);
        Assert.Equal(files, database.MediaFiles());
        Assert.Equivalent(first, Assert.Single(await database.WithMediaAsync(media => media.ListAsync(default))), strict: true);
    }

    [Fact]
    public async Task Color_is_the_dominant_color_as_lowercase_rrggbb()
    {
        await using var database = await CreateDatabaseAsync();
        using var blue = TestImages.Solid(400, 300, 0, 80, 200);
        using var red = TestImages.Solid(120, 120, 220, 30, 30);
        using var mostlyBlue = blue.Insert(red, 0, 0);

        var asset = await UploadAsync(database, TestImages.Png(mostlyBlue));

        Assert.Equal("#0050c8", asset.Color);
    }

    [Fact]
    public async Task An_embedded_color_profile_is_converted_to_srgb_and_then_dropped()
    {
        await using var database = await CreateDatabaseAsync();
        using var red = TestImages.Solid(800, 600, 220, 30, 30);
        using var displayP3 = red.IccTransform("p3", inputProfile: "srgb", embedded: false);
        var original = displayP3.JpegsaveBuffer(q: 95, keep: Enums.ForeignKeep.Icc);

        var asset = await UploadAsync(database, original);

        // Without converting, the raw P3 values would look like another red (duller) in the browser.
        AssertCloseTo([220, 30, 30], asset.Color);
        using var file = LoadFile(database, asset.Url);
        Assert.DoesNotContain("icc-profile-data", file.GetFields());
    }

    [Fact]
    public async Task Grayscale_and_cmyk_originals_come_out_as_srgb()
    {
        await using var database = await CreateDatabaseAsync();
        using var gray = TestImages.Solid(700, 500, 128);
        using var green = TestImages.Solid(700, 500, 40, 160, 60);
        using var cmyk = green.IccTransform("cmyk", inputProfile: "srgb", embedded: false);

        var grayAsset = await UploadAsync(database, TestImages.Png(gray));
        var cmykAsset = await UploadAsync(database, cmyk.JpegsaveBuffer(q: 95, keep: Enums.ForeignKeep.None));

        Assert.Equal("#808080", grayAsset.Color);
        AssertCloseTo([40, 160, 60], cmykAsset.Color, tolerance: 16);
        foreach (var asset in new[] { grayAsset, cmykAsset })
        {
            using var file = LoadFile(database, asset.Url);
            Assert.Equal(Enums.Interpretation.Srgb, file.Interpretation);
        }
    }

    [Fact]
    public async Task Uploading_the_same_image_again_reuses_the_asset_without_rewriting_files()
    {
        await using var database = await CreateDatabaseAsync();
        using var image = TestImages.Gradient(900, 600);
        var original = TestImages.Png(image);
        var first = await UploadAsync(database, original);
        var writtenAt = database.MediaFiles().Select(file => File.GetLastWriteTimeUtc(Path.Combine(database.MediaDirectory, file))).ToList();
        database.Clock.UtcNow = database.Clock.UtcNow.AddHours(1);

        var second = await UploadAsync(database, original);

        Assert.Equivalent(first, second, strict: true);
        Assert.Equivalent(first, Assert.Single(await database.WithMediaAsync(media => media.ListAsync(default))), strict: true);
        Assert.Equal(writtenAt, database.MediaFiles().Select(file => File.GetLastWriteTimeUtc(Path.Combine(database.MediaDirectory, file))));
    }

    [Fact]
    public async Task List_returns_every_asset_oldest_first()
    {
        await using var database = await CreateDatabaseAsync();
        using var older = TestImages.Solid(300, 200, 10, 20, 30);
        using var newer = TestImages.Solid(300, 200, 200, 100, 50);
        var first = await UploadAsync(database, TestImages.Png(older));
        database.Clock.UtcNow = database.Clock.UtcNow.AddMinutes(5);
        var second = await UploadAsync(database, TestImages.Png(newer));

        var listed = await database.WithMediaAsync(media => media.ListAsync(default));

        Assert.Equal([first.Id, second.Id], listed.Select(asset => asset.Id));
        Assert.Equivalent(new[] { first, second }, listed, strict: true);
    }

    [Fact]
    public async Task Rejects_an_image_over_the_pixel_limit_and_stores_nothing()
    {
        await using var database = await CreateDatabaseAsync();
        // 100,010,000 pixels in a 1-bit PNG: a few KB that decompressed would be hundreds of MB.
        using var huge = Image.Black(10_001, 10_000);
        var original = huge.PngsaveBuffer(bitdepth: 1, compression: 9, keep: Enums.ForeignKeep.None);
        Assert.True(original.Length < MediaService.MaxBytes);

        var error = await Assert.ThrowsAsync<DomainException>(() => UploadAsync(database, original));

        Assert.Equal("La imagen supera el máximo de 100 megapíxeles.", error.Message);
        await AssertNothingStoredAsync(database);
    }

    [Theory]
    [InlineData("not an image")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")]
    [InlineData("<html><script>alert(1)</script></html>")]
    public async Task Rejects_files_that_are_not_a_supported_image_and_stores_nothing(string content)
    {
        await using var database = await CreateDatabaseAsync();

        var error = await Assert.ThrowsAsync<DomainException>(() => UploadAsync(database, System.Text.Encoding.UTF8.GetBytes(content)));

        Assert.Equal(UnsupportedFormatMessage, error.Message);
        await AssertNothingStoredAsync(database);
    }

    [Fact]
    public async Task Rejects_a_file_that_starts_like_an_image_but_cannot_be_decoded()
    {
        await using var database = await CreateDatabaseAsync();
        byte[] fakePng = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, .. "this is not a PNG"u8];

        var error = await Assert.ThrowsAsync<DomainException>(() => UploadAsync(database, fakePng));

        Assert.Equal(UnreadableMessage, error.Message);
        await AssertNothingStoredAsync(database);
    }

    [Fact]
    public async Task Rejects_a_file_over_the_size_limit()
    {
        await using var database = await CreateDatabaseAsync();
        var big = new byte[MediaService.MaxBytes + 1];
        big[0] = 0x89; // even if it starts like a PNG, the size rules it out first

        var error = await Assert.ThrowsAsync<DomainException>(() => UploadAsync(database, big));

        Assert.Equal("La imagen supera el máximo de 8 MB.", error.Message);
        await AssertNothingStoredAsync(database);
    }

    private static async Task<SqliteTestDatabase> CreateDatabaseAsync()
    {
        var database = new SqliteTestDatabase();
        await database.InitializeAsync();
        return database;
    }

    private static Task<MediaAssetDto> UploadAsync(SqliteTestDatabase database, byte[] content) =>
        database.WithMediaAsync(async media =>
        {
            await using var stream = new MemoryStream(content);
            return await media.UploadImageAsync(stream, default);
        });

    private static async Task AssertNothingStoredAsync(SqliteTestDatabase database)
    {
        Assert.Empty(database.MediaFiles());
        Assert.Empty(await database.WithMediaAsync(media => media.ListAsync(default)));
    }

    private static string PathOf(SqliteTestDatabase database, string url) =>
        Path.Combine(database.MediaDirectory, url[WebUrl.MediaPrefix.Length..]);

    // Read into memory: a file opened by NetVips would prevent deleting the temporary folder on Windows.
    private static Image LoadFile(SqliteTestDatabase database, string url) =>
        Image.NewFromBuffer(File.ReadAllBytes(PathOf(database, url)));

    private static string Extension(MediaFormat format) => new MediaVariant(format, 1).Extension;

    private static void AssertCloseTo(int[] expected, string color, int tolerance = 6)
    {
        int[] actual = [.. Enumerable.Range(0, 3).Select(channel => Convert.ToInt32(color.Substring(1 + (channel * 2), 2), 16))];
        Assert.True(
            expected.Zip(actual).All(pair => Math.Abs(pair.First - pair.Second) <= tolerance),
            $"Expected a color close to ({string.Join(", ", expected)}) and got {color}.");
    }
}
