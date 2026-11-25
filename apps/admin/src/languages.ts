/**
 * Idiomas del sitio (L3): dos fijos, español el principal. Es el único lugar del admin que los enumera; no se
 * generaliza a N idiomas (YAGNI). Nombran el idioma de cada post y también el de la interfaz del admin (S6), que se
 * elige aparte; sus nombres para mostrar están en el diccionario (`lang.label.*`, `lang.inSentence.*`).
 */
export const LANGS = ['es', 'en'] as const;

export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = 'es';

/** "ES" / "EN": el prefijo de los chips de versión y el selector de idioma de la interfaz. */
export const langCode = (lang: Lang): string => lang.toUpperCase();
