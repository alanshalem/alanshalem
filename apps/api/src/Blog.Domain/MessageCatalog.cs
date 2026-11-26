using System.Globalization;
using System.Text.RegularExpressions;

namespace Blog.Domain;

/// <summary>Un texto del catálogo en los dos idiomas de <see cref="Language"/> (dos fijos, como en el resto del dominio).</summary>
public sealed record LocalizedText(string Spanish, string English)
{
    /// <exception cref="ArgumentOutOfRangeException">Si el idioma no es uno de <see cref="Language"/> (error de programación).</exception>
    public string In(string language) => language switch
    {
        Language.Spanish => Spanish,
        Language.English => English,
        _ => throw new ArgumentOutOfRangeException(nameof(language), language, "Idioma sin validar: pasalo antes por Language."),
    };
}

/// <summary>
/// El único lugar con los textos que ve el admin: cada <see cref="MessageKeys">clave</see> con su español y su inglés.
/// Dominio y casos de uso solo nombran la clave y los argumentos (<see cref="UserMessage"/>); el texto lo elige quien
/// sabe en qué idioma lee la persona (la API, por Accept-Language). Vive en el dominio porque es la capa que todas ven,
/// y no depende de ningún framework: son textos y un reemplazo de {marcadores}.
/// </summary>
public static partial class MessageCatalog
{
    /// <summary>Todas las entradas, por clave. Las pruebas verifican que cada clave declarada tenga los dos textos.</summary>
    public static IReadOnlyDictionary<string, LocalizedText> Entries { get; } = new Dictionary<string, LocalizedText>(StringComparer.Ordinal)
    {
        [MessageKeys.ProblemBadRequest] = new("Datos inválidos", "Invalid data"),
        [MessageKeys.ProblemNotFound] = new("No encontrado", "Not found"),
        [MessageKeys.ProblemConflict] = new("Conflicto", "Conflict"),
        [MessageKeys.ProblemInternalError] = new("Error interno", "Internal error"),

        [MessageKeys.LanguageInvalid] = new(
            "El idioma tiene que ser \"{spanish}\" (español) o \"{english}\" (inglés).",
            "The language must be \"{spanish}\" (Spanish) or \"{english}\" (English)."),
        [MessageKeys.LanguageSpanish] = new("español", "Spanish"),
        [MessageKeys.LanguageEnglish] = new("inglés", "English"),

        [MessageKeys.PostTitleRequired] = new("El título es obligatorio.", "The title is required."),
        [MessageKeys.PostTitleTooLong] = new(
            "El título no puede superar {max} caracteres.", "The title can't be longer than {max} characters."),
        [MessageKeys.PostSlugInvalid] = new(
            "El slug solo admite minúsculas, números y guiones (máx. {max}). Ejemplo: mi-primer-post.",
            "The slug only allows lowercase letters, numbers and hyphens (max. {max}). Example: my-first-post."),
        [MessageKeys.PostSummaryTooLong] = new(
            "El resumen no puede superar {max} caracteres.", "The summary can't be longer than {max} characters."),
        [MessageKeys.PostBodyTooLong] = new(
            "El contenido no puede superar {max} caracteres.", "The content can't be longer than {max} characters."),
        [MessageKeys.PostTooManyTags] = new("Máximo {max} etiquetas.", "At most {max} tags."),
        [MessageKeys.PostTagTooLong] = new(
            "Cada etiqueta puede tener hasta {max} caracteres.", "Each tag can be up to {max} characters long."),
        [MessageKeys.PostCoverUrlTooLong] = new(
            "La URL de la portada no puede superar {max} caracteres.", "The cover URL can't be longer than {max} characters."),
        [MessageKeys.PostCoverUrlInvalid] = new(
            "La portada debe ser una ruta /media/... o una URL http(s).", "The cover must be a /media/... path or an http(s) URL."),
        [MessageKeys.PostCoverAltTooLong] = new(
            "El texto alternativo de la portada no puede superar {max} caracteres.",
            "The cover's alt text can't be longer than {max} characters."),
        [MessageKeys.PostAlreadyInLanguage] = new(
            "El post ya está en {language}: la versión nueva tiene que ser en el otro idioma.",
            "The post is already in {language}: the new version has to be in the other language."),
        [MessageKeys.PostLanguageImmutable] = new(
            "El idioma de un post no se puede cambiar: creá su versión en el otro idioma.",
            "A post's language can't be changed: create its version in the other language."),
        [MessageKeys.PostTranslationExists] = new(
            "Este post ya tiene su versión en {language}.", "This post already has its {language} version."),
        [MessageKeys.PostSlugTaken] = new(
            "Ya existe un post en {language} con el slug \"{slug}\".", "There is already a post in {language} with the slug \"{slug}\"."),
        [MessageKeys.PostSaveConflict] = new(
            "Ya existe un post con ese slug en ese idioma, o el post ya tiene esa versión. Recargá y volvé a intentar.",
            "A post with that slug already exists in that language, or the post already has that version. Reload and try again."),
        [MessageKeys.PostNotFound] = new("El post no existe.", "The post doesn't exist."),
        [MessageKeys.PostRevisionNotFound] = new("La versión no existe.", "The version doesn't exist."),
        [MessageKeys.PostScheduleAlreadyPublished] = new(
            "El post ya está publicado: no se puede programar.", "The post is already published: it can't be scheduled."),
        [MessageKeys.PostScheduleInPast] = new(
            "La fecha de publicación tiene que ser en el futuro.", "The publication date has to be in the future."),
        [MessageKeys.PostPublishAtRequired] = new(
            "Indicá la fecha y hora de publicación.", "Enter the publication date and time."),
        [MessageKeys.PostPublishAtInvalid] = new(
            "La fecha de publicación no es válida: usá ISO 8601 con zona horaria (ej. 2026-12-01T09:00:00-03:00).",
            "The publication date isn't valid: use ISO 8601 with a time zone (e.g. 2026-12-01T09:00:00-03:00)."),

        [MessageKeys.SettingsNameRequired] = new("El nombre es obligatorio.", "The name is required."),
        [MessageKeys.SettingsNameTooLong] = new(
            "El nombre no puede superar {max} caracteres.", "The name can't be longer than {max} characters."),
        [MessageKeys.SettingsTaglineTooLong] = new(
            "La frase no puede superar {max} caracteres.", "The tagline can't be longer than {max} characters."),
        [MessageKeys.SettingsBioTooLong] = new(
            "La bio no puede superar {max} caracteres.", "The bio can't be longer than {max} characters."),
        [MessageKeys.SettingsEmailTooLong] = new(
            "El email no puede superar {max} caracteres.", "The email can't be longer than {max} characters."),
        [MessageKeys.SettingsEmailInvalid] = new("El email no tiene un formato válido.", "The email doesn't have a valid format."),
        [MessageKeys.SettingsLinkTooLong] = new(
            "El enlace de {label} no puede superar {max} caracteres.", "The {label} link can't be longer than {max} characters."),
        [MessageKeys.SettingsLinkInvalid] = new(
            "El enlace de {label} debe ser una URL http(s).", "The {label} link must be an http(s) URL."),
        [MessageKeys.SettingsTaglineEnTooLong] = new(
            "La frase en inglés no puede superar {max} caracteres.", "The English tagline can't be longer than {max} characters."),
        [MessageKeys.SettingsBioEnTooLong] = new(
            "La bio en inglés no puede superar {max} caracteres.", "The English bio can't be longer than {max} characters."),
        [MessageKeys.SettingsSaveConflict] = new(
            "Los ajustes se guardaron al mismo tiempo desde otro lado. Recargá y volvé a intentar.",
            "The settings were saved at the same time from somewhere else. Reload and try again."),

        [MessageKeys.HeroGuide] = new(
            "Ideal: {width}×{height} o más, horizontal 16:9.", "Ideal: {width}×{height} or larger, landscape 16:9."),
        [MessageKeys.HeroNotLandscape] = new(
            "Mide {width}×{height} y el hero necesita una imagen horizontal: vertical o cuadrada no sirve. {guide}",
            "It measures {width}×{height} and the hero needs a landscape image: portrait or square won't do. {guide}"),
        [MessageKeys.HeroTooSmall] = new(
            "Mide {width}×{height} y el mínimo es {minWidth}×{minHeight}. {guide}",
            "It measures {width}×{height} and the minimum is {minWidth}×{minHeight}. {guide}"),
        [MessageKeys.HeroLowResolution] = new(
            "Mide {width}×{height}: se acepta, pero en pantallas grandes se va a ver menos nítida. {guide}",
            "It measures {width}×{height}: it's accepted, but it will look less sharp on large screens. {guide}"),
        [MessageKeys.HeroAltRequired] = new("El texto alternativo es obligatorio.", "The alt text is required."),
        [MessageKeys.HeroAltTooLong] = new(
            "El texto alternativo no puede superar {max} caracteres.", "The alt text can't be longer than {max} characters."),
        [MessageKeys.HeroCreditTooLong] = new(
            "El crédito no puede superar {max} caracteres.", "The credit can't be longer than {max} characters."),
        [MessageKeys.HeroAltEnTooLong] = new(
            "El texto alternativo en inglés no puede superar {max} caracteres.",
            "The English alt text can't be longer than {max} characters."),
        [MessageKeys.HeroVideoProcessing] = new(
            "El video todavía se está procesando: esperá a que esté listo.", "The video is still being processed: wait until it's ready."),
        [MessageKeys.HeroVideoFailed] = new(
            "El video no se pudo procesar. Subilo de nuevo.", "The video couldn't be processed. Upload it again."),
        [MessageKeys.HeroImageNotFound] = new(
            "La imagen elegida no existe. Subila de nuevo.", "The chosen image doesn't exist. Upload it again."),
        [MessageKeys.HeroVideoNotFound] = new(
            "El video elegido no existe. Subilo de nuevo.", "The chosen video doesn't exist. Upload it again."),
        [MessageKeys.HeroSourceRequired] = new("Elegí una foto o un video para el hero.", "Choose a photo or a video for the hero."),
        [MessageKeys.HeroItemNotFound] = new("La foto del hero no existe.", "The hero photo doesn't exist."),

        [MessageKeys.MediaTooLarge] = new("La imagen supera el máximo de {max} MB.", "The image exceeds the {max} MB maximum."),
        [MessageKeys.MediaUnsupportedFormat] = new(
            "Formato no soportado. Subí una imagen PNG, JPG, GIF, WebP o AVIF.",
            "Unsupported format. Upload a PNG, JPG, GIF, WebP or AVIF image."),
        [MessageKeys.MediaUnreadable] = new(
            "No se pudo leer la imagen: el archivo está dañado o incompleto.",
            "The image couldn't be read: the file is damaged or incomplete."),
        [MessageKeys.MediaTooManyPixels] = new(
            "La imagen supera el máximo de {max} megapíxeles.", "The image exceeds the {max} megapixel maximum."),
        [MessageKeys.MediaUploadConflict] = new(
            "Esa imagen se acaba de subir desde otro lado. Volvé a intentar.", "That image was just uploaded from somewhere else. Try again."),

        [MessageKeys.VideoTooLarge] = new("El video supera el máximo de {max} MB.", "The video exceeds the {max} MB maximum."),
        [MessageKeys.VideoUnsupportedFormat] = new(
            "Formato no soportado. Subí un video MP4, MOV, WebM o MKV.", "Unsupported format. Upload an MP4, MOV, WebM or MKV video."),
        [MessageKeys.VideoUnreadable] = new(
            "No se pudo leer el video: el archivo está dañado o no tiene imagen.",
            "The video couldn't be read: the file is damaged or has no picture."),
        [MessageKeys.VideoNotFound] = new("El video no existe.", "The video doesn't exist."),
        [MessageKeys.VideoUploadConflict] = new(
            "Ese video se acaba de subir desde otro lado. Volvé a intentar.", "That video was just uploaded from somewhere else. Try again."),
        [MessageKeys.VideoInvalidNumber] = new(
            "{field} no es un número válido: usá segundos con punto decimal (ej. 2.5).",
            "{field} isn't a valid number: use seconds with a decimal point (e.g. 2.5)."),
        [MessageKeys.VideoFieldTrimStart] = new("El inicio del recorte", "The trim start"),
        [MessageKeys.VideoFieldTrimEnd] = new("El fin del recorte", "The trim end"),
        [MessageKeys.VideoFieldFadeSeconds] = new("La duración del fundido", "The fade duration"),
        [MessageKeys.VideoInvalidFade] = new(
            "Fundido no válido: tiene que ser loop, black o none.", "Invalid fade: it has to be loop, black or none."),
        [MessageKeys.VideoTrimStartNegative] = new(
            "El inicio del recorte no puede ser negativo.", "The trim start can't be negative."),
        [MessageKeys.VideoTrimEndBeforeStart] = new(
            "El fin del recorte tiene que ser posterior al inicio.", "The trim end has to be after the start."),
        [MessageKeys.VideoTrimEndPastVideo] = new(
            "El fin del recorte ({end} s) pasa el final del video, que dura {duration} s.",
            "The trim end ({end} s) goes past the end of the video, which lasts {duration} s."),
        [MessageKeys.VideoTrimTooLong] = new(
            "El tramo elegido dura {trimmed} s y el máximo es {max} s. Acortalo y volvé a subirlo.",
            "The chosen segment lasts {trimmed} s and the maximum is {max} s. Shorten it and upload it again."),
        [MessageKeys.VideoTrimTooShort] = new(
            "El tramo elegido dura {trimmed} s y el mínimo es {min} s.", "The chosen segment lasts {trimmed} s and the minimum is {min} s."),
        [MessageKeys.VideoFadeDurationInvalid] = new(
            "La duración del fundido tiene que ser {options} o {last} s.", "The fade duration must be {options} or {last} s."),
        [MessageKeys.VideoFadeTooLongForTrim] = new(
            "Un fundido de {fade} s necesita un tramo de al menos {needed} s y el elegido dura {trimmed} s. Elegí un fundido más corto o un tramo más largo.",
            "A {fade} s fade needs a segment of at least {needed} s and the chosen one lasts {trimmed} s. Choose a shorter fade or a longer segment."),
    };

    // Segundos con hasta dos decimales, con el separador de cada idioma y sin depender de la cultura del servidor.
    private const string SecondsFormat = "0.##";
    private static readonly NumberFormatInfo SpanishNumbers = new() { NumberDecimalSeparator = "," };

    [GeneratedRegex(@"\{(\w+)\}")]
    private static partial Regex Placeholder();

    /// <summary>El texto del mensaje en ese idioma, con cada {marcador} reemplazado por su argumento.</summary>
    /// <exception cref="KeyNotFoundException">Si la clave no está en el catálogo.</exception>
    /// <exception cref="InvalidOperationException">Si falta el argumento de un marcador.</exception>
    /// <exception cref="ArgumentOutOfRangeException">Si el idioma no es uno de <see cref="Language"/>.</exception>
    public static string Format(UserMessage message, string language)
    {
        var text = Entries[message.Key].In(language);
        return Placeholder().Replace(text, match =>
        {
            var name = match.Groups[1].Value;
            return message.Arguments.TryGetValue(name, out var value)
                ? Render(value, language)
                : throw new InvalidOperationException($"Falta el argumento {{{name}}} del mensaje {message.Key}.");
        });
    }

    // Un mensaje anidado (un nombre de idioma, un campo) se escribe en el mismo idioma; los decimales, con su separador;
    // una lista de segundos, separada por comas; el resto (enteros, textos) tal cual, sin separador de miles.
    private static string Render(object value, string language) => value switch
    {
        UserMessage nested => Format(nested, language),
        double seconds => seconds.ToString(SecondsFormat, NumbersOf(language)),
        IEnumerable<double> list => string.Join(", ", list.Select(item => Render(item, language))),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };

    // El idioma ya pasó por LocalizedText.In al elegir el texto: acá solo puede ser uno de los dos.
    private static NumberFormatInfo NumbersOf(string language) =>
        language == Language.English ? NumberFormatInfo.InvariantInfo : SpanishNumbers;
}
