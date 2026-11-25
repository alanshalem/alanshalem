/**
 * Idiomas del sitio (L3): dos fijos, español el principal. Es el único lugar del admin que los enumera; no se
 * generaliza a N idiomas (YAGNI). La interfaz del admin sigue en español: esto nombra el idioma de cada post.
 */
export const LANGS = ['es', 'en'] as const;

export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = 'es';

/** Cada idioma en su propio idioma, como se elige en el selector del post nuevo. */
export const LANG_LABELS: Record<Lang, string> = { es: 'Español', en: 'English' };

/** El idioma dentro de una frase del admin: "Crear versión en inglés". */
export const LANG_IN_SENTENCE: Record<Lang, string> = { es: 'español', en: 'inglés' };

/** "ES" / "EN": el prefijo de los chips de versión. */
export const langCode = (lang: Lang): string => lang.toUpperCase();
