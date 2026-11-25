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
    /// <summary>Lo que puede durar el tramo elegido (S12).</summary>
    public const double MinSeconds = 1;

    public const double MaxSeconds = 15;

    public const VideoFade DefaultFade = VideoFade.Loop;
    public const double DefaultFadeSeconds = 1;

    // Los contenedores redondean la duración y el navegador la mide distinto que ffprobe (15 s exportados por un
    // teléfono suelen medir 15,02 s): este margen evita rechazar por centésimas que nadie eligió.
    private const double ToleranceSeconds = 0.1;

    private const int Decimals = 3;

    // Coma decimal como se escribe en español, sin depender de la cultura del servidor.
    private static readonly NumberFormatInfo SpanishNumbers = new() { NumberDecimalSeparator = "," };

    // Constructor para EF Core.
    private VideoEdit()
    {
    }

    /// <summary>Corto, medio y largo (S15).</summary>
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

    /// <summary>Valida y normaliza la edición pedida. Lo que no se pide toma su valor por defecto.</summary>
    /// <param name="sourceSeconds">Duración del original (la que mide ffprobe).</param>
    /// <exception cref="DomainException">Si el tramo no queda entre 1 y 15 s, se sale del video o no le entra el fundido.</exception>
    public static VideoEdit Create(double sourceSeconds, double? trimStart, double? trimEnd, VideoFade? fade, double? fadeSeconds)
    {
        // Rechazar texto que no es un número es trabajo de quien lee el pedido; un NaN acá pasaría todas las comparaciones.
        if (!double.IsFinite(sourceSeconds) || new[] { trimStart, trimEnd, fadeSeconds }.Any(value => value is { } number && !double.IsFinite(number)))
        {
            throw new ArgumentOutOfRangeException(nameof(sourceSeconds), "Los tiempos de una edición tienen que ser números finitos.");
        }

        var start = Round(trimStart ?? 0);
        if (start < 0)
        {
            throw new DomainException("El inicio del recorte no puede ser negativo.");
        }

        var end = Round(trimEnd ?? Math.Min(sourceSeconds, MaxSeconds));
        if (end <= start)
        {
            throw new DomainException("El fin del recorte tiene que ser posterior al inicio.");
        }

        if (end > sourceSeconds + ToleranceSeconds)
        {
            throw new DomainException($"El fin del recorte ({Spanish(end)} s) pasa el final del video, que dura {Spanish(sourceSeconds)} s.");
        }

        // Dentro del margen, el fin es el final real: el mismo pedido con 15,02 o 15 produce el mismo video.
        end = Math.Min(end, Round(sourceSeconds));
        var trimmed = Round(end - start);
        if (trimmed > MaxSeconds + ToleranceSeconds)
        {
            throw new DomainException($"El tramo elegido dura {Spanish(trimmed)} s y el máximo es {Spanish(MaxSeconds)} s. Acortalo y volvé a subirlo.");
        }

        if (trimmed < MinSeconds)
        {
            throw new DomainException($"El tramo elegido dura {Spanish(trimmed)} s y el mínimo es {Spanish(MinSeconds)} s.");
        }

        var chosenFadeSeconds = fadeSeconds ?? DefaultFadeSeconds;
        if (!FadeDurations.Contains(chosenFadeSeconds))
        {
            throw new DomainException("La duración del fundido tiene que ser 0,5, 1 o 2 s.");
        }

        var chosenFade = fade ?? DefaultFade;
        if (chosenFade != VideoFade.None && chosenFadeSeconds * 2 > trimmed)
        {
            // Entrada y salida (o en loop, el tramo que se funde y el que lo recibe) no pueden superponerse.
            throw new DomainException(
                $"Un fundido de {Spanish(chosenFadeSeconds)} s necesita un tramo de al menos {Spanish(chosenFadeSeconds * 2)} s y el elegido dura {Spanish(trimmed)} s. Elegí un fundido más corto o un tramo más largo.");
        }

        return new VideoEdit
        {
            TrimStart = start,
            TrimEnd = end,
            Fade = chosenFade,
            FadeSeconds = chosenFade == VideoFade.None ? DefaultFadeSeconds : chosenFadeSeconds,
        };
    }

    private static double Round(double seconds) => Math.Round(seconds, Decimals, MidpointRounding.AwayFromZero);

    private static string Invariant(double seconds) => seconds.ToString("0.###", CultureInfo.InvariantCulture);

    private static string Spanish(double seconds) => seconds.ToString("0.##", SpanishNumbers);
}
