using Blog.Domain;

namespace Blog.Tests;

public class MediaVariantTests
{
    [Theory]
    [InlineData(1, new[] { 1 })]
    [InlineData(639, new[] { 639 })]
    [InlineData(640, new[] { 640 })]
    [InlineData(1023, new[] { 640 })]
    [InlineData(1600, new[] { 640, 1024, 1600 })]
    [InlineData(2399, new[] { 640, 1024, 1600 })]
    [InlineData(6000, new[] { 640, 1024, 1600, 2400 })]
    public void WidthsFor_never_exceeds_the_original_and_returns_at_least_one(int originalWidth, int[] expected) =>
        Assert.Equal(expected, MediaVariant.WidthsFor(originalWidth));

    [Fact]
    public void For_combines_every_format_with_every_width_avif_first() =>
        Assert.Equal(
            [
                new MediaVariant(MediaFormat.Avif, 640), new MediaVariant(MediaFormat.Avif, 1024),
                new MediaVariant(MediaFormat.Webp, 640), new MediaVariant(MediaFormat.Webp, 1024),
            ],
            MediaVariant.For(1200));

    [Theory]
    [InlineData(MediaFormat.Avif, "avif")]
    [InlineData(MediaFormat.Webp, "webp")]
    public void Extension_matches_the_format(MediaFormat format, string extension) =>
        Assert.Equal(extension, new MediaVariant(format, 640).Extension);
}

public class MediaAssetTests
{
    private static readonly string Hash = new('a', MediaAsset.HashLength);
    private static readonly DateTime Now = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);
    private const string Placeholder = MediaAsset.PlaceholderPrefix + "UklGRg==";

    [Fact]
    public void Paths_follow_the_media_hash_width_extension_scheme()
    {
        var asset = MediaAsset.Create(Hash, 3000, 2000, "#102030", Placeholder, Now);

        Assert.Equal($"{Hash}/640.avif", asset.RelativePathOf(new MediaVariant(MediaFormat.Avif, 640)));
        Assert.Equal($"/media/{Hash}/2400.webp", asset.UrlOf(new MediaVariant(MediaFormat.Webp, 2400)));
        Assert.True(WebUrl.IsImageUrl(asset.Url));
    }

    [Theory]
    [InlineData(3000, 1600)]
    [InlineData(1600, 1600)]
    [InlineData(1599, 1024)]
    [InlineData(500, 500)]
    public void Url_is_the_widest_webp_up_to_1600(int width, int expectedWidth) =>
        Assert.Equal($"/media/{Hash}/{expectedWidth}.webp", MediaAsset.Create(Hash, width, 100, "#102030", Placeholder, Now).Url);

    [Theory]
    [InlineData("../../etc")]
    [InlineData("ABCDEF")]
    [InlineData("")]
    public void Create_rejects_a_hash_that_is_not_lowercase_sha256_hex(string hash) =>
        Assert.Throws<ArgumentException>(() => MediaAsset.Create(hash, 10, 10, "#102030", Placeholder, Now));

    [Theory]
    [InlineData("red")]
    [InlineData("#FFF")]
    [InlineData("#FFFFFF")]
    public void Create_rejects_a_color_that_is_not_rrggbb(string color) =>
        Assert.Throws<ArgumentException>(() => MediaAsset.Create(Hash, 10, 10, color, Placeholder, Now));

    [Fact]
    public void Create_rejects_a_placeholder_that_is_not_a_small_webp_data_uri()
    {
        Assert.Throws<ArgumentException>(() => MediaAsset.Create(Hash, 10, 10, "#102030", "data:image/png;base64,AAAA", Now));
        Assert.Throws<ArgumentException>(() => MediaAsset.Create(
            Hash, 10, 10, "#102030", Placeholder + new string('A', MediaAsset.MaxPlaceholderLength), Now));
    }

    [Fact]
    public void Create_rejects_empty_dimensions()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => MediaAsset.Create(Hash, 0, 10, "#102030", Placeholder, Now));
        Assert.Throws<ArgumentOutOfRangeException>(() => MediaAsset.Create(Hash, 10, 0, "#102030", Placeholder, Now));
    }
}

public class HeroImageContentTests
{
    [Fact]
    public void Create_trims_and_turns_a_blank_credit_into_null()
    {
        Assert.Equal(new HeroImageContent("Nebulosa", null), HeroImageContent.Create("  Nebulosa ", "   "));
        Assert.Equal(new HeroImageContent("Nebulosa", "Foto: Ana"), HeroImageContent.Create("Nebulosa", " Foto: Ana "));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_requires_an_alt(string? alt)
    {
        var error = Assert.Throws<DomainException>(() => HeroImageContent.Create(alt, null));
        Assert.Equal("El texto alternativo es obligatorio.", error.Message);
    }

    [Fact]
    public void Create_accepts_the_maximum_lengths()
    {
        var content = HeroImageContent.Create(
            new string('a', HeroImageContent.MaxAltLength), new string('c', HeroImageContent.MaxCreditLength));

        Assert.Equal(HeroImageContent.MaxAltLength, content.Alt.Length);
        Assert.Equal(HeroImageContent.MaxCreditLength, content.Credit!.Length);
    }

    [Fact]
    public void Create_rejects_an_alt_or_credit_that_is_too_long()
    {
        var alt = Assert.Throws<DomainException>(() => HeroImageContent.Create(new string('a', HeroImageContent.MaxAltLength + 1), null));
        Assert.Equal("El texto alternativo no puede superar 300 caracteres.", alt.Message);

        var credit = Assert.Throws<DomainException>(() => HeroImageContent.Create("Alt", new string('c', HeroImageContent.MaxCreditLength + 1)));
        Assert.Equal("El crédito no puede superar 200 caracteres.", credit.Message);
    }
}
