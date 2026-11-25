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
        Assert.Equal((1280, 720, 12.5), (video.Width, video.Height, video.DurationSeconds));
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
    [InlineData(1920, 1080, 15.5, "El video dura 15,5 s y el máximo es 15 s. Recortalo y volvé a subirlo.")]
    [InlineData(1080, 1920, 10, "Mide 1080×1920 y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. Ideal: 1920×1080 o más, horizontal 16:9.")]
    [InlineData(1080, 1080, 10, "Mide 1080×1080 y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. Ideal: 1920×1080 o más, horizontal 16:9.")]
    [InlineData(1024, 576, 10, "Mide 1024×576 y el mínimo es 1280×720. Ideal: 1920×1080 o más, horizontal 16:9.")]
    public async Task A_video_too_long_not_landscape_or_too_small_is_rejected_and_leaves_nothing_behind(
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
            context.Database.WithVideosAsync(videos => videos.UploadAsync(huge, default)));

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

        public Task<VideoAssetDto> UploadAsync(byte[] content) =>
            Database.WithVideosAsync(async videos =>
            {
                await using var stream = new MemoryStream(content);
                return await videos.UploadAsync(stream, default);
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
