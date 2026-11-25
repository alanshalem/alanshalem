using Blog.Application.Abstractions;
using Blog.Application.Settings;
using Blog.Domain;

namespace Blog.Tests;

/// <summary>Casos de uso de los ajustes del sitio con un repositorio en memoria.</summary>
public class SiteSettingsServiceTests
{
    private sealed class InMemorySiteSettingsRepository : ISiteSettingsRepository
    {
        public SiteSettings? Stored { get; private set; }

        public int Saves { get; private set; }

        public Task<SiteSettings?> GetAsync(CancellationToken cancellationToken) => Task.FromResult(Stored);

        public void Add(SiteSettings settings) => Stored = settings;

        public Task SaveChangesAsync(CancellationToken cancellationToken)
        {
            Saves++;
            return Task.CompletedTask;
        }
    }

    private readonly InMemorySiteSettingsRepository _repository = new();
    private readonly CountingBuildTrigger _build = new();
    private readonly SiteSettingsService _service;

    public SiteSettingsServiceTests() => _service = new SiteSettingsService(_repository, _build);

    internal static SaveSiteSettingsRequest FullRequest(string name = "Alan Shalem") => new(
        name,
        "Escribo sobre .NET",
        "Hola, soy **Alan**.",
        "alan@example.com",
        "https://github.com/alan",
        "https://www.linkedin.com/in/alan",
        "https://x.com/alan",
        "/media/2026/11/hero.jpg",
        "Alan en la montaña",
        "Foto: Ana");

    [Fact]
    public async Task Get_returns_the_defaults_when_nothing_was_saved()
    {
        var settings = await _service.GetAsync(default);

        Assert.Equal(new SiteSettingsDto(
            "Mi blog", "Notas sobre software, ideas y cosas que estoy aprendiendo.", null, null, null, null, null, null, null, null),
            settings);
        Assert.Null(_repository.Stored);
        Assert.Equal(0, _repository.Saves);
    }

    [Fact]
    public async Task Save_stores_the_settings_returns_them_and_requests_a_rebuild()
    {
        var saved = await _service.SaveAsync(FullRequest(), default);
        var loaded = await _service.GetAsync(default);

        var expected = new SiteSettingsDto(
            "Alan Shalem", "Escribo sobre .NET", "Hola, soy **Alan**.", "alan@example.com", "https://github.com/alan",
            "https://www.linkedin.com/in/alan", "https://x.com/alan", "/media/2026/11/hero.jpg", "Alan en la montaña", "Foto: Ana");
        Assert.Equal(expected, saved);
        Assert.Equal(expected, loaded);
        Assert.Equal(1, _build.Requests);
    }

    [Fact]
    public async Task Saving_again_updates_the_same_single_row()
    {
        await _service.SaveAsync(FullRequest(), default);
        var first = _repository.Stored;

        var saved = await _service.SaveAsync(FullRequest("Otro nombre") with { Email = null }, default);

        Assert.Same(first, _repository.Stored);
        Assert.Equal("Otro nombre", saved.Name);
        Assert.Null(saved.Email);
        Assert.Equal(2, _build.Requests);
    }

    [Theory]
    [InlineData("name", "   ")]
    [InlineData("email", "no-es-mail")]
    [InlineData("github", "javascript:alert(1)")]
    public async Task Invalid_settings_are_rejected_and_leave_the_stored_ones_unchanged(string field, string value)
    {
        await _service.SaveAsync(FullRequest(), default);
        var before = await _service.GetAsync(default);
        var request = field switch
        {
            "name" => FullRequest() with { Name = value },
            "email" => FullRequest("Cambiado") with { Email = value },
            _ => FullRequest("Cambiado") with { GithubUrl = value },
        };

        await Assert.ThrowsAsync<DomainException>(() => _service.SaveAsync(request, default));

        Assert.Equal(before, await _service.GetAsync(default));
        Assert.Equal(1, _repository.Saves);
        Assert.Equal(1, _build.Requests);
    }

    [Fact]
    public async Task Invalid_first_save_does_not_create_a_row()
    {
        await Assert.ThrowsAsync<DomainException>(() => _service.SaveAsync(FullRequest() with { Name = "" }, default));

        Assert.Null(_repository.Stored);
        Assert.Equal(0, _build.Requests);
    }
}
