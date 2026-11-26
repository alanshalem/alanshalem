using System.Globalization;
using Blog.Domain;

namespace Blog.Application.Videos;

/// <summary>
/// Los campos de edición tal como llegan en la subida (texto, todos opcionales; vacío es lo mismo que no mandarlo).
/// Acá solo se leen; qué valores son válidos lo decide <see cref="VideoEdit"/>, que además necesita la duración del
/// original (por eso se convierte recién después de leer el video con ffprobe).
/// </summary>
public sealed record VideoEditInput(string? TrimStart, string? TrimEnd, string? Fade, string? FadeSeconds)
{
    // Los nombres del contrato, tal cual: Enum.TryParse aceptaría también números ("0") y mayúsculas.
    private static readonly Dictionary<string, VideoFade> FadeNames = new(StringComparer.Ordinal)
    {
        ["loop"] = VideoFade.Loop,
        ["black"] = VideoFade.Black,
        ["none"] = VideoFade.None,
    };

    /// <summary>Sin campos: la edición por defecto.</summary>
    public static VideoEditInput Empty { get; } = new(null, null, null, null);

    /// <exception cref="DomainException">Si un campo no se puede leer o la edición no es válida para ese video.</exception>
    public VideoEdit ToEdit(double sourceSeconds) => VideoEdit.Create(
        sourceSeconds,
        Seconds(TrimStart, MessageKeys.VideoFieldTrimStart),
        Seconds(TrimEnd, MessageKeys.VideoFieldTrimEnd),
        ParseFade(Fade),
        Seconds(FadeSeconds, MessageKeys.VideoFieldFadeSeconds));

    // Punto decimal siempre (cultura invariante): "2.5" significa lo mismo en cualquier servidor. Se rechazan la coma,
    // NaN e infinito; el signo y los rangos los valida el dominio con su mensaje.
    // fieldKey: el nombre del campo, que va anidado en el mensaje (también se traduce).
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

    // Los espacios alrededor se ignoran, igual que en los números (double.TryParse los acepta).
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
