import { sanitizeUrl } from '@blog/markdown';
import { getInternal } from './api.ts';

/** Forma en que la API entrega los ajustes del sitio (GET /api/internal/settings, L4). */
export interface ApiSettings {
  name: string | null;
  tagline: string | null;
  /** Markdown corto: se renderiza con @blog/markdown. */
  bio: string | null;
  email: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
}

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

const DEFAULT_NAME = 'Mi blog';
const DEFAULT_TAGLINE = 'Notas sobre software, ideas y cosas que estoy aprendiendo.';
const DEFAULT_AUTHOR = 'El autor';

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
 * Ajustes efectivos: manda la API; SITE_NAME / SITE_TAGLINE / SITE_AUTHOR solo cubren lo que llega vacío.
 * El autor (pie "© año …") es el nombre de los ajustes.
 */
export function toSiteSettings(api: Partial<ApiSettings>, env: Env): SiteSettings {
  const name = text(api.name);
  return {
    name: name ?? text(env.SITE_NAME) ?? DEFAULT_NAME,
    tagline: text(api.tagline) ?? text(env.SITE_TAGLINE) ?? DEFAULT_TAGLINE,
    author: name ?? text(env.SITE_AUTHOR) ?? DEFAULT_AUTHOR,
    bio: text(api.bio),
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

// Una sola petición por build (Astro renderiza todas las páginas en el mismo proceso).
let cache: Promise<SiteSettings> | undefined;

export function getSettings(): Promise<SiteSettings> {
  return (cache ??= getInternal<Partial<ApiSettings>>('/api/internal/settings', 'los ajustes del sitio').then(
    (api) => toSiteSettings(api, process.env),
  ));
}
