import type { SiteSettings } from '../api/types.ts';
import type { I18n, MessageKey } from '../i18n/i18n.ts';
import { LIMITS } from '../limits.ts';

/*
 * Admin-side validation and normalization of the site settings and a post's cover. It mirrors the API domain rules
 * (SiteSettingsContent, PostContent and WebUrl; the numbers come from src/limits.ts), with the same messages (in
 * Spanish; in English, their translation): it warns before sending. The API stays the authority and its errors
 * (ProblemDetails) are shown anyway. Texts come from the received `I18n`: the rules stay pure and are tested in both
 * languages.
 */

/** What the inputs edit: all text (the API's `null` shows as empty). */
export type SettingsForm = { [K in keyof SiteSettings]: string };
export type SettingsErrors = Partial<Record<keyof SiteSettings, string>>;

const MEDIA_PREFIX = '/media/';

export const emptySettingsForm = (): SettingsForm => ({
  name: '',
  tagline: '',
  bio: '',
  taglineEn: '',
  bioEn: '',
  email: '',
  githubUrl: '',
  linkedinUrl: '',
  xUrl: '',
});

/** Trims; empty is stored as `null` (like the API). */
export function cleanOptional(value: string): string | null {
  const clean = value.trim();
  return clean === '' ? null : clean;
}

// No spaces, control characters, backslashes or quotes/angle brackets: nothing that could break an HTML attribute.
function hasSafeCharacters(value: string): boolean {
  return value.length <= LIMITS.url && !/[\s\u0000-\u001f\u007f-\u009f\\"'<>`]/.test(value);
}

/** Absolute http:// or https:// URL with a host. */
export function isHttpUrl(value: string): boolean {
  if (!hasSafeCharacters(value) || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/** Image: what the media upload returns (`/media/...`) or an absolute http(s) URL. */
export function isImageUrl(value: string): boolean {
  const isMediaPath =
    hasSafeCharacters(value) &&
    value.startsWith(MEDIA_PREFIX) &&
    value.length > MEDIA_PREFIX.length &&
    // Like the API: no '%', so an encoded ".." (%2e%2e) cannot get through.
    !value.includes('%') &&
    !value.split('/').includes('..');
  return isMediaPath || isHttpUrl(value);
}

/** Minimal shape (something@domain.tld, no spaces). The real validation of an email is sending it a message. */
export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

export const toSettingsForm = (settings: SiteSettings): SettingsForm => ({
  name: settings.name,
  tagline: settings.tagline ?? '',
  bio: settings.bio ?? '',
  taglineEn: settings.taglineEn ?? '',
  bioEn: settings.bioEn ?? '',
  email: settings.email ?? '',
  githubUrl: settings.githubUrl ?? '',
  linkedinUrl: settings.linkedinUrl ?? '',
  xUrl: settings.xUrl ?? '',
});

export type SettingsValidation = { ok: true; input: SiteSettings } | { ok: false; errors: SettingsErrors };

/** "{subject} no puede superar {max} caracteres.": one sentence for every length limit (settings, cover, hero). */
export const tooLongMessage = (i18n: I18n, subject: MessageKey, max: number, params?: Record<string, string>): string =>
  i18n.t('validation.tooLong', { subject: i18n.t(subject, params), max });

/** Validates everything at once (to flag every field) and returns the body ready for the PUT. */
export function validateSettings(form: SettingsForm, i18n: I18n): SettingsValidation {
  const errors: SettingsErrors = {};
  const tooLong = (key: keyof SiteSettings, value: string | null, max: number, subject: MessageKey): void => {
    if (value !== null && value.length > max) errors[key] = tooLongMessage(i18n, subject, max);
  };
  const httpLink = (key: 'githubUrl' | 'linkedinUrl' | 'xUrl', site: string): string | null => {
    const value = cleanOptional(form[key]);
    if (value === null) return null;
    if (value.length > LIMITS.url) errors[key] = tooLongMessage(i18n, 'subject.link', LIMITS.url, { site });
    else if (!isHttpUrl(value)) errors[key] = i18n.t('settings.linkNotHttp', { site });
    return value;
  };

  const name = form.name.trim();
  if (name === '') errors.name = i18n.t('settings.nameRequired');
  else tooLong('name', name, LIMITS.settings.name, 'subject.name');

  const tagline = cleanOptional(form.tagline);
  tooLong('tagline', tagline, LIMITS.settings.tagline, 'subject.tagline');

  const bio = cleanOptional(form.bio);
  tooLong('bio', bio, LIMITS.settings.bio, 'subject.bio');

  // The English versions have the same limits as their Spanish counterparts; none is required. The name is a single
  // field for both languages.
  const taglineEn = cleanOptional(form.taglineEn);
  tooLong('taglineEn', taglineEn, LIMITS.settings.tagline, 'subject.taglineEn');

  const bioEn = cleanOptional(form.bioEn);
  tooLong('bioEn', bioEn, LIMITS.settings.bio, 'subject.bioEn');

  const email = cleanOptional(form.email);
  if (email !== null) {
    if (email.length > LIMITS.settings.email) errors.email = tooLongMessage(i18n, 'subject.email', LIMITS.settings.email);
    else if (!isEmail(email)) errors.email = i18n.t('settings.emailInvalid');
  }

  const githubUrl = httpLink('githubUrl', 'GitHub');
  const linkedinUrl = httpLink('linkedinUrl', 'LinkedIn');
  const xUrl = httpLink('xUrl', 'X');

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { name, tagline, bio, taglineEn, bioEn, email, githubUrl, linkedinUrl, xUrl } };
}

export type CoverValidation = { ok: true; coverUrl: string | null; coverAlt: string | null } | { ok: false; error: string };

/**
 * A post's cover. Without a URL there is no cover and the alt is dropped: the site falls back to the first image of
 * the text or, if there is none, to a generated cover.
 */
export function validateCover(url: string, alt: string, i18n: I18n): CoverValidation {
  const coverUrl = cleanOptional(url);
  if (coverUrl === null) return { ok: true, coverUrl: null, coverAlt: null };
  if (coverUrl.length > LIMITS.url) return { ok: false, error: tooLongMessage(i18n, 'subject.coverUrl', LIMITS.url) };
  if (!isImageUrl(coverUrl)) return { ok: false, error: i18n.t('cover.notImage') };

  const coverAlt = cleanOptional(alt);
  if (coverAlt !== null && coverAlt.length > LIMITS.post.coverAlt) {
    return { ok: false, error: tooLongMessage(i18n, 'subject.coverAlt', LIMITS.post.coverAlt) };
  }
  return { ok: true, coverUrl, coverAlt };
}
