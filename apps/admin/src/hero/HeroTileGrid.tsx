import type { KeyboardEvent, Ref } from 'react';
import { gridIndex } from '../components/rovingGrid.ts';
import { ImagePreview } from '../components/ImagePreview.tsx';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { thumbnailUrl } from './heroImage.ts';
import { tileLabel, type HeroTile } from './heroGrid.ts';

interface Props {
  tiles: readonly HeroTile[];
  /** La miniatura con tabIndex 0 (la última enfocada); si no está entre las visibles, la primera. */
  activeId: string | null;
  onActiveChange: (id: string) => void;
  onOpen: (id: string) => void;
  /** El id de la ayuda de teclado de la grilla. */
  describedBy: string;
  /** La lista: quien abre el panel devuelve el foco a una de sus miniaturas al cerrarlo. */
  ref?: Ref<HTMLOListElement>;
}

/** Cuántas columnas armó el CSS (auto-fill): las flechas arriba/abajo saltan esa cantidad. */
const columnsOf = (list: HTMLElement): number =>
  getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length || 1;

/**
 * Las miniaturas de los ítems guardados (U7): botones que abren el panel lateral. La grilla es una sola parada de Tab
 * (tabindex móvil) y se recorre con las flechas, Inicio y Fin (rovingGrid.ts); Enter o Espacio abren el ítem.
 * Cada miniatura usa la variante WebP más chica (sobre el color dominante y el placeholder) y, si es video, su póster:
 * nada se mueve en la grilla.
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
