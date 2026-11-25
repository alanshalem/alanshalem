namespace Blog.Domain;

/// <summary>Una foto de la galería del hero de la home. El sitio elige una al azar en cada visita.</summary>
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
    public string Alt { get; private set; }
    public string? Credit { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public static HeroImage Create(MediaAsset media, HeroImageContent content, DateTime nowUtc)
    {
        var image = new HeroImage
        {
            Id = Guid.CreateVersion7(),
            MediaAssetId = media.Id,
            Media = media,
            CreatedAtUtc = nowUtc,
        };
        image.Update(content);
        return image;
    }

    public void Update(HeroImageContent content)
    {
        Alt = content.Alt;
        Credit = content.Credit;
    }
}

/// <summary>Lo editable de una foto del hero, ya validado y normalizado. Si existe una instancia, es válida.</summary>
public sealed record HeroImageContent(string Alt, string? Credit)
{
    public const int MaxAltLength = 300;
    public const int MaxCreditLength = 200;

    public static HeroImageContent Create(string? alt, string? credit)
    {
        // El texto alternativo es obligatorio: es lo único que "ve" un lector de pantalla del hero.
        var cleanAlt = OptionalText.Clean(alt, MaxAltLength, $"El texto alternativo no puede superar {MaxAltLength} caracteres.")
            ?? throw new DomainException("El texto alternativo es obligatorio.");

        return new HeroImageContent(
            cleanAlt,
            OptionalText.Clean(credit, MaxCreditLength, $"El crédito no puede superar {MaxCreditLength} caracteres."));
    }
}
