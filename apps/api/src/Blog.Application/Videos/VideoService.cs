using Blog.Application.Abstractions;
using Blog.Application.Media;
using Blog.Domain;

namespace Blog.Application.Videos;

/// <summary>
/// Video upload for the hero. Validates right away (format, file size, trim and fade, hero size rule) and leaves the
/// video "processing" so <see cref="VideoProcessor"/> converts it in the background: converting takes minutes and the
/// HTTP request cannot wait that long.
/// </summary>
public sealed class VideoService(
    IVideoStaging staging,
    IVideoTranscoder transcoder,
    IVideoQueue queue,
    IVideoAssetRepository videos,
    IMediaStorage storage,
    IClock clock)
{
    public const long MaxBytes = 200L * 1024 * 1024;

    public async Task<VideoAssetDto> UploadAsync(Stream content, VideoEditInput edit, CancellationToken cancellationToken)
    {
        var staged = await staging.SaveAsync(content, MaxBytes, cancellationToken);
        var queued = false;
        try
        {
            if (staged.Length > MaxBytes)
            {
                throw new DomainException(MessageKeys.VideoTooLarge, ("max", MaxBytes / (1024 * 1024)));
            }

            if (!VideoSniffer.IsSupportedContainer(staged.Head))
            {
                throw new DomainException(MessageKeys.VideoUnsupportedFormat);
            }

            // The edit is validated against the original's real duration, so it is read with ffprobe first.
            var probe = await transcoder.ProbeAsync(staged.Path, cancellationToken)
                ?? throw new DomainException(MessageKeys.VideoUnreadable);
            var validEdit = edit.ToEdit(probe.DurationSeconds);

            // Same video with the same edit = same hash = same asset: if it already exists (or is processing) it is
            // returned as is, unless it has to be processed again (see NeedsProcessingAgain).
            var existing = await videos.GetByHashAsync(VideoAsset.HashOf(staged.Hash, validEdit), cancellationToken);
            if (existing is not null && !NeedsProcessingAgain(existing))
            {
                return existing.ToDto();
            }

            var video = existing ?? VideoAsset.Create(staged.Hash, probe.Width, probe.Height, validEdit, clock.UtcNow);
            if (existing is null)
            {
                videos.Add(video);
            }
            else
            {
                existing.Retry();
            }

            await videos.SaveChangesAsync(cancellationToken);
            queue.Enqueue(new VideoJob(video.Id, staged.Path));
            queued = true;
            return video.ToDto();
        }
        finally
        {
            // The original is kept only if it entered the queue: a rejection or a duplicate leaves nothing on disk.
            if (!queued)
            {
                staging.Delete(staged.Path);
            }
        }
    }

    public async Task<VideoAssetDto> GetAsync(Guid id, CancellationToken cancellationToken) =>
        (await videos.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException(MessageKeys.VideoNotFound)).ToDto();

    // One that failed, so the admin always has a way out: upload it again. And a ready one missing some file (source or
    // poster), the same as with images: otherwise the site would point to files that do not exist. The freshly uploaded
    // original is the one queued: it is the same content.
    private bool NeedsProcessingAgain(VideoAsset video) => video.Status switch
    {
        VideoStatus.Failed => true,
        VideoStatus.Ready => !storage.HasAllFiles(video),
        _ => false,
    };
}
