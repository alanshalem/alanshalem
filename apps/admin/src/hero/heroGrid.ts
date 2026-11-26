import type { HeroImage } from '../api/types.ts';
import type { I18n } from '../i18n/i18n.ts';
import { leaveConfirmation } from '../navigation/leaveGuard.ts';
import { heroItemKind, type HeroMediaKind } from './heroVideo.ts';

/*
 * Grilla de miniaturas + panel lateral (U7, L15): con 50 ítems, una ficha grande por ítem se volvía enorme. Reglas
 * puras de la grilla: filtros, contador, la marca "Sin inglés" y moverse entre ítems desde el panel.
 */

/** Los filtros del control segmentado, en su orden. */
export const HERO_FILTERS = ['all', 'photo', 'video', 'missingEn'] as const;
export type HeroFilter = (typeof HERO_FILTERS)[number];

/** Una miniatura: el ítem, su número en el orden de subida (no cambia al filtrar) y sus marcas. */
export interface HeroTile {
  readonly image: HeroImage;
  readonly number: number;
  readonly kind: HeroMediaKind;
  readonly missingEn: boolean;
}

/** Sin texto alternativo en inglés (vacío o solo espacios): el sitio en inglés usa el de español (L3). */
export const missingEnglish = ({ altEn }: Pick<HeroImage, 'altEn'>): boolean => (altEn ?? '').trim() === '';

const matches = (tile: HeroTile, filter: HeroFilter): boolean =>
  filter === 'all' ? true : filter === 'missingEn' ? tile.missingEn : tile.kind === filter;

const toTiles = (images: readonly HeroImage[]): HeroTile[] =>
  images.map((image, index) => ({ image, number: index + 1, kind: heroItemKind(image), missingEn: missingEnglish(image) }));

/** Las miniaturas que muestra el filtro, con el número de la lista completa. */
export const heroTiles = (images: readonly HeroImage[], filter: HeroFilter): HeroTile[] =>
  toTiles(images).filter((tile) => matches(tile, filter));

/** Cuántos ítems hay en cada filtro (el contador y el número de cada botón del filtro). */
export function countHeroItems(images: readonly HeroImage[]): Record<HeroFilter, number> {
  const tiles = toTiles(images);
  return Object.fromEntries(HERO_FILTERS.map((filter) => [filter, tiles.filter((tile) => matches(tile, filter)).length])) as Record<
    HeroFilter,
    number
  >;
}

/** "12 fotos · 3 videos"; un tipo que no hay no se nombra; sin ítems, vacío. */
export function heroCountText(counts: Record<HeroFilter, number>, { plural }: I18n): string {
  const parts = [
    counts.photo > 0 ? plural(counts.photo, 'hero.count.photos') : null,
    counts.video > 0 ? plural(counts.video, 'hero.count.videos') : null,
  ];
  return parts.filter((part) => part !== null).join(' · ');
}

/**
 * Nombre accesible de una miniatura: primero lo visible (el número), después el texto alternativo y las marcas con
 * los mismos textos que se ven (WCAG 2.5.3 y 1.1.1). "2. Un lago · Video · Sin inglés".
 */
export function tileLabel({ image, number, kind, missingEn }: HeroTile, { t }: I18n): string {
  const marks = [kind === 'video' ? t('hero.badge.video') : null, missingEn ? t('hero.filter.missingEn') : null];
  return [t('hero.tileName', { n: number, alt: image.alt }), ...marks.filter((mark) => mark !== null)].join(' · ');
}

/** Anterior y siguiente del ítem abierto en el panel (sin dar la vuelta) y su posición desde 1 (0 = ya no está). */
export function neighbors(
  ids: readonly string[],
  id: string,
): { previous: string | null; next: string | null; position: number; total: number } {
  const index = ids.indexOf(id);
  if (index < 0) return { previous: null, next: null, position: 0, total: ids.length };
  return { previous: ids[index - 1] ?? null, next: ids[index + 1] ?? null, position: index + 1, total: ids.length };
}

/** Al eliminar desde el panel, el foco va a la miniatura que ocupa su lugar (o a la anterior si era la última). */
export function focusAfterRemoval(ids: readonly string[], removedId: string): string | null {
  const index = ids.indexOf(removedId);
  if (index < 0) return null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/**
 * Cerrar el panel o pasar a otro ítem con cambios sin guardar: la misma regla que al cambiar de vista (leaveGuard), con
 * el guardia del panel solo (los cambios de los ajustes de arriba no se pierden al cerrar el panel). `null` = seguir.
 */
export const panelLeaveConfirmation = (dirty: boolean, { t }: I18n): string | null =>
  leaveConfirmation([{ dirty, message: t('unsaved.confirm') }], { name: 'settings' }, null);
