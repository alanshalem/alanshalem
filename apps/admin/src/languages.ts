/**
 * Site languages: two fixed ones, Spanish the main one. This is the only place in the admin that lists them; they are
 * not generalized to N languages (YAGNI). They name each post's language and also the admin UI language, which is
 * chosen separately; their display names live in the dictionary (`lang.label.*`, `lang.inSentence.*`).
 */
export const LANGS = ['es', 'en'] as const;

export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = 'es';

/** "ES" / "EN": the prefix of the version chips and of the UI language selector. */
export const langCode = (lang: Lang): string => lang.toUpperCase();
