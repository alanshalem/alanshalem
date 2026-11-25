using System.Text.Json;
using Blog.Application.Abstractions;
using Blog.Application.Videos;
using Blog.Domain;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Tests;

/// <summary>
/// ffmpeg y ffprobe reales (deben estar en el PATH) sobre clips chicos generados en el momento. Son las pruebas
/// lentas: se pueden filtrar con --filter "Category!=Ffmpeg", pero son las que prueban el adaptador de verdad.
/// </summary>
[Trait("Category", "Ffmpeg")]
public class FfmpegVideoTranscoderTests
{
    [Fact]
    public async Task Probe_reads_the_size_and_duration_of_a_real_clip()
    {
        await using var database = await CreateDatabaseAsync();
        var clip = await TestVideos.GenerateAsync(ScratchPath(database, "clip.mp4"), 1280, 720, seconds: 2);

        var probe = await Transcoder(database).ProbeAsync(clip, default);

        Assert.NotNull(probe);
        Assert.Equal((1280, 720), (probe.Width, probe.Height));
        Assert.InRange(probe.DurationSeconds, 1.9, 2.2);
    }

    [Fact]
    public async Task Probe_reports_the_size_as_displayed_when_the_clip_carries_a_rotation()
    {
        await using var database = await CreateDatabaseAsync();
        var clip = await TestVideos.GenerateAsync(ScratchPath(database, "girado.mp4"), 1280, 720, seconds: 1, displayRotation: 90);

        var probe = await Transcoder(database).ProbeAsync(clip, default);

        Assert.Equal((720, 1280), (probe!.Width, probe.Height));
    }

    [Fact]
    public async Task Probe_returns_null_for_a_file_that_only_looks_like_a_video()
    {
        await using var database = await CreateDatabaseAsync();
        var path = ScratchPath(database, "falso.mp4");
        await File.WriteAllBytesAsync(path, TestVideos.Fake("no hay ningún video acá"));

        Assert.Null(await Transcoder(database).ProbeAsync(path, default));
    }

    [Fact]
    public async Task A_720p_clip_with_audio_becomes_silent_av1_and_h264_at_720p_only_with_a_poster()
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        var clip = await TestVideos.GenerateAsync(ScratchPath(database, "clip.mp4"), 1280, 720, seconds: 2);
        Assert.Contains(Streams(await TestVideos.ProbeAsync(clip)), stream => stream.GetProperty("codec_type").GetString() == "audio");

        var uploaded = await UploadAsync(database, clip);
        await ProcessAsync(database, Assert.Single(queue.Jobs));

        var video = await database.WithVideosAsync(videos => videos.GetAsync(uploaded.Id, default));
        Assert.Equal(VideoStatus.Ready, video.Status);
        Assert.Null(video.Error);
        // Nunca se agranda: de un original de 720p no sale una versión de 1080p.
        Assert.Equal([(VideoCodec.Av1, 720), (VideoCodec.H264, 720)], video.Sources.Select(source => (source.Codec, source.Height)));
        foreach (var source in video.Sources)
        {
            await AssertOutputAsync(database, source, expectedWidth: 1280, expectedFps: "30/1");
        }

        Assert.NotNull(video.Poster);
        Assert.Equal((1280, 720), (video.Poster.Width, video.Poster.Height));
        Assert.All(video.Poster.Variants, variant =>
            Assert.True(File.Exists(Path.Combine(database.MediaDirectory, variant.Url[WebUrl.MediaPrefix.Length..])), variant.Url));
        Assert.Empty(database.VideoWorkFiles());
    }

    [Fact]
    public async Task A_1080p_60fps_clip_gets_both_heights_at_30fps()
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        var clip = await TestVideos.GenerateAsync(ScratchPath(database, "clip60.mp4"), 1920, 1080, seconds: 1, fps: 60);

        var uploaded = await UploadAsync(database, clip);
        await ProcessAsync(database, Assert.Single(queue.Jobs));

        var video = await database.WithVideosAsync(videos => videos.GetAsync(uploaded.Id, default));
        Assert.Equal(VideoStatus.Ready, video.Status);
        Assert.Equal(
            [(VideoCodec.Av1, 720), (VideoCodec.Av1, 1080), (VideoCodec.H264, 720), (VideoCodec.H264, 1080)],
            video.Sources.Select(source => (source.Codec, source.Height)));
        foreach (var source in video.Sources)
        {
            await AssertOutputAsync(database, source, expectedWidth: source.Height == 1080 ? 1920 : 1280, expectedFps: "30/1");
        }

        Assert.Equal((1920, 1080), (video.Poster!.Width, video.Poster.Height));
    }

    [Fact]
    public async Task A_real_clip_longer_than_15_seconds_is_rejected_on_upload()
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        var clip = await TestVideos.GenerateAsync(ScratchPath(database, "largo.mp4"), 1280, 720, seconds: 16, fps: 10, audio: false);

        var error = await Assert.ThrowsAsync<DomainException>(() => UploadAsync(database, clip));

        Assert.Equal("El video dura 16 s y el máximo es 15 s. Recortalo y volvé a subirlo.", error.Message);
        Assert.Empty(queue.Jobs);
        Assert.Empty(database.VideoWorkFiles());
        Assert.Empty(await database.ListAsync("SELECT Id FROM video_assets"));
    }

    private static async Task<SqliteTestDatabase> CreateDatabaseAsync(RecordingVideoQueue? queue = null)
    {
        var database = new SqliteTestDatabase(services =>
        {
            if (queue is not null)
            {
                services.AddSingleton<IVideoQueue>(queue);
            }
        });
        await database.InitializeAsync();
        return database;
    }

    private static IVideoTranscoder Transcoder(SqliteTestDatabase database) => database.Services.GetRequiredService<IVideoTranscoder>();

    // Junto a la base (no en la carpeta de trabajo de video, que la prueba verifica vacía al final).
    private static string ScratchPath(SqliteTestDatabase database, string name) =>
        Path.Combine(Path.GetDirectoryName(database.FilePath)!, name);

    private static Task<VideoAssetDto> UploadAsync(SqliteTestDatabase database, string path) =>
        database.WithVideosAsync(async videos =>
        {
            await using var stream = File.OpenRead(path);
            return await videos.UploadAsync(stream, default);
        });

    private static Task ProcessAsync(SqliteTestDatabase database, VideoJob job) =>
        database.WithVideoProcessorAsync(async processor =>
        {
            await processor.ProcessAsync(job, default);
            return true;
        });

    private static IEnumerable<JsonElement> Streams(JsonElement probe) => probe.GetProperty("streams").EnumerateArray();

    private static async Task AssertOutputAsync(SqliteTestDatabase database, VideoSourceDto source, int expectedWidth, string expectedFps)
    {
        var path = Path.Combine(database.MediaDirectory, source.Url[WebUrl.MediaPrefix.Length..]);
        var bytes = await File.ReadAllBytesAsync(path);
        Assert.Equal(source.Bytes, bytes.Length);
        // +faststart: el índice (moov) va antes que los datos (mdat), así el navegador empieza a reproducir enseguida.
        Assert.True(bytes.AsSpan().IndexOf("moov"u8) < bytes.AsSpan().IndexOf("mdat"u8), $"{source.Url} no tiene faststart.");

        var stream = Assert.Single(Streams(await TestVideos.ProbeAsync(path)));
        Assert.Equal("video", stream.GetProperty("codec_type").GetString());
        Assert.Equal(source.Codec == VideoCodec.Av1 ? "av1" : "h264", stream.GetProperty("codec_name").GetString());
        Assert.Equal((expectedWidth, source.Height), (stream.GetProperty("width").GetInt32(), stream.GetProperty("height").GetInt32()));
        Assert.Equal("yuv420p", stream.GetProperty("pix_fmt").GetString());
        Assert.Equal(expectedFps, stream.GetProperty("avg_frame_rate").GetString());
        if (source.Codec == VideoCodec.H264)
        {
            Assert.Equal("High", stream.GetProperty("profile").GetString());
        }
    }
}
