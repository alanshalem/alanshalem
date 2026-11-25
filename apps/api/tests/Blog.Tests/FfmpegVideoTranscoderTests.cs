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
        var clip = await TestVideos.GenerateAsync(ScratchPath(database, "clip.mp4"), 1280, 720, seconds: 3);
        Assert.Contains(Streams(await TestVideos.ProbeAsync(clip)), stream => stream.GetProperty("codec_type").GetString() == "audio");

        var uploaded = await UploadAsync(database, clip);
        await ProcessAsync(database, Assert.Single(queue.Jobs));

        var video = await database.WithVideosAsync(videos => videos.GetAsync(uploaded.Id, default));
        Assert.Equal(VideoStatus.Ready, video.Status);
        Assert.Null(video.Error);
        // Sin campos de edición: el video entero (dura menos de 15 s) con loop de 1 s.
        Assert.Equal((0, VideoFade.Loop, 1), (video.Edit.TrimStart, video.Edit.Fade, video.Edit.FadeSeconds));
        Assert.InRange(video.Edit.TrimEnd, 2.9, 3.1);
        Assert.Equal(video.Edit.TrimEnd - 1, video.DurationSeconds, precision: 3);
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
        // Empieza en el cuadro 45 del original (1,5 s a 30 fps): se parece más a ese que a sus vecinos.
        var atStart = await TestVideos.PsnrAsync(output, 0, clip, 45);
        Assert.True(atStart > await TestVideos.PsnrAsync(output, 0, clip, 42), $"PSNR con el cuadro 45: {atStart}");
        Assert.True(atStart > await TestVideos.PsnrAsync(output, 0, clip, 48), $"PSNR con el cuadro 45: {atStart}");
        // Sin fundido, del último cuadro al primero hay un salto de 3 s: mucho más distinto que dos cuadros vecinos.
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
        // El recorte dura 4 s; el último segundo se superpone con el principio: quedan 3 s.
        Assert.Equal(3, video.DurationSeconds);
        foreach (var source in video.Sources)
        {
            var output = OutputPath(database, source);
            Assert.InRange(await TestVideos.FrameCountAsync(output), 89, 91);
            // Al repetirse, del último cuadro al primero cambia lo mismo que entre dos cuadros vecinos: no hay salto.
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
        const double NearBlack = 20; // el negro de video es 16
        Assert.InRange(await TestVideos.MeanLumaAsync(output, 0), 0, NearBlack);
        Assert.InRange(await TestVideos.MeanLumaAsync(output, 89), 0, NearBlack + 5);
        Assert.True(await TestVideos.MeanLumaAsync(output, 45) > 60, "El medio del video no debería estar oscuro.");
        // El póster se toma después del fundido de entrada: se ve el patrón, no negro.
        var poster = Path.Combine(database.MediaDirectory, video.Poster!.Url[WebUrl.MediaPrefix.Length..]);
        Assert.True(await TestVideos.MeanLumaAsync(poster, 0) > 60, "El póster no debería estar oscuro.");
    }

    [Fact]
    public async Task The_poster_never_comes_from_footage_after_the_trim_end()
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        // A 10 fps los cuadros candidatos al póster cubren 1,5 s: desde el primer cuadro visible (1,5 s, tras el fundido
        // de 0,5 s) llegarían al blanco que empieza justo donde termina el recorte (2 s), y serían mayoría.
        var clip = await TestVideos.GenerateHardCutAsync(ScratchPath(database, "corte.mp4"), 1280, 720, cutAtSeconds: 2, seconds: 4, fps: 10);

        var video = await UploadAndProcessAsync(database, queue, clip, new VideoEditInput("1", "2", "loop", "0.5"));

        var poster = Path.Combine(database.MediaDirectory, video.Poster!.Url[WebUrl.MediaPrefix.Length..]);
        var luma = await TestVideos.MeanLumaAsync(poster, 0);
        Assert.True(luma < 100, $"El póster salió del blanco posterior al recorte (luminancia {luma}).");
    }

    [Fact]
    public async Task The_bitrate_cap_keeps_a_very_noisy_clip_small()
    {
        var queue = new RecordingVideoQueue();
        await using var database = await CreateDatabaseAsync(queue);
        // 8 s, como un video de hero típico: el techo de H.264 admite pasarse a lo sumo un búfer (1 s) en todo el clip,
        // y en uno muy corto ese búfer pesaría más que el margen del 10 %.
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

    // Junto a la base (no en la carpeta de trabajo de video, que la prueba verifica vacía al final).
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
