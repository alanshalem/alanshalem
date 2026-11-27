import { getInternal, oncePerBuild } from './api.ts';
import { htmlAttributes } from './html.ts';
import type { Lang } from './i18n.ts';
import { safeColor, safePlaceholder, srcset, type MediaAsset } from './media.ts';
import { videoSourcesHtml, type VideoAsset } from './video.ts';

/** HeroImageDto (GET /api/internal/hero-images, L10 + L13). */
export interface ApiHeroImage {
  id: string;
  /** La foto o, si es un video, su póster. */
  media: MediaAsset;
  alt: string;
  credit: string | null;
  /** Texto alternativo en inglés (L4); ausente o nulo → se usa el de español. El crédito es uno solo (L13). */
  altEn?: string | null;
  createdAt: string;
  video: VideoAsset | null;
}

/**
 * Lo mínimo que el script de rotación necesita de cada foto o video (va embebido en el HTML de la home).
 * `img` y `background` tienen los nombres de las propiedades del DOM: el script los asigna tal cual.
 */
export interface HeroSlide {
  avif: string;
  webp: string;
  img: { alt: string; width: number; height: number; src: string };
  background: { backgroundColor: string; backgroundImage: string };
  credit: string | null;
  /**
   * Marcado del <video> de fondo, ya escapado, o null si es una foto. El script lo inserta tal cual; si el
   * visitante pidió menos movimiento o ahorro de datos usa los campos de arriba, que en un video son el póster.
   */
  video: string | null;
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

/**
 * Video de fondo: autoplay sin sonido en bucle, como una foto que se mueve. `muted` y `playsinline` son las
 * condiciones de los navegadores (iOS incluido) para el autoplay; `preload="metadata"` no adelanta bytes si el
 * autoplay está bloqueado. `poster` no admite srcset: va el WebP de respaldo (`media.url`).
 * Accesibilidad: el envoltorio `role="img"` con el alt lo expone como lo que es —una imagen con su texto
 * alternativo, igual que las fotos— y, como los hijos de un `img` son presentacionales, el <video> sin controles
 * no se anuncia aparte. `role="img"` no está permitido en el propio <video>, y un `aria-label` suelto en él
 * no tiene un rol que lo nombre de forma fiable en todos los lectores.
 */
function backgroundVideoHtml(video: VideoAsset, alt: string, poster: string): string {
  const wrapper = htmlAttributes({ class: 'hero-video', role: 'img', 'aria-label': alt });
  const player = htmlAttributes({
    autoplay: true,
    muted: true,
    loop: true,
    playsinline: true,
    preload: 'metadata',
    poster,
  });
  return `<div${wrapper}><video${player}>${videoSourcesHtml(video)}</video></div>`;
}

/**
 * La foto con el alt del idioma de la página (L3); el crédito es el mismo en los dos (L13). Se localiza antes de armar
 * el hero, así diapositivas, <noscript> y og:image:alt salen de los mismos textos.
 */
export function localizeHeroImage(image: ApiHeroImage, lang: Lang): ApiHeroImage {
  if (lang !== 'en') return image;
  return { ...image, alt: image.altEn?.trim() || image.alt };
}

export function toHeroSlide({ media, alt, credit, video }: ApiHeroImage): HeroSlide {
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
    video: video && backgroundVideoHtml(video, alt, media.url),
  };
}

/** Hero de la home (S1): galería → public/hero.jpg → null (hero tipográfico). `gallery` ya ordenada. */
export function resolveHero(gallery: readonly ApiHeroImage[], heroJpgExists: boolean): Hero {
  const [first] = gallery;
  if (first) return { kind: 'gallery', first, slides: gallery.map(toHeroSlide) };
  return heroJpgExists ? { kind: 'static', src: STATIC_HERO_SRC } : null;
}

/**
 * The home's og:image: the first gallery item (a video shares its poster, `media`) with its alt, or the static photo,
 * which has no alt (it is a decorative background). The typographic hero has no image to share.
 */
export function heroShareImage(hero: Hero): { src: string; alt: string | undefined } | null {
  if (hero?.kind === 'gallery') return { src: hero.first.media.url, alt: hero.first.alt };
  return hero ? { src: hero.src, alt: undefined } : null;
}

export const getHeroImages: () => Promise<ApiHeroImage[]> = oncePerBuild(() =>
  getInternal<ApiHeroImage[]>('/api/internal/hero-images', 'las fotos del hero').then(orderHeroImages),
);
