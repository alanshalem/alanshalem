using Blog.Domain;

namespace Blog.Tests;

public class SlugTests
{
    [Theory]
    [InlineData("¡Hola, Mundo! Año 2026", "hola-mundo-ano-2026")]
    [InlineData("  Introducción a Ñandú  ", "introduccion-a-nandu")]
    [InlineData("C# & .NET", "c-net")]
    [InlineData("???", "post")]
    public void From_normalizes_text_into_a_url_friendly_slug(string input, string expected) =>
        Assert.Equal(expected, Slug.From(input));

    [Fact]
    public void From_never_exceeds_the_max_length()
    {
        var slug = Slug.From(new string('a', 500));
        Assert.True(slug.Length <= Slug.MaxLength);
    }

    [Theory]
    [InlineData("mi-primer-post", true)]
    [InlineData("a", true)]
    [InlineData("Mayuscula", false)]
    [InlineData("with space", false)]
    [InlineData("-empieza-con-guion", false)]
    [InlineData("termina-con-guion-", false)]
    [InlineData("doble--guion", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsValid_accepts_only_lowercase_alphanumerics_and_single_hyphens(string? value, bool expected) =>
        Assert.Equal(expected, Slug.IsValid(value));
}

public class PostContentTests
{
    [Fact]
    public void Create_trims_fields_and_derives_the_slug_from_the_title()
    {
        var content = PostContent.Create("  Mi título  ", null, "  resumen ", "cuerpo", ["a"]);

        Assert.Equal("Mi título", content.Title);
        Assert.Equal("mi-titulo", content.Slug);
        Assert.Equal("resumen", content.Summary);
    }

    [Fact]
    public void Create_keeps_an_explicit_slug()
    {
        var content = PostContent.Create("Título", "otro-slug", null, null, null);
        Assert.Equal("otro-slug", content.Slug);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_requires_a_title(string? title) =>
        Assert.Throws<DomainException>(() => PostContent.Create(title, null, null, null, null));

    [Fact]
    public void Create_rejects_an_invalid_slug() =>
        Assert.Throws<DomainException>(() => PostContent.Create("Título", "Slug Inválido", null, null, null));

    [Fact]
    public void Create_rejects_a_title_that_is_too_long() =>
        Assert.Throws<DomainException>(() => PostContent.Create(new string('a', PostContent.MaxTitleLength + 1), null, null, null, null));

    [Fact]
    public void Create_removes_blank_and_duplicate_tags_ignoring_case()
    {
        var content = PostContent.Create("T", null, null, null, ["net", " NET ", "", "react"]);
        Assert.Equal(new[] { "net", "react" }, content.Tags);
    }

    [Fact]
    public void Create_rejects_too_many_tags()
    {
        var tags = Enumerable.Range(0, PostContent.MaxTags + 1).Select(i => $"tag{i}");
        Assert.Throws<DomainException>(() => PostContent.Create("T", null, null, null, tags));
    }
}

public class PostTests
{
    private static readonly DateTime Now = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);

    private static Post NewDraft() => Post.CreateDraft(PostContent.Create("Título", null, null, "cuerpo", null), "es", Now);

    [Fact]
    public void A_new_post_is_a_draft_without_publication_date()
    {
        var post = NewDraft();

        Assert.Equal(PostStatus.Draft, post.Status);
        Assert.Null(post.PublishedAtUtc);
        Assert.Equal(Now, post.CreatedAtUtc);
        Assert.NotEqual(Guid.Empty, post.Id);
    }

    [Fact]
    public void Publish_sets_the_status_and_the_first_publication_date()
    {
        var post = NewDraft();
        post.Publish(Now.AddHours(1));

        Assert.Equal(PostStatus.Published, post.Status);
        Assert.Equal(Now.AddHours(1), post.PublishedAtUtc);
    }

    [Fact]
    public void Republishing_keeps_the_original_publication_date()
    {
        var post = NewDraft();
        post.Publish(Now.AddHours(1));
        post.Unpublish(Now.AddHours(2));
        post.Publish(Now.AddHours(3));

        Assert.Equal(Now.AddHours(1), post.PublishedAtUtc);
        Assert.Equal(Now.AddHours(3), post.UpdatedAtUtc);
    }

    [Fact]
    public void Update_replaces_the_content_and_touches_updated_at()
    {
        var post = NewDraft();
        post.Update(PostContent.Create("Nuevo", null, null, "otro", null), Now.AddMinutes(5));

        Assert.Equal("Nuevo", post.Title);
        Assert.Equal("nuevo", post.Slug);
        Assert.Equal(Now.AddMinutes(5), post.UpdatedAtUtc);
        Assert.Equal(Now, post.CreatedAtUtc);
    }
}
