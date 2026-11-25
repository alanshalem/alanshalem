namespace Blog.Domain;

/// <summary>
/// Un artículo del blog en un idioma. Sus versiones en otros idiomas son otros posts del mismo
/// <see cref="TranslationGroupId"/>, cada una con su contenido, su slug y su estado. Todas las fechas son UTC.
/// </summary>
public sealed class Post
{
    // Constructor para EF Core (materializa la entidad desde la base).
    private Post()
    {
        Slug = Title = Summary = Body = Lang = string.Empty;
        Tags = [];
    }

    public Guid Id { get; private set; }
    public string Slug { get; private set; }
    public string Title { get; private set; }
    public string Summary { get; private set; }
    public string Body { get; private set; }
    public IReadOnlyList<string> Tags { get; private set; }

    /// <summary>Portada elegida en el admin (/media/... o http(s)). Null = el sitio usa la primera imagen del cuerpo o una generativa.</summary>
    public string? CoverUrl { get; private set; }

    public string? CoverAlt { get; private set; }

    /// <summary>Idioma del contenido (<see cref="Language"/>). Fijo desde la creación: otro idioma es otra versión (<see cref="CreateTranslation"/>).</summary>
    public string Lang { get; private set; }

    /// <summary>Une las versiones del mismo artículo en distintos idiomas: a lo sumo una por idioma.</summary>
    public Guid TranslationGroupId { get; private set; }

    public PostStatus Status { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Último cambio de cualquier tipo: contenido, estado o programación. Ordena la lista del admin.</summary>
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>
    /// Último cambio del contenido (creación incluida). Publicar, despublicar o programar no lo mueven: es la referencia
    /// para saber si una traducción quedó atrás de su original, y un cambio de estado no deja nada nuevo que traducir.
    /// </summary>
    public DateTime ContentUpdatedAtUtc { get; private set; }

    /// <summary>Primera vez que se publicó. Se conserva si el post se despublica y se vuelve a publicar.</summary>
    public DateTime? PublishedAtUtc { get; private set; }

    /// <summary>Cuándo se publica solo (UTC). Solo la tiene un borrador: publicar, a mano o por la programación, la borra.</summary>
    public DateTime? ScheduledAtUtc { get; private set; }

    /// <summary>Un artículo nuevo: empieza su propio grupo de traducción.</summary>
    /// <exception cref="DomainException">Si el idioma no es uno de <see cref="Language"/>.</exception>
    public static Post CreateDraft(PostContent content, string lang, DateTime nowUtc) =>
        NewDraft(Language.Parse(lang), Guid.CreateVersion7(), content, nowUtc);

    /// <summary>
    /// El borrador de este artículo en otro idioma, en el mismo grupo, con el contenido copiado tal cual como punto de
    /// partida: la traducción es manual y se publica aparte. La portada se copia y después es independiente.
    /// </summary>
    /// <exception cref="DomainException">Si el idioma no es válido o es el de este post.</exception>
    public Post CreateTranslation(string? lang, DateTime nowUtc)
    {
        var target = Language.Parse(lang);
        if (target == Lang)
        {
            throw new DomainException($"El post ya está en {Language.NameOf(Lang)}: la versión nueva tiene que ser en el otro idioma.");
        }

        return NewDraft(target, TranslationGroupId, CurrentContent(), nowUtc);
    }

    /// <summary>
    /// Para la versión recién creada cuyo slug copiado ya usa otro artículo en su idioma: "mi-post" pasa a "mi-post-en",
    /// así crear la versión no falla por un slug que de todos modos se va a traducir. Es un cambio de contenido más.
    /// </summary>
    public void SuffixSlugWithLanguage(DateTime nowUtc) =>
        Update(CurrentContent() with { Slug = Domain.Slug.WithSuffix(Slug, Lang) }, nowUtc);

    /// <summary>
    /// Guarda el contenido. Siempre cuenta como actualización (<see cref="UpdatedAtUtc"/>), pero solo un contenido
    /// distinto mueve <see cref="ContentUpdatedAtUtc"/>: un guardado idéntico no deja nada nuevo que traducir.
    /// </summary>
    /// <returns>Si el contenido cambió: un guardado idéntico tampoco merece una versión nueva en el historial.</returns>
    public bool Update(PostContent content, DateTime nowUtc)
    {
        var changed = !HasContent(content);
        Apply(content, nowUtc);
        if (changed)
        {
            ContentUpdatedAtUtc = nowUtc;
        }

        return changed;
    }

    public void Publish(DateTime nowUtc)
    {
        Status = PostStatus.Published;
        PublishedAtUtc ??= nowUtc;
        ScheduledAtUtc = null;
        UpdatedAtUtc = nowUtc;
    }

    /// <summary>Programa la publicación. Reemplaza la fecha que hubiera.</summary>
    /// <exception cref="DomainException">Si el post ya está publicado o la fecha no es futura.</exception>
    public void Schedule(DateTime publishAtUtc, DateTime nowUtc)
    {
        if (Status == PostStatus.Published)
        {
            throw new DomainException("El post ya está publicado: no se puede programar.");
        }

        if (publishAtUtc <= nowUtc)
        {
            throw new DomainException("La fecha de publicación tiene que ser en el futuro.");
        }

        ScheduledAtUtc = publishAtUtc;
        UpdatedAtUtc = nowUtc;
    }

    public void Unschedule(DateTime nowUtc)
    {
        ScheduledAtUtc = null;
        UpdatedAtUtc = nowUtc;
    }

    /// <summary>Un borrador programado cuya hora ya llegó (o pasó, si la API estuvo apagada).</summary>
    public bool IsDue(DateTime nowUtc) => Status == PostStatus.Draft && ScheduledAtUtc <= nowUtc;

    public void Unpublish(DateTime nowUtc)
    {
        Status = PostStatus.Draft;
        UpdatedAtUtc = nowUtc;
    }

    private static Post NewDraft(string lang, Guid translationGroupId, PostContent content, DateTime nowUtc)
    {
        var post = new Post
        {
            Id = Guid.CreateVersion7(), // ordenable por tiempo: buen comportamiento como clave primaria
            Lang = lang,
            TranslationGroupId = translationGroupId,
            Status = PostStatus.Draft,
            CreatedAtUtc = nowUtc,
            ContentUpdatedAtUtc = nowUtc,
        };
        post.Apply(content, nowUtc);
        return post;
    }

    // Ya es contenido válido (salió de un PostContent): se copia sin volver a validar. Las etiquetas en una lista
    // propia, así editar la copia (otra versión, otro slug) nunca toca este post.
    private PostContent CurrentContent() => new(Title, Slug, Summary, Body, [.. Tags], CoverUrl, CoverAlt);

    private bool HasContent(PostContent content) =>
        Title == content.Title
        && Slug == content.Slug
        && Summary == content.Summary
        && Body == content.Body
        && Tags.SequenceEqual(content.Tags, StringComparer.Ordinal)
        && CoverUrl == content.CoverUrl
        && CoverAlt == content.CoverAlt;

    private void Apply(PostContent content, DateTime nowUtc)
    {
        Title = content.Title;
        Slug = content.Slug;
        Summary = content.Summary;
        Body = content.Body;
        Tags = content.Tags;
        CoverUrl = content.CoverUrl;
        CoverAlt = content.CoverAlt;
        UpdatedAtUtc = nowUtc;
    }
}
