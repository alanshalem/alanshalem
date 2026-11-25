using Blog.Application.Abstractions;
using Blog.Domain;

namespace Blog.Application.Posts;

/// <summary>
/// Casos de uso de posts. Cada cambio que afecta lo que ve el público dispara una regeneración del sitio, y cada guardado
/// que cambia el contenido deja una versión en el historial.
/// </summary>
public sealed class PostService(IPostRepository posts, IClock clock, ISiteBuildTrigger siteBuild)
{
    public async Task<IReadOnlyList<PostSummaryDto>> ListAsync(CancellationToken cancellationToken)
    {
        // La lista ya trae todas las versiones: se vinculan entre sí sin otra consulta.
        var summaries = await posts.ListSummariesAsync(cancellationToken);
        var groups = summaries.ToLookup(summary => summary.TranslationGroupId, summary => summary.ToTranslation());
        return summaries
            .Select(summary => summary with { Translations = PostMapping.OthersThan(summary.Id, groups[summary.TranslationGroupId]) })
            .ToList();
    }

    public async Task<PostDto> GetAsync(Guid id, CancellationToken cancellationToken) =>
        await ToDtoAsync(await FindAsync(id, cancellationToken), cancellationToken);

    public async Task<PostDto> CreateAsync(SavePostRequest request, CancellationToken cancellationToken)
    {
        var post = Post.CreateDraft(ToContent(request), request.Lang ?? Language.Default, clock.UtcNow);
        await EnsureSlugIsFreeAsync(post.Lang, post.Slug, excludingId: null, cancellationToken);

        posts.Add(post);
        await RecordRevisionAsync(post, cancellationToken);
        await posts.SaveChangesAsync(cancellationToken);

        // Un borrador nuevo no es visible para el público: no hace falta regenerar.
        return await ToDtoAsync(post, cancellationToken);
    }

    public async Task<PostDto> UpdateAsync(Guid id, SavePostRequest request, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        if (request.Lang is not null && Language.Parse(request.Lang) != post.Lang)
        {
            throw new DomainException("El idioma de un post no se puede cambiar: creá su versión en el otro idioma.");
        }

        var content = ToContent(request);
        await EnsureSlugIsFreeAsync(post.Lang, content.Slug, excludingId: id, cancellationToken);

        if (post.Update(content, clock.UtcNow))
        {
            await RecordRevisionAsync(post, cancellationToken);
        }

        await posts.SaveChangesAsync(cancellationToken);

        if (post.Status == PostStatus.Published)
        {
            await siteBuild.RequestBuildAsync(cancellationToken);
        }

        return await ToDtoAsync(post, cancellationToken);
    }

    /// <summary>
    /// Crea el borrador de la versión en otro idioma copiando el contenido del post (la traducción es manual, encima de
    /// la copia). Un borrador no se ve en el sitio: no se regenera.
    /// </summary>
    /// <exception cref="ConflictException">Si el grupo ya tiene esa versión, o si otro post usa el slug en ese idioma.</exception>
    public async Task<PostDto> CreateTranslationAsync(Guid id, CreateTranslationRequest request, CancellationToken cancellationToken)
    {
        var source = await FindAsync(id, cancellationToken);
        var translation = source.CreateTranslation(request.Lang, clock.UtcNow);

        // Una versión por idioma en cada grupo. El índice único (TranslationGroupId, Lang) cubre la carrera entre dos pedidos.
        var versions = await posts.ListVersionsAsync(source.TranslationGroupId, cancellationToken);
        if (versions.Any(version => version.Lang == translation.Lang))
        {
            throw new ConflictException($"Este post ya tiene su versión en {Language.NameOf(translation.Lang)}.");
        }

        await EnsureSlugIsFreeAsync(translation.Lang, translation.Slug, excludingId: null, cancellationToken);

        posts.Add(translation);
        await RecordRevisionAsync(translation, cancellationToken);
        await posts.SaveChangesAsync(cancellationToken);
        return translation.ToDto(versions);
    }

    /// <exception cref="NotFoundException">Si el post no existe.</exception>
    public async Task<IReadOnlyList<PostRevisionSummaryDto>> ListRevisionsAsync(Guid id, CancellationToken cancellationToken)
    {
        await FindAsync(id, cancellationToken);
        return await posts.ListRevisionsAsync(id, cancellationToken);
    }

    public async Task<PostRevisionDto> GetRevisionAsync(Guid id, Guid revisionId, CancellationToken cancellationToken) =>
        (await FindRevisionAsync(id, revisionId, cancellationToken)).ToDto();

    /// <summary>
    /// Vuelve el post a esa versión con un guardado normal: mismas validaciones (slug libre en su idioma, límites), mismo
    /// rebuild si está publicado, y una versión nueva en el historial. Las versiones posteriores no se tocan.
    /// </summary>
    public async Task<PostDto> RestoreRevisionAsync(Guid id, Guid revisionId, CancellationToken cancellationToken)
    {
        var revision = await FindRevisionAsync(id, revisionId, cancellationToken);
        return await UpdateAsync(id, revision.ToRequest(), cancellationToken);
    }

    /// <summary>Un borrador programado no se ve en el sitio hasta que se publica: no se regenera.</summary>
    public async Task<PostDto> ScheduleAsync(Guid id, SchedulePostRequest request, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        post.Schedule(request.ParsePublishAtUtc(), clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);
        return await ToDtoAsync(post, cancellationToken);
    }

    public async Task<PostDto> UnscheduleAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        post.Unschedule(clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);
        return await ToDtoAsync(post, cancellationToken);
    }

    /// <summary>Los borradores programados que ya vencieron, para publicarlos de a uno con <see cref="PublishIfDueAsync"/>.</summary>
    public Task<IReadOnlyList<Guid>> ListDueAsync(CancellationToken cancellationToken) =>
        posts.ListDueAsync(clock.UtcNow, cancellationToken);

    /// <summary>
    /// Publica un post programado por el mismo camino que la publicación manual, si sigue vencido: entre la lista y acá
    /// pudo publicarse a mano, cancelarse o borrarse. No regenera: quien publica la tanda pide un solo rebuild al final.
    /// </summary>
    /// <returns>Si lo publicó.</returns>
    public async Task<bool> PublishIfDueAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await posts.GetByIdAsync(id, cancellationToken);
        if (post is null || !post.IsDue(clock.UtcNow))
        {
            return false;
        }

        post.Publish(clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<PostDto> PublishAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        post.Publish(clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);
        await siteBuild.RequestBuildAsync(cancellationToken);
        return await ToDtoAsync(post, cancellationToken);
    }

    public async Task<PostDto> UnpublishAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        var wasPublished = post.Status == PostStatus.Published;

        post.Unpublish(clock.UtcNow);
        await posts.SaveChangesAsync(cancellationToken);

        if (wasPublished)
        {
            await siteBuild.RequestBuildAsync(cancellationToken);
        }

        return await ToDtoAsync(post, cancellationToken);
    }

    /// <summary>Borra solo esta versión: las demás del grupo quedan (si queda una, el grupo sigue con ella).</summary>
    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        var post = await FindAsync(id, cancellationToken);
        var wasPublished = post.Status == PostStatus.Published;

        posts.Remove(post);
        await posts.SaveChangesAsync(cancellationToken);

        if (wasPublished)
        {
            await siteBuild.RequestBuildAsync(cancellationToken);
        }
    }

    /// <summary>
    /// Lo que consume el builder de Astro: todos los posts publicados, con cuerpo. Cada uno se vincula solo con sus
    /// versiones publicadas: el sitio nunca enlaza un borrador.
    /// </summary>
    public async Task<IReadOnlyList<PostDto>> ListPublishedAsync(CancellationToken cancellationToken)
    {
        var published = await posts.ListPublishedAsync(cancellationToken);
        var groups = published.ToLookup(post => post.TranslationGroupId, post => post.ToTranslation());
        return published.Select(post => post.ToDto(groups[post.TranslationGroupId])).ToList();
    }

    private async Task<Post> FindAsync(Guid id, CancellationToken cancellationToken) =>
        await posts.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException("El post no existe.");

    private async Task<PostRevision> FindRevisionAsync(Guid id, Guid revisionId, CancellationToken cancellationToken)
    {
        await FindAsync(id, cancellationToken);
        return await posts.GetRevisionAsync(id, revisionId, cancellationToken) ?? throw new NotFoundException("La versión no existe.");
    }

    // La instantánea del contenido actual como versión siguiente, podando las que pasan de PostRevision.MaxPerPost. Se
    // confirma en el mismo SaveChanges que el post: nunca queda un guardado sin su versión ni al revés.
    private async Task RecordRevisionAsync(Post post, CancellationToken cancellationToken)
    {
        var number = await posts.LatestRevisionNumberAsync(post.Id, cancellationToken) + 1;
        var revision = PostRevision.Capture(post, number, clock.UtcNow);
        posts.AddRevision(revision);
        await posts.RemoveRevisionsBeforeAsync(post.Id, revision.FirstKeptNumber, cancellationToken);
    }

    private async Task<PostDto> ToDtoAsync(Post post, CancellationToken cancellationToken) =>
        post.ToDto(await posts.ListVersionsAsync(post.TranslationGroupId, cancellationToken));

    private static PostContent ToContent(SavePostRequest request) =>
        PostContent.Create(request.Title, request.Slug, request.Summary, request.Body, request.Tags, request.CoverUrl, request.CoverAlt);

    // El slug es único por idioma: la misma URL puede existir en /es/ y en /en/.
    private async Task EnsureSlugIsFreeAsync(string lang, string slug, Guid? excludingId, CancellationToken cancellationToken)
    {
        if (await posts.SlugExistsAsync(lang, slug, excludingId, cancellationToken))
        {
            throw new ConflictException($"Ya existe un post en {Language.NameOf(lang)} con el slug \"{slug}\".");
        }
    }
}
