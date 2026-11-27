using Blog.Application.Abstractions;
using Blog.Application.Videos;
using Blog.Domain;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Tests;

/// <summary>Queue and background process as AddInfrastructure registers them, with simulated ffmpeg.</summary>
public class VideoProcessingTests
{
    private static readonly TimeSpan WaitLimit = TimeSpan.FromSeconds(30);

    [Fact]
    public async Task The_worker_processes_one_video_at_a_time_and_records_a_failure_without_files()
    {
        var transcoder = new FakeVideoTranscoder();
        await using var database = new SqliteTestDatabase(services => services.AddSingleton<IVideoTranscoder>(transcoder));
        await database.InitializeAsync();
        Guid[] ids;
        var failingContent = TestVideos.Fake("FAIL primero");

        // The worker starts first (as in the API, before accepting requests); uploads are queued while it processes.
        await database.VideoWorker.StartAsync(default);
        try
        {
            var failing = await UploadAsync(database, failingContent);
            var second = await UploadAsync(database, TestVideos.Fake("segundo"));
            var third = await UploadAsync(database, TestVideos.Fake("tercero"));
            ids = [failing.Id, second.Id, third.Id];
            await WaitUntilProcessedAsync(database, ids);
        }
        finally
        {
            await database.VideoWorker.StopAsync(default);
        }

        Assert.Equal(3, transcoder.Transcodes);
        Assert.Equal(1, transcoder.MaxConcurrent);
        // Each video is processed with the edit that was stored (no fields: the 10 s original with a 1 s loop).
        Assert.All(transcoder.Edits, edit => Assert.Equal(VideoEdit.DefaultFor(10), edit));

        var failed = await GetAsync(database, ids[0]);
        Assert.Equal(VideoStatus.Failed, failed.Status);
        Assert.Equal(MessageKeys.VideoProcessingFailed, failed.Error?.Value);
        Assert.Null(failed.Poster);
        Assert.Empty(failed.Sources);

        foreach (var id in ids[1..])
        {
            var ready = await GetAsync(database, id);
            Assert.Equal(VideoStatus.Ready, ready.Status);
            Assert.Null(ready.Error);
            Assert.NotNull(ready.Poster);
            Assert.Equal((1920, 1080), (ready.Poster.Width, ready.Poster.Height));
            Assert.Equal(
                VideoVariant.For(1080).Select(variant => (variant.Codec, variant.Height)),
                ready.Sources.Select(source => (source.Codec, source.Height)));
            Assert.All(ready.Sources, source =>
                Assert.Equal(source.Bytes, new FileInfo(Path.Combine(database.MediaDirectory, source.Url[WebUrl.MediaPrefix.Length..])).Length));
        }

        var videoFiles = database.MediaFiles().Where(file => file.StartsWith("videos/", StringComparison.Ordinal)).ToList();
        Assert.Equal(8, videoFiles.Count);
        var failingHash = VideoAsset.HashOf(
            Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(failingContent)), VideoEdit.DefaultFor(10));
        Assert.DoesNotContain(videoFiles, file => file.Contains(failingHash, StringComparison.Ordinal));
        Assert.Empty(database.VideoWorkFiles());
    }

    [Fact]
    public async Task On_restart_videos_left_processing_are_marked_failed_and_the_work_folder_is_cleared()
    {
        await using var database = new SqliteTestDatabase(services => services.AddSingleton<IVideoTranscoder>(new FakeVideoTranscoder()));
        await database.InitializeAsync();
        // As an interruption half way leaves it: the row "processing" and its original in the work folder, but the
        // queue (in memory) empty.
        var interrupted = await database.InScopeAsync(async provider =>
        {
            var videos = provider.GetRequiredService<IVideoAssetRepository>();
            var video = VideoAsset.Create(new string('d', MediaAsset.HashLength), 1920, 1080, VideoEdit.DefaultFor(10), database.Clock.UtcNow);
            videos.Add(video);
            await videos.SaveChangesAsync(default);
            return video;
        });
        Directory.CreateDirectory(database.VideoWorkDirectory);
        await File.WriteAllBytesAsync(Path.Combine(database.VideoWorkDirectory, "orphan.source"), [1, 2, 3]);
        Directory.CreateDirectory(Path.Combine(database.VideoWorkDirectory, "salida-a-medias"));

        await database.VideoWorker.StartAsync(default);
        await database.VideoWorker.StopAsync(default);

        var failed = await GetAsync(database, interrupted.Id);
        Assert.Equal(VideoStatus.Failed, failed.Status);
        Assert.Equal(MessageKeys.VideoProcessingInterrupted, failed.Error?.Value);
        Assert.Equal("Se interrumpió el procesamiento porque el servidor se reinició. Volvé a subir el video.", failed.Error?.In(Language.Spanish));
        Assert.Empty(database.VideoWorkFiles());
    }

    private static Task<VideoAssetDto> UploadAsync(SqliteTestDatabase database, byte[] content) =>
        database.WithVideosAsync(async videos =>
        {
            await using var stream = new MemoryStream(content);
            return await videos.UploadAsync(stream, VideoEditInput.Empty, default);
        });

    private static Task<VideoAssetDto> GetAsync(SqliteTestDatabase database, Guid id) =>
        database.WithVideosAsync(videos => videos.GetAsync(id, default));

    private static async Task WaitUntilProcessedAsync(SqliteTestDatabase database, params Guid[] ids)
    {
        using var timeout = new CancellationTokenSource(WaitLimit);
        foreach (var id in ids)
        {
            while ((await GetAsync(database, id)).Status == VideoStatus.Processing)
            {
                await Task.Delay(20, timeout.Token);
            }
        }
    }
}
