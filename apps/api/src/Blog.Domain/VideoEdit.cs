using System.Globalization;

namespace Blog.Domain;

/// <summary>Cómo empalma el video consigo mismo al repetirse en el hero.</summary>
public enum VideoFade
{
    /// <summary>El final se funde con el principio: el último cuadro sigue sin salto en el primero.</summary>
    Loop,

    /// <summary>Aparece desde negro al empezar y se va a negro al terminar.</summary>
    Black,

    /// <summary>Corte directo.</summary>
    None,
}

/// <summary>
/// El recorte y el fundido que se aplican al procesar un video, ya validados contra la duración del original y
/// normalizados: dos pedidos que producen el mismo resultado son la misma edición (y el mismo asset). Los tiempos
/// son segundos del original, redondeados al milisegundo.
/// </summary>
public sealed record VideoEdit
{
    /// <summary>
    /// Lo que puede durar el tramo elegido. Es el fondo del hero y se repite en loop: hasta 15 s alcanza para que la
    /// repetición no se note y deja acotado lo que baja cada visita; menos de 1 s sería un parpadeo.
    /// </summary>
    public const double MinSeconds = 1;

    public const double MaxSeconds = 15;

    public const VideoFade DefaultFade = VideoFade.Loop;
    public const double DefaultFadeSeconds = 1;

    // Los contenedores redondean la duración y el navegador la mide distinto que ffprobe (15 s exportados por un
    // teléfono suelen medir 15,02 s): este margen evita rechazar por centésimas que nadie eligió.
    private const double ToleranceSeconds = 0.1;

    private const int Decimals = 3;

    // Constructor para EF Core.
    private VideoEdit()
    {
    }

    /// <summary>
    /// Las duraciones de fundido que se pueden elegir: corta, media y larga. Pocas a propósito, así el admin compara
    /// cada una en la vista previa en vez de afinar décimas. Es la única lista: el mensaje de error sale de acá.
    /// </summary>
    public static IReadOnlyList<double> FadeDurations { get; } = [0.5, 1, 2];

    public double TrimStart { get; private set; }
    public double TrimEnd { get; private set; }
    public VideoFade Fade { get; private set; }

    /// <summary>Sin fundido no se usa: queda en el valor por defecto para que no distinga dos ediciones iguales.</summary>
    public double FadeSeconds { get; private set; }

    /// <summary>Lo que dura el tramo recortado.</summary>
    public double TrimmedSeconds => Round(TrimEnd - TrimStart);

    /// <summary>
    /// Lo que dura el video final. En loop el último tramo de fundido se superpone con el principio, así que el
    /// resultado es más corto que el recorte.
    /// </summary>
    public double OutputSeconds => Fade == VideoFade.Loop ? Round(TrimmedSeconds - FadeSeconds) : TrimmedSeconds;

    /// <summary>
    /// Segundo del original del primer cuadro que se ve entero: en black, donde termina el fundido de entrada; en
    /// loop, donde arranca el video final (lo anterior solo aparece fundido al final). De ahí sale el póster.
    /// </summary>
    public double FirstVisibleSecond => Fade == VideoFade.None ? TrimStart : Round(TrimStart + FadeSeconds);

    /// <summary>Texto estable que identifica la edición (ej. "2-15-loop-1"): junto al hash del original, define el asset.</summary>
    public string Key => string.Join('-', Invariant(TrimStart), Invariant(TrimEnd), Fade.ToString().ToLowerInvariant(), Invariant(FadeSeconds));

    /// <summary>Lo que pasa sin campos de edición: los primeros min(duración, 15) s con loop de 1 s.</summary>
    public static VideoEdit DefaultFor(double sourceSeconds) => Create(sourceSeconds, null, null, null, null);

    /// <summary>
    /// Valida y normaliza la edición pedida. Lo que no se pide toma su valor por defecto; sin fin, el tramo sigue hasta
    /// 15 s después del inicio (o hasta el final del video, si termina antes).
    /// </summary>
    /// <param name="sourceSeconds">Duración del original (la que mide ffprobe).</param>
    /// <exception cref="DomainException">Si el tramo no queda entre 1 y 15 s, se sale del video o no le entra el fundido.</exception>
    public static VideoEdit Create(double sourceSeconds, double? trimStart, double? trimEnd, VideoFade? fade, double? fadeSeconds)
    {
        // Rechazar texto que no es un número es trabajo de quien lee el pedido; un NaN acá pasaría todas las comparaciones.
        EnsureFinite(sourceSeconds, nameof(sourceSeconds));
        EnsureFinite(trimStart, nameof(trimStart));
        EnsureFinite(trimEnd, nameof(trimEnd));
        EnsureFinite(fadeSeconds, nameof(fadeSeconds));

        var start = Round(trimStart ?? 0);
        if (start < 0)
        {
            throw new DomainException(MessageKeys.VideoTrimStartNegative);
        }

        // El fin por defecto se cuenta desde el inicio elegido: pedir solo el inicio da el tramo más largo posible desde ahí.
        var end = Round(trimEnd ?? Math.Min(sourceSeconds, start + MaxSeconds));
        if (end <= start)
        {
            throw new DomainException(MessageKeys.VideoTrimEndBeforeStart);
        }

        if (end > sourceSeconds + ToleranceSeconds)
        {
            throw new DomainException(MessageKeys.VideoTrimEndPastVideo, ("end", end), ("duration", sourceSeconds));
        }

        // Dentro del margen, el fin es el final real: el mismo pedido con 15,02 o 15 produce el mismo video.
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
            // Entrada y salida (o en loop, el tramo que se funde y el que lo recibe) no pueden superponerse.
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
            throw new ArgumentOutOfRangeException(parameter, value, "Los tiempos de una edición tienen que ser números finitos.");
        }
    }

    private static double Round(double seconds) => Math.Round(seconds, Decimals, MidpointRounding.AwayFromZero);

    private static string Invariant(double seconds) => seconds.ToString("0.###", CultureInfo.InvariantCulture);
}
