namespace Blog.Domain;

/// <summary>
/// Regla de tamaño de lo que entra al hero (fotos y videos). El hero es una franja horizontal a todo el ancho: una
/// imagen vertical o cuadrada quedaría casi toda recortada, y una chica se vería borrosa en una pantalla de escritorio.
/// Las fotos de portadas y de posts no pasan por acá.
/// </summary>
public static class HeroFrame
{
    public const int MinWidth = 1280;
    public const int MinHeight = 720;
    public const int IdealWidth = 1920;
    public const int IdealHeight = 1080;

    /// <summary>La guía que ve el admin, igual en cada mensaje.</summary>
    public const string Guide = "Ideal: 1920×1080 o más, horizontal 16:9.";

    // El ancho tiene que ser al menos 1,2 veces el alto (6/5, en enteros para no comparar con decimales):
    // deja afuera verticales, cuadradas y casi cuadradas, que el recorte del hero dejaría irreconocibles.
    private const int MinAspectNumerator = 6;
    private const int MinAspectDenominator = 5;

    /// <exception cref="DomainException">Si es vertical, cuadrada o más chica que 1280×720 (con las medidas recibidas).</exception>
    public static void Ensure(int width, int height)
    {
        if ((long)width * MinAspectDenominator < (long)height * MinAspectNumerator)
        {
            throw new DomainException($"Mide {width}×{height} y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. {Guide}");
        }

        if (width < MinWidth || height < MinHeight)
        {
            throw new DomainException($"Mide {width}×{height} y el mínimo es {MinWidth}×{MinHeight}. {Guide}");
        }
    }

    /// <summary>Se acepta, pero si es más chica que la ideal se avisa: en pantallas grandes se va a ver menos nítida.</summary>
    public static IReadOnlyList<string> WarningsFor(int width, int height) =>
        width < IdealWidth || height < IdealHeight
            ? [$"Mide {width}×{height}: se acepta, pero en pantallas grandes se va a ver menos nítida. {Guide}"]
            : [];
}
