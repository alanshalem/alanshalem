import { sanitizeUrl } from '@blog/markdown';
import { getInternal, oncePerBuild } from './api.ts';
import { DEFAULT_LANG, ui, type Lang } from './i18n.ts';

/** Forma en que la API entrega los ajustes del sitio (GET /api/internal/settings, L4). */
export interface ApiSettings {
  name: string | null;
  tagline: string | null;
  /** Markdown corto: se renderiza con @blog/markdown. */
  bio: string | null;
  /** Versiones en inglés (L4, L6); nulas → se usa el español. El nombre es uno solo en los dos idiomas (L12). */
  taglineEn?: string | null;
  bioEn?: string | null;
  email: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
}

/** Ajustes ya resueltos para las páginas de UN idioma. */
export interface SiteSettings {
  name: string;
  tagline: string;
  author: string;
  bio: string | null;
  email: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
}

type Env = Partial<Record<'SITE_NAME' | 'SITE_TAGLINE' | 'SITE_AUTHOR', string | undefined>>;

/** Texto recortado; vacío => null. */
const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** Solo links http(s) que pasan la allowlist de @blog/markdown. */
const webUrl = (value: string | null | undefined): string | null => {
  const url = text(value) === null ? null : sanitizeUrl(value as string);
  return url && /^https?:\/\//i.test(url) ? url : null;
};

const emailAddress = (value: string | null | undefined): string | null => {
  const email = text(value);
  return email && /^[^\s@<>"]+@[^\s@<>"]+$/.test(email) ? email : null;
};

/**
 * Ajustes efectivos de un idioma: manda la API; SITE_NAME / SITE_TAGLINE / SITE_AUTHOR solo cubren lo que llega vacío,
 * y si tampoco están, los respaldos del diccionario en el idioma de la página.
 * En inglés, bajada y bio usan taglineEn / bioEn y, si faltan, los de español (L3, L6): mejor un texto en español
 * que ninguno. El nombre es uno solo en los dos idiomas (L12); el autor (pie "© año …") es ese nombre.
 */
export function toSiteSettings(api: Partial<ApiSettings>, env: Env, lang: Lang = DEFAULT_LANG): SiteSettings {
  // Campo en español con su par `En`: en inglés gana el par si trae texto.
  const localized = (es: string | null | undefined, english: string | null | undefined): string | null =>
    (lang === 'en' ? text(english) : null) ?? text(es);
  const t = ui(lang);
  const name = text(api.name);
  return {
    name: name ?? text(env.SITE_NAME) ?? t.defaultName,
    tagline: localized(api.tagline, api.taglineEn) ?? text(env.SITE_TAGLINE) ?? t.defaultTagline,
    author: name ?? text(env.SITE_AUTHOR) ?? t.defaultAuthor,
    bio: localized(api.bio, api.bioEn),
    email: emailAddress(api.email),
    githubUrl: webUrl(api.githubUrl),
    linkedinUrl: webUrl(api.linkedinUrl),
    xUrl: webUrl(api.xUrl),
  };
}

/** Links de contacto presentes, en el orden en que se muestran (hero y footer). */
export function contactLinks(settings: SiteSettings): Array<{ label: string; href: string }> {
  const links: Array<{ label: string; href: string | null }> = [
    { label: settings.email ?? '', href: settings.email && `mailto:${settings.email}` },
    { label: 'GitHub', href: settings.githubUrl },
    { label: 'LinkedIn', href: settings.linkedinUrl },
    { label: 'X', href: settings.xUrl },
  ];
  return links.filter((link): link is { label: string; href: string } => Boolean(link.href));
}

const getApiSettings = oncePerBuild(() =>
  getInternal<Partial<ApiSettings>>('/api/internal/settings', 'los ajustes del sitio'),
);

/** Una sola petición por build para los dos idiomas; cada página resuelve los suyos. */
export const getSettings = async (lang: Lang): Promise<SiteSettings> =>
  toSiteSettings(await getApiSettings(), process.env, lang);
