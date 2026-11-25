import { getInternal } from './api.ts';
import { safeColor, safePlaceholder, srcset, type MediaAsset } from './media.ts';

/** HeroImageDto (GET /api/internal/hero-images, L10). */
export interface ApiHeroImage {
  id: string;
  media: MediaAsset;
  alt: string;
  credit: string | null;
  createdAt: string;
}

/**
 * Lo mínimo que el script de rotación necesita de cada foto (va embebido en el HTML de la home).
 * `img` y `background` tienen los nombres de las propiedades del DOM: el script los asigna tal cual.
 */
export interface HeroSlide {
  avif: string;
  webp: string;
  img: { alt: string; width: number; height: number; src: string };
  background: { backgroundColor: string; backgroundImage: string };
  credit: string | null;
}

export type Hero =
  /** Galería del admin: rota en cada visita; `first` se renderiza en <noscript> y es la de og:image. */
  | { kind: 'gallery'; first: ApiHeroImage; slides: HeroSlide[] }
  /** Respaldo sin galería: una foto dejada a mano en public/. */
  | { kind: 'static'; src: string }
  | null;

const STATIC_HERO_SRC = '/hero.jpg';

/** La más vieja primero (L10): es la de <noscript> y og:image, y no cambia al subir fotos nuevas. */
export const orderHeroImages = (images: readonly ApiHeroImage[]): ApiHeroImage[] =>
  [...images].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

export function toHeroSlide({ media, alt, credit }: ApiHeroImage): HeroSlide {
  const placeholder = safePlaceholder(media.placeholder);
  return {
    avif: srcset(media, 'avif'),
    webp: srcset(media, 'webp'),
    // `src` al final: el script asigna en este orden y la petición sale con alt y medidas ya puestos.
    img: { alt, width: media.width, height: media.height, src: media.url },
    background: {
      backgroundColor: safeColor(media.color) ?? '',
      backgroundImage: placeholder ? `url(${placeholder})` : '',
    },
    credit: credit?.trim() || null,
  };
}

/** Hero de la home (S1): galería → public/hero.jpg → null (hero tipográfico). `gallery` ya ordenada. */
export function resolveHero(gallery: readonly ApiHeroImage[], heroJpgExists: boolean): Hero {
  const [first] = gallery;
  if (first) return { kind: 'gallery', first, slides: gallery.map(toHeroSlide) };
  return heroJpgExists ? { kind: 'static', src: STATIC_HERO_SRC } : null;
}

// Una sola petición por build.
let cache: Promise<ApiHeroImage[]> | undefined;

export function getHeroImages(): Promise<ApiHeroImage[]> {
  return (cache ??= getInternal<ApiHeroImage[]>('/api/internal/hero-images', 'las fotos del hero').then(
    orderHeroImages,
  ));
}
