namespace Blog.Domain;

/// <summary>
/// Una foto o un video de la galería del hero de la home. El sitio elige uno al azar en cada visita. Un video lleva
/// su póster como <see cref="Media"/>: es lo que se ve mientras carga, o en vez del video (movimiento reducido, ahorro de datos).
/// </summary>
public sealed class HeroImage
{
    // Constructor para EF Core.
    private HeroImage()
    {
        Alt = string.Empty;
        Media = null!;
    }

    public Guid Id { get; private set; }
    public Guid MediaAssetId { get; private set; }
    public MediaAsset Media { get; private set; }
    public Guid? VideoAssetId { get; private set; }
    public VideoAsset? Video { get; private set; }
    public string Alt { get; private set; }
    public string? Credit { get; private set; }

    /// <summary>Versión en inglés de <see cref="Alt"/>. Null = el sitio en inglés usa la de español.</summary>
    public string? AltEn { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>
    /// Lo que el sitio puede mostrar: una foto, o un video que ya tiene sus archivos. Si es foto o video lo dice
    /// <see cref="VideoAssetId"/> (lo guardado), no <see cref="Video"/>: una relación sin cargar también es null y
    /// haría pasar un video sin archivos por una foto.
    /// </summary>
    /// <exception cref="InvalidOperationException">Si es un video y se leyó sin cargar <see cref="Video"/> (error de programación).</exception>
    public bool IsPublishable => VideoAssetId is null || LoadedVideo.Status == VideoStatus.Ready;

    private VideoAsset LoadedVideo => Video
        ?? throw new InvalidOperationException("El ítem del hero es un video y se leyó sin cargar el video: incluí la relación Video en la consulta.");

    /// <exception cref="DomainException">Si la foto no cumple la regla de tamaño del hero (<see cref="HeroFrame"/>).</exception>
    public static HeroImage CreatePhoto(MediaAsset media, HeroImageContent content, DateTime nowUtc)
    {
        HeroFrame.Ensure(media.Width, media.Height);
        return New(media, video: null, content, nowUtc);
    }

    /// <summary>La regla de tamaño ya se aplicó al subir el video (<see cref="VideoAsset.Create"/>).</summary>
    /// <exception cref="DomainException">Si el video todavía se está procesando o falló.</exception>
    public static HeroImage CreateVideo(VideoAsset video, HeroImageContent content, DateTime nowUtc) => video switch
    {
        { Status: VideoStatus.Ready, Poster: { } poster } => New(poster, video, content, nowUtc),
        { Status: VideoStatus.Processing } => throw new DomainException(MessageKeys.HeroVideoProcessing),
        _ => throw new DomainException(MessageKeys.HeroVideoFailed),
    };

    public void Update(HeroImageContent content)
    {
        Alt = content.Alt;
        Credit = content.Credit;
        AltEn = content.AltEn;
    }

    private static HeroImage New(MediaAsset media, VideoAsset? video, HeroImageContent content, DateTime nowUtc)
    {
        var image = new HeroImage
        {
            Id = Guid.CreateVersion7(),
            MediaAssetId = media.Id,
            Media = media,
            VideoAssetId = video?.Id,
            Video = video,
            CreatedAtUtc = nowUtc,
        };
        image.Update(content);
        return image;
    }
}

/// <summary>Lo editable de un ítem del hero, ya validado y normalizado. Si existe una instancia, es válida.</summary>
/// <remarks>El crédito es uno solo en los dos idiomas (L13): solo el texto alternativo tiene versión en inglés.</remarks>
public sealed record HeroImageContent(string Alt, string? Credit, string? AltEn = null)
{
    public const int MaxAltLength = 300;
    public const int MaxCreditLength = 200;

    /// <param name="altEn">Opcional aunque el de español no: si falta, el sitio en inglés usa el de español.</param>
    public static HeroImageContent Create(string? alt, string? credit, string? altEn = null)
    {
        // El texto alternativo es obligatorio: es lo único que "ve" un lector de pantalla del hero.
        var cleanAlt = OptionalText.Clean(alt, MaxAltLength, MessageKeys.HeroAltTooLong)
            ?? throw new DomainException(MessageKeys.HeroAltRequired);

        return new HeroImageContent(
            cleanAlt,
            OptionalText.Clean(credit, MaxCreditLength, MessageKeys.HeroCreditTooLong),
            OptionalText.Clean(altEn, MaxAltLength, MessageKeys.HeroAltEnTooLong));
    }
}
