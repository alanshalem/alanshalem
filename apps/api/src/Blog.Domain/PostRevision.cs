namespace Blog.Domain;

/// <summary>
/// Instantánea del contenido de un post tal como quedó en un guardado. Nunca se modifica: restaurar aplica una vieja
/// como un guardado más, que deja su propia versión nueva (la historia no se reescribe).
/// </summary>
public sealed class PostRevision
{
    /// <summary>Versiones que se guardan por post; al pasarse se borran las más viejas. Alcanza para deshacer días de edición sin que el cuerpo (hasta 500 KB) infle la base.</summary>
    public const int MaxPerPost = 50;

    // Constructor para EF Core (materializa la entidad desde la base).
    private PostRevision()
    {
        Title = Slug = Summary = Body = string.Empty;
        Tags = [];
    }

    public Guid Id { get; private set; }
    public Guid PostId { get; private set; }

    /// <summary>1, 2, 3... por post. No se reutiliza al podar: "versión 37" siempre es la misma.</summary>
    public int Number { get; private set; }

    public string Title { get; private set; }
    public string Slug { get; private set; }
    public string Summary { get; private set; }
    public string Body { get; private set; }
    public IReadOnlyList<string> Tags { get; private set; }
    public string? CoverUrl { get; private set; }
    public string? CoverAlt { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>La versión más vieja que se conserva una vez guardada esta: las anteriores se podan.</summary>
    public int FirstKeptNumber => Math.Max(1, Number - MaxPerPost + 1);

    /// <summary>El contenido actual del post como su versión número <paramref name="number"/>.</summary>
    public static PostRevision Capture(Post post, int number, DateTime nowUtc) => new()
    {
        Id = Guid.CreateVersion7(),
        PostId = post.Id,
        Number = number,
        Title = post.Title,
        Slug = post.Slug,
        Summary = post.Summary,
        Body = post.Body,
        Tags = [.. post.Tags], // lista propia: la instantánea no comparte nada con el post vivo
        CoverUrl = post.CoverUrl,
        CoverAlt = post.CoverAlt,
        CreatedAtUtc = nowUtc,
    };
}
