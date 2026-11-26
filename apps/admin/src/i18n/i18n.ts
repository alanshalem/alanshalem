import { DEFAULT_LANG, langCode, LANGS, type Lang } from '../languages.ts';
import { en } from './en.ts';
import { es, type Dictionary, type MessageKey } from './es.ts';

/*
 * Idioma de la interfaz del admin (S6, L4): independiente del idioma de cada post, aunque usa los mismos códigos.
 * Todo acá es puro (sin React ni DOM): los módulos de reglas reciben un `I18n` como parámetro y los tests eligen
 * el idioma con `i18nFor`. Sin librería: dos idiomas fijos, interpolación y singular/plural alcanzan (KISS).
 */

export type { MessageKey };

export type Params = Readonly<Record<string, string | number>>;

/** El texto de `key` con sus `{parámetros}`; los números, con `formatNumber`. Uno que falta queda a la vista. */
export type Translate = (key: MessageKey, params?: Params) => string;

/** Las claves que tienen su par `.one` / `.other`, sin el sufijo (`'posts.count'`). */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? (`${Base}.other` extends MessageKey ? Base : never) : never;
}[MessageKey];

export interface I18n {
  readonly lang: Lang;
  readonly t: Translate;
  /** `.one` si `count` es 1 y `.other` si no (así en español y en inglés); `{count}` va incluido. */
  readonly plural: (count: number, key: PluralKey, params?: Params) => string;
  /** A lo sumo una décima (lo más fino que muestra el admin: segundos de video), sin separador de miles. */
  readonly formatNumber: (value: number, minimumFractionDigits?: 0 | 1) => string;
  readonly formatDate: (iso: string) => string;
  /** Hora y minutos en la zona del navegador ("14:05" / "2:05 PM"): el "Guardado" del editor. */
  readonly formatTime: (date: Date) => string;
  /** Fecha y hora en la zona del navegador ("1 dic 2026, 09:00"): versiones del historial y publicación programada. */
  readonly formatDateTime: (iso: string) => string;
}

const DICTIONARIES: Record<Lang, Dictionary> = { es, en };

// Español rioplatense, como los textos ("Entrá", "Guardá"); inglés de EE. UU.
const LOCALES: Record<Lang, string> = { es: 'es-AR', en: 'en-US' };

const PLACEHOLDER = /\{(\w+)\}/g;

function createI18n(lang: Lang): I18n {
  const dictionary = DICTIONARIES[lang];
  // Los Intl.*Format son caros de crear: uno por idioma y formato, al cargar el módulo.
  const numbers = ([0, 1] as const).map(
    (minimumFractionDigits) =>
      new Intl.NumberFormat(LOCALES[lang], { minimumFractionDigits, maximumFractionDigits: 1, useGrouping: false }),
  );
  const dates = new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: 'medium' });
  // En la Argentina la hora va de 0 a 23 ("14:05"); ICU usa p. m. por defecto para es-AR.
  const times = new Intl.DateTimeFormat(LOCALES[lang], { timeStyle: 'short', hourCycle: lang === 'es' ? 'h23' : undefined });

  const formatNumber = (value: number, minimumFractionDigits: 0 | 1 = 0): string =>
    numbers[minimumFractionDigits]!.format(value);

  const t = (key: MessageKey, params: Params = {}): string =>
    dictionary[key].replace(PLACEHOLDER, (placeholder, name: string) => {
      const value = params[name];
      if (value === undefined) return placeholder;
      return typeof value === 'number' ? formatNumber(value) : value;
    });

  return {
    lang,
    t,
    plural: (count, key, params) => t(`${key}.${count === 1 ? 'one' : 'other'}` as MessageKey, { ...params, count }),
    formatNumber,
    formatDate: (iso) => dates.format(new Date(iso)),
    formatTime: (date) => times.format(date),
    // Fecha y hora por separado: juntas, es-AR cambia la fecha a "1 de dic de 2026" y no coincidiría con la de la lista.
    formatDateTime: (iso) => `${dates.format(new Date(iso))}, ${times.format(new Date(iso))}`,
  };
}

const INSTANCES: Record<Lang, I18n> = { es: createI18n('es'), en: createI18n('en') };

/** Siempre la misma instancia por idioma: se puede usar como dependencia de hooks sin re-ejecutarlos. */
export const i18nFor = (lang: Lang): I18n => INSTANCES[lang];

export const UI_LANG_STORAGE_KEY = 'admin.uiLang';

const isLang = (value: unknown): value is Lang => (LANGS as readonly unknown[]).includes(value);

/**
 * Idioma inicial: el que eligió el usuario (localStorage) o, si nunca eligió, el del navegador: inglés si es en*,
 * español para todo lo demás (el idioma principal del sitio). Sin almacenamiento (bloqueado), decide el navegador.
 */
export function loadUiLang(storage: Pick<Storage, 'getItem'> | null, browserLanguage: string): Lang {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(UI_LANG_STORAGE_KEY) ?? null;
  } catch {
    /* almacenamiento bloqueado: como si nunca se hubiera elegido */
  }
  if (isLang(stored)) return stored;
  return browserLanguage.toLowerCase().startsWith('en') ? 'en' : DEFAULT_LANG;
}

/** Recuerda la elección. Si no se puede guardar, dura lo que dure la pestaña: no es motivo para un error. */
export function saveUiLang(storage: Pick<Storage, 'setItem'> | null, lang: Lang): void {
  try {
    storage?.setItem(UI_LANG_STORAGE_KEY, lang);
  } catch {
    /* cuota llena o almacenamiento bloqueado */
  }
}

/**
 * Nombre de un botón del selector de idioma: primero lo que se ve ("ES") y después el idioma completo, para que
 * quien usa control por voz pueda decir "ES" y quien escucha sepa cuál es (WCAG 2.5.3).
 */
export const uiLangButtonName = (lang: Lang, t: Translate): string => `${langCode(lang)} – ${t(`lang.label.${lang}`)}`;
