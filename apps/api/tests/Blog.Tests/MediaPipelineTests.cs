using System.Security.Cryptography;
using Blog.Application.Abstractions;
using Blog.Application.Media;
using Blog.Domain;
using Microsoft.Extensions.DependencyInjection;
using NetVips;

namespace Blog.Tests;

/// <summary>End-to-end image upload: real pipeline (NetVips), real disk and real SQLite database.</summary>
public class MediaPipelineTests
{
    private const string UnsupportedFormatMessage = "Formato no soportado. Subí una imagen PNG, JPG, GIF, WebP, AVIF, TIFF o SVG.";
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
    [InlineData("png")]
    [InlineData("jpg")]
    [InlineData("gif")]
    [InlineData("webp")]
    [InlineData("avif")]
    [InlineData("tif")]
    [InlineData("svg")]
    public async Task The_server_libvips_has_a_loader_for_every_format_the_sniffer_accepts(string extension)
    {
        await using var database = await CreateDatabaseAsync();

        var supported = await database.InScopeAsync(provider =>
            Task.FromResult(Assert.IsAssignableFrom<IImageFormatSupport>(provider.GetRequiredService<IImageProcessor>()).CanDecode(extension)));

        Assert.True(supported, $"libvips has no loader for {extension}");
    }

    [Fact]
    public async Task A_tiff_is_converted_to_the_usual_avif_and_webp_variants()
    {
        await using var database = await CreateDatabaseAsync();
        using var photo = TestImages.Gradient(1200, 800);
        var original = photo.TiffsaveBuffer(compression: Enums.ForeignTiffCompression.Lzw);
        var hash = Convert.ToHexStringLower(SHA256.HashData(original));

        var asset = await UploadAsync(database, original);

        Assert.Equal((1200, 800), (asset.Width, asset.Height));
        int[] widths = [640, 1024];
        var expected = MediaVariant.Formats
            .SelectMany(format => widths.Select(width => new MediaVariantDto(format, width, $"/media/{hash}/{width}.{Extension(format)}")))
            .ToList();
        Assert.Equal(expected, asset.Variants);
        Assert.DoesNotContain(database.MediaFiles(), file => file.EndsWith(".tif", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_multi_page_tiff_keeps_only_its_first_page_and_is_not_treated_as_an_animation()
    {
        await using var database = await CreateDatabaseAsync();
        using var red = TestImages.Solid(800, 600, 220, 30, 30);
        using var blue = TestImages.Solid(800, 600, 30, 30, 220);
        using var strip = Image.Arrayjoin([red, blue], across: 1);
        using var pages = strip.Mutate(image => image.Set(GValue.GIntType, "page-height", 600));
        var original = pages.TiffsaveBuffer();
        using (var fixture = Image.NewFromBuffer(original))
        {
            Assert.Equal(2, fixture.Get("n-pages")); // the test is only valid with a real two-page TIFF
        }

        var asset = await UploadAsync(database, original);

        Assert.Equal((800, 600), (asset.Width, asset.Height));
        Assert.Equal(MediaVariant.Formats.Count, asset.Variants.Count); // AVIF + WebP: still images, not an animated WebP
        Assert.Equal("#dc1e1e", asset.Color);
    }

    [Fact]
    public async Task An_svg_is_rasterized_into_avif_and_webp_and_never_stored_as_svg()
    {
        await using var database = await CreateDatabaseAsync();
        var original = System.Text.Encoding.UTF8.GetBytes(
            "<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"600\">" +
            "<rect width=\"800\" height=\"600\" fill=\"#0050c8\"/></svg>");
        var hash = Convert.ToHexStringLower(SHA256.HashData(original));

        var asset = await UploadAsync(database, original);

        Assert.Equal((800, 600), (asset.Width, asset.Height));
        Assert.Equal("#0050c8", asset.Color);
        Assert.Equal(
            MediaVariant.Formats.Select(format => $"{hash}/640.{Extension(format)}").Order(StringComparer.Ordinal),
            database.MediaFiles());
        Assert.All(asset.Variants, variant =>
        {
            using var file = LoadFile(database, variant.Url);
            Assert.Equal(variant.Format == MediaFormat.Avif ? "heifload_buffer" : "webpload_buffer", file.Get("vips-loader"));
        });
    }

    // The control of the test below: an <image> that does load (a data: URI, which needs no fetch) covers the whole
    // canvas, so a fetched http or file image would show in the output pixels.
    [Fact]
    public async Task An_svg_image_that_loads_covers_the_canvas_so_a_fetched_one_would_show_in_the_pixels()
    {
        await using var database = await CreateDatabaseAsync();
        using var green = TestImages.Solid(70, 50, 30, 200, 30);
        var dataUri = "data:image/png;base64," + Convert.ToBase64String(TestImages.Png(green));

        var asset = await UploadAsync(database, SvgOverRed(700, 500, $"<image href=\"{dataUri}\" width=\"700\" height=\"500\"/>"));

        AssertCloseTo([30, 200, 30], asset.Color, tolerance: 2);
    }

    [Fact]
    public async Task An_svg_with_a_script_and_external_images_is_rasterized_without_running_or_fetching_them()
    {
        await using var database = await CreateDatabaseAsync();
        using var green = TestImages.Solid(70, 50, 30, 200, 30);
        await using var server = new CountingHttpServer(TestImages.Png(green), "image/png");
        using var blue = TestImages.Solid(70, 50, 30, 30, 220);
        var bluePath = Path.Combine(Path.GetDirectoryName(database.FilePath)!, "blue.png");
        await File.WriteAllBytesAsync(bluePath, TestImages.Png(blue));
        var original = SvgOverRed(700, 500,
            "<script>alert(1)</script>" +
            $"<image href=\"{server.UrlOf("green.png")}\" width=\"700\" height=\"500\"/>" +
            $"<image xlink:href=\"{server.UrlOf("legacy.png")}\" width=\"700\" height=\"500\"/>" +
            $"<image href=\"{new Uri(bluePath).AbsoluteUri}\" width=\"700\" height=\"500\"/>");

        var asset = await UploadAsync(database, original);

        Assert.Equal(0, server.Connections);
        AssertCloseTo([220, 30, 30], asset.Color, tolerance: 2);
        Assert.All(asset.Variants, variant =>
        {
            // Every output pixel is the red rectangle: neither the green (http) nor the blue (file) image was drawn.
            using var file = LoadFile(database, variant.Url);
            using var greenBand = file[1];
            using var blueBand = file[2];
            Assert.True(greenBand.Max() < 80 && blueBand.Max() < 80, $"{variant.Url} contains a referenced image's color");
        });
        Assert.All(database.MediaFiles(), file =>
        {
            Assert.Matches(@"\.(avif|webp)$", file);
            Assert.Equal(-1, File.ReadAllBytes(Path.Combine(database.MediaDirectory, file)).AsSpan().IndexOf("<script"u8));
        });

        // The server does count a real request: its 0 above is evidence, not a server that never listened.
        using var http = new HttpClient();
        _ = await http.GetByteArrayAsync(server.UrlOf("green.png"));
        Assert.Equal(1, server.Connections);
    }

    // The sniffer refuses these DOCTYPEs (ImageSnifferTests); this proves the loader behind it would not fetch them either.
    [Theory]
    [InlineData("SYSTEM \"{0}\"")]
    [InlineData("PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"{0}\"")]
    public async Task The_svg_loader_never_fetches_an_external_dtd(string externalId)
    {
        await using var database = await CreateDatabaseAsync();
        await using var server = new CountingHttpServer("<!ENTITY fill \"#00ff00\">"u8.ToArray(), "application/xml-dtd");
        var svg = System.Text.Encoding.UTF8.GetBytes(
            $"<?xml version=\"1.0\"?><!DOCTYPE svg {string.Format(System.Globalization.CultureInfo.InvariantCulture, externalId, server.UrlOf("svg.dtd"))}>" +
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"80\"><rect width=\"100\" height=\"80\" fill=\"#dc1e1e\"/></svg>");

        var processed = await database.InScopeAsync(async provider =>
        {
            var images = provider.GetRequiredService<IImageProcessor>();
            Assert.Equal(new ImageSize(100, 80, 1), images.ReadSize(svg));
            return await images.ProcessAsync(svg, MediaVariant.For(100), default);
        });

        Assert.NotNull(processed);
        Assert.Equal(0, server.Connections);
    }

    // librsvg sizes an SVG by width/height (any unit, at 72 dpi), else by its viewBox: the header read must report the
    // same canvas the pipeline renders, or the pixel limit would be checked against the wrong number.
    [Theory]
    [InlineData("width=\"300\" height=\"200\"", 300, 200)]
    [InlineData("viewBox=\"0 0 300 200\"", 300, 200)]
    [InlineData("width=\"100%\" height=\"100%\" viewBox=\"0 0 300 200\"", 300, 200)]
    [InlineData("width=\"3in\" height=\"2in\"", 216, 144)]
    public async Task Reading_the_size_of_an_svg_reports_the_canvas_the_pipeline_renders(string canvas, int width, int height)
    {
        await using var database = await CreateDatabaseAsync();
        var svg = SvgWith(canvas, "<rect width=\"100%\" height=\"100%\" fill=\"#dc1e1e\"/>");

        var size = await database.InScopeAsync(provider => Task.FromResult(provider.GetRequiredService<IImageProcessor>().ReadSize(svg)));
        var asset = await UploadAsync(database, svg);

        Assert.Equal(new ImageSize(width, height, 1), size);
        Assert.All(asset.Variants, variant =>
        {
            using var file = LoadFile(database, variant.Url);
            Assert.Equal((width, height), (file.Width, file.Height));
        });
    }

    // A few hundred bytes of SVG can declare a canvas of billions of pixels: the header read reports it, so the pixel
    // limit refuses it before anything is rasterized.
    [Theory]
    [InlineData("width=\"100000\" height=\"100000\"")]
    [InlineData("viewBox=\"0 0 100000 100000\"")]
    [InlineData("width=\"100%\" height=\"100%\" viewBox=\"0 0 100000 100000\"")]
    [InlineData("width=\"2000in\" height=\"2000in\"")]
    [InlineData("width=\"10001\" height=\"10000\"")]
    public async Task An_svg_declaring_a_canvas_over_the_pixel_limit_is_refused_before_it_is_rasterized(string canvas)
    {
        await using var database = await CreateDatabaseAsync();
        var svg = SvgWith(canvas, "<rect width=\"100%\" height=\"100%\" fill=\"#dc1e1e\"/>");

        var (error, processed) = await UploadCountingAsync(database, svg);

        Assert.Equal(MessageKeys.MediaTooManyPixels, error?.UserMessage.Key);
        Assert.Equal("La imagen supera el máximo de 100 megapíxeles.", error?.Message);
        Assert.Equal(0, processed);
        await AssertNothingStoredAsync(database);
    }

    // The boundary: exactly 100 megapixels is within the limit (only the header is read here: rendering it is not the
    // point and would take minutes).
    [Fact]
    public async Task An_svg_canvas_of_exactly_the_pixel_limit_is_reported_whole()
    {
        await using var database = await CreateDatabaseAsync();
        var svg = SvgWith("width=\"10000\" height=\"10000\"", "");

        var size = await database.InScopeAsync(provider => Task.FromResult(provider.GetRequiredService<IImageProcessor>().ReadSize(svg)));

        Assert.Equal(MediaService.MaxPixels, size?.Pixels);
    }

    // Without width, height or viewBox librsvg has no canvas, and libvips sizes the SVG by what it draws: still a
    // number the header read reports, so a huge drawing meets the same pixel limit.
    [Fact]
    public async Task An_svg_without_size_or_viewbox_is_sized_by_its_drawing()
    {
        await using var database = await CreateDatabaseAsync();
        var svg = SvgWith("", "<rect width=\"120\" height=\"80\" fill=\"#dc1e1e\"/>");

        var asset = await UploadAsync(database, svg);

        Assert.Equal((120, 80), (asset.Width, asset.Height));
        Assert.All(asset.Variants, variant =>
        {
            using var file = LoadFile(database, variant.Url);
            Assert.Equal((120, 80), (file.Width, file.Height));
        });
    }

    [Fact]
    public async Task An_svg_without_size_or_viewbox_whose_drawing_is_over_the_pixel_limit_is_refused_before_it_is_rasterized()
    {
        await using var database = await CreateDatabaseAsync();
        var svg = SvgWith("", "<rect width=\"100000\" height=\"100000\" fill=\"#dc1e1e\"/>");

        var (error, processed) = await UploadCountingAsync(database, svg);

        Assert.Equal(MessageKeys.MediaTooManyPixels, error?.UserMessage.Key);
        Assert.Equal(0, processed);
        await AssertNothingStoredAsync(database);
    }

    // Nothing to size it by (no width, height, viewBox nor drawing): a defined answer, never a guess at a canvas.
    [Fact]
    public async Task An_empty_svg_without_size_or_viewbox_is_refused_as_unreadable_and_stores_nothing()
    {
        await using var database = await CreateDatabaseAsync();

        var (error, processed) = await UploadCountingAsync(database, SvgWith("", ""));

        Assert.Equal(MessageKeys.MediaUnreadable, error?.UserMessage.Key);
        Assert.Equal(0, processed);
        await AssertNothingStoredAsync(database);
    }

    [Fact]
    public async Task An_svg_is_rejected_with_a_clear_message_when_the_svg_loader_is_missing()
    {
        await using var database = await CreateDatabaseAsync();
        var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"/>"u8.ToArray();

        var error = await Assert.ThrowsAsync<DomainException>(() => database.InScopeAsync(async provider =>
        {
            var media = new MediaService(
                new WithoutLoader(provider.GetRequiredService<IImageProcessor>(), "svg"),
                provider.GetRequiredService<IMediaStorage>(),
                provider.GetRequiredService<IMediaAssetRepository>(),
                database.Clock);
            await using var stream = new MemoryStream(svg);
            return await media.UploadImageAsync(stream, default);
        }));

        Assert.Equal(MessageKeys.MediaFormatNotDecodable, error.UserMessage.Key);
        Assert.Equal("Las imágenes SVG no se pueden procesar en este servidor. Convertila a PNG o JPG y subila de nuevo.", error.Message);
        await AssertNothingStoredAsync(database);
    }

    [Theory]
    [InlineData("\0\0\0\u0018ftypheic\0\0\0\0mif1heic", "HEIC")]
    [InlineData("BMF\0\0\0\0\0\0\06\0\0\0(\0\0\0", "BMP")]
    [InlineData("\0\0\u0001\0\u0001\0\u0010\u0010", "ICO")]
    [InlineData("ÿ\nú\u0007", "JPEG XL")]
    public async Task Rejects_a_known_format_the_server_cannot_decode_naming_it_and_stores_nothing(string latin1, string name)
    {
        await using var database = await CreateDatabaseAsync();

        var error = await Assert.ThrowsAsync<DomainException>(() => UploadAsync(database, System.Text.Encoding.Latin1.GetBytes(latin1)));

        Assert.Equal(MessageKeys.MediaFormatNotDecodable, error.UserMessage.Key);
        Assert.Equal($"Las imágenes {name} no se pueden procesar en este servidor. Convertila a PNG o JPG y subila de nuevo.", error.Message);
        Assert.Equal(
            $"{name} images can't be processed on this server. Convert it to PNG or JPG and upload it again.",
            MessageCatalog.Format(error.UserMessage, Language.English));
        await AssertNothingStoredAsync(database);
    }

    [Theory]
    [InlineData("not an image")]
    [InlineData("<html><script>alert(1)</script></html>")]
    [InlineData("<?xml version=\"1.0\"?><!DOCTYPE svg [<!ENTITY a \"aaaa\">]><svg>&a;</svg>")]
    [InlineData("<?xml version=\"1.0\"?><!DOCTYPE svg SYSTEM \"http://attacker.example/svg.dtd\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"/>")]
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

    /// <summary>Uploads through the real pipeline and counts how many times it got as far as rasterizing.</summary>
    private static async Task<(DomainException? Error, int Processed)> UploadCountingAsync(SqliteTestDatabase database, byte[] content)
    {
        var processed = 0;
        try
        {
            await database.InScopeAsync(async provider =>
            {
                var media = new MediaService(
                    new CountingProcess(provider.GetRequiredService<IImageProcessor>(), () => processed++),
                    provider.GetRequiredService<IMediaStorage>(),
                    provider.GetRequiredService<IMediaAssetRepository>(),
                    database.Clock);
                await using var stream = new MemoryStream(content);
                return await media.UploadImageAsync(stream, default);
            });
            return (null, processed);
        }
        catch (DomainException error)
        {
            return (error, processed);
        }
    }

    private static byte[] SvgWith(string canvas, string content) => System.Text.Encoding.UTF8.GetBytes(
        $"<svg xmlns=\"http://www.w3.org/2000/svg\" {canvas}>{content}</svg>");

    private static byte[] SvgOverRed(int width, int height, string content) => System.Text.Encoding.UTF8.GetBytes(
        $"<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"{width}\" height=\"{height}\">" +
        $"<rect width=\"{width}\" height=\"{height}\" fill=\"#dc1e1e\"/>{content}</svg>");

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

    /// <summary>The real pipeline, as a server whose libvips lacks the loader of one format.</summary>
    private sealed class WithoutLoader(IImageProcessor inner, string missing) : IImageProcessor, IImageFormatSupport
    {
        public bool CanDecode(string extension) => extension != missing && ((IImageFormatSupport)inner).CanDecode(extension);

        public ImageSize? ReadSize(byte[] image) => inner.ReadSize(image);

        public Task<ProcessedImage?> ProcessAsync(byte[] image, IReadOnlyList<MediaVariant> variants, CancellationToken cancellationToken) =>
            inner.ProcessAsync(image, variants, cancellationToken);
    }

    /// <summary>The real pipeline, counting the uploads that reach rasterization.</summary>
    private sealed class CountingProcess(IImageProcessor inner, Action onProcess) : IImageProcessor, IImageFormatSupport
    {
        public bool CanDecode(string extension) => ((IImageFormatSupport)inner).CanDecode(extension);

        public ImageSize? ReadSize(byte[] image) => inner.ReadSize(image);

        public Task<ProcessedImage?> ProcessAsync(byte[] image, IReadOnlyList<MediaVariant> variants, CancellationToken cancellationToken)
        {
            onProcess();
            return inner.ProcessAsync(image, variants, cancellationToken);
        }
    }

    private static void AssertCloseTo(int[] expected, string color, int tolerance = 6)
    {
        int[] actual = [.. Enumerable.Range(0, 3).Select(channel => Convert.ToInt32(color.Substring(1 + (channel * 2), 2), 16))];
        Assert.True(
            expected.Zip(actual).All(pair => Math.Abs(pair.First - pair.Second) <= tolerance),
            $"Expected a color close to ({string.Join(", ", expected)}) and got {color}.");
    }
}
