using System.Text.Json;
using Blog.Application.Abstractions;
using Blog.Application.Videos;
using Blog.Domain;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Tests;

/// <summary>
/// Real ffmpeg and ffprobe (they must be on the PATH) on small clips generated on the spot. These are the slow tests:
/// they can be filtered out with --filter "Category!=Ffmpeg", but they are the ones that really test the adapter.
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
        await File.WriteAllBytesAsync(path, TestVideos.Fake("there is no video here"));

        Assert.Null(await Transcoder(database).ProbeAsync(path, default));
    }

    [Fact]
    public async Task A_720p_clip_with_audio_becomes_silent_av1_and_h264_at_720p_only_with_a_poster()
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        var clip = await TestVideos.GenerateAsync(ScratchPath(database, "clip.mp4"), 1280, 720, seconds: 3);
        Assert.Contains(Streams(await TestVideos.ProbeAsync(clip)), stream => stream.GetProperty("codec_type").GetString() == "audio");

        var uploaded = await UploadAsync(database, clip);
        await ProcessAsync(database, Assert.Single(queue.Jobs));

        var video = await database.WithVideosAsync(videos => videos.GetAsync(uploaded.Id, default));
        Assert.Equal(VideoStatus.Ready, video.Status);
        Assert.Null(video.Error);
        // No edit fields: the whole video (shorter than 15 s) with a 1 s loop.
        Assert.Equal((0, VideoFade.Loop, 1), (video.Edit.TrimStart, video.Edit.Fade, video.Edit.FadeSeconds));
        Assert.InRange(video.Edit.TrimEnd, 2.9, 3.1);
        Assert.Equal(video.Edit.TrimEnd - 1, video.DurationSeconds, precision: 3);
        // Never enlarged: a 720p original does not produce a 1080p version.
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
        var edit = new VideoEditInput(null, null, "none", null);

        var uploaded = await UploadAsync(database, clip, edit);
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

    [Theory]
    [InlineData("0", "16", "El tramo elegido dura 16 s y el máximo es 15 s. Acortalo y volvé a subirlo.")]
    [InlineData("10", "16.5", "El fin del recorte (16,5 s) pasa el final del video, que dura 16 s.")]
    public async Task A_trim_too_long_or_past_the_real_end_measured_by_ffprobe_is_rejected_on_upload(
        string trimStart, string trimEnd, string expectedMessage)
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        var clip = await TestVideos.GenerateAsync(ScratchPath(database, "largo.mp4"), 1280, 720, seconds: 16, fps: 10, audio: false);

        var error = await Assert.ThrowsAsync<DomainException>(() =>
            UploadAsync(database, clip, new VideoEditInput(trimStart, trimEnd, null, null)));

        Assert.Equal(expectedMessage, error.Message);
        Assert.Empty(queue.Jobs);
        Assert.Empty(database.VideoWorkFiles());
        Assert.Empty(await database.ListAsync("SELECT Id FROM video_assets"));
    }

    [Fact]
    public async Task The_trim_is_exact_to_the_frame_and_without_fade_the_wrap_is_a_visible_cut()
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        var clip = await TestVideos.GeneratePanAsync(ScratchPath(database, "pan.mp4"), 1280, 720, seconds: 6);

        var video = await UploadAndProcessAsync(database, queue, clip, new VideoEditInput("1.5", "4.5", "none", null));

        Assert.Equal(new VideoEditDto(1.5, 4.5, VideoFade.None, 1), video.Edit);
        Assert.Equal(3, video.DurationSeconds);
        var output = OutputPath(database, video.Sources.Single(source => source.Codec == VideoCodec.H264));
        Assert.InRange(await TestVideos.FrameCountAsync(output), 89, 91);
        // It starts at frame 45 of the original (1.5 s at 30 fps): it looks more like that one than like its neighbors.
        var atStart = await TestVideos.PsnrAsync(output, 0, clip, 45);
        Assert.True(atStart > await TestVideos.PsnrAsync(output, 0, clip, 42), $"PSNR against frame 45: {atStart}");
        Assert.True(atStart > await TestVideos.PsnrAsync(output, 0, clip, 48), $"PSNR against frame 45: {atStart}");
        // Without a fade, from the last frame to the first there is a 3 s jump: much more different than two neighboring frames.
        var adjacent = await TestVideos.PsnrAsync(output, 44, output, 45);
        var wrap = await TestVideos.PsnrAsync(output, 89, output, 0);
        Assert.True(wrap < adjacent - 10, $"vecinos: {adjacent} dB, vuelta: {wrap} dB");
    }

    [Fact]
    public async Task Loop_blends_the_end_into_the_start_so_the_last_frame_continues_into_the_first()
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        var clip = await TestVideos.GeneratePanAsync(ScratchPath(database, "pan.mp4"), 1280, 720, seconds: 6);

        var video = await UploadAndProcessAsync(database, queue, clip, new VideoEditInput("1", "5", "loop", "1"));

        Assert.Equal(new VideoEditDto(1, 5, VideoFade.Loop, 1), video.Edit);
        // The trim lasts 4 s; the last second overlaps the start: 3 s are left.
        Assert.Equal(3, video.DurationSeconds);
        foreach (var source in video.Sources)
        {
            var output = OutputPath(database, source);
            Assert.InRange(await TestVideos.FrameCountAsync(output), 89, 91);
            // When it repeats, from the last frame to the first the change is the same as between two neighboring frames: no jump.
            var adjacent = await TestVideos.PsnrAsync(output, 44, output, 45);
            var wrap = await TestVideos.PsnrAsync(output, 89, output, 0);
            Assert.True(wrap > adjacent - 3, $"{source.Url}: vecinos {adjacent} dB, vuelta {wrap} dB");
        }
    }

    [Fact]
    public async Task Black_fades_in_from_and_out_to_black_and_the_poster_is_a_visible_frame()
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        var clip = await TestVideos.GeneratePanAsync(ScratchPath(database, "pan.mp4"), 1280, 720, seconds: 4);

        var video = await UploadAndProcessAsync(database, queue, clip, new VideoEditInput("0.5", "3.5", "black", "0.5"));

        Assert.Equal(new VideoEditDto(0.5, 3.5, VideoFade.Black, 0.5), video.Edit);
        Assert.Equal(3, video.DurationSeconds);
        var output = OutputPath(database, video.Sources.Single(source => source.Codec == VideoCodec.H264));
        Assert.InRange(await TestVideos.FrameCountAsync(output), 89, 91);
        const double NearBlack = 20; // video black is 16
        Assert.InRange(await TestVideos.MeanLumaAsync(output, 0), 0, NearBlack);
        Assert.InRange(await TestVideos.MeanLumaAsync(output, 89), 0, NearBlack + 5);
        Assert.True(await TestVideos.MeanLumaAsync(output, 45) > 60, "The middle of the video should not be dark.");
        // The poster is taken after the fade-in: the pattern shows, not black.
        var poster = Path.Combine(database.MediaDirectory, video.Poster!.Url[WebUrl.MediaPrefix.Length..]);
        Assert.True(await TestVideos.MeanLumaAsync(poster, 0) > 60, "The poster should not be dark.");
    }

    [Fact]
    public async Task The_poster_never_comes_from_footage_after_the_trim_end()
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        // At 10 fps the poster candidate frames cover 1.5 s: from the first visible frame (1.5 s, after the 0.5 s fade)
        // they would reach the white that starts right where the trim ends (2 s), and would be the majority.
        var clip = await TestVideos.GenerateHardCutAsync(ScratchPath(database, "corte.mp4"), 1280, 720, cutAtSeconds: 2, seconds: 4, fps: 10);

        var video = await UploadAndProcessAsync(database, queue, clip, new VideoEditInput("1", "2", "loop", "0.5"));

        var poster = Path.Combine(database.MediaDirectory, video.Poster!.Url[WebUrl.MediaPrefix.Length..]);
        var luma = await TestVideos.MeanLumaAsync(poster, 0);
        Assert.True(luma < 100, $"The poster came from the white after the trim (luminance {luma}).");
    }

    [Fact]
    public async Task The_bitrate_cap_keeps_a_very_noisy_clip_small()
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        // 8 s, like a typical hero video: the H.264 ceiling allows going over by at most one buffer (1 s) in the whole
        // clip, and in a very short one that buffer would weigh more than the 10 % margin.
        var clip = await TestVideos.GenerateNoisyAsync(ScratchPath(database, "ruido.mp4"), 1280, 720, seconds: 8);

        var video = await UploadAndProcessAsync(database, queue, clip, new VideoEditInput(null, null, "none", null));

        Assert.Equal(VideoStatus.Ready, video.Status);
        foreach (var source in video.Sources)
        {
            var capKbps = source.Codec == VideoCodec.Av1 ? 1200 : 1920;
            var maxBytes = capKbps * 1000 / 8 * video.DurationSeconds * 1.1;
            Assert.True(source.Bytes <= maxBytes, $"{source.Url}: {source.Bytes} bytes, tope {maxBytes:0}");
        }
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

    // Next to the database (not in the video work folder, which the test checks is empty at the end).
    private static string ScratchPath(SqliteTestDatabase database, string name) =>
        Path.Combine(Path.GetDirectoryName(database.FilePath)!, name);

    private static Task<VideoAssetDto> UploadAsync(SqliteTestDatabase database, string path, VideoEditInput? edit = null) =>
        database.WithVideosAsync(async videos =>
        {
            await using var stream = File.OpenRead(path);
            return await videos.UploadAsync(stream, edit ?? VideoEditInput.Empty, default);
        });

    private static async Task<VideoAssetDto> UploadAndProcessAsync(
        SqliteTestDatabase database, RecordingVideoQueue queue, string clip, VideoEditInput edit)
    {
        var uploaded = await UploadAsync(database, clip, edit);
        await ProcessAsync(database, Assert.Single(queue.Jobs));
        var video = await database.WithVideosAsync(videos => videos.GetAsync(uploaded.Id, default));
        Assert.Equal(VideoStatus.Ready, video.Status);
        return video;
    }

    private static string OutputPath(SqliteTestDatabase database, VideoSourceDto source) =>
        Path.Combine(database.MediaDirectory, source.Url[WebUrl.MediaPrefix.Length..]);


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
        // +faststart: the index (moov) goes before the data (mdat), so the browser starts playing right away.
        Assert.True(bytes.AsSpan().IndexOf("moov"u8) < bytes.AsSpan().IndexOf("mdat"u8), $"{source.Url} has no faststart.");

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
