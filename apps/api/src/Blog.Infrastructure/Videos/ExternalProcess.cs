using System.ComponentModel;
using System.Diagnostics;

namespace Blog.Infrastructure.Videos;

/// <summary>
/// Runs ffmpeg/ffprobe with a list of arguments (never a string for a shell: a file name cannot inject options or
/// commands), with low priority and a maximum time.
/// </summary>
internal static class ExternalProcess
{
    public sealed record Result(int ExitCode, string Output, string Error);

    /// <exception cref="TimeoutException">If it exceeds the maximum time (the process is killed with all its children).</exception>
    /// <exception cref="Win32Exception">If the executable does not exist: it is a server failure, not a file failure.</exception>
    public static async Task<Result> RunAsync(
        string fileName, IReadOnlyList<string> arguments, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo(fileName)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Could not start {fileName}.");
        LowerPriority(process);

        // Both outputs are read in parallel: if one fills up without anyone reading it, the process blocks.
        var output = process.StandardOutput.ReadToEndAsync(CancellationToken.None);
        var error = process.StandardError.ReadToEndAsync(CancellationToken.None);

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        try
        {
            await process.WaitForExitAsync(deadline.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
            cancellationToken.ThrowIfCancellationRequested();
            throw new TimeoutException($"{Path.GetFileName(fileName)} exceeded {timeout.TotalMinutes:0.#} min.");
        }

        return new Result(process.ExitCode, await output, await error);
    }

    // Low priority: the API, the site and the other apps on the VPS keep answering while encoding. It is lowered as
    // soon as it starts (there is an instant at normal priority, irrelevant next to minutes of encoding); if the process
    // already finished or the system does not allow it, it goes on anyway.
    private static void LowerPriority(Process process)
    {
        try
        {
            process.PriorityClass = ProcessPriorityClass.BelowNormal;
        }
        catch (Exception exception) when (exception is InvalidOperationException or Win32Exception)
        {
        }
    }
}
