import { getInternal, oncePerBuild } from './api.ts';
import { htmlAttributes } from './html.ts';
import type { Lang } from './i18n.ts';
import { safeColor, safePlaceholder, srcset, type MediaAsset } from './media.ts';
import { videoSourcesHtml, type VideoAsset } from './video.ts';

/** HeroImageDto (GET /api/internal/hero-images). */
export interface ApiHeroImage {
  id: string;
  /** The photo or, for a video, its poster. */
  media: MediaAsset;
  alt: string;
  credit: string | null;
  /** English alternative text; missing or null → the Spanish one is used. There is one credit (a proper name). */
  altEn?: string | null;
  createdAt: string;
  video: VideoAsset | null;
}

/**
 * The minimum the rotation script needs from each photo or video (embedded in the home's HTML).
 * `img` and `background` use the DOM property names: the script assigns them as they are.
 */
export interface HeroSlide {
  avif: string;
  webp: string;
  img: { alt: string; width: number; height: number; src: string };
  background: { backgroundColor: string; backgroundImage: string };
  credit: string | null;
  /**
   * Markup of the background <video>, already escaped, or null for a photo. The script inserts it as is; if the
   * visitor asked for reduced motion or data saving it uses the fields above, which for a video are the poster.
   */
  video: string | null;
}

export type Hero =
  /** The admin's gallery: rotates on every visit; `first` is rendered in <noscript> and is the og:image. */
  | { kind: 'gallery'; first: ApiHeroImage; slides: HeroSlide[] }
  /** Fallback without a gallery: a photo dropped by hand in public/. */
  | { kind: 'static'; src: string }
  | null;

const STATIC_HERO_SRC = '/hero.jpg';

/** Oldest first: it is the <noscript> one and the og:image, and it does not change when new photos are uploaded. */
export const orderHeroImages = (images: readonly ApiHeroImage[]): ApiHeroImage[] =>
  [...images].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

/**
 * Background video: muted autoplay in a loop, like a photo that moves. `muted` and `playsinline` are the browsers'
 * conditions (iOS included) for autoplay; `preload="metadata"` fetches no bytes ahead if autoplay is blocked.
 * `poster` does not accept srcset: it gets the fallback WebP (`media.url`).
 * Accessibility: the `role="img"` wrapper with the alt exposes it as what it is (an image with its alternative
 * text, just like the photos) and, since the children of an `img` are presentational, the <video> without controls
 * is not announced separately. `role="img"` is not allowed on the <video> itself, and a bare `aria-label` on it has
 * no role that names it reliably in every screen reader.
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
 * The photo with the alt in the page's language; the credit is the same in both (a proper name). It is localized
 * before building the hero, so slides, <noscript> and og:image:alt come from the same texts.
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
    // `src` last: the script assigns in this order, so the request goes out with alt and size already set.
    img: { alt, width: media.width, height: media.height, src: media.url },
    background: {
      backgroundColor: safeColor(media.color) ?? '',
      backgroundImage: placeholder ? `url(${placeholder})` : '',
    },
    credit: credit?.trim() || null,
    video: video && backgroundVideoHtml(video, alt, media.url),
  };
}

/** The home's hero: gallery → public/hero.jpg → null (typographic hero). `gallery` already sorted. */
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
  getInternal<ApiHeroImage[]>('/api/internal/hero-images', 'the hero photos').then(orderHeroImages),
);
