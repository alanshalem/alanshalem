import type { PostStatus, PostSummary } from '../api/types.ts';
import type { I18n } from '../i18n/i18n.ts';
import { DEFAULT_LANG, langCode, LANGS, type Lang } from '../languages.ts';

/*
 * Reglas puras de las versiones de un post por idioma (L3, L4). Cada versión es un post propio unido a las otras
 * por `translationGroupId`; la traducción es manual (S2) y queda como borrador hasta que se revisa (S3).
 */

/** Una fila de la lista: todas las versiones de un mismo post. */
export interface PostGroup {
  id: string;
  /** La versión que da título y enlace a la fila: la del idioma principal si existe. */
  main: PostSummary;
  versions: PostSummary[];
  /** La última edición de cualquiera de sus versiones. */
  updatedAt: string;
}

/** Agrupa por `translationGroupId`; cada grupo aparece donde llegó su primera versión (la API ordena la lista). */
export function groupPosts(posts: readonly PostSummary[]): PostGroup[] {
  const byGroup = new Map<string, PostSummary[]>();
  for (const post of posts) {
    const versions = byGroup.get(post.translationGroupId);
    if (versions) versions.push(post);
    else byGroup.set(post.translationGroupId, [post]);
  }
  return [...byGroup].map(([id, versions]) => ({
    id,
    // Hay al menos una versión: el grupo nace con la primera.
    main: versions.find((version) => version.lang === DEFAULT_LANG) ?? versions[0]!,
    versions,
    updatedAt: versions.reduce(
      (latest, version) => (Date.parse(version.updatedAt) > Date.parse(latest) ? version.updatedAt : latest),
      versions[0]!.updatedAt,
    ),
  }));
}

export interface VersionSlot<T> {
  lang: Lang;
  version: T | null;
}

/**
 * Un lugar por idioma (en el orden de `LANGS`) con su versión o `null` si falta. `except` deja afuera el idioma
 * propio: el editor solo lista las otras versiones; la lista, todas.
 */
export function versionSlots<T extends { lang: Lang }>(versions: readonly T[], except?: Lang): VersionSlot<T>[] {
  return LANGS.filter((lang) => lang !== except).map((lang) => ({
    lang,
    version: versions.find((version) => version.lang === lang) ?? null,
  }));
}

/** Estado de un post en el idioma de la interfaz: "Borrador" / "Draft". */
export const statusLabel = (status: PostStatus, i18n: I18n): string => i18n.t(`status.${status}`);

/** El texto del chip de una versión: "ES · Publicado" o "EN · Borrador" (el código no se traduce). */
export const versionLabel = (lang: Lang, status: PostStatus, i18n: I18n): string =>
  `${langCode(lang)} · ${statusLabel(status, i18n)}`;

/**
 * El chip de una versión que falta es un botón que la crea: se ve "+ EN" (antes "EN · Falta", que parecía un estado y
 * no una acción) y se anuncia "Crear versión en inglés (EN)", con el texto visible dentro del nombre (WCAG 2.5.3).
 */
export const missingVersion = (lang: Lang, i18n: I18n): { text: string; label: string } => {
  const code = langCode(lang);
  return {
    text: i18n.t('versions.add', { code }),
    label: i18n.t('versions.createAria', { lang: i18n.t(`lang.inSentence.${lang}`), code }),
  };
};

export type TranslationWarning = 'untranslated' | 'outdated';

/** Lo que hace falta de una versión para compararla con la otra. */
export interface VersionContent {
  title: string;
  body: string;
  createdAt: string;
  /** No `updatedAt`: publicar o programar también lo cambian, y eso no vuelve vieja a ninguna traducción. */
  contentUpdatedAt: string;
}

/**
 * Avisos de la traducción respecto de la otra versión (L3). La traducción es la versión creada después: "Crear
 * versión" copia el original, así que el original nunca se avisa a sí mismo.
 * - `untranslated`: el título o el cuerpo siguen iguales al original (el contenido copiado sin traducir).
 * - `outdated`: el contenido del original cambió después del último cambio de contenido de la traducción.
 */
export function translationWarnings(current: VersionContent, other: VersionContent): TranslationWarning[] {
  if (Date.parse(current.createdAt) <= Date.parse(other.createdAt)) return [];
  const warnings: TranslationWarning[] = [];
  if (current.title.trim() === other.title.trim() || current.body.trim() === other.body.trim()) {
    warnings.push('untranslated');
  }
  if (Date.parse(other.contentUpdatedAt) > Date.parse(current.contentUpdatedAt)) warnings.push('outdated');
  return warnings;
}
