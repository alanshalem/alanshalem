namespace Blog.Domain;

/// <summary>
/// Size rule for what goes into the hero (photos and videos). The hero is a full-width horizontal band: a portrait or
/// square image would be almost entirely cropped, and a small one would look blurry on a desktop screen.
/// Cover and post photos do not go through here.
/// </summary>
public static class HeroFrame
{
    public const int MinWidth = 1280;
    public const int MinHeight = 720;
    public const int IdealWidth = 1920;
    public const int IdealHeight = 1080;

    // The guidance the admin sees, the same in every message (nested, so it is translated with it). It comes from the
    // constants: changing the ideal changes the text.
    private static readonly UserMessage Guide = new(MessageKeys.HeroGuide, ("width", IdealWidth), ("height", IdealHeight));

    // The width must be at least 1.2 times the height (6/5, in integers to avoid comparing decimals): it rules out
    // portrait, square and almost square images, which the hero crop would make unrecognizable.
    private const int MinAspectNumerator = 6;
    private const int MinAspectDenominator = 5;

    /// <exception cref="DomainException">If it is portrait, square or smaller than 1280×720 (with the given size).</exception>
    public static void Ensure(int width, int height)
    {
        if ((long)width * MinAspectDenominator < (long)height * MinAspectNumerator)
        {
            throw new DomainException(MessageKeys.HeroNotLandscape, ("width", width), ("height", height), ("guide", Guide));
        }

        if (width < MinWidth || height < MinHeight)
        {
            throw new DomainException(
                MessageKeys.HeroTooSmall, ("width", width), ("height", height), ("minWidth", MinWidth), ("minHeight", MinHeight), ("guide", Guide));
        }
    }

    /// <summary>
    /// Accepted, but smaller than the ideal size gets a warning: it will look less sharp on large screens. The warning
    /// is a message without text (it is not an error): whoever shows it writes it in the reader's language.
    /// </summary>
    public static IReadOnlyList<UserMessage> WarningsFor(int width, int height) =>
        width < IdealWidth || height < IdealHeight
            ? [new UserMessage(MessageKeys.HeroLowResolution, ("width", width), ("height", height), ("guide", Guide))]
            : [];
}
