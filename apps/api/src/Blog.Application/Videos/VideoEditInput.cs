using System.Globalization;
using Blog.Domain;

namespace Blog.Application.Videos;

/// <summary>
/// The edit fields as they arrive in the upload (text, all optional; empty is the same as not sending it).
/// Here they are only read; which values are valid is decided by <see cref="VideoEdit"/>, which also needs the
/// original's duration (that is why it is converted only after reading the video with ffprobe).
/// </summary>
public sealed record VideoEditInput(string? TrimStart, string? TrimEnd, string? Fade, string? FadeSeconds)
{
    // The contract names, as is: Enum.TryParse would also accept numbers ("0") and capital letters.
    private static readonly Dictionary<string, VideoFade> FadeNames = new(StringComparer.Ordinal)
    {
        ["loop"] = VideoFade.Loop,
        ["black"] = VideoFade.Black,
        ["none"] = VideoFade.None,
    };

    /// <summary>No fields: the default edit.</summary>
    public static VideoEditInput Empty { get; } = new(null, null, null, null);

    /// <exception cref="DomainException">If a field cannot be read or the edit is not valid for that video.</exception>
    public VideoEdit ToEdit(double sourceSeconds) => VideoEdit.Create(
        sourceSeconds,
        Seconds(TrimStart, MessageKeys.VideoFieldTrimStart),
        Seconds(TrimEnd, MessageKeys.VideoFieldTrimEnd),
        ParseFade(Fade),
        Seconds(FadeSeconds, MessageKeys.VideoFieldFadeSeconds));

    // Always a decimal point (invariant culture): "2.5" means the same on any server. The comma, NaN and infinity are
    // rejected; the sign and the ranges are validated by the domain with its message.
    // fieldKey: the name of the field, nested in the message (it is translated too).
    private static double? Seconds(string? text, string fieldKey)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds) && double.IsFinite(seconds)
            ? seconds
            : throw new DomainException(MessageKeys.VideoInvalidNumber, ("field", new UserMessage(fieldKey)));
    }

    // Surrounding spaces are ignored, the same as in numbers (double.TryParse accepts them).
    private static VideoFade? ParseFade(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        return FadeNames.TryGetValue(text.Trim(), out var fade)
            ? fade
            : throw new DomainException(MessageKeys.VideoInvalidFade);
    }
}
