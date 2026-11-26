using System.Collections.Concurrent;
using Blog.Application.Abstractions;
using Blog.Domain;
using Blog.Infrastructure.Build;
using Microsoft.Extensions.Logging;

namespace Blog.Tests;

internal sealed class FixedClock : IClock
{
    public DateTime UtcNow { get; set; } = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);
}

internal sealed class CountingBuildTrigger : ISiteBuildTrigger
{
    public int Requests { get; private set; }

    public Task RequestBuildAsync(CancellationToken cancellationToken)
    {
        Requests++;
        return Task.CompletedTask;
    }
}

/// <summary>
/// El builder simulado: cuenta los envíos y acepta o rechaza según <see cref="Accepts"/>. Con el token cancelado
/// nunca acepta, como el envío HTTP real (el pedido no llega a salir). Un envío con respuesta encolada en
/// <see cref="Respond"/> la usa en su lugar: así una prueba decide qué pasa mientras un pedido está en vuelo.
/// </summary>
internal sealed class FakeBuildRequestSender : IBuildRequestSender
{
    private readonly ConcurrentQueue<Func<CancellationToken, Task<bool>>> _scripted = new();
    private int _requests;

    public bool Accepts { get; set; }

    public int Requests => Volatile.Read(ref _requests);

    /// <summary>La respuesta del próximo envío (en orden de llegada); sin ninguna encolada, rige <see cref="Accepts"/>.</summary>
    public void Respond(Func<CancellationToken, Task<bool>> response) => _scripted.Enqueue(response);

    public Task<bool> SendAsync(CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref _requests);
        return _scripted.TryDequeue(out var response)
            ? response(cancellationToken)
            : Task.FromResult(Accepts && !cancellationToken.IsCancellationRequested);
    }
}

internal sealed record LogEntry(string Category, LogLevel Level, string Message, Exception? Exception);

/// <summary>Guarda cada log para que la prueba verifique qué se registró (categoría, nivel y excepción).</summary>
internal sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<LogEntry> _entries = new();

    public IReadOnlyList<LogEntry> Entries => [.. _entries];

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, _entries);

    public void Dispose()
    {
    }

    private sealed class CapturingLogger(string category, ConcurrentQueue<LogEntry> entries) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            entries.Enqueue(new LogEntry(category, logLevel, formatter(state, exception), exception));
    }
}

/// <summary>Cola que solo anota lo encolado: para probar la subida sin que nada procese en segundo plano.</summary>
internal sealed class RecordingVideoQueue : IVideoQueue
{
    private readonly ConcurrentQueue<VideoJob> _jobs = new();

    public IReadOnlyList<VideoJob> Jobs => [.. _jobs];

    public void Enqueue(VideoJob job) => _jobs.Enqueue(job);
}

/// <summary>
/// ffmpeg simulado: rápido y determinista. El probe devuelve <see cref="Probe"/>; un original que empieza con
/// <see cref="FailMarker"/> (después de la cabecera ftyp) hace fallar el proceso. Cuenta cuántos procesos corren a la vez.
/// </summary>
internal sealed class FakeVideoTranscoder : IVideoTranscoder
{
    public static readonly byte[] FailMarker = "FAIL"u8.ToArray();

    private readonly ConcurrentQueue<VideoEdit> _edits = new();

    private int _running;
    private int _maxRunning;
    private int _transcodes;

    public VideoProbe? Probe { get; set; } = new(1920, 1080, 10);

    public int MaxConcurrent => _maxRunning;

    public int Transcodes => _transcodes;

    /// <summary>La edición con que se pidió cada conversión.</summary>
    public IReadOnlyList<VideoEdit> Edits => [.. _edits];

    public Task<VideoProbe?> ProbeAsync(string sourcePath, CancellationToken cancellationToken) => Task.FromResult(Probe);

    public async Task<TranscodedVideo> TranscodeAsync(
        string sourcePath, IReadOnlyList<VideoVariant> variants, VideoEdit edit, CancellationToken cancellationToken)
    {
        _edits.Enqueue(edit);
        var running = Interlocked.Increment(ref _running);
        Interlocked.Increment(ref _transcodes);
        InterlockedMax(ref _maxRunning, running);
        try
        {
            // Una pausa real: si dos procesos se pisaran, MaxConcurrent lo mostraría.
            await Task.Delay(50, cancellationToken);
            var original = await File.ReadAllBytesAsync(sourcePath, cancellationToken);
            if (original.AsSpan(TestVideos.FtypHeader.Length).StartsWith(FailMarker))
            {
                throw new VideoProcessingException("ffmpeg no pudo convertir el video. Probá exportarlo de nuevo como MP4 y volvé a subirlo.");
            }

            using var frame = TestImages.Gradient(1920, 1080);
            var files = variants.Select((variant, index) => new EncodedVideo(variant, new byte[100 + index])).ToList();
            return new TranscodedVideo(files, TestImages.Jpeg(frame));
        }
        finally
        {
            Interlocked.Decrement(ref _running);
        }
    }

    private static void InterlockedMax(ref int target, int value)
    {
        int current;
        while ((current = Volatile.Read(ref target)) < value && Interlocked.CompareExchange(ref target, value, current) != current)
        {
        }
    }
}
