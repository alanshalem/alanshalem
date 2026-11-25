namespace Blog.Domain;

/// <summary>Un artículo del blog. Todas las fechas son UTC.</summary>
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

    /// <summary>Idioma del contenido (hoy siempre "es"). Se guarda desde el día uno para poder sumar traducciones sin migrar datos.</summary>
    public string Lang { get; private set; }

    public PostStatus Status { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>Primera vez que se publicó. Se conserva si el post se despublica y se vuelve a publicar.</summary>
    public DateTime? PublishedAtUtc { get; private set; }

    public static Post CreateDraft(PostContent content, string lang, DateTime nowUtc)
    {
        var post = new Post
        {
            Id = Guid.CreateVersion7(), // ordenable por tiempo: buen comportamiento como clave primaria
            Lang = lang,
            Status = PostStatus.Draft,
            CreatedAtUtc = nowUtc,
        };
        post.Apply(content, nowUtc);
        return post;
    }

    public void Update(PostContent content, DateTime nowUtc) => Apply(content, nowUtc);

    public void Publish(DateTime nowUtc)
    {
        Status = PostStatus.Published;
        PublishedAtUtc ??= nowUtc;
        UpdatedAtUtc = nowUtc;
    }

    public void Unpublish(DateTime nowUtc)
    {
        Status = PostStatus.Draft;
        UpdatedAtUtc = nowUtc;
    }

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
