import { DEFAULT_LANG, langCode, LANGS, type Lang } from '../languages.ts';
import { en } from './en.ts';
import { es, type Dictionary, type MessageKey } from './es.ts';

/*
 * The admin UI language: independent from each post's language, although it uses the same codes. Everything here is
 * pure (no React, no DOM): rule modules receive an `I18n` parameter and tests choose the language with `i18nFor`.
 * No library: two fixed languages, interpolation and singular/plural are enough (KISS).
 */

export type { MessageKey };

export type Params = Readonly<Record<string, string | number>>;

/** The text of `key` with its `{parameters}`; numbers through `formatNumber`. A missing one stays visible. */
export type Translate = (key: MessageKey, params?: Params) => string;

/** The keys that have their `.one` / `.other` pair, without the suffix (`'posts.count'`). */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? (`${Base}.other` extends MessageKey ? Base : never) : never;
}[MessageKey];

export interface I18n {
  readonly lang: Lang;
  readonly t: Translate;
  /** `.one` if `count` is 1 and `.other` otherwise (so in Spanish and in English); `{count}` is included. */
  readonly plural: (count: number, key: PluralKey, params?: Params) => string;
  /** At most one decimal (the finest the admin shows: video seconds), without a thousands separator. */
  readonly formatNumber: (value: number, minimumFractionDigits?: 0 | 1) => string;
  readonly formatDate: (iso: string) => string;
  /** Hours and minutes in the browser's zone ("14:05" / "2:05 PM"): the editor's "Guardado". */
  readonly formatTime: (date: Date) => string;
  /** Date and time in the browser's zone ("1 dic 2026, 09:00"): history revisions and scheduled publishing. */
  readonly formatDateTime: (iso: string) => string;
}

const DICTIONARIES: Record<Lang, Dictionary> = { es, en };

// Rioplatense Spanish, like the texts ("Entrá", "Guardá"); US English.
const LOCALES: Record<Lang, string> = { es: 'es-AR', en: 'en-US' };

const PLACEHOLDER = /\{(\w+)\}/g;

function createI18n(lang: Lang): I18n {
  const dictionary = DICTIONARIES[lang];
  // Intl.*Format objects are expensive to create: one per language and format, when the module loads.
  const numbers = ([0, 1] as const).map(
    (minimumFractionDigits) =>
      new Intl.NumberFormat(LOCALES[lang], { minimumFractionDigits, maximumFractionDigits: 1, useGrouping: false }),
  );
  const dates = new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: 'medium' });
  // In Argentina hours go from 0 to 23 ("14:05"); ICU uses p. m. by default for es-AR.
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
    // Date and time separately: together, es-AR turns the date into "1 de dic de 2026" and it would not match the list's.
    formatDateTime: (iso) => `${dates.format(new Date(iso))}, ${times.format(new Date(iso))}`,
  };
}

const INSTANCES: Record<Lang, I18n> = { es: createI18n('es'), en: createI18n('en') };

/** Always the same instance per language: it can be a hook dependency without re-running them. */
export const i18nFor = (lang: Lang): I18n => INSTANCES[lang];

export const UI_LANG_STORAGE_KEY = 'admin.uiLang';

const isLang = (value: unknown): value is Lang => (LANGS as readonly unknown[]).includes(value);

/**
 * Initial language: the one the user chose (localStorage) or, if never chosen, the browser's: English if it is en*,
 * Spanish for everything else (the site's main language). Without storage (blocked), the browser decides.
 */
export function loadUiLang(storage: Pick<Storage, 'getItem'> | null, browserLanguage: string): Lang {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(UI_LANG_STORAGE_KEY) ?? null;
  } catch {
    /* blocked storage: as if never chosen */
  }
  if (isLang(stored)) return stored;
  return browserLanguage.toLowerCase().startsWith('en') ? 'en' : DEFAULT_LANG;
}

/** Remembers the choice. If it cannot be stored, it lasts as long as the tab: not a reason for an error. */
export function saveUiLang(storage: Pick<Storage, 'setItem'> | null, lang: Lang): void {
  try {
    storage?.setItem(UI_LANG_STORAGE_KEY, lang);
  } catch {
    /* quota full or blocked storage */
  }
}

/**
 * Name of a language selector button: first what is visible ("ES") and then the full language, so voice control
 * users can say "ES" and listeners know which one it is (WCAG 2.5.3).
 */
export const uiLangButtonName = (lang: Lang, t: Translate): string => `${langCode(lang)} – ${t(`lang.label.${lang}`)}`;
