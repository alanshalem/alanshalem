using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Blog.Tests;

/// <summary>
/// Videos for the tests. The fake ones are bytes with an MP4 header (for the simulated ffmpeg); the real ones are
/// generated with ffmpeg (test pattern + audio tone), so there are no binary files in the repo.
/// </summary>
internal static class TestVideos
{
    /// <summary>ftyp box of an MP4 ("isom"): the minimum to pass the magic bytes check.</summary>
    public static readonly byte[] FtypHeader = [0x00, 0x00, 0x00, 0x18, .. "ftypisom"u8];

    /// <summary>Fake "video": MP4 header + its own content (different contents = different hashes).</summary>
    public static byte[] Fake(string content) => [.. FtypHeader, .. System.Text.Encoding.UTF8.GetBytes(content)];

    /// <summary>Real H.264 + AAC clip generated with ffmpeg at the given file.</summary>
    public static async Task<string> GenerateAsync(
        string path, int width, int height, double seconds, int fps = 30, bool audio = true, int? displayRotation = null)
    {
        List<string> arguments = ["-hide_banner", "-loglevel", "error", "-y"];
        if (displayRotation is { } rotation)
        {
            // Like a phone: the pixels are stored lying down and a rotation matrix says how to show them.
            arguments.AddRange(["-display_rotation", rotation.ToString(System.Globalization.CultureInfo.InvariantCulture)]);
        }

        arguments.AddRange(["-f", "lavfi", "-i", $"testsrc2=size={width}x{height}:rate={fps}"]);
        if (audio)
        {
            arguments.AddRange(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"]);
        }

        arguments.AddRange(["-t", seconds.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]);
        if (audio)
        {
            arguments.AddRange(["-c:a", "aac", "-shortest"]);
        }

        arguments.Add(path);
        await RunAsync("ffmpeg", arguments);
        return path;
    }

    /// <summary>
    /// A still image that moves 2 px per frame (30 fps): neighboring frames almost equal and distant frames quite
    /// different. Used to measure jumps (a cut shows, a seamless join does not) and on which frame a trim starts.
    /// </summary>
    public static async Task<string> GeneratePanAsync(string path, int width, int height, double seconds)
    {
        await RunAsync("ffmpeg",
        [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", $"testsrc=size={width}x{height}:rate=1:duration=1",
            "-filter_complex", $"[0]scale={width * 3}:{height},loop=-1:1,fps=30,setpts=N/30/TB,crop={width}:{height}:t*60:0,format=yuv420p",
            "-t", Invariant(seconds), "-c:v", "libx264", "-preset", "ultrafast", path,
        ]);
        return path;
    }

    /// <summary>
    /// Flat dark gray until <paramref name="cutAtSeconds"/> and white afterwards: an abrupt scene change at a known
    /// second, to tell which side a frame came from just by measuring its luminance.
    /// </summary>
    public static async Task<string> GenerateHardCutAsync(string path, int width, int height, double cutAtSeconds, double seconds, int fps)
    {
        await RunAsync("ffmpeg",
        [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", $"color=c=0x202020:size={width}x{height}:rate={fps}:duration={Invariant(cutAtSeconds)}",
            "-f", "lavfi", "-i", $"color=c=white:size={width}x{height}:rate={fps}:duration={Invariant(seconds - cutAtSeconds)}",
            "-filter_complex", "[0][1]concat=n=2:v=1:a=0,format=yuv420p",
            "-c:v", "libx264", "-preset", "ultrafast", path,
        ]);
        return path;
    }

    /// <summary>Test pattern with heavy noise that changes on every frame: the worst case for size (without the ceiling, it explodes).</summary>
    public static async Task<string> GenerateNoisyAsync(string path, int width, int height, double seconds)
    {
        await RunAsync("ffmpeg",
        [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", $"testsrc2=size={width}x{height}:rate=30", "-vf", "noise=alls=40:allf=t+u,format=yuv420p",
            "-t", Invariant(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", path,
        ]);
        return path;
    }

    /// <summary>How many frames the video has (decoding it whole, not what the header says).</summary>
    public static async Task<int> FrameCountAsync(string path)
    {
        var (output, _) = await RunAsync("ffprobe",
            ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path]);
        return int.Parse(output.Trim(), CultureInfo.InvariantCulture);
    }

    /// <summary>PSNR (dB) between a frame of one video and one of another (or the same): higher = more alike.</summary>
    public static async Task<double> PsnrAsync(string first, int firstFrame, string second, int secondFrame)
    {
        var (_, log) = await RunAsync("ffmpeg",
        [
            "-hide_banner", "-nostdin", "-i", first, "-i", second, "-filter_complex",
            $"[0:v]select=eq(n\\,{firstFrame}),setpts=0[a];[1:v]select=eq(n\\,{secondFrame}),setpts=0[b];[a][b]psnr", "-f", "null", "-",
        ]);
        var average = Regex.Match(log, @"PSNR .* average:(?<value>[0-9.]+|inf)").Groups["value"].Value;
        return average == "inf" ? double.PositiveInfinity : double.Parse(average, CultureInfo.InvariantCulture);
    }

    /// <summary>Mean luminance of a frame (0-255; video black is 16).</summary>
    public static async Task<double> MeanLumaAsync(string path, int frame)
    {
        var (_, log) = await RunAsync("ffmpeg",
            ["-hide_banner", "-nostdin", "-i", path, "-vf", $"select=eq(n\\,{frame}),signalstats,metadata=print", "-f", "null", "-"]);
        return double.Parse(Regex.Match(log, @"lavfi\.signalstats\.YAVG=(?<value>[0-9.]+)").Groups["value"].Value, CultureInfo.InvariantCulture);
    }

    /// <summary>What ffprobe sees in a file: the streams (type, codec, profile, size, fps) and the duration.</summary>
    public static async Task<JsonElement> ProbeAsync(string path)
    {
        var (json, _) = await RunAsync("ffprobe",
        [
            "-v", "error", "-show_entries",
            "stream=codec_type,codec_name,profile,width,height,pix_fmt,avg_frame_rate:format=duration", "-of", "json", path,
        ]);
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    private static string Invariant(double value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>The standard output and the log (stderr): that is where psnr and signalstats write their measurements.</summary>
    private static async Task<(string Output, string Log)> RunAsync(string fileName, IReadOnlyList<string> arguments)
    {
        var startInfo = new ProcessStartInfo(fileName)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = Process.Start(startInfo)!;
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"{fileName} failed ({process.ExitCode}): {await error}");
        }

        return (await output, await error);
    }
}
