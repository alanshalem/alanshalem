using System.Security.Cryptography;
using System.Text;

namespace Blog.Domain;

public enum VideoStatus
{
    Processing,
    Ready,
    Failed,
}

/// <summary>
/// A video uploaded for the hero, with its trim and fade (<see cref="Edit"/>). It is validated on upload (edit and size
/// rule) and processed in the background: meanwhile it is <see cref="VideoStatus.Processing"/>. Its files live in
/// /media/videos/{Hash}/{height}.{codec}.mp4.
/// </summary>
public sealed class VideoAsset
{
    /// <summary>The column length: it fits a catalog key and also the texts old rows stored.</summary>
    public const int MaxErrorLength = 500;

    public const string FolderName = "videos";

    // Constructor for EF Core.
    private VideoAsset()
    {
        Hash = string.Empty;
        Edit = null!;
        Sources = [];
    }

    public Guid Id { get; private set; }

    /// <summary>
    /// Identity of the asset: <see cref="HashOf"/> the original and the edit. The same file with the same edit is a
    /// single asset; with another trim or fade, another one. Videos processed before edits existed keep the hash of
    /// the original (and so their files on disk).
    /// </summary>
    public string Hash { get; private set; }

    /// <summary>Size as seen (with the rotation phones store already applied).</summary>
    public int Width { get; private set; }

    public int Height { get; private set; }

    public VideoEdit Edit { get; private set; }

    /// <summary>How long the final video lasts (already trimmed and, in loop, without the stretch that blends into the start).</summary>
    public double DurationSeconds => Edit.OutputSeconds;

    public VideoStatus Status { get; private set; }

    /// <summary>
    /// Why processing failed: a <see cref="MessageKeys"/> key (or, in rows from before the catalog, the Spanish text;
    /// see <see cref="StoredMessage"/>). Null if it did not fail.
    /// </summary>
    public string? Error { get; private set; }

    public Guid? PosterId { get; private set; }

    /// <summary>First useful frame, optimized by the image pipeline. It exists when the video is ready.</summary>
    public MediaAsset? Poster { get; private set; }

    public IReadOnlyList<VideoSource> Sources { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Size rule warnings (derived from the dimensions: not stored).</summary>
    public IReadOnlyList<UserMessage> Warnings => HeroFrame.WarningsFor(Width, Height);

    /// <param name="contentHash">SHA-256 of the original file.</param>
    /// <exception cref="DomainException">If it does not meet the hero size rule (the edit comes already validated).</exception>
    public static VideoAsset Create(string contentHash, int width, int height, VideoEdit edit, DateTime nowUtc)
    {
        HeroFrame.Ensure(width, height);

        return new VideoAsset
        {
            Id = Guid.CreateVersion7(),
            Hash = HashOf(contentHash, edit),
            Width = width,
            Height = height,
            Edit = edit,
            Status = VideoStatus.Processing,
            CreatedAtUtc = nowUtc,
        };
    }

    /// <summary>
    /// SHA-256 of the original's hash together with the edit: it is still a valid hash as a folder, and each edit of
    /// the same file has its own (their files do not overwrite each other). It is what is looked up so the same work is
    /// not processed twice.
    /// </summary>
    public static string HashOf(string contentHash, VideoEdit edit)
    {
        ContentHash.EnsureValid(contentHash);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{contentHash}/{edit.Key}")));
    }

    public void MarkReady(MediaAsset poster, IReadOnlyList<VideoSource> sources)
    {
        EnsureStatus(VideoStatus.Processing);
        if (sources.Count == 0)
        {
            throw new ArgumentException("A ready video has at least one source.", nameof(sources));
        }

        Poster = poster;
        PosterId = poster.Id;
        Sources = [.. sources];
        Status = VideoStatus.Ready;
    }

    /// <param name="errorKey">One of <see cref="MessageKeys"/>, without arguments: whoever shows it chooses the text.</param>
    /// <exception cref="ArgumentException">If it is not a catalog key (programming error).</exception>
    public void MarkFailed(string errorKey)
    {
        if (!MessageCatalog.Entries.ContainsKey(errorKey))
        {
            throw new ArgumentException($"\"{errorKey}\" is not a message catalog key.", nameof(errorKey));
        }

        EnsureStatus(VideoStatus.Processing);
        Error = errorKey;
        Status = VideoStatus.Failed;
    }

    /// <summary>
    /// Uploading a video again processes it again (the same content is the same asset) if it failed, or if it was ready
    /// but files are missing on disk. Meanwhile it looks like a freshly uploaded one: no error, no poster and no sources.
    /// </summary>
    public void Retry()
    {
        if (Status == VideoStatus.Processing)
        {
            throw new InvalidOperationException("The video is already processing.");
        }

        Error = null;
        Poster = null;
        PosterId = null;
        Sources = [];
        Status = VideoStatus.Processing;
    }

    /// <summary>Path of the file inside the media folder: videos/{hash}/{height}.{codec}.mp4.</summary>
    public string RelativePathOf(VideoVariant variant) => $"{FolderName}/{Hash}/{variant.Height}.{variant.CodecName}.mp4";

    public string UrlOf(VideoVariant variant) => WebUrl.MediaPrefix + RelativePathOf(variant);

    // The valid transitions are processing → ready | failed and ready | failed → processing; any other is a programming error.
    private void EnsureStatus(VideoStatus expected)
    {
        if (Status != expected)
        {
            throw new InvalidOperationException($"The video is {Status} and {expected} was expected.");
        }
    }
}
