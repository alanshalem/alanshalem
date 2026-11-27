using System.Globalization;
using System.Text.Json;
using Blog.Application.Abstractions;
using Blog.Domain;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Blog.Infrastructure.Videos;

/// <summary>
/// Hero videos with ffprobe and ffmpeg. Each version is a separate ffmpeg run (one at a time, with bounded threads and
/// low priority): decoding 15 s again is cheap, and this way CPU usage has a clear ceiling.
/// The encoding parameters and the filters live here, once; which heights and codecs are generated and what each edit
/// means is decided by the domain.
/// </summary>
internal sealed class FfmpegVideoTranscoder(IOptions<VideoOptions> options, ILogger<FfmpegVideoTranscoder> logger) : IVideoTranscoder
{
    // Calibrated with a 12 s 1080p clip (fractal + test pattern + noise), measuring VMAF against the already filtered
    // original: AV1 preset 4 / CRF 35 ≈ 88.8 and H.264 slow / CRF 24 ≈ 89.1, the same quality to the eye. AV1 in
    // 10 bits and tune=0 did not improve quality per size and took longer; faster presets weigh 10-25 % more.
    private const int Av1Preset = 4; // 0-13: lower compresses more and takes longer
    private const int Av1Crf = 35;
    private const string H264Preset = "slow";
    private const int H264Crf = 24;

    // CRF with a bitrate ceiling: CRF rules the easy scenes and the ceiling holds back the hard ones (noise, a lot of
    // motion). It is a looping background behind text: a bit less detail in the worst case does not show; several extra
    // MB on every visit do. H.264 needs ~1.6× the bits of AV1 to look the same. In x264 the ceiling is maxrate with a
    // 1 s buffer (how much the whole clip may exceed the ceiling); in SVT-AV1, its "capped CRF" mode (mbr), with no
    // allowed excess: with its default excess it went 30 % over, and with 10 % it reached exactly 10 %. Measured on
    // 12 s at 1080p: a clip with heavy noise went down from 13.6 MB to 3.1 MB in AV1 (and from 55.8 MB to ~6 MB in
    // H.264); a slow zoom over a detailed image barely changed (2.3 → 2.1 MB, VMAF 94).
    private const int Av1MaxKbps720 = 1200;
    private const int Av1MaxKbps1080 = 2500;
    private const int Av1MaxOvershootPercent = 0;
    private const double H264BitrateFactor = 1.6;
    private const int H264BufferSeconds = 1;

    // 8-bit 4:2:0: what any phone decodes in hardware, and the only H.264 format Safari accepts.
    private const string PixelFormat = "yuv420p";

    // Gentle enhancement: hqdn3d removes noise (above all temporal noise, which spends the most bits) and unsharp gives
    // back a little sharpness after downscaling. Low values on purpose: clean, not "paint" the video.
    private const string Denoise = "hqdn3d=2:1.5:4:3";
    private const string Sharpen = "unsharp=5:5:0.4:5:5:0";

    private const int MaxFramesPerSecond = 30;

    // Several apps share the VPS: ffmpeg never uses more than these threads, even if there are more cores.
    private const int Threads = 2;

    // The poster is the most representative frame among the first ones (≈ half a second): it avoids a black or
    // transition first frame. Almost lossless JPEG: the image pipeline optimizes it afterwards.
    private const int PosterCandidateFrames = 15;
    private const int PosterJpegQuality = 2; // 2-31: 2 is almost lossless

    private const int LoggedErrorLength = 2000;

    private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(30);

    // Measured during the hero verification: a 15 s 1080p clip with these parameters took 211 s to process whole (all
    // its versions). The limit is per ffmpeg run and leaves plenty of margin: it only stops a hung process.
    private static readonly TimeSpan EncodeTimeout = TimeSpan.FromMinutes(10);

    public async Task<VideoProbe?> ProbeAsync(string sourcePath, CancellationToken cancellationToken) =>
        await ProbeStreamAsync(sourcePath, cancellationToken) is { } stream
            ? new VideoProbe(stream.Width, stream.Height, stream.DurationSeconds)
            : null;

    public async Task<TranscodedVideo> TranscodeAsync(
        string sourcePath, IReadOnlyList<VideoVariant> variants, VideoEdit edit, CancellationToken cancellationToken)
    {
        var stream = await ProbeStreamAsync(sourcePath, cancellationToken) ?? throw new VideoProcessingException(MessageKeys.VideoProcessingFailed);
        var workDirectory = Path.Combine(Path.GetFullPath(options.Value.WorkDirectory), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workDirectory);
        try
        {
            var files = new List<EncodedVideo>();
            foreach (var variant in variants)
            {
                var output = Path.Combine(workDirectory, $"{variant.Height}.{variant.CodecName}.mp4");
                await RunFfmpegAsync(EncodeArguments(sourcePath, stream, variant, edit, output), cancellationToken);
                files.Add(new EncodedVideo(variant, await File.ReadAllBytesAsync(output, cancellationToken)));
            }

            var poster = Path.Combine(workDirectory, "poster.jpg");
            await RunFfmpegAsync(
                PosterArguments(sourcePath, stream, variants.Max(variant => variant.Height), edit, poster), cancellationToken);
            return new TranscodedVideo(files, await File.ReadAllBytesAsync(poster, cancellationToken));
        }
        finally
        {
            Directory.Delete(workDirectory, recursive: true);
        }
    }

    /// <summary>
    /// The filter graph of a version: the gentle enhancement and, depending on the edit, the fade. It receives the
    /// stretch already trimmed (with -ss/-t on the input), so its times start at 0.
    /// <list type="bullet">
    /// <item>black: fade in from black and fade out to black, each one of FadeSeconds.</item>
    /// <item>loop: the stretch is split into the start (the first FadeSeconds) and the rest; the rest blends into the
    /// start at the end (xfade). It ends on the frame before the first one of the rest, which is the one it starts with:
    /// when it repeats there is no jump. It lasts the trim minus FadeSeconds.</item>
    /// <item>none: hard cut.</item>
    /// </list>
    /// </summary>
    internal static string FilterGraph(string? frameRate, int height, VideoEdit edit)
    {
        var enhanced = Enhancement(frameRate, height);
        var fade = Seconds(edit.FadeSeconds);
        return edit.Fade switch
        {
            VideoFade.None => enhanced,
            VideoFade.Black =>
                $"{enhanced},fade=t=in:st=0:d={fade},fade=t=out:st={Seconds(edit.TrimmedSeconds - edit.FadeSeconds)}:d={fade}",
            VideoFade.Loop =>
                $"{enhanced},split[full][copy];" +
                $"[full]trim=start={fade},setpts=PTS-STARTPTS[rest];" +
                $"[copy]trim=end={fade},setpts=PTS-STARTPTS[intro];" +
                $"[rest][intro]xfade=transition=fade:duration={fade}:offset={Seconds(edit.TrimmedSeconds - (2 * edit.FadeSeconds))}",
            _ => throw new ArgumentOutOfRangeException(nameof(edit), edit.Fade, "Fundido desconocido."),
        };
    }

    /// <summary>
    /// Gentle enhancement at that height. scale=-2:height keeps the aspect ratio with an even width (yuv420p requires
    /// it); the domain already guarantees it never enlarges. fps goes first: fewer frames to filter, and constant
    /// frames for xfade.
    /// </summary>
    internal static string Enhancement(string? frameRate, int height)
    {
        var filters = $"{Denoise},scale=-2:{height}:flags=lanczos,{Sharpen}";
        return frameRate is null ? filters : $"fps={frameRate},{filters}";
    }

    private static List<string> EncodeArguments(string source, StreamInfo stream, VideoVariant variant, VideoEdit edit, string output)
    {
        var arguments = InputArguments(source, edit.TrimStart, edit.TrimmedSeconds);
        arguments.AddRange(["-vf", FilterGraph(OutputFrameRate(stream), variant.Height, edit)]);
        var maxKbps = MaxKilobitsPerSecond(variant);
        arguments.AddRange(variant.Codec switch
        {
            VideoCodec.Av1 => ["-c:v", "libsvtav1", "-preset", Invariant(Av1Preset), "-crf", Invariant(Av1Crf),
                "-svtav1-params", $"lp={Threads}:mbr={maxKbps}:mbr-overshoot-pct={Av1MaxOvershootPercent}"],
            VideoCodec.H264 => ["-c:v", "libx264", "-preset", H264Preset, "-crf", Invariant(H264Crf), "-profile:v", "high",
                "-maxrate", $"{maxKbps}k", "-bufsize", $"{maxKbps * H264BufferSeconds}k", "-threads", Invariant(Threads)],
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant.Codec, "Unknown video codec."),
        });
        // +faststart: the index goes at the start and the browser starts playing without downloading the whole file.
        arguments.AddRange(["-pix_fmt", PixelFormat, "-movflags", "+faststart", "-f", "mp4", output]);
        return arguments;
    }

    /// <summary>
    /// Bitrate ceiling of each version. The one that carries the background is 1080p; 720p goes to small screens.
    /// </summary>
    internal static int MaxKilobitsPerSecond(VideoVariant variant)
    {
        var av1 = variant.Height switch
        {
            720 => Av1MaxKbps720,
            1080 => Av1MaxKbps1080,
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant.Height, "Height without a calibrated bitrate ceiling."),
        };
        return variant.Codec == VideoCodec.Av1 ? av1 : (int)(av1 * H264BitrateFactor);
    }

    // The poster comes from the edit's first visible frame (after the fade-in in black; where the final video starts in
    // loop), so it matches what shows when playback starts. Reading ends at the end of the trim: otherwise, with a
    // short stretch (or low fps) the thumbnail candidates would reach what was cut. If fewer than PosterCandidateFrames
    // are left, thumbnail picks among the ones there are when the input ends.
    private static List<string> PosterArguments(string source, StreamInfo stream, int height, VideoEdit edit, string output)
    {
        var arguments = InputArguments(source, edit.FirstVisibleSecond, edit.TrimEnd - edit.FirstVisibleSecond);
        arguments.AddRange(["-vf", $"{Enhancement(OutputFrameRate(stream), height)},thumbnail={PosterCandidateFrames}",
            "-frames:v", "1", "-q:v", Invariant(PosterJpegQuality), "-update", "1", "-f", "image2", output]);
        return arguments;
    }

    // Only the first video track: -an drops the audio, and no subtitles, data, metadata (GPS, phone model) or
    // chapters. ffmpeg applies only the rotation phones store before the filters.
    // -ss before -i seeks fast to the previous key frame and decodes from there discarding up to the exact second (the
    // trim is frame accurate); -t cuts the reading at the length of the stretch.
    private static List<string> InputArguments(string source, double start, double duration) =>
    [
        "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
        "-threads", Invariant(Threads), "-ss", Seconds(start), "-t", Seconds(duration),
        "-i", source,
        "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
        "-filter_threads", Invariant(Threads),
    ];

    /// <summary>
    /// The output fps, always explicit: it leaves constant frames (phones record with variable frames), which is what
    /// the fades need to land on the right second. More than 30 fps is divided by the smallest integer that leaves it
    /// at 30 or less (60 → 30, 50 → 25, 120 → 30): evenly spaced frames are dropped and the motion stays smooth. Null if
    /// ffprobe does not report the fps (what is unknown is not touched).
    /// </summary>
    private static string? OutputFrameRate(StreamInfo stream)
    {
        if (stream.FrameRate is not var (numerator, denominator))
        {
            return null;
        }

        var cap = (long)MaxFramesPerSecond * denominator;
        var divisor = numerator <= cap ? 1 : (numerator + cap - 1) / cap;
        return $"{numerator}/{denominator * divisor}";
    }

    private async Task RunFfmpegAsync(List<string> arguments, CancellationToken cancellationToken)
    {
        ExternalProcess.Result result;
        try
        {
            result = await ExternalProcess.RunAsync(options.Value.FfmpegPath, arguments, EncodeTimeout, cancellationToken);
        }
        catch (TimeoutException exception)
        {
            logger.LogWarning(exception, "ffmpeg exceeded the maximum time; the video was cancelled.");
            throw new VideoProcessingException(MessageKeys.VideoProcessingTimedOut);
        }

        if (result.ExitCode != 0)
        {
            logger.LogWarning("ffmpeg exited with code {ExitCode}: {Error}", result.ExitCode, Tail(result.Error));
            throw new VideoProcessingException(MessageKeys.VideoProcessingFailed);
        }
    }

    /// <summary>
    /// Width and height as seen (with the rotation applied), the container's duration (the stream's is often missing in
    /// MKV/WebM) and average fps. Null if there is no video track with a size and a duration.
    /// </summary>
    private async Task<StreamInfo?> ProbeStreamAsync(string sourcePath, CancellationToken cancellationToken)
    {
        ExternalProcess.Result result;
        try
        {
            result = await ExternalProcess.RunAsync(options.Value.FfprobePath,
            [
                "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height,avg_frame_rate:stream_side_data=rotation:format=duration",
                "-of", "json", sourcePath,
            ], ProbeTimeout, cancellationToken);
        }
        catch (TimeoutException exception)
        {
            logger.LogWarning(exception, "ffprobe exceeded the maximum time; the video is treated as unreadable.");
            return null;
        }

        if (result.ExitCode != 0)
        {
            logger.LogInformation("ffprobe could not read the video ({ExitCode}): {Error}", result.ExitCode, Tail(result.Error));
            return null;
        }

        return ParseProbe(result.Output);
    }

    private static StreamInfo? ParseProbe(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (!root.TryGetProperty("streams", out var streams) || streams.GetArrayLength() == 0
            || !root.TryGetProperty("format", out var format)
            || !format.TryGetProperty("duration", out var durationText)
            || !double.TryParse(durationText.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var duration)
            || duration <= 0)
        {
            return null;
        }

        var stream = streams[0];
        if (!stream.TryGetProperty("width", out var widthValue) || !stream.TryGetProperty("height", out var heightValue))
        {
            return null;
        }

        var (width, height) = (widthValue.GetInt32(), heightValue.GetInt32());
        // A phone stores the pixels lying down with a ±90° rotation: it is seen with width and height swapped.
        if (Math.Abs(Rotation(stream)) % 180 == 90)
        {
            (width, height) = (height, width);
        }

        return new StreamInfo(width, height, duration, FrameRate(stream));
    }

    private static int Rotation(JsonElement stream)
    {
        if (!stream.TryGetProperty("side_data_list", out var sideData))
        {
            return 0;
        }

        foreach (var item in sideData.EnumerateArray())
        {
            if (item.TryGetProperty("rotation", out var rotation) && rotation.TryGetInt32(out var degrees))
            {
                return degrees;
            }
        }

        return 0;
    }

    // "30000/1001" → (30000, 1001). "0/0" (unknown) → null: what is unknown is not limited.
    private static (long Numerator, long Denominator)? FrameRate(JsonElement stream)
    {
        var parts = stream.TryGetProperty("avg_frame_rate", out var rate) ? rate.GetString()?.Split('/') : null;
        return parts is [var numerator, var denominator]
               && long.TryParse(numerator, CultureInfo.InvariantCulture, out var top) && top > 0
               && long.TryParse(denominator, CultureInfo.InvariantCulture, out var bottom) && bottom > 0
            ? (top, bottom)
            : null;
    }

    private static string Tail(string text) => text.Length > LoggedErrorLength ? text[^LoggedErrorLength..] : text;

    private static string Invariant(int value) => value.ToString(CultureInfo.InvariantCulture);

    // To the millisecond, with a decimal point: it is the time format ffmpeg and its filters understand.
    private static string Seconds(double value) => value.ToString("0.###", CultureInfo.InvariantCulture);

    private sealed record StreamInfo(int Width, int Height, double DurationSeconds, (long Numerator, long Denominator)? FrameRate);
}
