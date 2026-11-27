import { sanitizeUrl } from '@blog/markdown';
import { getInternal, oncePerBuild } from './api.ts';
import { DEFAULT_LANG, ui, type Lang } from './i18n.ts';

/** How the API delivers the site settings (GET /api/internal/settings). */
export interface ApiSettings {
  /** Required: the API never stores it empty (SiteSettingsContent.Create) and sends the default if none is saved. */
  name: string;
  tagline: string | null;
  /** Short Markdown: rendered with @blog/markdown. */
  bio: string | null;
  /** English versions; null → the Spanish one is used. The name is one for both languages (a proper name). */
  taglineEn?: string | null;
  bioEn?: string | null;
  email: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
}

/** Settings already resolved for the pages of ONE language. */
export interface SiteSettings {
  name: string;
  tagline: string;
  bio: string | null;
  email: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
}

/** Trimmed text; empty => null. */
const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** Only http(s) links that pass the @blog/markdown allowlist. */
const webUrl = (value: string | null | undefined): string | null => {
  const url = text(value) === null ? null : sanitizeUrl(value as string);
  return url && /^https?:\/\//i.test(url) ? url : null;
};

const emailAddress = (value: string | null | undefined): string | null => {
  const email = text(value);
  return email && /^[^\s@<>"]+@[^\s@<>"]+$/.test(email) ? email : null;
};

/**
 * A language's effective settings: everything comes from the API. Only the tagline may arrive empty, and then the
 * dictionary one in the page's language is used. In English, tagline and bio use taglineEn / bioEn and, when they are
 * missing, the Spanish ones: better a Spanish text than none. The name is one for both languages (a proper name) and
 * is also the footer's author ("© year …"). Without a name the API broke its contract: the build fails and the
 * builder keeps the published site.
 */
export function toSiteSettings(api: ApiSettings, lang: Lang = DEFAULT_LANG): SiteSettings {
  // A Spanish field with its `En` pair: in English the pair wins when it has text.
  const localized = (es: string | null | undefined, english: string | null | undefined): string | null =>
    (lang === 'en' ? text(english) : null) ?? text(es);
  const name = text(api.name);
  if (name === null) throw new Error('The API returned the site settings without a name.');
  return {
    name,
    tagline: localized(api.tagline, api.taglineEn) ?? ui(lang).defaultTagline,
    bio: localized(api.bio, api.bioEn),
    email: emailAddress(api.email),
    githubUrl: webUrl(api.githubUrl),
    linkedinUrl: webUrl(api.linkedinUrl),
    xUrl: webUrl(api.xUrl),
  };
}

/** The contact links present, in display order (hero and footer). */
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
  getInternal<ApiSettings>('/api/internal/settings', 'the site settings'),
);

/** One request per build for both languages; each page resolves its own. */
export const getSettings = async (lang: Lang): Promise<SiteSettings> =>
  toSiteSettings(await getApiSettings(), lang);
