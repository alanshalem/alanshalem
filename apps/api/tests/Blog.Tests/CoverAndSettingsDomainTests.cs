using Blog.Domain;

namespace Blog.Tests;

public class PostCoverTests
{
    private const string InvalidCoverMessage = "La portada debe ser una ruta /media/... o una URL http(s).";

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_treats_a_blank_cover_as_no_cover(string? coverUrl)
    {
        var content = PostContent.Create("T", null, null, null, null, coverUrl, "  ");

        Assert.Null(content.CoverUrl);
        Assert.Null(content.CoverAlt);
    }

    [Fact]
    public void Create_without_cover_arguments_has_no_cover()
    {
        var content = PostContent.Create("T", null, null, null, null);

        Assert.Null(content.CoverUrl);
        Assert.Null(content.CoverAlt);
    }

    [Theory]
    [InlineData("/media/x.png")]
    [InlineData("/media/2026/11/abc.webp")]
    [InlineData("https://images.example.com/foto.jpg")]
    [InlineData("http://example.com/a.png?w=800")]
    public void Create_accepts_media_paths_and_http_urls_and_trims_them(string coverUrl)
    {
        var content = PostContent.Create("T", null, null, null, null, $"  {coverUrl} ", " Una foto ");

        Assert.Equal(coverUrl, content.CoverUrl);
        Assert.Equal("Una foto", content.CoverAlt);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("JavaScript:alert(1)")]
    [InlineData("//evil.com/x.png")]
    [InlineData("data:image/png;base64,iVBORw0KGgo=")]
    [InlineData("vbscript:msgbox(1)")]
    [InlineData("ftp://example.com/x.png")]
    [InlineData("x.png")]
    [InlineData("media/x.png")]
    [InlineData("/otra/x.png")]
    [InlineData("/media/")]
    [InlineData("/media/../secreto")]
    [InlineData("/media/%2e%2e/secreto")]
    [InlineData("/media/%2E%2E/secreto")]
    [InlineData("/media/.%2e/secreto")]
    [InlineData("/media/a b.png")]
    [InlineData("https://")]
    [InlineData("https:/evil.com")]
    [InlineData("\\\\evil.com\\x.png")]
    [InlineData("https://evil.com/\"onerror=\"alert(1)")]
    public void Create_rejects_unsafe_or_foreign_cover_urls(string coverUrl)
    {
        var error = Assert.Throws<DomainException>(() => PostContent.Create("T", null, null, null, null, coverUrl, null));
        Assert.Equal(InvalidCoverMessage, error.Message);
    }

    [Fact]
    public void Create_rejects_a_cover_url_that_is_too_long()
    {
        var url = "/media/" + new string('a', WebUrl.MaxLength);

        var error = Assert.Throws<DomainException>(() => PostContent.Create("T", null, null, null, null, url, null));
        Assert.Equal($"La URL de la portada no puede superar {WebUrl.MaxLength} caracteres.", error.Message);
    }

    [Fact]
    public void Create_rejects_a_cover_alt_that_is_too_long()
    {
        var alt = new string('a', PostContent.MaxCoverAltLength + 1);

        var error = Assert.Throws<DomainException>(() => PostContent.Create("T", null, null, null, null, "/media/x.png", alt));
        Assert.Equal($"El texto alternativo de la portada no puede superar {PostContent.MaxCoverAltLength} caracteres.", error.Message);
    }

    [Fact]
    public void A_post_keeps_and_replaces_its_cover()
    {
        var now = new DateTime(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);
        var post = Post.CreateDraft(PostContent.Create("T", null, null, null, null, "/media/a.png", "A"), "es", now);

        Assert.Equal("/media/a.png", post.CoverUrl);
        Assert.Equal("A", post.CoverAlt);

        post.Update(PostContent.Create("T", null, null, null, null), now.AddMinutes(1));

        Assert.Null(post.CoverUrl);
        Assert.Null(post.CoverAlt);
    }
}

public class SiteSettingsContentTests
{
    private static SiteSettingsContent Valid(
        string? name = "Alan",
        string? email = null,
        string? githubUrl = null,
        string? linkedinUrl = null,
        string? xUrl = null,
        string? bio = null) =>
        SiteSettingsContent.Create(name, null, bio, email, githubUrl, linkedinUrl, xUrl);

    [Fact]
    public void Default_has_the_blog_name_and_tagline_and_nothing_else()
    {
        var defaults = SiteSettingsContent.Default;

        Assert.Equal("Mi blog", defaults.Name);
        Assert.Equal("Notas sobre software, ideas y cosas que estoy aprendiendo.", defaults.Tagline);
        Assert.Null(defaults.Bio);
        Assert.Null(defaults.Email);
        Assert.Null(defaults.GithubUrl);
        Assert.Null(defaults.LinkedinUrl);
        Assert.Null(defaults.XUrl);
    }

    [Fact]
    public void Create_trims_values_and_turns_blanks_into_null()
    {
        var content = SiteSettingsContent.Create(
            "  Alan  ", " Frase ", "  **Hola**  ", " alan@example.com ", " https://github.com/alan ",
            " https://www.linkedin.com/in/alan ", " https://x.com/alan ");

        Assert.Equal("Alan", content.Name);
        Assert.Equal("Frase", content.Tagline);
        Assert.Equal("**Hola**", content.Bio);
        Assert.Equal("alan@example.com", content.Email);
        Assert.Equal("https://github.com/alan", content.GithubUrl);
        Assert.Equal("https://www.linkedin.com/in/alan", content.LinkedinUrl);
        Assert.Equal("https://x.com/alan", content.XUrl);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_requires_a_name(string? name)
    {
        var error = Assert.Throws<DomainException>(() => Valid(name: name));
        Assert.Equal("El nombre es obligatorio.", error.Message);
    }

    [Fact]
    public void Create_rejects_a_name_that_is_too_long()
    {
        var error = Assert.Throws<DomainException>(() => Valid(name: new string('a', SiteSettingsContent.MaxNameLength + 1)));
        Assert.Equal($"El nombre no puede superar {SiteSettingsContent.MaxNameLength} caracteres.", error.Message);
    }

    [Theory]
    [InlineData("not-an-email")]
    [InlineData("a@b")]
    [InlineData("a b@example.com")]
    [InlineData("@example.com")]
    [InlineData("a@@example.com")]
    public void Create_rejects_an_invalid_email(string email)
    {
        var error = Assert.Throws<DomainException>(() => Valid(email: email));
        Assert.Equal("El email no tiene un formato válido.", error.Message);
    }

    [Theory]
    [InlineData("github", "javascript:alert(1)", "El enlace de GitHub debe ser una URL http(s).")]
    [InlineData("github", "github.com/alan", "El enlace de GitHub debe ser una URL http(s).")]
    [InlineData("github", "//github.com/alan", "El enlace de GitHub debe ser una URL http(s).")]
    [InlineData("github", "/media/x.png", "El enlace de GitHub debe ser una URL http(s).")]
    [InlineData("linkedin", "ftp://linkedin.com/in/alan", "El enlace de LinkedIn debe ser una URL http(s).")]
    [InlineData("x", "data:text/html,hola", "El enlace de X debe ser una URL http(s).")]
    public void Create_rejects_links_that_are_not_safe_urls(string field, string value, string expectedMessage)
    {
        var error = Assert.Throws<DomainException>(() => field switch
        {
            "github" => Valid(githubUrl: value),
            "linkedin" => Valid(linkedinUrl: value),
            "x" => Valid(xUrl: value),
            // A typo in InlineData must break the test, not test X by accident.
            _ => throw new ArgumentOutOfRangeException(nameof(field), field, "Unknown link field."),
        });
        Assert.Equal(expectedMessage, error.Message);
    }

    [Fact]
    public void Create_rejects_a_bio_that_is_too_long()
    {
        var error = Assert.Throws<DomainException>(() => Valid(bio: new string('a', SiteSettingsContent.MaxBioLength + 1)));
        Assert.Equal($"La bio no puede superar {SiteSettingsContent.MaxBioLength} caracteres.", error.Message);
    }
}
