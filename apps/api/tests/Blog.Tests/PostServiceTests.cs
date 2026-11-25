using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Application.Posts;
using Blog.Domain;
using Blog.Tests.Http;

namespace Blog.Tests;

/// <summary>Los casos de uso se prueban con dobles en memoria: sin base de datos, sin red, sin disco.</summary>
public class PostServiceTests
{
    private sealed class InMemoryPostRepository : IPostRepository
    {
        public List<Post> Items { get; } = [];

        public Task<Post?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult(Items.FirstOrDefault(post => post.Id == id));

        public Task<bool> SlugExistsAsync(string lang, string slug, Guid? excludingId, CancellationToken cancellationToken) =>
            Task.FromResult(Items.Any(post => post.Lang == lang && post.Slug == slug && post.Id != excludingId));

        public Task<IReadOnlyList<PostTranslationDto>> ListVersionsAsync(Guid translationGroupId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PostTranslationDto>>(Items
                .Where(post => post.TranslationGroupId == translationGroupId)
                .Select(post => post.ToTranslation())
                .ToList());

        public Task<IReadOnlyList<PostSummaryDto>> ListSummariesAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PostSummaryDto>>(Items
                .OrderByDescending(post => post.UpdatedAtUtc)
                .Select(post => new PostSummaryDto(
                    post.Id, post.Slug, post.Title, post.Lang, post.TranslationGroupId, post.Status, post.UpdatedAtUtc, post.ContentUpdatedAtUtc,
                    post.PublishedAtUtc, post.ScheduledAtUtc, post.CoverUrl, post.CoverAlt, []))
                .ToList());

        public Task<IReadOnlyList<Post>> ListPublishedAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Post>>(Items.Where(post => post.Status == PostStatus.Published).ToList());

        public void Add(Post post) => Items.Add(post);

        public void Remove(Post post)
        {
            Items.Remove(post);
            Revisions.RemoveAll(revision => revision.PostId == post.Id);
        }

        public Task SaveChangesAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public List<PostRevision> Revisions { get; } = [];

        public Task<int> LatestRevisionNumberAsync(Guid postId, CancellationToken cancellationToken) =>
            Task.FromResult(Revisions.Where(revision => revision.PostId == postId).Select(revision => revision.Number).DefaultIfEmpty().Max());

        public void AddRevision(PostRevision revision) => Revisions.Add(revision);

        public Task RemoveRevisionsBeforeAsync(Guid postId, int number, CancellationToken cancellationToken)
        {
            Revisions.RemoveAll(revision => revision.PostId == postId && revision.Number < number);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<PostRevisionSummaryDto>> ListRevisionsAsync(Guid postId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PostRevisionSummaryDto>>(Revisions
                .Where(revision => revision.PostId == postId)
                .OrderByDescending(revision => revision.Number)
                .Select(revision => new PostRevisionSummaryDto(revision.Id, revision.Number, revision.CreatedAtUtc, revision.Title, revision.Body.Length))
                .ToList());

        public Task<PostRevision?> GetRevisionAsync(Guid postId, Guid revisionId, CancellationToken cancellationToken) =>
            Task.FromResult(Revisions.FirstOrDefault(revision => revision.PostId == postId && revision.Id == revisionId));

        public Task<IReadOnlyList<Guid>> ListDueAsync(DateTime nowUtc, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Guid>>(Items.Where(post => post.IsDue(nowUtc)).Select(post => post.Id).ToList());
    }

    private readonly InMemoryPostRepository _repository = new();
    private readonly CountingBuildTrigger _build = new();
    private readonly FixedClock _clock = new();
    private readonly PostService _service;

    public PostServiceTests() => _service = new PostService(_repository, _clock, _build);

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

        // Equivalent y no Equal: Translations es una lista nueva en cada lectura (el record la compararía por referencia).
        Assert.Equivalent(before, await _service.GetAsync(created.Id, default), strict: true);
        Assert.Equal(buildsBefore, _build.Requests);
    }

    // ----- Idioma y versiones (traducciones) -----

    [Fact]
    public async Task Create_uses_spanish_by_default_accepts_english_and_starts_a_group_without_translations()
    {
        var spanish = await _service.CreateAsync(Request("Hola"), default);
        var english = await _service.CreateAsync(Request("Hello") with { Lang = "en" }, default);

        Assert.Equal(("es", "en"), (spanish.Lang, english.Lang));
        Assert.NotEqual(spanish.TranslationGroupId, english.TranslationGroupId);
        Assert.Empty(spanish.Translations);
    }

    [Fact]
    public async Task Create_with_an_unknown_language_is_rejected_and_stores_nothing()
    {
        var error = await Assert.ThrowsAsync<DomainException>(() => _service.CreateAsync(Request("Hola") with { Lang = "fr" }, default));

        Assert.Equal(LanguageTests.InvalidLanguageMessage, error.Message);
        Assert.Empty(_repository.Items);
    }

    [Fact]
    public async Task Update_cannot_change_the_language_but_accepts_the_same_one()
    {
        var post = await _service.CreateAsync(Request("Hola"), default);
        var before = await _service.GetAsync(post.Id, default);

        var error = await Assert.ThrowsAsync<DomainException>(() =>
            _service.UpdateAsync(post.Id, Request("Cambiado", "hola") with { Lang = "en" }, default));
        var unchanged = await _service.GetAsync(post.Id, default);
        var same = await _service.UpdateAsync(post.Id, Request("Hola 2", "hola") with { Lang = "es" }, default);

        Assert.Equal("El idioma de un post no se puede cambiar: creá su versión en el otro idioma.", error.Message);
        Assert.Equivalent(before, unchanged, strict: true);
        Assert.Equal(("Hola 2", "es"), (same.Title, same.Lang));
    }

    [Fact]
    public async Task The_same_slug_is_allowed_in_each_language_but_not_twice_in_one()
    {
        var spanish = await _service.CreateAsync(Request("Hola"), default);
        var english = await _service.CreateAsync(Request("Hello", "hola") with { Lang = "en" }, default);
        var other = await _service.CreateAsync(Request("Other") with { Lang = "en" }, default);
        var otherBefore = await _service.GetAsync(other.Id, default);

        var onCreate = await Assert.ThrowsAsync<ConflictException>(() => _service.CreateAsync(Request("Otro", "hola"), default));
        var onUpdate = await Assert.ThrowsAsync<ConflictException>(() =>
            _service.UpdateAsync(other.Id, Request("Other", "hola") with { Lang = "en" }, default));

        Assert.Equal(("hola", "hola"), (spanish.Slug, english.Slug));
        Assert.Equal("Ya existe un post en español con el slug \"hola\".", onCreate.Message);
        Assert.Equal("Ya existe un post en inglés con el slug \"hola\".", onUpdate.Message);
        Assert.Equal(3, _repository.Items.Count);
        Assert.Equivalent(otherBefore, await _service.GetAsync(other.Id, default), strict: true);
    }

    [Fact]
    public async Task CreateTranslation_stores_a_draft_in_the_same_group_with_the_content_copied_and_links_both_versions()
    {
        var original = await _service.CreateAsync(
            new SavePostRequest("Hola", "hola", "Resumen", "cuerpo", ["net"], "/media/a.png", "Alt"), default);
        await _service.PublishAsync(original.Id, default);
        var builds = _build.Requests;
        _clock.UtcNow = _clock.UtcNow.AddHours(1);

        var translation = await _service.CreateTranslationAsync(original.Id, new CreateTranslationRequest("en"), default);

        Assert.Equal(("en", PostStatus.Draft, original.TranslationGroupId), (translation.Lang, translation.Status, translation.TranslationGroupId));
        Assert.Equal(
            ("Hola", "hola", "Resumen", "cuerpo", "/media/a.png", "Alt"),
            (translation.Title, translation.Slug, translation.Summary, translation.Body, translation.CoverUrl, translation.CoverAlt));
        Assert.Equal(["net"], translation.Tags);
        Assert.Null(translation.PublishedAt);
        Assert.Equal(1, _repository.Items.Count(post => post.Lang == "en"));
        var published = await _service.GetAsync(original.Id, default);
        Assert.Equal(
            [new PostTranslationDto(original.Id, "es", "hola", PostStatus.Published, published.UpdatedAt, published.ContentUpdatedAt)],
            translation.Translations);
        Assert.Equal(
            [new PostTranslationDto(translation.Id, "en", "hola", PostStatus.Draft, _clock.UtcNow, _clock.UtcNow)],
            published.Translations);
        // Un borrador nuevo no se ve en el sitio: no se regenera.
        Assert.Equal(builds, _build.Requests);
    }

    [Fact]
    public async Task CreateTranslation_of_a_language_the_group_already_has_is_a_conflict_and_stores_nothing()
    {
        var original = await _service.CreateAsync(Request("Hola"), default);
        var english = await _service.CreateTranslationAsync(original.Id, new CreateTranslationRequest("en"), default);

        var fromOriginal = await Assert.ThrowsAsync<ConflictException>(() =>
            _service.CreateTranslationAsync(original.Id, new CreateTranslationRequest("en"), default));
        var fromTranslation = await Assert.ThrowsAsync<ConflictException>(() =>
            _service.CreateTranslationAsync(english.Id, new CreateTranslationRequest("es"), default));

        Assert.Equal("Este post ya tiene su versión en inglés.", fromOriginal.Message);
        Assert.Equal("Este post ya tiene su versión en español.", fromTranslation.Message);
        Assert.Equal(2, _repository.Items.Count);
    }

    [Theory]
    [InlineData("es", "El post ya está en español: la versión nueva tiene que ser en el otro idioma.")]
    [InlineData("fr", LanguageTests.InvalidLanguageMessage)]
    [InlineData(null, LanguageTests.InvalidLanguageMessage)]
    public async Task CreateTranslation_in_the_same_or_an_unknown_language_is_rejected_and_stores_nothing(string? lang, string expected)
    {
        var original = await _service.CreateAsync(Request("Hola"), default);

        var error = await Assert.ThrowsAsync<DomainException>(() =>
            _service.CreateTranslationAsync(original.Id, new CreateTranslationRequest(lang), default));

        Assert.Equal(expected, error.Message);
        Assert.Single(_repository.Items);
    }

    [Fact]
    public async Task CreateTranslation_of_an_unknown_post_is_not_found()
    {
        var error = await Assert.ThrowsAsync<NotFoundException>(() =>
            _service.CreateTranslationAsync(Guid.NewGuid(), new CreateTranslationRequest("en"), default));

        Assert.Equal("El post no existe.", error.Message);
        Assert.Empty(_repository.Items);
    }

    [Fact]
    public async Task CreateTranslation_suffixes_the_language_when_another_post_already_uses_the_slug_in_that_language()
    {
        var original = await _service.CreateAsync(Request("Hola"), default);
        var unrelated = await _service.CreateAsync(Request("Hello", "hola") with { Lang = "en" }, default);

        var translation = await _service.CreateTranslationAsync(original.Id, new CreateTranslationRequest("en"), default);

        Assert.Equal(("hola-en", "en", original.TranslationGroupId), (translation.Slug, translation.Lang, translation.TranslationGroupId));
        Assert.Equal("hola-en", (await _service.GetRevisionAsync(translation.Id, Assert.Single(await RevisionsAsync(translation.Id)).Id, default)).Slug);
        // El original y el otro post en inglés no cambian.
        Assert.Equal("hola", (await _service.GetAsync(original.Id, default)).Slug);
        Assert.Equal("hola", (await _service.GetAsync(unrelated.Id, default)).Slug);
    }

    [Fact]
    public async Task CreateTranslation_is_a_conflict_when_the_slug_with_the_language_suffix_is_taken_too_and_stores_nothing()
    {
        var original = await _service.CreateAsync(Request("Hola"), default);
        await _service.CreateAsync(Request("Hello", "hola") with { Lang = "en" }, default);
        await _service.CreateAsync(Request("Hello again", "hola-en") with { Lang = "en" }, default);
        var revisionsBefore = _repository.Revisions.Count;

        var error = await Assert.ThrowsAsync<ConflictException>(() =>
            _service.CreateTranslationAsync(original.Id, new CreateTranslationRequest("en"), default));

        Assert.Equal("Ya existe un post en inglés con el slug \"hola-en\".", error.Message);
        Assert.Equal(3, _repository.Items.Count);
        Assert.Equal(revisionsBefore, _repository.Revisions.Count);
        Assert.Empty((await _service.GetAsync(original.Id, default)).Translations);
    }

    [Fact]
    public async Task Publishing_or_unpublishing_a_version_does_not_move_the_content_time_the_other_one_sees()
    {
        var original = await _service.CreateAsync(Request("Hola"), default);
        var created = _clock.UtcNow;
        _clock.UtcNow = created.AddHours(1);
        var english = await _service.CreateTranslationAsync(original.Id, new CreateTranslationRequest("en"), default);
        _clock.UtcNow = created.AddHours(2);

        var published = await _service.PublishAsync(original.Id, default);
        var unpublished = await _service.UnpublishAsync(english.Id, default);

        Assert.Equal((created.AddHours(2), created), (published.UpdatedAt, published.ContentUpdatedAt));
        Assert.Equal((created.AddHours(2), created.AddHours(1)), (unpublished.UpdatedAt, unpublished.ContentUpdatedAt));
        Assert.Equal(created, Assert.Single(unpublished.Translations).ContentUpdatedAt);
        var summaries = (await _service.ListAsync(default)).ToDictionary(summary => summary.Id);
        Assert.Equal(created, summaries[original.Id].ContentUpdatedAt);
        Assert.Equal(created, Assert.Single(summaries[english.Id].Translations).ContentUpdatedAt);

        // Editar el contenido sí la mueve.
        _clock.UtcNow = created.AddHours(3);
        var edited = await _service.UpdateAsync(original.Id, Request("Hola editado", "hola"), default);
        Assert.Equal(created.AddHours(3), edited.ContentUpdatedAt);
        Assert.Equal(created.AddHours(3), Assert.Single((await _service.GetAsync(english.Id, default)).Translations).ContentUpdatedAt);
    }

    [Fact]
    public async Task Deleting_one_version_keeps_the_other_alone_in_its_group()
    {
        var original = await _service.CreateAsync(Request("Hola"), default);
        var english = await _service.CreateTranslationAsync(original.Id, new CreateTranslationRequest("en"), default);

        await _service.DeleteAsync(original.Id, default);

        var kept = await _service.GetAsync(english.Id, default);
        Assert.Equal(original.TranslationGroupId, kept.TranslationGroupId);
        Assert.Empty(kept.Translations);
    }

    [Fact]
    public async Task The_admin_list_links_each_version_only_to_the_other_ones()
    {
        var original = await _service.CreateAsync(Request("Hola"), default);
        var english = await _service.CreateTranslationAsync(original.Id, new CreateTranslationRequest("en"), default);
        var alone = await _service.CreateAsync(Request("Solo"), default);

        var list = (await _service.ListAsync(default)).ToDictionary(summary => summary.Id);

        Assert.Equal(("es", original.TranslationGroupId), (list[original.Id].Lang, list[original.Id].TranslationGroupId));
        Assert.Equal([english.Id], list[original.Id].Translations.Select(version => version.Id));
        Assert.Equal([(original.Id, "es")], list[english.Id].Translations.Select(version => (version.Id, version.Lang)));
        Assert.Empty(list[alone.Id].Translations);
    }

    [Fact]
    public async Task The_published_list_carries_language_and_group_and_links_only_published_versions()
    {
        var original = await _service.CreateAsync(Request("Hola"), default);
        await _service.PublishAsync(original.Id, default);
        var english = await _service.CreateTranslationAsync(original.Id, new CreateTranslationRequest("en"), default);

        var beforeEnglishIsPublished = Assert.Single(await _service.ListPublishedAsync(default));
        await _service.PublishAsync(english.Id, default);
        var published = (await _service.ListPublishedAsync(default)).ToDictionary(post => post.Id);

        Assert.Equal(("es", original.TranslationGroupId), (beforeEnglishIsPublished.Lang, beforeEnglishIsPublished.TranslationGroupId));
        Assert.Empty(beforeEnglishIsPublished.Translations);
        Assert.Equal([english.Id], published[original.Id].Translations.Select(version => version.Id));
        Assert.Equal([original.Id], published[english.Id].Translations.Select(version => version.Id));
    }

    // ----- Historial de versiones -----

    private Task<IReadOnlyList<PostRevisionSummaryDto>> RevisionsAsync(Guid id) => _service.ListRevisionsAsync(id, default);

    private static SavePostRequest Full() => new("Hola", "hola", "Resumen", "cuerpo", ["net"], "/media/a.png", "Alt");

    [Fact]
    public async Task Creating_and_each_content_change_record_a_revision_but_no_ops_and_publishing_do_not()
    {
        var created = _clock.UtcNow;
        var post = await _service.CreateAsync(Request("Hola"), default);
        _clock.UtcNow = _clock.UtcNow.AddMinutes(1);

        await _service.UpdateAsync(post.Id, Request("Hola 2", "hola"), default);
        await _service.UpdateAsync(post.Id, Request("Hola 2", "hola"), default);
        await _service.PublishAsync(post.Id, default);
        await _service.UnpublishAsync(post.Id, default);
        var translation = await _service.CreateTranslationAsync(post.Id, new CreateTranslationRequest("en"), default);

        var revisions = await RevisionsAsync(post.Id);
        Assert.Equal([(2, "Hola 2", _clock.UtcNow), (1, "Hola", created)], revisions.Select(revision => (revision.Number, revision.Title, revision.CreatedAt)));
        Assert.Equal("cuerpo".Length, revisions[0].BodyLength);
        Assert.Equal([1], (await RevisionsAsync(translation.Id)).Select(revision => revision.Number));
    }

    [Fact]
    public async Task A_no_op_update_of_a_published_post_still_saves_and_rebuilds_as_before()
    {
        var post = await _service.CreateAsync(Request("Hola"), default);
        await _service.PublishAsync(post.Id, default);
        var builds = _build.Requests;
        _clock.UtcNow = _clock.UtcNow.AddMinutes(5);

        var updated = await _service.UpdateAsync(post.Id, Request("Hola", "hola"), default);

        Assert.Equal(_clock.UtcNow, updated.UpdatedAt);
        Assert.Equal(builds + 1, _build.Requests);
        Assert.Single(await RevisionsAsync(post.Id));
    }

    [Fact]
    public async Task Only_the_latest_revisions_are_kept_and_numbers_keep_growing()
    {
        var post = await _service.CreateAsync(Request("Hola"), default);

        for (var number = 2; number <= PostRevision.MaxPerPost + 10; number++)
        {
            await _service.UpdateAsync(post.Id, Request($"Hola {number}", "hola"), default);
        }

        Assert.Equal(Enumerable.Range(11, PostRevision.MaxPerPost).Reverse(), (await RevisionsAsync(post.Id)).Select(revision => revision.Number));
    }

    [Fact]
    public async Task GetRevision_returns_the_whole_snapshot()
    {
        var post = await _service.CreateAsync(Full(), default);
        var first = Assert.Single(await RevisionsAsync(post.Id));

        var revision = await _service.GetRevisionAsync(post.Id, first.Id, default);

        Assert.Equal(
            new PostRevisionDto(first.Id, 1, _clock.UtcNow, "Hola", "hola", "Resumen", "cuerpo", revision.Tags, "/media/a.png", "Alt"), revision);
        Assert.Equal(["net"], revision.Tags);
    }

    [Fact]
    public async Task Restore_applies_the_snapshot_as_a_normal_update_and_records_a_new_revision()
    {
        var post = await _service.CreateAsync(Full(), default);
        await _service.PublishAsync(post.Id, default);
        await _service.UpdateAsync(post.Id, new SavePostRequest("Cambiado", "cambiado", null, "otro", null), default);
        var first = (await RevisionsAsync(post.Id))[^1];
        var builds = _build.Requests;

        var restored = await _service.RestoreRevisionAsync(post.Id, first.Id, default);

        Assert.Equal(
            ("Hola", "hola", "Resumen", "cuerpo", "/media/a.png", "Alt", PostStatus.Published),
            (restored.Title, restored.Slug, restored.Summary, restored.Body, restored.CoverUrl, restored.CoverAlt, restored.Status));
        Assert.Equal(["net"], restored.Tags);
        Assert.Equal([3, 2, 1], (await RevisionsAsync(post.Id)).Select(revision => revision.Number));
        // Es un guardado más: un post publicado pide regenerar el sitio.
        Assert.Equal(builds + 1, _build.Requests);
    }

    [Fact]
    public async Task A_restore_rejected_by_validation_leaves_the_post_and_its_history_unchanged()
    {
        var post = await _service.CreateAsync(Request("Hola"), default);
        await _service.UpdateAsync(post.Id, Request("Hola", "nuevo"), default);
        await _service.CreateAsync(Request("Otro", "hola"), default);
        var history = await RevisionsAsync(post.Id);
        var before = await _service.GetAsync(post.Id, default);

        var error = await Assert.ThrowsAsync<ConflictException>(() => _service.RestoreRevisionAsync(post.Id, history[^1].Id, default));

        Assert.Equal("Ya existe un post en español con el slug \"hola\".", error.Message);
        Assert.Equivalent(before, await _service.GetAsync(post.Id, default), strict: true);
        Assert.Equal(history, await RevisionsAsync(post.Id));
    }

    [Fact]
    public async Task Revisions_of_an_unknown_post_and_unknown_or_foreign_revisions_are_not_found()
    {
        var post = await _service.CreateAsync(Request("Uno"), default);
        var other = await _service.CreateAsync(Request("Dos"), default);
        var foreign = Assert.Single(await RevisionsAsync(other.Id));

        var noPost = await Assert.ThrowsAsync<NotFoundException>(() => _service.ListRevisionsAsync(Guid.NewGuid(), default));
        var noRevision = await Assert.ThrowsAsync<NotFoundException>(() => _service.GetRevisionAsync(post.Id, Guid.NewGuid(), default));
        var notItsRevision = await Assert.ThrowsAsync<NotFoundException>(() => _service.RestoreRevisionAsync(post.Id, foreign.Id, default));

        Assert.Equal(("El post no existe.", "La versión no existe.", "La versión no existe."), (noPost.Message, noRevision.Message, notItsRevision.Message));
        Assert.Equal("Uno", (await _service.GetAsync(post.Id, default)).Title);
        Assert.Single(await RevisionsAsync(post.Id));
    }

    // ----- Publicación programada -----

    [Fact]
    public async Task Schedule_stores_the_time_in_utc_and_cancel_clears_it_without_rebuilding()
    {
        var post = await _service.CreateAsync(Request("Hola"), default);

        var scheduled = await _service.ScheduleAsync(post.Id, new SchedulePostRequest("2026-11-26T09:00:00-03:00"), default);
        var listed = Assert.Single(await _service.ListAsync(default));
        var cancelled = await _service.UnscheduleAsync(post.Id, default);

        Assert.Equal(new DateTime(2026, 11, 26, 12, 0, 0, DateTimeKind.Utc), scheduled.ScheduledAt);
        Assert.Equal(DateTimeKind.Utc, scheduled.ScheduledAt!.Value.Kind);
        Assert.Equal(scheduled.ScheduledAt, listed.ScheduledAt);
        Assert.Null(cancelled.ScheduledAt);
        Assert.Equal(0, _build.Requests);
    }

    [Theory]
    [InlineData(null, ScheduleMessages.Missing)]
    [InlineData("  ", ScheduleMessages.Missing)]
    [InlineData("mañana", ScheduleMessages.BadFormat)]
    [InlineData("2026-11-26T09:00:00", ScheduleMessages.BadFormat)]
    [InlineData("2026-11-25T11:59:59Z", ScheduleMessages.Past)]
    [InlineData("2026-11-25T09:00:00-03:00", ScheduleMessages.Past)]
    public async Task Schedule_rejects_missing_ambiguous_or_past_times_and_keeps_the_current_one(string? publishAt, string expected)
    {
        var post = await _service.CreateAsync(Request("Hola"), default);
        await _service.ScheduleAsync(post.Id, new SchedulePostRequest("2026-12-01T00:00:00Z"), default);
        var before = await _service.GetAsync(post.Id, default);

        var error = await Assert.ThrowsAsync<DomainException>(() => _service.ScheduleAsync(post.Id, new SchedulePostRequest(publishAt), default));

        Assert.Equal(expected, error.Message);
        Assert.Equivalent(before, await _service.GetAsync(post.Id, default), strict: true);
    }

    [Fact]
    public async Task Publishing_by_hand_clears_the_schedule_and_a_published_post_cannot_be_scheduled()
    {
        var post = await _service.CreateAsync(Request("Hola"), default);
        await _service.ScheduleAsync(post.Id, new SchedulePostRequest("2026-12-01T00:00:00Z"), default);

        var published = await _service.PublishAsync(post.Id, default);
        var error = await Assert.ThrowsAsync<DomainException>(() =>
            _service.ScheduleAsync(post.Id, new SchedulePostRequest("2026-12-02T00:00:00Z"), default));

        Assert.Null(published.ScheduledAt);
        Assert.Equal(ScheduleMessages.Published, error.Message);
        Assert.Null((await _service.GetAsync(post.Id, default)).ScheduledAt);
    }

    [Fact]
    public async Task Only_due_drafts_are_listed_and_PublishIfDue_publishes_each_one_once_without_rebuilding()
    {
        var due = await _service.CreateAsync(Request("Vencido"), default);
        var later = await _service.CreateAsync(Request("Después"), default);
        await _service.CreateAsync(Request("Sin programar"), default);
        await _service.ScheduleAsync(due.Id, new SchedulePostRequest("2026-11-25T13:00:00Z"), default);
        await _service.ScheduleAsync(later.Id, new SchedulePostRequest("2026-11-27T00:00:00Z"), default);
        _clock.UtcNow = _clock.UtcNow.AddHours(2);

        Assert.Equal([due.Id], await _service.ListDueAsync(default));
        Assert.True(await _service.PublishIfDueAsync(due.Id, default));
        Assert.False(await _service.PublishIfDueAsync(due.Id, default));
        Assert.False(await _service.PublishIfDueAsync(later.Id, default));
        Assert.False(await _service.PublishIfDueAsync(Guid.NewGuid(), default));

        var published = await _service.GetAsync(due.Id, default);
        Assert.Equal((PostStatus.Published, (DateTime?)null, (DateTime?)_clock.UtcNow), (published.Status, published.ScheduledAt, published.PublishedAt));
        Assert.Equal(PostStatus.Draft, (await _service.GetAsync(later.Id, default)).Status);
        Assert.Empty(await _service.ListDueAsync(default));
        // La tanda pide un solo rebuild al final (lo hace el proceso en segundo plano), no uno por post.
        Assert.Equal(0, _build.Requests);
    }
}
