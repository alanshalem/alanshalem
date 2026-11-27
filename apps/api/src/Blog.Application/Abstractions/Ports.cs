using Blog.Application.Posts;
using Blog.Domain;

namespace Blog.Application.Abstractions;

/// <summary>Post persistence. Implemented by Infrastructure.</summary>
public interface IPostRepository
{
    Task<Post?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>The slug is unique per language.</summary>
    Task<bool> SlugExistsAsync(string lang, string slug, Guid? excludingId, CancellationToken cancellationToken);

    /// <summary>Every version of the translation group, including the one of the requested post.</summary>
    Task<IReadOnlyList<PostTranslationDto>> ListVersionsAsync(Guid translationGroupId, CancellationToken cancellationToken);

    /// <summary>
    /// Every post, newest first, WITHOUT the body (the admin list does not need to load it) and with empty
    /// Translations: the service links the versions using the list itself.
    /// </summary>
    Task<IReadOnlyList<PostSummaryDto>> ListSummariesAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<Post>> ListPublishedAsync(CancellationToken cancellationToken);

    void Add(Post post);

    /// <summary>Deletes the post and, in cascade, its history.</summary>
    void Remove(Post post);

    /// <summary>Ids of the scheduled drafts whose time has come, from the most overdue to the most recent.</summary>
    Task<IReadOnlyList<Guid>> ListDueAsync(DateTime nowUtc, CancellationToken cancellationToken);

    // ----- History: part of the post (saved in the same SaveChanges and deleted with it) -----

    /// <summary>The number of the post's latest version; 0 if it has none.</summary>
    Task<int> LatestRevisionNumberAsync(Guid postId, CancellationToken cancellationToken);

    void AddRevision(PostRevision revision);

    /// <summary>Marks for deletion (on the next SaveChanges) the versions older than that number.</summary>
    Task RemoveRevisionsBeforeAsync(Guid postId, int number, CancellationToken cancellationToken);

    /// <summary>The post's versions, newest first, without the body.</summary>
    Task<IReadOnlyList<PostRevisionSummaryDto>> ListRevisionsAsync(Guid postId, CancellationToken cancellationToken);

    /// <summary>Null if it does not exist or belongs to another post.</summary>
    Task<PostRevision?> GetRevisionAsync(Guid postId, Guid revisionId, CancellationToken cancellationToken);

    /// <exception cref="ConflictException">
    /// If the slug already exists in that language or the group already has that version (race between two
    /// simultaneous saves).
    /// </exception>
    Task SaveChangesAsync(CancellationToken cancellationToken);
}

/// <summary>Persistence of the site settings (a single row). Implemented by Infrastructure.</summary>
public interface ISiteSettingsRepository
{
    /// <summary>The stored row, or null if nothing was saved from the admin yet.</summary>
    Task<SiteSettings?> GetAsync(CancellationToken cancellationToken);

    void Add(SiteSettings settings);

    Task SaveChangesAsync(CancellationToken cancellationToken);
}

public interface IClock
{
    DateTime UtcNow { get; }
}

/// <summary>
/// Tells the "builder" the static site must be regenerated. Must never throw: a builder that is down does not break the
/// save. Nor does it lose the request: if the builder does not accept it, it stays pending and is retried (handled by
/// Infrastructure).
/// </summary>
public interface ISiteBuildTrigger
{
    Task RequestBuildAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The epoch of the admin sessions: every session cookie carries the epoch current when it was issued, and only that
/// epoch gets in. Revoking raises it, so no cookie issued before is accepted again, not even a copied one. Implemented
/// by Infrastructure (persisted, cached in memory).
/// </summary>
public interface IAdminSessionEpoch
{
    /// <summary>Checked on every request with a session, so it must be cheap.</summary>
    ValueTask<int> CurrentAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Invalidates every session issued so far. Fails closed: if the new epoch is saved but anything after it fails,
    /// <see cref="CurrentAsync"/> never returns the revoked one again.
    /// </summary>
    Task RevokeAllAsync(CancellationToken cancellationToken);
}

/// <summary>Media files. Paths are built by the domain (<see cref="MediaAsset.RelativePathOf"/>), never by the user.</summary>
public interface IMediaStorage
{
    /// <summary>Saves (or replaces) the file at that path relative to the media folder, e.g. {hash}/640.webp.</summary>
    Task SaveAsync(string relativePath, ReadOnlyMemory<byte> content, CancellationToken cancellationToken);

    bool Exists(string relativePath);
}

/// <summary>Persistence of uploaded images. Implemented by Infrastructure.</summary>
public interface IMediaAssetRepository
{
    Task<MediaAsset?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    Task<MediaAsset?> GetByHashAsync(string hash, CancellationToken cancellationToken);

    /// <summary>All of them, from oldest to newest.</summary>
    Task<IReadOnlyList<MediaAsset>> ListAsync(CancellationToken cancellationToken);

    void Add(MediaAsset asset);

    /// <exception cref="ConflictException">If the same image finished uploading at the same time from elsewhere.</exception>
    Task SaveChangesAsync(CancellationToken cancellationToken);
}

/// <summary>Persistence of the hero gallery. Each photo is read with its <see cref="MediaAsset"/>.</summary>
public interface IHeroImageRepository
{
    Task<HeroImage?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>All of them, from oldest to newest: the first is the one the site shows without JavaScript.</summary>
    Task<IReadOnlyList<HeroImage>> ListAsync(CancellationToken cancellationToken);

    void Add(HeroImage image);

    void Remove(HeroImage image);

    Task SaveChangesAsync(CancellationToken cancellationToken);
}

/// <summary>Size of an image as seen (already rotated by its EXIF). For an animation, of one frame.</summary>
public sealed record ImageSize(int Width, int Height, int Pages)
{
    public bool IsAnimated => Pages > 1;

    /// <summary>All the frames: it is what it takes once decoded.</summary>
    public long Pixels => (long)Width * Height * Pages;
}

public sealed record EncodedVariant(MediaVariant Variant, byte[] Content);

/// <summary>What the pipeline produces: the files of each variant, the dominant color (#rrggbb) and the placeholder (data URI).</summary>
public sealed record ProcessedImage(IReadOnlyList<EncodedVariant> Files, string Color, string Placeholder);

/// <summary>Image pipeline (decode, rotate, strip metadata, encode). Implemented by Infrastructure with libvips.</summary>
public interface IImageProcessor
{
    /// <summary>Reads only the header, without decoding the pixels. Null if the bytes are not a readable image.</summary>
    ImageSize? ReadSize(byte[] image);

    /// <summary>
    /// Generates each requested variant without metadata and in sRGB, processing one image at a time.
    /// Null if the pixels cannot be decoded (damaged file).
    /// </summary>
    Task<ProcessedImage?> ProcessAsync(byte[] image, IReadOnlyList<MediaVariant> variants, CancellationToken cancellationToken);
}

/// <summary>Persistence of the hero videos. Each video is read with its poster.</summary>
public interface IVideoAssetRepository
{
    Task<VideoAsset?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    Task<VideoAsset?> GetByHashAsync(string hash, CancellationToken cancellationToken);

    /// <summary>
    /// Discards the unsaved changes of this scope and reads the video again as it is in the database. Used to record a
    /// failure starting from what is stored and not from a half-done state left in memory.
    /// </summary>
    Task<VideoAsset?> ReloadAsync(Guid id, CancellationToken cancellationToken);

    Task<IReadOnlyList<VideoAsset>> ListProcessingAsync(CancellationToken cancellationToken);

    void Add(VideoAsset video);

    /// <exception cref="ConflictException">If the same video finished uploading at the same time from elsewhere.</exception>
    Task SaveChangesAsync(CancellationToken cancellationToken);
}

/// <summary>Video original already copied to the work folder (outside /media: it carries audio and metadata).</summary>
/// <param name="Length">Bytes copied. If it exceeds the requested maximum, the copy stopped there and the file is incomplete.</param>
/// <param name="Head">The first bytes, to check the format by magic bytes.</param>
public sealed record StagedVideo(string Path, string Hash, long Length, byte[] Head)
{
    /// <summary>The magic bytes of MP4/MOV (ftyp box at byte 4) and of WebM/MKV fit in the first 8.</summary>
    public const int HeadLength = 8;
}

/// <summary>Work folder of the videos: originals waiting for their turn and ffmpeg outputs.</summary>
public interface IVideoStaging
{
    /// <summary>
    /// Copies the upload to a file of its own, computing the SHA-256 on the way (without loading it in memory). Copies
    /// at most maxBytes + 1: enough to know whether it went over.
    /// </summary>
    Task<StagedVideo> SaveAsync(Stream content, long maxBytes, CancellationToken cancellationToken);

    void Delete(string path);

    /// <summary>Deletes what was left by a previous run (originals and half-written outputs).</summary>
    void Clear();
}

/// <summary>A video waiting to be processed and where its original is.</summary>
public sealed record VideoJob(Guid VideoId, string SourcePath);

/// <summary>In-memory queue of videos to process. Consumed by a single background process, one at a time.</summary>
public interface IVideoQueue
{
    void Enqueue(VideoJob job);
}

/// <summary>Size as seen (with the rotation applied) and duration of a video.</summary>
public sealed record VideoProbe(int Width, int Height, double DurationSeconds);

public sealed record EncodedVideo(VideoVariant Variant, byte[] Content);

/// <summary>What the transcoder produces: each requested version and the poster (JPEG of a visible frame, not optimized).</summary>
public sealed record TranscodedVideo(IReadOnlyList<EncodedVideo> Files, byte[] Poster);

/// <summary>
/// The video could not be converted (ffmpeg failed or took too long). Its key is for the admin: it is stored as the
/// video's error. The adapter logs the technical details.
/// </summary>
/// <param name="key">One of <see cref="MessageKeys"/>, without arguments.</param>
public sealed class VideoProcessingException(string key) : UserMessageException(new UserMessage(key));

/// <summary>Video reading and conversion. Implemented by Infrastructure with ffprobe and ffmpeg.</summary>
public interface IVideoTranscoder
{
    /// <summary>Null if the file is not a readable video (no video track or no duration).</summary>
    Task<VideoProbe?> ProbeAsync(string sourcePath, CancellationToken cancellationToken);

    /// <summary>
    /// Generates each requested version (without audio or metadata) with the edit's trim and fade, and the poster of its
    /// first visible frame (<see cref="VideoEdit.FirstVisibleSecond"/>), without writing anything to /media.
    /// </summary>
    /// <exception cref="VideoProcessingException">If ffmpeg fails or exceeds the maximum time.</exception>
    Task<TranscodedVideo> TranscodeAsync(
        string sourcePath, IReadOnlyList<VideoVariant> variants, VideoEdit edit, CancellationToken cancellationToken);
}
