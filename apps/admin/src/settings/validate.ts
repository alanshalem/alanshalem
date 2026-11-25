import type { SiteSettings } from '../api/types.ts';
import type { I18n, MessageKey } from '../i18n/i18n.ts';

/*
 * Validación y normalización del lado del admin para los ajustes del sitio y la portada de un post.
 * Es un espejo de las reglas del dominio de la API (SiteSettingsContent, PostContent y WebUrl, ver L4),
 * con los mismos mensajes (en español; en inglés, su traducción): sirve para avisar antes de enviar. La API sigue
 * siendo la autoridad y sus errores (ProblemDetails) se muestran igual. Los textos salen del `I18n` recibido: las
 * reglas siguen puras y se prueban en los dos idiomas.
 */

/** Lo que editan los inputs: todo texto (los `null` de la API se ven como vacío). */
export type SettingsForm = { [K in keyof SiteSettings]: string };
export type SettingsErrors = Partial<Record<keyof SiteSettings, string>>;

export const LIMITS = {
  name: 100,
  tagline: 200,
  bio: 2000,
  email: 254,
  url: 2048,
  coverAlt: 300,
} as const;

const MEDIA_PREFIX = '/media/';

export const emptySettingsForm = (): SettingsForm => ({
  name: '',
  tagline: '',
  bio: '',
  nameEn: '',
  taglineEn: '',
  bioEn: '',
  email: '',
  githubUrl: '',
  linkedinUrl: '',
  xUrl: '',
});

/** Recorta; el vacío se guarda como `null` (igual que la API). */
export function cleanOptional(value: string): string | null {
  const clean = value.trim();
  return clean === '' ? null : clean;
}

// Sin espacios, caracteres de control, barras invertidas ni comillas/ángulos: nada que pueda cortar un atributo HTML.
function hasSafeCharacters(value: string): boolean {
  return value.length <= LIMITS.url && !/[\s\u0000-\u001f\u007f-\u009f\\"'<>`]/.test(value);
}

/** URL absoluta http:// o https:// con host. */
export function isHttpUrl(value: string): boolean {
  if (!hasSafeCharacters(value) || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/** Imagen: lo que devuelve la subida de media (`/media/...`) o una URL absoluta http(s). */
export function isImageUrl(value: string): boolean {
  const isMediaPath =
    hasSafeCharacters(value) &&
    value.startsWith(MEDIA_PREFIX) &&
    value.length > MEDIA_PREFIX.length &&
    // Igual que la API: sin '%', para que no pase un ".." codificado (%2e%2e).
    !value.includes('%') &&
    !value.split('/').includes('..');
  return isMediaPath || isHttpUrl(value);
}

/** Forma mínima (algo@dominio.tld, sin espacios). La validación real de un email es mandarle un correo. */
export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

export const toSettingsForm = (settings: SiteSettings): SettingsForm => ({
  name: settings.name,
  tagline: settings.tagline ?? '',
  bio: settings.bio ?? '',
  nameEn: settings.nameEn ?? '',
  taglineEn: settings.taglineEn ?? '',
  bioEn: settings.bioEn ?? '',
  email: settings.email ?? '',
  githubUrl: settings.githubUrl ?? '',
  linkedinUrl: settings.linkedinUrl ?? '',
  xUrl: settings.xUrl ?? '',
});

export type SettingsValidation = { ok: true; input: SiteSettings } | { ok: false; errors: SettingsErrors };

/** "{sujeto} no puede superar {max} caracteres.": una sola frase para todo límite de largo (ajustes, portada, hero). */
export const tooLongMessage = (i18n: I18n, subject: MessageKey, max: number, params?: Record<string, string>): string =>
  i18n.t('validation.tooLong', { subject: i18n.t(subject, params), max });

/** Valida todo de una vez (para marcar cada campo) y devuelve el cuerpo listo para el PUT. */
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
  else tooLong('name', name, LIMITS.name, 'subject.name');

  const tagline = cleanOptional(form.tagline);
  tooLong('tagline', tagline, LIMITS.tagline, 'subject.tagline');

  const bio = cleanOptional(form.bio);
  tooLong('bio', bio, LIMITS.bio, 'subject.bio');

  // Las versiones en inglés tienen los mismos límites que sus pares en español (L4); ninguna es obligatoria.
  const nameEn = cleanOptional(form.nameEn);
  tooLong('nameEn', nameEn, LIMITS.name, 'subject.nameEn');

  const taglineEn = cleanOptional(form.taglineEn);
  tooLong('taglineEn', taglineEn, LIMITS.tagline, 'subject.taglineEn');

  const bioEn = cleanOptional(form.bioEn);
  tooLong('bioEn', bioEn, LIMITS.bio, 'subject.bioEn');

  const email = cleanOptional(form.email);
  if (email !== null) {
    if (email.length > LIMITS.email) errors.email = tooLongMessage(i18n, 'subject.email', LIMITS.email);
    else if (!isEmail(email)) errors.email = i18n.t('settings.emailInvalid');
  }

  const githubUrl = httpLink('githubUrl', 'GitHub');
  const linkedinUrl = httpLink('linkedinUrl', 'LinkedIn');
  const xUrl = httpLink('xUrl', 'X');

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { name, tagline, bio, nameEn, taglineEn, bioEn, email, githubUrl, linkedinUrl, xUrl } };
}

export type CoverValidation = { ok: true; coverUrl: string | null; coverAlt: string | null } | { ok: false; error: string };

/**
 * Portada de un post. Sin URL no hay portada y el alt se descarta: el sitio cae a la primera imagen
 * del texto o, si no hay ninguna, a una portada generativa (L5).
 */
export function validateCover(url: string, alt: string, i18n: I18n): CoverValidation {
  const coverUrl = cleanOptional(url);
  if (coverUrl === null) return { ok: true, coverUrl: null, coverAlt: null };
  if (coverUrl.length > LIMITS.url) return { ok: false, error: tooLongMessage(i18n, 'subject.coverUrl', LIMITS.url) };
  if (!isImageUrl(coverUrl)) return { ok: false, error: i18n.t('cover.notImage') };

  const coverAlt = cleanOptional(alt);
  if (coverAlt !== null && coverAlt.length > LIMITS.coverAlt) {
    return { ok: false, error: tooLongMessage(i18n, 'subject.coverAlt', LIMITS.coverAlt) };
  }
  return { ok: true, coverUrl, coverAlt };
}
