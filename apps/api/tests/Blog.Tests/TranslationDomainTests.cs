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
        // The original does not change.
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

/// <summary>
/// The date of the last content change: with it the admin decides whether a translation fell behind, so publishing,
/// unpublishing or scheduling cannot move it.
/// </summary>
public class PostContentUpdatedAtTests
{
    private static readonly DateTime Now = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);

    private static PostContent Content(string body = "cuerpo") => PostContent.Create("Hola", "hola", "Resumen", body, ["net"], "/media/a.png", "Alt");

    [Fact]
    public void A_new_post_and_a_new_translation_start_with_their_creation_time()
    {
        var post = Post.CreateDraft(Content(), "es", Now);
        var translation = post.CreateTranslation("en", Now.AddHours(1));

        Assert.Equal(Now, post.ContentUpdatedAtUtc);
        Assert.Equal(Now.AddHours(1), translation.ContentUpdatedAtUtc);
    }

    [Fact]
    public void Publishing_unpublishing_and_scheduling_touch_UpdatedAt_but_not_the_content_time()
    {
        var post = Post.CreateDraft(Content(), "es", Now);

        post.Schedule(Now.AddDays(1), Now.AddMinutes(1));
        Assert.Equal((Now.AddMinutes(1), Now), (post.UpdatedAtUtc, post.ContentUpdatedAtUtc));
        post.Unschedule(Now.AddMinutes(2));
        Assert.Equal((Now.AddMinutes(2), Now), (post.UpdatedAtUtc, post.ContentUpdatedAtUtc));
        post.Publish(Now.AddMinutes(3));
        Assert.Equal((Now.AddMinutes(3), Now), (post.UpdatedAtUtc, post.ContentUpdatedAtUtc));
        post.Unpublish(Now.AddMinutes(4));
        Assert.Equal((Now.AddMinutes(4), Now), (post.UpdatedAtUtc, post.ContentUpdatedAtUtc));
    }

    [Fact]
    public void Only_a_save_that_changes_the_content_moves_the_content_time()
    {
        var post = Post.CreateDraft(Content(), "es", Now);

        Assert.False(post.Update(Content(), Now.AddMinutes(1)));
        Assert.Equal((Now.AddMinutes(1), Now), (post.UpdatedAtUtc, post.ContentUpdatedAtUtc));
        Assert.True(post.Update(Content("otro"), Now.AddMinutes(2)));
        Assert.Equal((Now.AddMinutes(2), Now.AddMinutes(2)), (post.UpdatedAtUtc, post.ContentUpdatedAtUtc));
    }
}

/// <summary>
/// The slug copied to the new version may be taken in its language by another article: the language suffix is added,
/// as one more content change.
/// </summary>
public class TranslationSlugSuffixTests
{
    private static readonly DateTime Now = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void The_suffix_is_the_language_code_and_counts_as_a_content_change()
    {
        var translation = Post.CreateDraft(PostContent.Create("Hola", "hola", null, "cuerpo", null), "es", Now)
            .CreateTranslation("en", Now.AddHours(1));

        translation.SuffixSlugWithLanguage(Now.AddHours(2));

        Assert.Equal("hola-en", translation.Slug);
        Assert.Equal((Now.AddHours(2), Now.AddHours(2)), (translation.UpdatedAtUtc, translation.ContentUpdatedAtUtc));
        Assert.Equal(("Hola", "cuerpo"), (translation.Title, translation.Body));
    }

    public static TheoryData<string, string, string> LongSlugs => new()
    {
        // It just fits: nothing is cut.
        { new string('a', Slug.MaxLength - 3), "en", new string('a', Slug.MaxLength - 3) + "-en" },
        // It does not fit: the base is cut, and the hyphen left dangling at the cut is removed (the slug does not allow it).
        { new string('a', Slug.MaxLength - 4) + "-bbb", "en", new string('a', Slug.MaxLength - 4) + "-en" },
        { new string('a', Slug.MaxLength), "es", new string('a', Slug.MaxLength - 3) + "-es" },
    };

    [Theory]
    [MemberData(nameof(LongSlugs))]
    public void A_long_slug_is_shortened_so_the_suffixed_one_still_fits(string slug, string lang, string expected)
    {
        var post = Post.CreateDraft(PostContent.Create("Hola", slug, null, "cuerpo", null), lang == "en" ? "es" : "en", Now)
            .CreateTranslation(lang, Now);

        post.SuffixSlugWithLanguage(Now);

        Assert.Equal(expected, post.Slug);
        Assert.True(Slug.IsValid(post.Slug));
    }
}

public class EnglishTextsDomainTests
{
    [Fact]
    public void Settings_trim_the_english_tagline_and_bio_and_turn_blanks_into_null()
    {
        var filled = SiteSettingsContent.Create("Alan", null, null, null, null, null, null, taglineEn: " Notes ", bioEn: " **Hi** ");
        var blank = SiteSettingsContent.Create("Alan", null, null, null, null, null, null, taglineEn: "  ", bioEn: "");

        Assert.Equal(("Alan", "Notes", "**Hi**"), (filled.Name, filled.TaglineEn, filled.BioEn));
        Assert.Equal(((string?)null, (string?)null), (blank.TaglineEn, blank.BioEn));
    }

    [Fact]
    public void Settings_reject_an_english_tagline_or_bio_over_the_same_limits()
    {
        var tagline = Assert.Throws<DomainException>(() => SiteSettingsContent.Create(
            "Alan", null, null, null, null, null, null, taglineEn: new string('a', SiteSettingsContent.MaxTaglineLength + 1)));
        var bio = Assert.Throws<DomainException>(() => SiteSettingsContent.Create(
            "Alan", null, null, null, null, null, null, bioEn: new string('a', SiteSettingsContent.MaxBioLength + 1)));
        var atLimit = SiteSettingsContent.Create(
            "Alan", null, null, null, null, null, null,
            new string('a', SiteSettingsContent.MaxTaglineLength),
            new string('a', SiteSettingsContent.MaxBioLength));

        Assert.Equal("La frase en inglés no puede superar 200 caracteres.", tagline.Message);
        Assert.Equal("La bio en inglés no puede superar 2000 caracteres.", bio.Message);
        Assert.Equal((200, 2000), (atLimit.TaglineEn!.Length, atLimit.BioEn!.Length));
    }

    [Fact]
    public void Hero_content_trims_the_english_alt_and_turns_a_blank_one_into_null()
    {
        Assert.Equal(new HeroImageContent("Nebulosa", "Foto: Ana", "Nebula"), HeroImageContent.Create("Nebulosa", " Foto: Ana ", " Nebula "));
        Assert.Equal(new HeroImageContent("Nebulosa", null), HeroImageContent.Create("Nebulosa", null, "  "));
    }

    [Fact]
    public void Hero_content_rejects_an_english_alt_that_is_too_long()
    {
        var alt = Assert.Throws<DomainException>(() =>
            HeroImageContent.Create("Alt", null, new string('a', HeroImageContent.MaxAltLength + 1)));
        var atLimit = HeroImageContent.Create("Alt", null, new string('a', HeroImageContent.MaxAltLength));

        Assert.Equal("El texto alternativo en inglés no puede superar 300 caracteres.", alt.Message);
        Assert.Equal(300, atLimit.AltEn!.Length);
    }
}
