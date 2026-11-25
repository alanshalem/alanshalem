import type { SiteSettings } from '../api/types.ts';

/*
 * Validación y normalización del lado del admin para los ajustes del sitio y la portada de un post.
 * Es un espejo de las reglas del dominio de la API (SiteSettingsContent, PostContent y WebUrl, ver L4),
 * con los mismos mensajes: sirve para avisar antes de enviar. La API sigue siendo la autoridad y
 * sus errores (ProblemDetails) se muestran igual.
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
  email: settings.email ?? '',
  githubUrl: settings.githubUrl ?? '',
  linkedinUrl: settings.linkedinUrl ?? '',
  xUrl: settings.xUrl ?? '',
});

export type SettingsValidation = { ok: true; input: SiteSettings } | { ok: false; errors: SettingsErrors };

/** Valida todo de una vez (para marcar cada campo) y devuelve el cuerpo listo para el PUT. */
export function validateSettings(form: SettingsForm): SettingsValidation {
  const errors: SettingsErrors = {};
  const tooLong = (key: keyof SiteSettings, value: string | null, max: number, message: string): void => {
    if (value !== null && value.length > max) errors[key] = message;
  };
  const httpLink = (key: 'githubUrl' | 'linkedinUrl' | 'xUrl', label: string): string | null => {
    const value = cleanOptional(form[key]);
    if (value === null) return null;
    if (value.length > LIMITS.url) errors[key] = `El enlace de ${label} no puede superar ${LIMITS.url} caracteres.`;
    else if (!isHttpUrl(value)) errors[key] = `El enlace de ${label} debe ser una URL http(s).`;
    return value;
  };

  const name = form.name.trim();
  if (name === '') errors.name = 'El nombre es obligatorio.';
  else tooLong('name', name, LIMITS.name, `El nombre no puede superar ${LIMITS.name} caracteres.`);

  const tagline = cleanOptional(form.tagline);
  tooLong('tagline', tagline, LIMITS.tagline, `La frase no puede superar ${LIMITS.tagline} caracteres.`);

  const bio = cleanOptional(form.bio);
  tooLong('bio', bio, LIMITS.bio, `La bio no puede superar ${LIMITS.bio} caracteres.`);

  const email = cleanOptional(form.email);
  if (email !== null) {
    if (email.length > LIMITS.email) errors.email = `El email no puede superar ${LIMITS.email} caracteres.`;
    else if (!isEmail(email)) errors.email = 'El email no tiene un formato válido.';
  }

  const githubUrl = httpLink('githubUrl', 'GitHub');
  const linkedinUrl = httpLink('linkedinUrl', 'LinkedIn');
  const xUrl = httpLink('xUrl', 'X');

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { name, tagline, bio, email, githubUrl, linkedinUrl, xUrl } };
}

export type CoverValidation = { ok: true; coverUrl: string | null; coverAlt: string | null } | { ok: false; error: string };

/**
 * Portada de un post. Sin URL no hay portada y el alt se descarta: el sitio cae a la primera imagen
 * del texto o, si no hay ninguna, a una portada generativa (L5).
 */
export function validateCover(url: string, alt: string): CoverValidation {
  const coverUrl = cleanOptional(url);
  if (coverUrl === null) return { ok: true, coverUrl: null, coverAlt: null };
  if (coverUrl.length > LIMITS.url) {
    return { ok: false, error: `La URL de la portada no puede superar ${LIMITS.url} caracteres.` };
  }
  if (!isImageUrl(coverUrl)) return { ok: false, error: 'La portada debe ser una ruta /media/... o una URL http(s).' };

  const coverAlt = cleanOptional(alt);
  if (coverAlt !== null && coverAlt.length > LIMITS.coverAlt) {
    return { ok: false, error: `El texto alternativo de la portada no puede superar ${LIMITS.coverAlt} caracteres.` };
  }
  return { ok: true, coverUrl, coverAlt };
}
