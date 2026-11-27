using System.Globalization;

namespace Blog.Domain;

/// <summary>How the video joins itself when it repeats in the hero.</summary>
public enum VideoFade
{
    /// <summary>The end blends into the start: the last frame continues into the first without a jump.</summary>
    Loop,

    /// <summary>Fades in from black at the start and out to black at the end.</summary>
    Black,

    /// <summary>Hard cut.</summary>
    None,
}

/// <summary>
/// The trim and fade applied when processing a video, validated against the original's duration and normalized: two
/// requests that produce the same result are the same edit (and the same asset). Times are seconds of the original,
/// rounded to the millisecond.
/// </summary>
public sealed record VideoEdit
{
    /// <summary>
    /// How long the chosen stretch can last. It is the hero background and repeats in a loop: up to 15 s is enough for
    /// the repetition not to show and keeps what each visit downloads bounded; less than 1 s would be a flicker.
    /// </summary>
    public const double MinSeconds = 1;

    public const double MaxSeconds = 15;

    public const VideoFade DefaultFade = VideoFade.Loop;
    public const double DefaultFadeSeconds = 1;

    // Containers round the duration and the browser measures it differently from ffprobe (15 s exported by a phone
    // often measure 15.02 s): this margin avoids rejecting over hundredths nobody chose.
    private const double ToleranceSeconds = 0.1;

    private const int Decimals = 3;

    // Constructor for EF Core.
    private VideoEdit()
    {
    }

    /// <summary>
    /// The fade durations that can be chosen: short, medium and long. Few on purpose, so the admin compares each one in
    /// the preview instead of fine-tuning tenths. It is the only list: the error message comes from here.
    /// </summary>
    public static IReadOnlyList<double> FadeDurations { get; } = [0.5, 1, 2];

    public double TrimStart { get; private set; }
    public double TrimEnd { get; private set; }
    public VideoFade Fade { get; private set; }

    /// <summary>Unused without a fade: it stays at the default value so it does not tell two equal edits apart.</summary>
    public double FadeSeconds { get; private set; }

    /// <summary>How long the trimmed stretch lasts.</summary>
    public double TrimmedSeconds => Round(TrimEnd - TrimStart);

    /// <summary>
    /// How long the final video lasts. In loop the last fade stretch overlaps the start, so the result is shorter than
    /// the trim.
    /// </summary>
    public double OutputSeconds => Fade == VideoFade.Loop ? Round(TrimmedSeconds - FadeSeconds) : TrimmedSeconds;

    /// <summary>
    /// Second of the original of the first frame seen whole: in black, where the fade-in ends; in loop, where the final
    /// video starts (what comes before only appears faded in at the end). The poster comes from there.
    /// </summary>
    public double FirstVisibleSecond => Fade == VideoFade.None ? TrimStart : Round(TrimStart + FadeSeconds);

    /// <summary>Stable text that identifies the edit (e.g. "2-15-loop-1"): together with the original's hash, it defines the asset.</summary>
    public string Key => string.Join('-', Invariant(TrimStart), Invariant(TrimEnd), Fade.ToString().ToLowerInvariant(), Invariant(FadeSeconds));

    /// <summary>What happens without edit fields: the first min(duration, 15) s with a 1 s loop.</summary>
    public static VideoEdit DefaultFor(double sourceSeconds) => Create(sourceSeconds, null, null, null, null);

    /// <summary>
    /// Validates and normalizes the requested edit. Whatever is not requested takes its default value; without an end,
    /// the stretch runs until 15 s after the start (or until the end of the video, if it ends earlier).
    /// </summary>
    /// <param name="sourceSeconds">Duration of the original (as measured by ffprobe).</param>
    /// <exception cref="DomainException">If the stretch is not between 1 and 15 s, goes past the video or the fade does not fit.</exception>
    public static VideoEdit Create(double sourceSeconds, double? trimStart, double? trimEnd, VideoFade? fade, double? fadeSeconds)
    {
        // Rejecting text that is not a number is the job of whoever reads the request; a NaN here would pass every comparison.
        EnsureFinite(sourceSeconds, nameof(sourceSeconds));
        EnsureFinite(trimStart, nameof(trimStart));
        EnsureFinite(trimEnd, nameof(trimEnd));
        EnsureFinite(fadeSeconds, nameof(fadeSeconds));

        var start = Round(trimStart ?? 0);
        if (start < 0)
        {
            throw new DomainException(MessageKeys.VideoTrimStartNegative);
        }

        // The default end counts from the chosen start: asking only for the start gives the longest possible stretch from there.
        var end = Round(trimEnd ?? Math.Min(sourceSeconds, start + MaxSeconds));
        if (end <= start)
        {
            throw new DomainException(MessageKeys.VideoTrimEndBeforeStart);
        }

        if (end > sourceSeconds + ToleranceSeconds)
        {
            throw new DomainException(MessageKeys.VideoTrimEndPastVideo, ("end", end), ("duration", sourceSeconds));
        }

        // Within the margin, the end is the real end: the same request with 15.02 or 15 produces the same video.
        end = Math.Min(end, Round(sourceSeconds));
        var trimmed = Round(end - start);
        if (trimmed > MaxSeconds + ToleranceSeconds)
        {
            throw new DomainException(MessageKeys.VideoTrimTooLong, ("trimmed", trimmed), ("max", MaxSeconds));
        }

        if (trimmed < MinSeconds)
        {
            throw new DomainException(MessageKeys.VideoTrimTooShort, ("trimmed", trimmed), ("min", MinSeconds));
        }

        var chosenFadeSeconds = fadeSeconds ?? DefaultFadeSeconds;
        if (!FadeDurations.Contains(chosenFadeSeconds))
        {
            throw new DomainException(
                MessageKeys.VideoFadeDurationInvalid, ("options", FadeDurations.SkipLast(1).ToList()), ("last", FadeDurations[^1]));
        }

        var chosenFade = fade ?? DefaultFade;
        if (chosenFade != VideoFade.None && chosenFadeSeconds * 2 > trimmed)
        {
            // Fade-in and fade-out (or in loop, the stretch that blends and the one that receives it) cannot overlap.
            throw new DomainException(
                MessageKeys.VideoFadeTooLongForTrim, ("fade", chosenFadeSeconds), ("needed", chosenFadeSeconds * 2), ("trimmed", trimmed));
        }

        return new VideoEdit
        {
            TrimStart = start,
            TrimEnd = end,
            Fade = chosenFade,
            FadeSeconds = chosenFade == VideoFade.None ? DefaultFadeSeconds : chosenFadeSeconds,
        };
    }

    private static void EnsureFinite(double? seconds, string parameter)
    {
        if (seconds is { } value && !double.IsFinite(value))
        {
            throw new ArgumentOutOfRangeException(parameter, value, "The times of an edit must be finite numbers.");
        }
    }

    private static double Round(double seconds) => Math.Round(seconds, Decimals, MidpointRounding.AwayFromZero);

    private static string Invariant(double seconds) => seconds.ToString("0.###", CultureInfo.InvariantCulture);
}
