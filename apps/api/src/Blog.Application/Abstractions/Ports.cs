using Blog.Application.Posts;
using Blog.Domain;

namespace Blog.Application.Abstractions;

/// <summary>Persistencia de posts. La implementa Infrastructure.</summary>
public interface IPostRepository
{
    Task<Post?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    Task<bool> SlugExistsAsync(string slug, Guid? excludingId, CancellationToken cancellationToken);

    /// <summary>Todos los posts, más recientes primero, SIN el cuerpo (la lista del admin no necesita cargarlo).</summary>
    Task<IReadOnlyList<PostSummaryDto>> ListSummariesAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<Post>> ListPublishedAsync(CancellationToken cancellationToken);

    void Add(Post post);

    void Remove(Post post);

    /// <exception cref="ConflictException">Si el slug ya existe (carrera entre dos guardados simultáneos).</exception>
    Task SaveChangesAsync(CancellationToken cancellationToken);
}

public interface IClock
{
    DateTime UtcNow { get; }
}

/// <summary>Avisa al "builder" que hay que regenerar el sitio estático. Nunca debe lanzar: un builder caído no rompe el guardado.</summary>
public interface ISiteBuildTrigger
{
    Task RequestBuildAsync(CancellationToken cancellationToken);
}

public interface IMediaStorage
{
    /// <summary>Guarda el archivo y devuelve su URL pública relativa (ej: /media/2026/11/abc.png).</summary>
    Task<string> SaveAsync(Stream content, string extension, CancellationToken cancellationToken);
}
