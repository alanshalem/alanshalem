using Blog.Application.Abstractions;
using Blog.Application.Videos;
using Blog.Domain;
using Blog.Infrastructure.Persistence;
using Blog.Infrastructure.Videos;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Blog.Tests;

/// <summary>
/// Qué pasa cuando falla un guardado mientras se procesa un video (base real, ffmpeg simulado y un repositorio que falla
/// cuando la prueba lo pide): el error original nunca se pierde y el fallo se guarda partiendo de lo que está en la base.
/// </summary>
public class VideoProcessorTests
{
    private const string UnexpectedMessage = "No se pudo procesar el video por un error del servidor. Volvé a subirlo más tarde.";
    private static readonly TimeSpan WaitLimit = TimeSpan.FromSeconds(30);

    [Fact]
    public async Task If_saving_the_ready_video_fails_it_is_stored_as_failed_and_the_original_error_is_rethrown()
    {
        await using var context = await TestContext.CreateAsync();
        var job = await context.UploadAsync(TestVideos.Fake("listo sin guardar"));
        var original = new InvalidOperationException("La base no respondió.");
        context.Saves.FailNext(original);

        var thrown = await Assert.ThrowsAnyAsync<Exception>(() => context.ProcessAsync(job, default));

        Assert.Same(original, thrown);
        var stored = await context.GetAsync(job.VideoId);
        Assert.Equal((VideoStatus.Failed, UnexpectedMessage), (stored.Status, stored.Error));
        Assert.Null(stored.Poster);
        Assert.Empty(stored.Sources);
        Assert.Empty(context.Database.VideoWorkFiles());
    }

    [Fact]
    public async Task If_saving_the_failure_also_fails_both_errors_are_thrown_and_the_video_stays_processing()
    {
        await using var context = await TestContext.CreateAsync();
        var job = await context.UploadAsync(TestVideos.Fake("FAIL y tampoco se guarda"));
        var saveError = new IOException("Disco lleno.");
        context.Saves.FailNext(saveError);

        var thrown = await Assert.ThrowsAsync<AggregateException>(() => context.ProcessAsync(job, default));

        Assert.Equal(2, thrown.InnerExceptions.Count);
        Assert.IsType<VideoProcessingException>(thrown.InnerExceptions[0]);
        Assert.Same(saveError, thrown.InnerExceptions[1]);
        // Queda en "processing": el próximo arranque lo marca como interrumpido (FailInterruptedAsync).
        Assert.Equal(VideoStatus.Processing, (await context.GetAsync(job.VideoId)).Status);
        Assert.Empty(context.Database.VideoWorkFiles());
    }

    [Fact]
    public async Task A_shutdown_leaves_the_video_processing_without_saving_a_failure()
    {
        await using var context = await TestContext.CreateAsync();
        var job = await context.UploadAsync(TestVideos.Fake("se apaga el servidor"));
        var savesBefore = context.Saves.Attempts;
        using var shutdown = new CancellationTokenSource();
        await shutdown.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => context.ProcessAsync(job, shutdown.Token));

        Assert.Equal(savesBefore, context.Saves.Attempts);
        Assert.Equal(VideoStatus.Processing, (await context.GetAsync(job.VideoId)).Status);
        Assert.Empty(context.Database.VideoWorkFiles());
    }

    [Fact]
    public async Task An_expected_error_is_stored_as_the_video_error_and_not_rethrown()
    {
        await using var context = await TestContext.CreateAsync();
        var job = await context.UploadAsync(TestVideos.Fake("FAIL previsto"));

        await context.ProcessAsync(job, default);

        var stored = await context.GetAsync(job.VideoId);
        Assert.Equal(VideoStatus.Failed, stored.Status);
        Assert.Equal("ffmpeg no pudo convertir el video. Probá exportarlo de nuevo como MP4 y volvé a subirlo.", stored.Error);
    }

    [Fact]
    public async Task The_worker_logs_the_original_error_and_the_failed_save_together()
    {
        await using var context = await TestContext.CreateAsync();

        // Primero arranca el worker: al arrancar marca como interrumpido todo lo que esté en "processing".
        await context.Database.VideoWorker.StartAsync(default);
        try
        {
            var job = await context.UploadAsync(TestVideos.Fake("FAIL en el worker"));
            context.Saves.FailNext(new IOException("Disco lleno."));
            context.Database.Services.GetRequiredService<ChannelVideoQueue>().Enqueue(job);
            await WaitForErrorLogAsync(context.Database);
        }
        finally
        {
            await context.Database.VideoWorker.StopAsync(default);
        }

        var entry = Assert.Single(context.Database.Logs.Entries, entry => entry.Level == LogLevel.Error);
        Assert.Equal(typeof(VideoProcessingWorker).FullName, entry.Category);
        var logged = Assert.IsType<AggregateException>(entry.Exception);
        Assert.Collection(
            logged.InnerExceptions,
            original => Assert.IsType<VideoProcessingException>(original),
            save => Assert.Equal("Disco lleno.", Assert.IsType<IOException>(save).Message));
    }

    private static async Task WaitForErrorLogAsync(SqliteTestDatabase database)
    {
        using var timeout = new CancellationTokenSource(WaitLimit);
        while (!database.Logs.Entries.Any(entry => entry.Level == LogLevel.Error))
        {
            await Task.Delay(20, timeout.Token);
        }
    }

    /// <summary>Base + ffmpeg simulado + cola que solo anota + repositorio de videos con guardados que fallan a pedido.</summary>
    private sealed class TestContext : IAsyncDisposable
    {
        private readonly RecordingVideoQueue _queue = new();

        private TestContext()
        {
            Database = new SqliteTestDatabase(services =>
            {
                services.AddSingleton<IVideoTranscoder>(new FakeVideoTranscoder());
                services.AddSingleton<IVideoQueue>(_queue);
                services.AddScoped<IVideoAssetRepository>(provider =>
                    new FailingSaveVideoAssetRepository(new VideoAssetRepository(provider.GetRequiredService<BlogDbContext>()), Saves));
            });
        }

        public SaveFailures Saves { get; } = new();

        public SqliteTestDatabase Database { get; }

        public static async Task<TestContext> CreateAsync()
        {
            var context = new TestContext();
            await context.Database.InitializeAsync();
            return context;
        }

        /// <summary>Sube el video (queda en "processing") y devuelve su trabajo, sin procesarlo.</summary>
        public async Task<VideoJob> UploadAsync(byte[] content)
        {
            var video = await Database.WithVideosAsync(async videos =>
            {
                await using var stream = new MemoryStream(content);
                return await videos.UploadAsync(stream, VideoEditInput.Empty, default);
            });
            return _queue.Jobs.Single(job => job.VideoId == video.Id);
        }

        public Task<bool> ProcessAsync(VideoJob job, CancellationToken cancellationToken) =>
            Database.WithVideoProcessorAsync(async processor =>
            {
                await processor.ProcessAsync(job, cancellationToken);
                return true;
            });

        public Task<VideoAssetDto> GetAsync(Guid id) => Database.WithVideosAsync(videos => videos.GetAsync(id, default));

        public ValueTask DisposeAsync() => Database.DisposeAsync();
    }

    /// <summary>Los próximos guardados que van a fallar, en orden, y cuántos se intentaron en total.</summary>
    private sealed class SaveFailures
    {
        private readonly Queue<Exception> _pending = new();

        public int Attempts { get; private set; }

        public void FailNext(Exception error) => _pending.Enqueue(error);

        public void OnSave()
        {
            Attempts++;
            if (_pending.TryDequeue(out var error))
            {
                throw error;
            }
        }
    }

    /// <summary>El repositorio real, salvo que un guardado puede fallar antes de llegar a la base.</summary>
    private sealed class FailingSaveVideoAssetRepository(IVideoAssetRepository inner, SaveFailures failures) : IVideoAssetRepository
    {
        public Task<VideoAsset?> GetByIdAsync(Guid id, CancellationToken cancellationToken) => inner.GetByIdAsync(id, cancellationToken);

        public Task<VideoAsset?> GetByHashAsync(string hash, CancellationToken cancellationToken) => inner.GetByHashAsync(hash, cancellationToken);

        public Task<VideoAsset?> ReloadAsync(Guid id, CancellationToken cancellationToken) => inner.ReloadAsync(id, cancellationToken);

        public Task<IReadOnlyList<VideoAsset>> ListProcessingAsync(CancellationToken cancellationToken) =>
            inner.ListProcessingAsync(cancellationToken);

        public void Add(VideoAsset video) => inner.Add(video);

        public Task SaveChangesAsync(CancellationToken cancellationToken)
        {
            failures.OnSave();
            return inner.SaveChangesAsync(cancellationToken);
        }
    }
}
