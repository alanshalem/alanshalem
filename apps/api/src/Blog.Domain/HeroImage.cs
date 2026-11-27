namespace Blog.Domain;

/// <summary>
/// A photo or a video of the home page hero gallery. The site picks one at random on each visit. A video carries its
/// poster as <see cref="Media"/>: it is what shows while it loads, or instead of the video (reduced motion, Save-Data).
/// </summary>
public sealed class HeroImage
{
    // Constructor for EF Core.
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

    /// <summary>English version of <see cref="Alt"/>. Null = the English site uses the Spanish one.</summary>
    public string? AltEn { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>
    /// What the site can show: a photo, or a video that already has its files. Whether it is a photo or a video is
    /// told by <see cref="VideoAssetId"/> (what is stored), not by <see cref="Video"/>: an unloaded navigation is also
    /// null and would pass a video without files off as a photo.
    /// </summary>
    /// <exception cref="InvalidOperationException">If it is a video read without loading <see cref="Video"/> (programming error).</exception>
    public bool IsPublishable => VideoAssetId is null || LoadedVideo.Status == VideoStatus.Ready;

    private VideoAsset LoadedVideo => Video
        ?? throw new InvalidOperationException("The hero item is a video and was read without loading it: include the Video navigation in the query.");

    /// <exception cref="DomainException">If the photo does not meet the hero size rule (<see cref="HeroFrame"/>).</exception>
    public static HeroImage CreatePhoto(MediaAsset media, HeroImageContent content, DateTime nowUtc)
    {
        HeroFrame.Ensure(media.Width, media.Height);
        return New(media, video: null, content, nowUtc);
    }

    /// <summary>The size rule was already applied when the video was uploaded (<see cref="VideoAsset.Create"/>).</summary>
    /// <exception cref="DomainException">If the video is still processing or failed.</exception>
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

/// <summary>The editable part of a hero item, validated and normalized. If an instance exists, it is valid.</summary>
/// <remarks>
/// The credit is a proper name, one single field for both languages: only the alternative text has an English version.
/// </remarks>
public sealed record HeroImageContent(string Alt, string? Credit, string? AltEn = null)
{
    public const int MaxAltLength = 300;
    public const int MaxCreditLength = 200;

    /// <param name="altEn">Optional even though the Spanish one is not: if missing, the English site uses the Spanish one.</param>
    public static HeroImageContent Create(string? alt, string? credit, string? altEn = null)
    {
        // The alternative text is required: it is all a screen reader "sees" of the hero.
        var cleanAlt = OptionalText.Clean(alt, MaxAltLength, MessageKeys.HeroAltTooLong)
            ?? throw new DomainException(MessageKeys.HeroAltRequired);

        return new HeroImageContent(
            cleanAlt,
            OptionalText.Clean(credit, MaxCreditLength, MessageKeys.HeroCreditTooLong),
            OptionalText.Clean(altEn, MaxAltLength, MessageKeys.HeroAltEnTooLong));
    }
}
