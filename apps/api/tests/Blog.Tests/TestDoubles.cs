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
/// The simulated builder: counts the sends and accepts or rejects according to <see cref="Accepts"/>. With the token
/// cancelled it never accepts, like the real HTTP send (the request never goes out). A send with a response queued in
/// <see cref="Respond"/> uses it instead: this way a test decides what happens while a request is in flight.
/// </summary>
internal sealed class FakeBuildRequestSender : IBuildRequestSender
{
    private readonly ConcurrentQueue<Func<CancellationToken, Task<bool>>> _scripted = new();
    private int _requests;

    public bool Accepts { get; set; }

    public int Requests => Volatile.Read(ref _requests);

    /// <summary>The response of the next send (in order of arrival); with none queued, <see cref="Accepts"/> rules.</summary>
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

/// <summary>Keeps every log entry so the test checks what was logged (category, level and exception).</summary>
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

/// <summary>A queue that only records what was enqueued: to test the upload without anything processing in the background.</summary>
internal sealed class RecordingVideoQueue : IVideoQueue
{
    private readonly ConcurrentQueue<VideoJob> _jobs = new();

    public IReadOnlyList<VideoJob> Jobs => [.. _jobs];

    public void Enqueue(VideoJob job) => _jobs.Enqueue(job);
}

/// <summary>
/// Simulated ffmpeg: fast and deterministic. The probe returns <see cref="Probe"/>; an original that starts with
/// <see cref="FailMarker"/> (after the ftyp header) makes the process fail, and one that starts with
/// <see cref="BrokenPosterMarker"/> returns an unreadable poster. Counts how many processes run at the same time.
/// </summary>
internal sealed class FakeVideoTranscoder : IVideoTranscoder
{
    public static readonly byte[] FailMarker = "FAIL"u8.ToArray();
    public static readonly byte[] BrokenPosterMarker = "POSTER ROTO"u8.ToArray();

    private readonly ConcurrentQueue<VideoEdit> _edits = new();

    private int _running;
    private int _maxRunning;
    private int _transcodes;

    public VideoProbe? Probe { get; set; } = new(1920, 1080, 10);

    public int MaxConcurrent => _maxRunning;

    public int Transcodes => _transcodes;

    /// <summary>The edit each conversion was requested with.</summary>
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
            // A real pause: if two processes overlapped, MaxConcurrent would show it.
            await Task.Delay(50, cancellationToken);
            var original = await File.ReadAllBytesAsync(sourcePath, cancellationToken);
            if (original.AsSpan(TestVideos.FtypHeader.Length).StartsWith(FailMarker))
            {
                throw new VideoProcessingException(MessageKeys.VideoProcessingFailed);
            }

            using var frame = TestImages.Gradient(1920, 1080);
            var files = variants.Select((variant, index) => new EncodedVideo(variant, new byte[100 + index])).ToList();
            var brokenPoster = original.AsSpan(TestVideos.FtypHeader.Length).StartsWith(BrokenPosterMarker);
            return new TranscodedVideo(files, brokenPoster ? [0xFF, 0xD8, 0xFF, 0x00] : TestImages.Jpeg(frame));
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
