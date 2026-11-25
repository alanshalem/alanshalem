using Blog.Application.Posts;
using Blog.Domain;

namespace Blog.Application.Abstractions;

/// <summary>Persistencia de posts. La implementa Infrastructure.</summary>
public interface IPostRepository
{
    Task<Post?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>El slug es único por idioma.</summary>
    Task<bool> SlugExistsAsync(string lang, string slug, Guid? excludingId, CancellationToken cancellationToken);

    /// <summary>Todas las versiones del grupo de traducción, incluida la del post que se pidió.</summary>
    Task<IReadOnlyList<PostTranslationDto>> ListVersionsAsync(Guid translationGroupId, CancellationToken cancellationToken);

    /// <summary>
    /// Todos los posts, más recientes primero, SIN el cuerpo (la lista del admin no necesita cargarlo) y con
    /// Translations vacío: las versiones las vincula el servicio con la lista misma.
    /// </summary>
    Task<IReadOnlyList<PostSummaryDto>> ListSummariesAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<Post>> ListPublishedAsync(CancellationToken cancellationToken);

    void Add(Post post);

    /// <summary>Borra el post y, en cascada, su historial.</summary>
    void Remove(Post post);

    /// <summary>Ids de los borradores programados cuya hora ya llegó, del más atrasado al más reciente.</summary>
    Task<IReadOnlyList<Guid>> ListDueAsync(DateTime nowUtc, CancellationToken cancellationToken);

    // ----- Historial: parte del post (se guarda en el mismo SaveChanges y se borra con él) -----

    /// <summary>El número de la última versión del post; 0 si no tiene.</summary>
    Task<int> LatestRevisionNumberAsync(Guid postId, CancellationToken cancellationToken);

    void AddRevision(PostRevision revision);

    /// <summary>Marca para borrar (en el próximo SaveChanges) las versiones anteriores a ese número.</summary>
    Task RemoveRevisionsBeforeAsync(Guid postId, int number, CancellationToken cancellationToken);

    /// <summary>Las versiones del post, la más nueva primero, sin el cuerpo.</summary>
    Task<IReadOnlyList<PostRevisionSummaryDto>> ListRevisionsAsync(Guid postId, CancellationToken cancellationToken);

    /// <summary>Null si no existe o es de otro post.</summary>
    Task<PostRevision?> GetRevisionAsync(Guid postId, Guid revisionId, CancellationToken cancellationToken);

    /// <exception cref="ConflictException">
    /// Si el slug ya existe en ese idioma o el grupo ya tiene esa versión (carrera entre dos guardados simultáneos).
    /// </exception>
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

    bool Exists(string relativePath);
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

/// <summary>Dimensiones de una imagen tal como se ve (ya rotada según su EXIF). En una animación, las de un cuadro.</summary>
public sealed record ImageSize(int Width, int Height, int Pages)
{
    public bool IsAnimated => Pages > 1;

    /// <summary>Todos los cuadros: es lo que ocupa decodificada.</summary>
    public long Pixels => (long)Width * Height * Pages;
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

/// <summary>Persistencia de los videos del hero. Cada video se lee con su póster.</summary>
public interface IVideoAssetRepository
{
    Task<VideoAsset?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    Task<VideoAsset?> GetByHashAsync(string hash, CancellationToken cancellationToken);

    /// <summary>
    /// Descarta los cambios sin guardar de este scope y vuelve a leer el video tal como está en la base. Sirve para
    /// registrar un fallo partiendo de lo guardado y no de un estado a medias que quedó en memoria.
    /// </summary>
    Task<VideoAsset?> ReloadAsync(Guid id, CancellationToken cancellationToken);

    Task<IReadOnlyList<VideoAsset>> ListProcessingAsync(CancellationToken cancellationToken);

    void Add(VideoAsset video);

    /// <exception cref="ConflictException">Si el mismo video se terminó de subir al mismo tiempo desde otro lado.</exception>
    Task SaveChangesAsync(CancellationToken cancellationToken);
}

/// <summary>Original de video ya copiado a la carpeta de trabajo (fuera de /media: trae audio y metadatos).</summary>
/// <param name="Length">Bytes copiados. Si supera el máximo pedido, la copia se cortó ahí y el archivo no está completo.</param>
/// <param name="Head">Los primeros bytes, para verificar el formato por magic bytes.</param>
public sealed record StagedVideo(string Path, string Hash, long Length, byte[] Head)
{
    /// <summary>Los magic bytes de MP4/MOV (caja ftyp en el byte 4) y de WebM/MKV entran en los primeros 8.</summary>
    public const int HeadLength = 8;
}

/// <summary>Carpeta de trabajo de los videos: originales en espera de su turno y salidas de ffmpeg.</summary>
public interface IVideoStaging
{
    /// <summary>
    /// Copia la subida a un archivo propio calculando el SHA-256 al pasar (sin cargarla en memoria). Copia como
    /// máximo maxBytes + 1: alcanza para saber si se pasó.
    /// </summary>
    Task<StagedVideo> SaveAsync(Stream content, long maxBytes, CancellationToken cancellationToken);

    void Delete(string path);

    /// <summary>Borra lo que haya quedado de una ejecución anterior (originales y salidas a medias).</summary>
    void Clear();
}

/// <summary>Un video que espera ser procesado y dónde está su original.</summary>
public sealed record VideoJob(Guid VideoId, string SourcePath);

/// <summary>Cola en memoria de videos por procesar. La consume un único proceso en segundo plano, de a uno.</summary>
public interface IVideoQueue
{
    void Enqueue(VideoJob job);
}

/// <summary>Dimensiones como se ve (con la rotación aplicada) y duración de un video.</summary>
public sealed record VideoProbe(int Width, int Height, double DurationSeconds);

public sealed record EncodedVideo(VideoVariant Variant, byte[] Content);

/// <summary>Lo que produce el transcodificador: cada versión pedida y el póster (JPEG de un cuadro visible, sin optimizar).</summary>
public sealed record TranscodedVideo(IReadOnlyList<EncodedVideo> Files, byte[] Poster);

/// <summary>
/// No se pudo convertir el video (ffmpeg falló o tardó demasiado). El mensaje es para el admin: se guarda como error
/// del video. Los detalles técnicos los registra el adaptador.
/// </summary>
public sealed class VideoProcessingException(string message) : Exception(message);

/// <summary>Lectura y conversión de videos. Lo implementa Infrastructure con ffprobe y ffmpeg.</summary>
public interface IVideoTranscoder
{
    /// <summary>Null si el archivo no es un video legible (sin pista de video o sin duración).</summary>
    Task<VideoProbe?> ProbeAsync(string sourcePath, CancellationToken cancellationToken);

    /// <summary>
    /// Genera cada versión pedida (sin audio ni metadatos) con el recorte y el fundido de la edición, y el póster de su
    /// primer cuadro visible (<see cref="VideoEdit.FirstVisibleSecond"/>), sin escribir nada en /media.
    /// </summary>
    /// <exception cref="VideoProcessingException">Si ffmpeg falla o se pasa del tiempo máximo.</exception>
    Task<TranscodedVideo> TranscodeAsync(
        string sourcePath, IReadOnlyList<VideoVariant> variants, VideoEdit edit, CancellationToken cancellationToken);
}
