namespace Blog.Domain;

/// <summary>
/// Las claves del catálogo de mensajes (<see cref="MessageCatalog"/>). Son parte del contrato de la API: viajan como
/// "code" en cada error, así el admin decide por la clave y no por el texto. Una clave publicada no se renombra.
/// Forma: área.nombre (área en minúsculas, nombre en camelCase).
/// </summary>
public static class MessageKeys
{
    // ----- Títulos de las respuestas de error (problem details) -----
    public const string ProblemBadRequest = "problem.badRequest";
    public const string ProblemNotFound = "problem.notFound";
    public const string ProblemConflict = "problem.conflict";
    public const string ProblemInternalError = "problem.internalError";
    public const string ProblemUnavailable = "problem.unavailable";

    // ----- Idiomas -----
    public const string LanguageInvalid = "language.invalid";
    public const string LanguageSpanish = "language.spanish";
    public const string LanguageEnglish = "language.english";

    // ----- Posts -----
    public const string PostTitleRequired = "post.titleRequired";
    public const string PostTitleTooLong = "post.titleTooLong";
    public const string PostSlugInvalid = "post.slugInvalid";
    public const string PostSummaryTooLong = "post.summaryTooLong";
    public const string PostBodyTooLong = "post.bodyTooLong";
    public const string PostTooManyTags = "post.tooManyTags";
    public const string PostTagTooLong = "post.tagTooLong";
    public const string PostCoverUrlTooLong = "post.coverUrlTooLong";
    public const string PostCoverUrlInvalid = "post.coverUrlInvalid";
    public const string PostCoverAltTooLong = "post.coverAltTooLong";
    public const string PostAlreadyInLanguage = "post.alreadyInLanguage";
    public const string PostLanguageImmutable = "post.languageImmutable";
    public const string PostTranslationExists = "post.translationExists";
    public const string PostSlugTaken = "post.slugTaken";
    public const string PostSaveConflict = "post.saveConflict";
    public const string PostNotFound = "post.notFound";
    public const string PostRevisionNotFound = "post.revisionNotFound";
    public const string PostScheduleAlreadyPublished = "post.scheduleAlreadyPublished";
    public const string PostScheduleInPast = "post.scheduleInPast";
    public const string PostPublishAtRequired = "post.publishAtRequired";
    public const string PostPublishAtInvalid = "post.publishAtInvalid";

    // ----- Ajustes del sitio -----
    public const string SettingsNameRequired = "settings.nameRequired";
    public const string SettingsNameTooLong = "settings.nameTooLong";
    public const string SettingsTaglineTooLong = "settings.taglineTooLong";
    public const string SettingsBioTooLong = "settings.bioTooLong";
    public const string SettingsEmailTooLong = "settings.emailTooLong";
    public const string SettingsEmailInvalid = "settings.emailInvalid";
    public const string SettingsLinkTooLong = "settings.linkTooLong";
    public const string SettingsLinkInvalid = "settings.linkInvalid";
    public const string SettingsTaglineEnTooLong = "settings.taglineEnTooLong";
    public const string SettingsBioEnTooLong = "settings.bioEnTooLong";
    public const string SettingsSaveConflict = "settings.saveConflict";

    // ----- Hero (galería de la home y su regla de tamaño) -----
    public const string HeroGuide = "hero.guide";
    public const string HeroNotLandscape = "hero.notLandscape";
    public const string HeroTooSmall = "hero.tooSmall";
    public const string HeroLowResolution = "hero.lowResolution";
    public const string HeroAltRequired = "hero.altRequired";
    public const string HeroAltTooLong = "hero.altTooLong";
    public const string HeroCreditTooLong = "hero.creditTooLong";
    public const string HeroAltEnTooLong = "hero.altEnTooLong";
    public const string HeroVideoProcessing = "hero.videoProcessing";
    public const string HeroVideoFailed = "hero.videoFailed";
    public const string HeroImageNotFound = "hero.imageNotFound";
    public const string HeroVideoNotFound = "hero.videoNotFound";
    public const string HeroSourceRequired = "hero.sourceRequired";
    public const string HeroItemNotFound = "hero.itemNotFound";

    // ----- Imágenes -----
    public const string MediaTooLarge = "media.tooLarge";
    public const string MediaUnsupportedFormat = "media.unsupportedFormat";
    public const string MediaUnreadable = "media.unreadable";
    public const string MediaTooManyPixels = "media.tooManyPixels";
    public const string MediaUploadConflict = "media.uploadConflict";

    // ----- Videos -----
    public const string VideoTooLarge = "video.tooLarge";
    public const string VideoUnsupportedFormat = "video.unsupportedFormat";
    public const string VideoUnreadable = "video.unreadable";
    public const string VideoNotFound = "video.notFound";
    public const string VideoUploadConflict = "video.uploadConflict";
    public const string VideoInvalidNumber = "video.invalidNumber";
    public const string VideoFieldTrimStart = "video.field.trimStart";
    public const string VideoFieldTrimEnd = "video.field.trimEnd";
    public const string VideoFieldFadeSeconds = "video.field.fadeSeconds";
    public const string VideoInvalidFade = "video.invalidFade";
    public const string VideoTrimStartNegative = "video.trimStartNegative";
    public const string VideoTrimEndBeforeStart = "video.trimEndBeforeStart";
    public const string VideoTrimEndPastVideo = "video.trimEndPastVideo";
    public const string VideoTrimTooLong = "video.trimTooLong";
    public const string VideoTrimTooShort = "video.trimTooShort";
    public const string VideoFadeDurationInvalid = "video.fadeDurationInvalid";
    public const string VideoFadeTooLongForTrim = "video.fadeTooLongForTrim";
}
