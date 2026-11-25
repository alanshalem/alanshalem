using Blog.Application;
using Blog.Application.Abstractions;
using Blog.Application.Videos;
using Blog.Domain;
using Microsoft.Extensions.DependencyInjection;

namespace Blog.Tests;

/// <summary>Subida de videos con ffmpeg simulado: base SQLite real y carpeta de trabajo real, sin proceso en segundo plano.</summary>
public class VideoServiceTests
{
    private const string UnsupportedMessage = "Formato no soportado. Subí un video MP4, MOV, WebM o MKV.";

    [Fact]
    public async Task Upload_stores_a_processing_video_and_queues_its_original()
    {
        await using var context = await TestContext.CreateAsync();
        context.Transcoder.Probe = new VideoProbe(1280, 720, 12.5);
        var original = TestVideos.Fake("uno");

        var video = await context.UploadAsync(original);

        Assert.NotEqual(Guid.Empty, video.Id);
        Assert.Equal(VideoStatus.Processing, video.Status);
        Assert.Null(video.Error);
        // Sin campos de edición: el video entero con loop de 1 s, que lo deja 1 s más corto.
        Assert.Equal((1280, 720, 11.5), (video.Width, video.Height, video.DurationSeconds));
        Assert.Equal(new VideoEditDto(0, 12.5, VideoFade.Loop, 1), video.Edit);
        Assert.Null(video.Poster);
        Assert.Empty(video.Sources);
        Assert.Equal(HeroFrame.WarningsFor(1280, 720), video.Warnings);
        Assert.Equal(context.Database.Clock.UtcNow, video.CreatedAt);
        Assert.Equivalent(video, await context.Database.WithVideosAsync(videos => videos.GetAsync(video.Id, default)), strict: true);

        var job = Assert.Single(context.Queue.Jobs);
        Assert.Equal(video.Id, job.VideoId);
        Assert.Equal(original, await File.ReadAllBytesAsync(job.SourcePath));
        Assert.Equal([job.SourcePath], context.Database.VideoWorkFiles());
        Assert.Empty(context.Database.MediaFiles());
    }

    [Fact]
    public async Task Uploading_the_same_video_again_returns_the_same_asset_without_queueing_it_twice()
    {
        await using var context = await TestContext.CreateAsync();
        var first = await context.UploadAsync(TestVideos.Fake("igual"));
        context.Database.Clock.UtcNow = context.Database.Clock.UtcNow.AddHours(1);

        var second = await context.UploadAsync(TestVideos.Fake("igual"));

        Assert.Equivalent(first, second, strict: true);
        Assert.Single(context.Queue.Jobs);
        Assert.Single(context.Database.VideoWorkFiles());
    }

    [Fact]
    public async Task Upload_stores_the_chosen_trim_and_fade_and_the_final_duration()
    {
        await using var context = await TestContext.CreateAsync();
        context.Transcoder.Probe = new VideoProbe(1920, 1080, 20);

        var video = await context.UploadAsync(TestVideos.Fake("editado"), new VideoEditInput("2", "15", "black", "0.5"));

        Assert.Equal(new VideoEditDto(2, 15, VideoFade.Black, 0.5), video.Edit);
        Assert.Equal(13, video.DurationSeconds);
        Assert.Equivalent(video, await context.Database.WithVideosAsync(videos => videos.GetAsync(video.Id, default)), strict: true);
        Assert.Single(context.Queue.Jobs);
    }

    [Fact]
    public async Task The_same_file_with_another_edit_is_another_asset_and_with_an_equivalent_edit_the_same()
    {
        await using var context = await TestContext.CreateAsync();
        context.Transcoder.Probe = new VideoProbe(1920, 1080, 20);
        var original = TestVideos.Fake("mismo archivo");
        var first = await context.UploadAsync(original, new VideoEditInput("2", "10", "none", "0.5"));

        // Mismo tramo escrito de otra forma y, sin fundido, otra duración de fundido: es la misma edición.
        var same = await context.UploadAsync(original, new VideoEditInput("2.0", "10.0004", "none", "2"));
        var otherTrim = await context.UploadAsync(original, new VideoEditInput("3", "10", "none", null));
        var otherFade = await context.UploadAsync(original, new VideoEditInput("2", "10", "loop", null));

        Assert.Equivalent(first, same, strict: true);
        Assert.Equal(3, new[] { first.Id, otherTrim.Id, otherFade.Id }.Distinct().Count());
        Assert.Equal([first.Id, otherTrim.Id, otherFade.Id], context.Queue.Jobs.Select(job => job.VideoId));
        Assert.Equal(3, (await context.Database.ListAsync("SELECT Id FROM video_assets")).Count);
    }

    [Theory]
    [InlineData(null, "16", null, null, "El tramo elegido dura 16 s y el máximo es 15 s. Acortalo y volvé a subirlo.")]
    [InlineData("5", "5.5", null, null, "El tramo elegido dura 0,5 s y el mínimo es 1 s.")]
    [InlineData("10", "21", null, null, "El fin del recorte (21 s) pasa el final del video, que dura 20 s.")]
    [InlineData("8", "8", null, null, "El fin del recorte tiene que ser posterior al inicio.")]
    [InlineData("-1", null, null, null, "El inicio del recorte no puede ser negativo.")]
    [InlineData("0", "3", "loop", "2", "Un fundido de 2 s necesita un tramo de al menos 4 s y el elegido dura 3 s. Elegí un fundido más corto o un tramo más largo.")]
    [InlineData(null, null, "fast", null, "Fundido no válido: tiene que ser loop, black o none.")]
    [InlineData(null, null, "Loop", null, "Fundido no válido: tiene que ser loop, black o none.")]
    [InlineData(null, null, "0", null, "Fundido no válido: tiene que ser loop, black o none.")]
    [InlineData(null, null, null, "1.5", "La duración del fundido tiene que ser 0,5, 1 o 2 s.")]
    [InlineData(null, null, "none", "3", "La duración del fundido tiene que ser 0,5, 1 o 2 s.")]
    [InlineData("2,5", null, null, null, "El inicio del recorte no es un número válido: usá segundos con punto decimal (ej. 2.5).")]
    [InlineData(null, "NaN", null, null, "El fin del recorte no es un número válido: usá segundos con punto decimal (ej. 2.5).")]
    [InlineData(null, null, null, "Infinity", "La duración del fundido no es un número válido: usá segundos con punto decimal (ej. 2.5).")]
    public async Task An_invalid_edit_is_rejected_in_spanish_and_leaves_nothing_behind(
        string? trimStart, string? trimEnd, string? fade, string? fadeSeconds, string expectedMessage)
    {
        await using var context = await TestContext.CreateAsync();
        context.Transcoder.Probe = new VideoProbe(1920, 1080, 20);

        var error = await Assert.ThrowsAsync<DomainException>(() =>
            context.UploadAsync(TestVideos.Fake("mal editado"), new VideoEditInput(trimStart, trimEnd, fade, fadeSeconds)));

        Assert.Equal(expectedMessage, error.Message);
        await context.AssertNothingStoredAsync();
    }

    [Fact]
    public async Task Blank_fields_are_the_defaults()
    {
        await using var context = await TestContext.CreateAsync();
        context.Transcoder.Probe = new VideoProbe(1920, 1080, 20);

        var blank = await context.UploadAsync(TestVideos.Fake("vacíos"), new VideoEditInput("", " ", "", ""));
        var omitted = await context.UploadAsync(TestVideos.Fake("vacíos"));

        Assert.Equal(new VideoEditDto(0, 15, VideoFade.Loop, 1), blank.Edit);
        Assert.Equal(14, blank.DurationSeconds);
        Assert.Equal(blank.Id, omitted.Id);
    }

    [Fact]
    public async Task A_rejected_edit_of_an_already_uploaded_file_leaves_the_stored_video_unchanged()
    {
        await using var context = await TestContext.CreateAsync();
        var stored = await context.UploadAsync(TestVideos.Fake("guardado"));

        await Assert.ThrowsAsync<DomainException>(() =>
            context.UploadAsync(TestVideos.Fake("guardado"), new VideoEditInput("0", "10", "loop", "7")));

        Assert.Equivalent(stored, await context.Database.WithVideosAsync(videos => videos.GetAsync(stored.Id, default)), strict: true);
        Assert.Single(await context.Database.ListAsync("SELECT Id FROM video_assets"));
        Assert.Single(context.Queue.Jobs);
        Assert.Equal([context.Queue.Jobs[0].SourcePath], context.Database.VideoWorkFiles());
    }

    [Fact]
    public async Task Uploading_again_a_video_that_failed_queues_it_again()
    {
        await using var context = await TestContext.CreateAsync();
        var failed = await context.UploadAsync(TestVideos.Fake("falló"));
        await context.Database.WithVideoProcessorAsync(async processor =>
        {
            await processor.FailInterruptedAsync(default);
            return true;
        });

        var retried = await context.UploadAsync(TestVideos.Fake("falló"));

        Assert.Equal(failed.Id, retried.Id);
        Assert.Equal((VideoStatus.Processing, (string?)null), (retried.Status, retried.Error));
        Assert.Equal(2, context.Queue.Jobs.Count);
        Assert.Equal([context.Queue.Jobs[1].SourcePath], context.Database.VideoWorkFiles());
    }

    [Theory]
    [InlineData(1080, 1920, 10, "Mide 1080×1920 y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. Ideal: 1920×1080 o más, horizontal 16:9.")]
    [InlineData(1080, 1080, 10, "Mide 1080×1080 y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. Ideal: 1920×1080 o más, horizontal 16:9.")]
    [InlineData(1024, 576, 10, "Mide 1024×576 y el mínimo es 1280×720. Ideal: 1920×1080 o más, horizontal 16:9.")]
    public async Task A_video_not_landscape_or_too_small_is_rejected_and_leaves_nothing_behind(
        int width, int height, double seconds, string expectedMessage)
    {
        await using var context = await TestContext.CreateAsync();
        context.Transcoder.Probe = new VideoProbe(width, height, seconds);

        var error = await Assert.ThrowsAsync<DomainException>(() => context.UploadAsync(TestVideos.Fake("rechazado")));

        Assert.Equal(expectedMessage, error.Message);
        await context.AssertNothingStoredAsync();
    }

    [Theory]
    [InlineData("esto no es un video")]
    [InlineData("<html><script>alert(1)</script></html>")]
    public async Task A_file_that_is_not_a_video_is_rejected_by_its_magic_bytes(string content)
    {
        await using var context = await TestContext.CreateAsync();

        var error = await Assert.ThrowsAsync<DomainException>(() => context.UploadAsync(System.Text.Encoding.UTF8.GetBytes(content)));

        Assert.Equal(UnsupportedMessage, error.Message);
        await context.AssertNothingStoredAsync();
    }

    [Fact]
    public async Task A_webm_or_mkv_header_passes_the_magic_bytes_check()
    {
        await using var context = await TestContext.CreateAsync();

        var video = await context.UploadAsync([0x1A, 0x45, 0xDF, 0xA3, .. "webm"u8]);

        Assert.Equal(VideoStatus.Processing, video.Status);
    }

    [Fact]
    public async Task A_file_that_starts_like_a_video_but_ffprobe_cannot_read_is_rejected()
    {
        await using var context = await TestContext.CreateAsync();
        context.Transcoder.Probe = null;

        var error = await Assert.ThrowsAsync<DomainException>(() => context.UploadAsync(TestVideos.Fake("roto")));

        Assert.Equal("No se pudo leer el video: el archivo está dañado o no tiene imagen.", error.Message);
        await context.AssertNothingStoredAsync();
    }

    [Fact]
    public async Task A_video_over_200_MB_is_rejected_without_keeping_any_of_it()
    {
        await using var context = await TestContext.CreateAsync();
        await using var huge = new FakeVideoStream(VideoService.MaxBytes + 1);

        var error = await Assert.ThrowsAsync<DomainException>(() =>
            context.Database.WithVideosAsync(videos => videos.UploadAsync(huge, VideoEditInput.Empty, default)));

        Assert.Equal("El video supera el máximo de 200 MB.", error.Message);
        await context.AssertNothingStoredAsync();
    }

    [Fact]
    public async Task Getting_an_unknown_video_is_not_found()
    {
        await using var context = await TestContext.CreateAsync();

        var error = await Assert.ThrowsAsync<NotFoundException>(() =>
            context.Database.WithVideosAsync(videos => videos.GetAsync(Guid.NewGuid(), default)));

        Assert.Equal("El video no existe.", error.Message);
    }

    /// <summary>Base + ffmpeg simulado + cola que solo anota.</summary>
    private sealed class TestContext : IAsyncDisposable
    {
        private TestContext()
        {
            Database = new SqliteTestDatabase(services =>
            {
                services.AddSingleton<IVideoTranscoder>(Transcoder);
                services.AddSingleton<IVideoQueue>(Queue);
            });
        }

        public FakeVideoTranscoder Transcoder { get; } = new();

        public RecordingVideoQueue Queue { get; } = new();

        public SqliteTestDatabase Database { get; }

        public static async Task<TestContext> CreateAsync()
        {
            var context = new TestContext();
            await context.Database.InitializeAsync();
            return context;
        }

        public Task<VideoAssetDto> UploadAsync(byte[] content, VideoEditInput? edit = null) =>
            Database.WithVideosAsync(async videos =>
            {
                await using var stream = new MemoryStream(content);
                return await videos.UploadAsync(stream, edit ?? VideoEditInput.Empty, default);
            });

        public async Task AssertNothingStoredAsync()
        {
            Assert.Empty(Queue.Jobs);
            Assert.Empty(Database.VideoWorkFiles());
            Assert.Empty(Database.MediaFiles());
            Assert.Empty(await Database.ListAsync("SELECT Id FROM video_assets"));
        }

        public ValueTask DisposeAsync() => Database.DisposeAsync();
    }

    /// <summary>Un "video" de N bytes generado al leer (cabecera MP4 + ceros), sin ocupar esa memoria.</summary>
    private sealed class FakeVideoStream(long length) : Stream
    {
        private long _position;

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => length;

        public override long Position
        {
            get => _position;
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            var read = (int)Math.Min(count, length - _position);
            Array.Clear(buffer, offset, read);
            for (var index = 0; index < read; index++)
            {
                var absolute = _position + index;
                if (absolute < TestVideos.FtypHeader.Length)
                {
                    buffer[offset + index] = TestVideos.FtypHeader[absolute];
                }
            }

            _position += read;
            return read;
        }

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
