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

/// <summary>Persistencia de los ajustes del sitio (una sola fila). La implementa Infrastructure.</summary>
public interface ISiteSettingsRepository
{
    /// <summary>La fila guardada, o null si todavía no se guardó nada desde el admin.</summary>
    Task<SiteSettings?> GetAsync(CancellationToken cancellationToken);

    void Add(SiteSettings settings);

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

/// <summary>Archivos de media. Las rutas las arma el dominio (<see cref="MediaAsset.RelativePathOf"/>), nunca el usuario.</summary>
public interface IMediaStorage
{
    /// <summary>Guarda (o reemplaza) el archivo en esa ruta relativa a la carpeta de media, ej: {hash}/640.webp.</summary>
    Task SaveAsync(string relativePath, ReadOnlyMemory<byte> content, CancellationToken cancellationToken);
}

/// <summary>Persistencia de las imágenes subidas. La implementa Infrastructure.</summary>
public interface IMediaAssetRepository
{
    Task<MediaAsset?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    Task<MediaAsset?> GetByHashAsync(string hash, CancellationToken cancellationToken);

    /// <summary>Todas, de la más vieja a la más nueva.</summary>
    Task<IReadOnlyList<MediaAsset>> ListAsync(CancellationToken cancellationToken);

    void Add(MediaAsset asset);

    /// <exception cref="ConflictException">Si la misma imagen se terminó de subir al mismo tiempo desde otro lado.</exception>
    Task SaveChangesAsync(CancellationToken cancellationToken);
}

/// <summary>Persistencia de la galería del hero. Cada foto se lee con su <see cref="MediaAsset"/>.</summary>
public interface IHeroImageRepository
{
    Task<HeroImage?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Todas, de la más vieja a la más nueva: la primera es la que el sitio muestra sin JavaScript.</summary>
    Task<IReadOnlyList<HeroImage>> ListAsync(CancellationToken cancellationToken);

    void Add(HeroImage image);

    void Remove(HeroImage image);

    Task SaveChangesAsync(CancellationToken cancellationToken);
}

/// <summary>Dimensiones de una imagen tal como se ve (ya rotada según su EXIF).</summary>
public sealed record ImageSize(int Width, int Height)
{
    public long Pixels => (long)Width * Height;
}

public sealed record EncodedVariant(MediaVariant Variant, byte[] Content);

/// <summary>Lo que produce el pipeline: los archivos de cada variante, el color dominante (#rrggbb) y el placeholder (data URI).</summary>
public sealed record ProcessedImage(IReadOnlyList<EncodedVariant> Files, string Color, string Placeholder);

/// <summary>Pipeline de imágenes (decodificar, rotar, quitar metadatos, codificar). Lo implementa Infrastructure con libvips.</summary>
public interface IImageProcessor
{
    /// <summary>Lee solo la cabecera, sin decodificar los píxeles. Null si los bytes no son una imagen legible.</summary>
    ImageSize? ReadSize(byte[] image);

    /// <summary>
    /// Genera cada variante pedida sin metadatos y en sRGB, procesando una imagen a la vez.
    /// Null si los píxeles no se pueden decodificar (archivo dañado).
    /// </summary>
    Task<ProcessedImage?> ProcessAsync(byte[] image, IReadOnlyList<MediaVariant> variants, CancellationToken cancellationToken);
}
