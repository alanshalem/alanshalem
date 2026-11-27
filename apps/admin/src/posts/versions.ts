import type { PostStatus, PostSummary } from '../api/types.ts';
import type { I18n } from '../i18n/i18n.ts';
import { DEFAULT_LANG, langCode, LANGS, type Lang } from '../languages.ts';

/*
 * Pure rules of a post's language versions. Each version is its own post joined to the others by
 * `translationGroupId`; translation is manual and stays a draft until reviewed.
 */

/** A list row: all the versions of one post. */
export interface PostGroup {
  id: string;
  /** The version that gives the row its title and link: the main language's if it exists. */
  main: PostSummary;
  versions: PostSummary[];
  /** The latest edit of any of its versions. */
  updatedAt: string;
}

/** Groups by `translationGroupId`; each group appears where its first version arrived (the API sorts the list). */
export function groupPosts(posts: readonly PostSummary[]): PostGroup[] {
  const byGroup = new Map<string, PostSummary[]>();
  for (const post of posts) {
    const versions = byGroup.get(post.translationGroupId);
    if (versions) versions.push(post);
    else byGroup.set(post.translationGroupId, [post]);
  }
  return [...byGroup].map(([id, versions]) => ({
    id,
    // There is at least one version: the group is born with the first.
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
 * One slot per language (in `LANGS` order) with its version or `null` if missing. `except` leaves out the own
 * language: the editor only lists the other versions; the list, all of them.
 */
export function versionSlots<T extends { lang: Lang }>(versions: readonly T[], except?: Lang): VersionSlot<T>[] {
  return LANGS.filter((lang) => lang !== except).map((lang) => ({
    lang,
    version: versions.find((version) => version.lang === lang) ?? null,
  }));
}

/** A post's status in the UI language: "Borrador" / "Draft". */
export const statusLabel = (status: PostStatus, i18n: I18n): string => i18n.t(`status.${status}`);

/** The text of a version chip: "ES · Publicado" or "EN · Borrador" (the code is not translated). */
export const versionLabel = (lang: Lang, status: PostStatus, i18n: I18n): string =>
  `${langCode(lang)} · ${statusLabel(status, i18n)}`;

/**
 * The chip of a missing version is a button that creates it: it shows "+ EN" (before, "EN · Falta", which looked like a
 * status and not an action) and announces "Crear versión en inglés (EN)", with the visible text inside the name
 * (WCAG 2.5.3).
 */
export const missingVersion = (lang: Lang, i18n: I18n): { text: string; label: string } => {
  const code = langCode(lang);
  return {
    text: i18n.t('versions.add', { code }),
    label: i18n.t('versions.createAria', { lang: i18n.t(`lang.inSentence.${lang}`), code }),
  };
};

export type TranslationWarning = 'untranslated' | 'outdated';

/** What a version needs to be compared with the other. */
export interface VersionContent {
  title: string;
  body: string;
  createdAt: string;
  /** Not `updatedAt`: publishing or scheduling also change it, and that does not make any translation outdated. */
  contentUpdatedAt: string;
}

/**
 * Warnings of the translation against the other version. The translation is the version created later: "Crear
 * versión" copies the original, so the original never warns about itself.
 * - `untranslated`: the title or the body still equal the original (the copied content not translated).
 * - `outdated`: the original's content changed after the translation's last content change.
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
