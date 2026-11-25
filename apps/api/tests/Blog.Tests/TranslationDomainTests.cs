using Blog.Domain;

namespace Blog.Tests;

public class LanguageTests
{
    internal const string InvalidLanguageMessage = "El idioma tiene que ser \"es\" (español) o \"en\" (inglés).";

    [Theory]
    [InlineData("es", "es")]
    [InlineData("en", "en")]
    [InlineData(" EN ", "en")]
    [InlineData("Es", "es")]
    public void Parse_accepts_spanish_and_english_and_normalizes_them(string value, string expected) =>
        Assert.Equal(expected, Language.Parse(value));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("fr")]
    [InlineData("español")]
    [InlineData("en-US")]
    public void Parse_rejects_anything_else_with_the_spanish_message(string? value)
    {
        var error = Assert.Throws<DomainException>(() => Language.Parse(value));
        Assert.Equal(InvalidLanguageMessage, error.Message);
    }

    [Fact]
    public void Spanish_is_the_default_language() => Assert.Equal("es", Language.Default);
}

public class PostTranslationTests
{
    private static readonly DateTime Now = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);

    private static Post Original() => Post.CreateDraft(
        PostContent.Create("Hola", "hola", "Resumen", "cuerpo", ["net", "ia"], "/media/a.png", "Alt"), "es", Now);

    [Fact]
    public void Each_new_post_starts_its_own_translation_group()
    {
        var first = Original();
        var second = Original();

        Assert.NotEqual(Guid.Empty, first.TranslationGroupId);
        Assert.NotEqual(first.TranslationGroupId, second.TranslationGroupId);
    }

    [Fact]
    public void CreateDraft_rejects_an_unknown_language()
    {
        var error = Assert.Throws<DomainException>(() =>
            Post.CreateDraft(PostContent.Create("Hola", null, null, null, null), "fr", Now));
        Assert.Equal(LanguageTests.InvalidLanguageMessage, error.Message);
    }

    [Fact]
    public void CreateTranslation_is_a_new_draft_in_the_same_group_with_the_content_copied()
    {
        var original = Original();
        original.Publish(Now.AddHours(1));

        var translation = original.CreateTranslation(" en ", Now.AddHours(2));

        Assert.NotEqual(original.Id, translation.Id);
        Assert.Equal(original.TranslationGroupId, translation.TranslationGroupId);
        Assert.Equal("en", translation.Lang);
        Assert.Equal(PostStatus.Draft, translation.Status);
        Assert.Null(translation.PublishedAtUtc);
        Assert.Equal((Now.AddHours(2), Now.AddHours(2)), (translation.CreatedAtUtc, translation.UpdatedAtUtc));
        Assert.Equal(
            ("Hola", "hola", "Resumen", "cuerpo", "/media/a.png", "Alt"),
            (translation.Title, translation.Slug, translation.Summary, translation.Body, translation.CoverUrl, translation.CoverAlt));
        Assert.Equal(["net", "ia"], translation.Tags);
        // El original no cambia.
        Assert.Equal(("es", PostStatus.Published), (original.Lang, original.Status));
    }

    [Fact]
    public void CreateTranslation_in_the_same_language_is_rejected()
    {
        var error = Assert.Throws<DomainException>(() => Original().CreateTranslation("es", Now));
        Assert.Equal("El post ya está en español: la versión nueva tiene que ser en el otro idioma.", error.Message);
    }

    [Fact]
    public void CreateTranslation_in_an_unknown_language_is_rejected()
    {
        var error = Assert.Throws<DomainException>(() => Original().CreateTranslation("de", Now));
        Assert.Equal(LanguageTests.InvalidLanguageMessage, error.Message);
    }
}

public class EnglishTextsDomainTests
{
    [Fact]
    public void Settings_trim_the_english_name_tagline_and_bio_and_turn_blanks_into_null()
    {
        var filled = SiteSettingsContent.Create(
            "Alan", null, null, null, null, null, null, nameEn: " Alan S. ", taglineEn: " Notes ", bioEn: " **Hi** ");
        var blank = SiteSettingsContent.Create("Alan", null, null, null, null, null, null, nameEn: "   ", taglineEn: "  ", bioEn: "");

        Assert.Equal(("Alan S.", "Notes", "**Hi**"), (filled.NameEn, filled.TaglineEn, filled.BioEn));
        Assert.Equal((null, null, null), (blank.NameEn, blank.TaglineEn, blank.BioEn));
    }

    [Fact]
    public void Settings_reject_an_english_name_tagline_or_bio_over_the_same_limits()
    {
        var name = Assert.Throws<DomainException>(() => SiteSettingsContent.Create(
            "Alan", null, null, null, null, null, null, nameEn: new string('a', SiteSettingsContent.MaxNameLength + 1)));
        var tagline = Assert.Throws<DomainException>(() => SiteSettingsContent.Create(
            "Alan", null, null, null, null, null, null, taglineEn: new string('a', SiteSettingsContent.MaxTaglineLength + 1)));
        var bio = Assert.Throws<DomainException>(() => SiteSettingsContent.Create(
            "Alan", null, null, null, null, null, null, bioEn: new string('a', SiteSettingsContent.MaxBioLength + 1)));
        var atLimit = SiteSettingsContent.Create(
            "Alan", null, null, null, null, null, null,
            new string('a', SiteSettingsContent.MaxNameLength),
            new string('a', SiteSettingsContent.MaxTaglineLength),
            new string('a', SiteSettingsContent.MaxBioLength));

        Assert.Equal("El nombre en inglés no puede superar 100 caracteres.", name.Message);
        Assert.Equal("La frase en inglés no puede superar 200 caracteres.", tagline.Message);
        Assert.Equal("La bio en inglés no puede superar 2000 caracteres.", bio.Message);
        Assert.Equal((100, 200, 2000), (atLimit.NameEn!.Length, atLimit.TaglineEn!.Length, atLimit.BioEn!.Length));
    }

    [Fact]
    public void Hero_content_trims_the_english_alt_and_credit_and_turns_blanks_into_null()
    {
        Assert.Equal(new HeroImageContent("Nebulosa", null, "Nebula", "Photo: Ana"), HeroImageContent.Create("Nebulosa", null, " Nebula ", " Photo: Ana "));
        Assert.Equal(new HeroImageContent("Nebulosa", null), HeroImageContent.Create("Nebulosa", null, "  ", ""));
    }

    [Fact]
    public void Hero_content_rejects_an_english_alt_or_credit_that_is_too_long()
    {
        var alt = Assert.Throws<DomainException>(() =>
            HeroImageContent.Create("Alt", null, new string('a', HeroImageContent.MaxAltLength + 1)));
        var credit = Assert.Throws<DomainException>(() =>
            HeroImageContent.Create("Alt", null, null, new string('c', HeroImageContent.MaxCreditLength + 1)));
        var atLimit = HeroImageContent.Create(
            "Alt", null, new string('a', HeroImageContent.MaxAltLength), new string('c', HeroImageContent.MaxCreditLength));

        Assert.Equal("El texto alternativo en inglés no puede superar 300 caracteres.", alt.Message);
        Assert.Equal("El crédito en inglés no puede superar 200 caracteres.", credit.Message);
        Assert.Equal((300, 200), (atLimit.AltEn!.Length, atLimit.CreditEn!.Length));
    }
}
