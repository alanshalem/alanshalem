/** "Introducción a Ñandú!" -> "introduccion-a-nandu" (ASCII, apto para URLs y anclas). */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca los acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'seccion' : slug;
}

/**
 * Generador de ids únicos dentro de un documento: si dos títulos dan el mismo slug,
 * el segundo queda "slug-2", el tercero "slug-3", etc.
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
