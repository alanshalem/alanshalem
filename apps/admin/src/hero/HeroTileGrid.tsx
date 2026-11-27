import type { KeyboardEvent, Ref } from 'react';
import { gridIndex } from '../components/rovingGrid.ts';
import { ImagePreview } from '../components/ImagePreview.tsx';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { thumbnailUrl } from './heroImage.ts';
import { tileLabel, type HeroTile } from './heroGrid.ts';

interface Props {
  tiles: readonly HeroTile[];
  /** The thumbnail with tabIndex 0 (the last focused); if it is not among the visible ones, the first. */
  activeId: string | null;
  onActiveChange: (id: string) => void;
  onOpen: (id: string) => void;
  /** The id of the grid's keyboard help. */
  describedBy: string;
  /** The list: whoever opens the panel returns focus to one of its thumbnails on close. */
  ref?: Ref<HTMLOListElement>;
}

/** How many columns the CSS built (auto-fill): the up/down arrows jump that many. */
const columnsOf = (list: HTMLElement): number =>
  getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length || 1;

/**
 * The thumbnails of the saved items: buttons that open the side panel. The grid is a single Tab stop (roving
 * tabindex) walked with the arrows, Home and End (rovingGrid.ts); Enter or Space open the item. Each thumbnail uses
 * the smallest WebP variant (over the dominant color and the placeholder) and, for a video, its poster: nothing moves
 * in the grid.
 */
export function HeroTileGrid({ tiles, activeId, onActiveChange, onOpen, describedBy, ref }: Props) {
  const i18n = useUiLanguage();
  const { t } = i18n;
  const found = tiles.findIndex((tile) => tile.image.id === activeId);
  const current = found < 0 ? 0 : found;

  const handleKeyDown = (event: KeyboardEvent<HTMLOListElement>): void => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const next = gridIndex(event.nativeEvent, current, tiles.length, columnsOf(event.currentTarget));
    if (next === null) return;
    event.preventDefault();
    const id = tiles[next]?.image.id;
    if (!id) return;
    onActiveChange(id);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(id)}"]`)?.focus();
  };

  return (
    <ol ref={ref} className="hero-grid" aria-label={t('hero.savedList')} aria-describedby={describedBy} onKeyDown={handleKeyDown}>
      {tiles.map((tile, index) => (
        <li key={tile.image.id}>
          <button
            type="button"
            className="hero-tile"
            data-id={tile.image.id}
            tabIndex={index === current ? 0 : -1}
            aria-label={tileLabel(tile, i18n)}
            aria-haspopup="dialog"
            onFocus={() => onActiveChange(tile.image.id)}
            onClick={() => onOpen(tile.image.id)}
          >
            <ImagePreview
              as="span"
              src={thumbnailUrl(tile.image.media)}
              alt=""
              emptyText={t('hero.noPreview')}
              color={tile.image.media.color}
              placeholder={tile.image.media.placeholder}
            />
            <span className="hero-tile-number">{tile.number}</span>
            {(tile.kind === 'video' || tile.missingEn) && (
              <span className="hero-tile-marks">
                {tile.kind === 'video' && <span className="hero-tile-mark">{t('hero.badge.video')}</span>}
                {tile.missingEn && (
                  <span className="hero-tile-mark hero-tile-mark-warning">{t('hero.filter.missingEn')}</span>
                )}
              </span>
            )}
          </button>
        </li>
      ))}
    </ol>
  );
}
