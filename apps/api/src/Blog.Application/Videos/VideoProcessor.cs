using Blog.Application.Abstractions;
using Blog.Application.Media;
using Blog.Domain;

namespace Blog.Application.Videos;

/// <summary>
/// Converts an already validated video: AV1 and H.264 versions without audio with its trim and fade, and the poster
/// through the image pipeline. Called by the background process, one video at a time.
/// </summary>
public sealed class VideoProcessor(
    IVideoTranscoder transcoder,
    IVideoStaging staging,
    IVideoAssetRepository videos,
    MediaService media,
    IMediaStorage storage)
{
    /// <remarks>
    /// An expected error (<see cref="ErrorKeyOf"/>) stays as the video's error. An unexpected one too, with a generic
    /// message, and it is also rethrown so the background process logs it with its details. A server shutdown is not
    /// recorded as a failure: the video stays "processing" and the next start resolves it.
    /// </remarks>
    /// <exception cref="AggregateException">If the failure could not be saved either: carries the original error and the save error.</exception>
    public async Task ProcessAsync(VideoJob job, CancellationToken cancellationToken)
    {
        try
        {
            var video = await videos.GetByIdAsync(job.VideoId, cancellationToken);
            if (video is { Status: VideoStatus.Processing })
            {
                await ConvertAsync(video, job.SourcePath, cancellationToken);
            }
        }
        catch (Exception error) when (!IsShutdown(error, cancellationToken))
        {
            await RecordFailureAsync(job.VideoId, error);
            if (ErrorKeyOf(error) == MessageKeys.VideoProcessingUnexpected)
            {
                throw;
            }
        }
        finally
        {
            staging.Delete(job.SourcePath);
        }
    }

    /// <summary>
    /// On start: the queue lives in memory, so a video left "processing" has nobody left to process it. It is marked as
    /// failed (the admin uploads it again and it is reprocessed) and what was left in the work folder is deleted. It is
    /// simpler and more predictable than requeueing: the originals do not need to survive a restart.
    /// </summary>
    public async Task FailInterruptedAsync(CancellationToken cancellationToken)
    {
        foreach (var video in await videos.ListProcessingAsync(cancellationToken))
        {
            video.MarkFailed(MessageKeys.VideoProcessingInterrupted);
        }

        await videos.SaveChangesAsync(cancellationToken);
        staging.Clear();
    }

    private async Task ConvertAsync(VideoAsset video, string sourcePath, CancellationToken cancellationToken)
    {
        // Everything is generated first in the work folder: if ffmpeg fails, no half-written file reaches /media.
        var transcoded = await transcoder.TranscodeAsync(sourcePath, VideoVariant.For(video.Height), video.Edit, cancellationToken);

        await using var posterContent = new MemoryStream(transcoded.Poster);
        var poster = await media.StoreImageAsync(posterContent, cancellationToken);

        // Files first and the status afterwards: a "ready" video never points to files that do not exist.
        foreach (var file in transcoded.Files)
        {
            await storage.SaveAsync(video.RelativePathOf(file.Variant), file.Content, cancellationToken);
        }

        video.MarkReady(poster, [.. transcoded.Files.Select(file => new VideoSource(file.Variant.Codec, file.Variant.Height, file.Content.Length))]);
        await videos.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// What the admin is told. ffmpeg carries its reason; a broken image rule here can only come from the poster (ffmpeg
    /// generates it and the image pipeline processes it), and the way out is the same: export the video again.
    /// Any other error is a defect or a server failure.
    /// </summary>
    private static string ErrorKeyOf(Exception error) => error switch
    {
        VideoProcessingException processing => processing.UserMessage.Key,
        DomainException => MessageKeys.VideoPosterFailed,
        _ => MessageKeys.VideoProcessingUnexpected,
    };

    private static bool IsShutdown(Exception error, CancellationToken cancellationToken) =>
        error is OperationCanceledException && cancellationToken.IsCancellationRequested;

    /// <summary>
    /// Saves the failure starting from what is in the database, not from the video in memory: if the error happened
    /// while saving after MarkReady, in memory it is already ready and marking it failed would throw another exception
    /// hiding the original one.
    /// </summary>
    /// <exception cref="AggregateException">
    /// If it cannot be saved: with both errors, so the original one is logged and not only the save error. The video
    /// stays "processing" and the next start resolves it (<see cref="FailInterruptedAsync"/>).
    /// </exception>
    private async Task RecordFailureAsync(Guid videoId, Exception error)
    {
        try
        {
            // No cancellation: the failure is saved even if the shutdown starts right then.
            var video = await videos.ReloadAsync(videoId, CancellationToken.None);
            if (video is { Status: VideoStatus.Processing })
            {
                video.MarkFailed(ErrorKeyOf(error));
                await videos.SaveChangesAsync(CancellationToken.None);
            }
        }
        catch (Exception saveError)
        {
            throw new AggregateException($"Could not save the failure of video {videoId}.", error, saveError);
        }
    }
}
