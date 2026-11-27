import type { HeroImage } from '../api/types.ts';
import type { I18n } from '../i18n/i18n.ts';
import { leaveConfirmation } from '../navigation/leaveGuard.ts';
import { heroItemKind, type HeroMediaKind } from './heroVideo.ts';

/*
 * Thumbnail grid + side panel: with 50 items, one large card per item became huge. Pure rules of the grid: filters,
 * counter, the "Sin inglés" mark and moving between items from the panel.
 */

/** The filters of the segmented control, in order. */
export const HERO_FILTERS = ['all', 'photo', 'video', 'missingEn'] as const;
export type HeroFilter = (typeof HERO_FILTERS)[number];

/** A thumbnail: the item, its number in upload order (it does not change when filtering) and its marks. */
export interface HeroTile {
  readonly image: HeroImage;
  readonly number: number;
  readonly kind: HeroMediaKind;
  readonly missingEn: boolean;
}

/** No English alt text (empty or only spaces): the English site uses the Spanish one. */
export const missingEnglish = ({ altEn }: Pick<HeroImage, 'altEn'>): boolean => (altEn ?? '').trim() === '';

const matches = (tile: HeroTile, filter: HeroFilter): boolean =>
  filter === 'all' ? true : filter === 'missingEn' ? tile.missingEn : tile.kind === filter;

const toTiles = (images: readonly HeroImage[]): HeroTile[] =>
  images.map((image, index) => ({ image, number: index + 1, kind: heroItemKind(image), missingEn: missingEnglish(image) }));

/** The thumbnails the filter shows, with their number in the full list. */
export const heroTiles = (images: readonly HeroImage[], filter: HeroFilter): HeroTile[] =>
  toTiles(images).filter((tile) => matches(tile, filter));

/** How many items each filter has (the counter and the number on each filter button). */
export function countHeroItems(images: readonly HeroImage[]): Record<HeroFilter, number> {
  const tiles = toTiles(images);
  return Object.fromEntries(HERO_FILTERS.map((filter) => [filter, tiles.filter((tile) => matches(tile, filter)).length])) as Record<
    HeroFilter,
    number
  >;
}

/** "12 fotos · 3 videos"; a kind with no items is not named; without items, empty. */
export function heroCountText(counts: Record<HeroFilter, number>, { plural }: I18n): string {
  const parts = [
    counts.photo > 0 ? plural(counts.photo, 'hero.count.photos') : null,
    counts.video > 0 ? plural(counts.video, 'hero.count.videos') : null,
  ];
  return parts.filter((part) => part !== null).join(' · ');
}

/**
 * Accessible name of a thumbnail: first what is visible (the number), then the alt text and the marks with the same
 * texts that are shown (WCAG 2.5.3 and 1.1.1). "2. Un lago · Video · Sin inglés".
 */
export function tileLabel({ image, number, kind, missingEn }: HeroTile, { t }: I18n): string {
  const marks = [kind === 'video' ? t('hero.badge.video') : null, missingEn ? t('hero.filter.missingEn') : null];
  return [t('hero.tileName', { n: number, alt: image.alt }), ...marks.filter((mark) => mark !== null)].join(' · ');
}

/** Previous and next of the item open in the panel (no wrapping) and its 1-based position (0 = no longer there). */
export function neighbors(
  ids: readonly string[],
  id: string,
): { previous: string | null; next: string | null; position: number; total: number } {
  const index = ids.indexOf(id);
  if (index < 0) return { previous: null, next: null, position: 0, total: ids.length };
  return { previous: ids[index - 1] ?? null, next: ids[index + 1] ?? null, position: index + 1, total: ids.length };
}

/** On delete from the panel, focus goes to the thumbnail taking its place (or the previous one if it was the last). */
export function focusAfterRemoval(ids: readonly string[], removedId: string): string | null {
  const index = ids.indexOf(removedId);
  if (index < 0) return null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/**
 * Closing the panel or moving to another item with unsaved changes: the same rule as when changing views
 * (leaveGuard), with only the panel's guard (changes to the settings above are not lost by closing the panel).
 * `null` = go on.
 */
export const panelLeaveConfirmation = (dirty: boolean, { t }: I18n): string | null =>
  leaveConfirmation([{ dirty, message: t('unsaved.confirm') }], { name: 'settings' }, null);
