using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Application.Posts;
using Blog.Domain;

namespace Blog.Tests;

/// <summary>Los casos de uso se prueban con dobles en memoria: sin base de datos, sin red, sin disco.</summary>
public class PostServiceTests
{
    private sealed class InMemoryPostRepository : IPostRepository
    {
        public List<Post> Items { get; } = [];

        public Task<Post?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult(Items.FirstOrDefault(post => post.Id == id));

        public Task<bool> SlugExistsAsync(string slug, Guid? excludingId, CancellationToken cancellationToken) =>
            Task.FromResult(Items.Any(post => post.Slug == slug && post.Id != excludingId));

        public Task<IReadOnlyList<PostSummaryDto>> ListSummariesAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PostSummaryDto>>(Items
                .OrderByDescending(post => post.UpdatedAtUtc)
                .Select(post => new PostSummaryDto(
                    post.Id, post.Slug, post.Title, post.Status, post.UpdatedAtUtc, post.PublishedAtUtc, post.CoverUrl, post.CoverAlt))
                .ToList());

        public Task<IReadOnlyList<Post>> ListPublishedAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Post>>(Items.Where(post => post.Status == PostStatus.Published).ToList());

        public void Add(Post post) => Items.Add(post);

        public void Remove(Post post) => Items.Remove(post);

        public Task SaveChangesAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private readonly InMemoryPostRepository _repository = new();
    private readonly CountingBuildTrigger _build = new();
    private readonly PostService _service;

    public PostServiceTests() => _service = new PostService(_repository, new FixedClock(), _build);

    private static SavePostRequest Request(string title, string? slug = null) => new(title, slug, null, "cuerpo", null);

    [Fact]
    public async Task Create_stores_a_draft_and_does_not_rebuild_the_site()
    {
        var post = await _service.CreateAsync(Request("Hola"), default);

        Assert.Equal(PostStatus.Draft, post.Status);
        Assert.Equal("hola", post.Slug);
        Assert.Single(_repository.Items);
        Assert.Equal(0, _build.Requests);
    }

    [Fact]
    public async Task Create_rejects_a_duplicate_slug()
    {
        await _service.CreateAsync(Request("Hola"), default);

        await Assert.ThrowsAsync<ConflictException>(() => _service.CreateAsync(Request("Otro título", "hola"), default));
    }

    [Fact]
    public async Task Update_can_keep_the_posts_own_slug()
    {
        var post = await _service.CreateAsync(Request("Hola"), default);

        var updated = await _service.UpdateAsync(post.Id, Request("Hola editado", "hola"), default);

        Assert.Equal("Hola editado", updated.Title);
    }

    [Fact]
    public async Task Update_cannot_take_the_slug_of_another_post()
    {
        await _service.CreateAsync(Request("Uno"), default);
        var second = await _service.CreateAsync(Request("Dos"), default);

        await Assert.ThrowsAsync<ConflictException>(() => _service.UpdateAsync(second.Id, Request("Dos", "uno"), default));
    }

    [Fact]
    public async Task Updating_a_draft_does_not_rebuild_but_updating_a_published_post_does()
    {
        var post = await _service.CreateAsync(Request("Hola"), default);

        await _service.UpdateAsync(post.Id, Request("Hola 2", "hola"), default);
        Assert.Equal(0, _build.Requests);

        await _service.PublishAsync(post.Id, default);
        Assert.Equal(1, _build.Requests);

        await _service.UpdateAsync(post.Id, Request("Hola 3", "hola"), default);
        Assert.Equal(2, _build.Requests);
    }

    [Fact]
    public async Task Unpublish_rebuilds_only_if_the_post_was_published()
    {
        var post = await _service.CreateAsync(Request("Hola"), default);

        await _service.UnpublishAsync(post.Id, default);
        Assert.Equal(0, _build.Requests);

        await _service.PublishAsync(post.Id, default);
        await _service.UnpublishAsync(post.Id, default);
        Assert.Equal(2, _build.Requests);
    }

    [Fact]
    public async Task Delete_rebuilds_only_if_the_post_was_published()
    {
        var draft = await _service.CreateAsync(Request("Borrador"), default);
        var published = await _service.CreateAsync(Request("Publicado"), default);
        await _service.PublishAsync(published.Id, default);
        var before = _build.Requests;

        await _service.DeleteAsync(draft.Id, default);
        Assert.Equal(before, _build.Requests);

        await _service.DeleteAsync(published.Id, default);
        Assert.Equal(before + 1, _build.Requests);
        Assert.Empty(_repository.Items);
    }

    [Fact]
    public async Task Missing_posts_raise_NotFound()
    {
        await Assert.ThrowsAsync<NotFoundException>(() => _service.GetAsync(Guid.NewGuid(), default));
        await Assert.ThrowsAsync<NotFoundException>(() => _service.PublishAsync(Guid.NewGuid(), default));
        await Assert.ThrowsAsync<NotFoundException>(() => _service.DeleteAsync(Guid.NewGuid(), default));
    }

    [Fact]
    public async Task ListPublished_returns_only_published_posts_with_their_body()
    {
        await _service.CreateAsync(Request("Borrador"), default);
        var published = await _service.CreateAsync(Request("Publicado"), default);
        await _service.PublishAsync(published.Id, default);

        var result = await _service.ListPublishedAsync(default);

        var only = Assert.Single(result);
        Assert.Equal("Publicado", only.Title);
        Assert.Equal("cuerpo", only.Body);
    }

    [Fact]
    public async Task Invalid_content_is_rejected_before_touching_the_repository()
    {
        await Assert.ThrowsAsync<DomainException>(() => _service.CreateAsync(Request("   "), default));
        Assert.Empty(_repository.Items);
    }

    [Fact]
    public async Task The_cover_travels_through_create_get_list_and_the_published_list()
    {
        var created = await _service.CreateAsync(new SavePostRequest("Hola", null, null, "cuerpo", null, "/media/a.png", "Alt"), default);
        await _service.PublishAsync(created.Id, default);

        var loaded = await _service.GetAsync(created.Id, default);
        var summary = Assert.Single(await _service.ListAsync(default));
        var published = Assert.Single(await _service.ListPublishedAsync(default));

        Assert.Equal(("/media/a.png", "Alt"), (created.CoverUrl, created.CoverAlt));
        Assert.Equal(("/media/a.png", "Alt"), (loaded.CoverUrl, loaded.CoverAlt));
        Assert.Equal(("/media/a.png", "Alt"), (summary.CoverUrl, summary.CoverAlt));
        Assert.Equal(("/media/a.png", "Alt"), (published.CoverUrl, published.CoverAlt));
    }

    [Fact]
    public async Task An_unsafe_cover_is_rejected_and_the_post_stays_as_it_was()
    {
        var created = await _service.CreateAsync(new SavePostRequest("Hola", null, null, "cuerpo", null, "/media/a.png", "Alt"), default);
        await _service.PublishAsync(created.Id, default);
        var before = await _service.GetAsync(created.Id, default);
        var buildsBefore = _build.Requests;

        await Assert.ThrowsAsync<DomainException>(() => _service.UpdateAsync(
            created.Id, new SavePostRequest("Cambiado", null, null, "otro", null, "javascript:alert(1)", "x"), default));

        Assert.Equal(before, await _service.GetAsync(created.Id, default));
        Assert.Equal(buildsBefore, _build.Requests);
    }
}
