/** "Introducción a Ñandú!" -> "introduccion-a-nandu" (ASCII, fit for URLs and anchors). */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strips the accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'seccion' : slug;
}

/**
 * Generator of ids unique within a document: when two titles give the same slug, the second becomes "slug-2", the
 * third "slug-3", and so on.
 */
export function createSlugger(): (text: string) => string {
  const used = new Map<string, number>();
  return (text) => {
    const base = slugify(text);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
}
