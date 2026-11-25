import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { localizeHeroImage, orderHeroImages, resolveHero, toHeroSlide, type ApiHeroImage, type HeroSlide } from '../src/lib/hero.ts';
import { HERO_ELEMENT_IDS, HERO_ROTATION_SCRIPT, HERO_STORAGE_KEY, PICK_HERO_INDEX_JS } from '../src/lib/hero-rotation.ts';
import { jsonForScript } from '../src/lib/html.ts';
import { mediaAsset, videoAsset } from './fixtures.ts';

const heroImage = (n: number, overrides: Partial<ApiHeroImage> = {}): ApiHeroImage => ({
  id: `h${n}`,
  media: mediaAsset(`hash${n}`),
  alt: `Foto ${n}`,
  credit: `Crédito ${n}`,
  createdAt: `2026-11-0${n}T10:00:00Z`,
  video: null,
  ...overrides,
});

/** Ítem de video de la galería (L13): `media` es su póster. */
const heroVideo = (n: number, overrides: Partial<ApiHeroImage> = {}): ApiHeroImage => {
  const video = videoAsset(`v${n}`);
  return heroImage(n, { alt: `Video ${n}`, media: video.poster ?? mediaAsset(`poster-v${n}`), video, ...overrides });
};

describe('orderHeroImages: la galería va por createdAt ascendente (L10)', () => {
  it('la más vieja primero, sin mutar la entrada', () => {
    const input = [heroImage(3), heroImage(1), heroImage(2)];
    assert.deepEqual(orderHeroImages(input).map((h) => h.id), ['h1', 'h2', 'h3']);
    assert.deepEqual(input.map((h) => h.id), ['h3', 'h1', 'h2']);
  });
});

describe('resolveHero (S1): galería → public/hero.jpg → hero tipográfico', () => {
  it('con galería: la primera es la de <noscript>; una diapositiva por foto', () => {
    const hero = resolveHero([heroImage(1), heroImage(2)], true);
    assert.equal(hero?.kind, 'gallery');
    assert.ok(hero?.kind === 'gallery');
    assert.equal(hero.first.id, 'h1');
    assert.equal(hero.slides.length, 2);
  });
  it('sin galería usa /hero.jpg si existe', () => {
    assert.deepEqual(resolveHero([], true), { kind: 'static', src: '/hero.jpg' });
  });
  it('sin galería ni hero.jpg => null (hero tipográfico)', () => {
    assert.equal(resolveHero([], false), null);
  });
});

describe('localizeHeroImage: altEn / creditEn en /en/, con respaldo en español (L4)', () => {
  it('en usa los textos en inglés', () => {
    const image = localizeHeroImage(heroImage(1, { altEn: 'Photo 1', creditEn: 'Credit 1' }), 'en');
    assert.equal(image.alt, 'Photo 1');
    assert.equal(image.credit, 'Credit 1');
    assert.equal(toHeroSlide(image).img.alt, 'Photo 1');
  });
  it('en sin textos en inglés (ausentes, nulos o en blanco) usa los de español', () => {
    assert.equal(localizeHeroImage(heroImage(1), 'en').alt, 'Foto 1');
    const blank = localizeHeroImage(heroImage(1, { altEn: ' ', creditEn: null }), 'en');
    assert.equal(blank.alt, 'Foto 1');
    assert.equal(blank.credit, 'Crédito 1');
  });
  it('es ignora los textos en inglés', () => {
    const image = localizeHeroImage(heroImage(1, { altEn: 'Photo 1', creditEn: 'Credit 1' }), 'es');
    assert.equal(image.alt, 'Foto 1');
    assert.equal(image.credit, 'Crédito 1');
  });
});

describe('toHeroSlide: lo mínimo que necesita el script', () => {
  it('srcset AVIF y WebP, <img> fallback con medidas y alt, fondo y crédito', () => {
    assert.deepEqual(toHeroSlide(heroImage(1)), {
      avif: '/media/hash1/640.avif 640w, /media/hash1/1024.avif 1024w, /media/hash1/1600.avif 1600w',
      webp: '/media/hash1/640.webp 640w, /media/hash1/1024.webp 1024w, /media/hash1/1600.webp 1600w',
      img: { alt: 'Foto 1', width: 2000, height: 1125, src: '/media/hash1/1600.webp' },
      background: {
        backgroundColor: '#336699',
        backgroundImage: 'url(data:image/webp;base64,UklGRhIAAABXRUJQ)',
      },
      credit: 'Crédito 1',
      video: null,
    } satisfies HeroSlide);
  });

  it('src va último: el script asigna en orden y la imagen se pide con alt y medidas ya puestos', () => {
    assert.equal(Object.keys(toHeroSlide(heroImage(1)).img).at(-1), 'src');
  });

  it('color o placeholder inválidos no llegan al estilo; crédito vacío => null', () => {
    const slide = toHeroSlide(
      heroImage(1, { credit: '  ', media: mediaAsset('x', { color: 'red', placeholder: 'javascript:alert(1)' }) }),
    );
    assert.deepEqual(slide.background, { backgroundColor: '', backgroundImage: '' });
    assert.equal(slide.credit, null);
  });
});

const AV1_1080 = 'video/mp4; codecs=&quot;av01.0.08M.08&quot;';
const AV1_720 = 'video/mp4; codecs=&quot;av01.0.05M.08&quot;';
const H264_1080 = 'video/mp4; codecs=&quot;avc1.640028&quot;';
const H264_720 = 'video/mp4; codecs=&quot;avc1.64001f&quot;';

describe('toHeroSlide con video (S9, S10, L13)', () => {
  it('el póster ocupa el lugar de la foto: mismas fuentes AVIF/WebP, <img>, fondo y crédito', () => {
    const slide = toHeroSlide(heroVideo(1));
    const photo = toHeroSlide(heroImage(1, { alt: 'Video 1', media: mediaAsset('poster-v1') }));
    assert.deepEqual({ ...slide, video: null }, photo);
    assert.equal(slide.img.src, '/media/poster-v1/1600.webp');
  });

  it('<video> de fondo: AV1 antes que H.264, 1080p solo en pantallas anchas, tipos exactos del encoder', () => {
    assert.equal(
      toHeroSlide(heroVideo(1)).video,
      '<div class="hero-video" role="img" aria-label="Video 1">' +
        '<video autoplay muted loop playsinline preload="metadata" poster="/media/poster-v1/1600.webp">' +
        `<source src="/media/videos/v1/1080.av1.mp4" type="${AV1_1080}" media="(min-width: 1024px)">` +
        `<source src="/media/videos/v1/720.av1.mp4" type="${AV1_720}">` +
        `<source src="/media/videos/v1/1080.h264.mp4" type="${H264_1080}" media="(min-width: 1024px)">` +
        `<source src="/media/videos/v1/720.h264.mp4" type="${H264_720}">` +
        '</video></div>',
    );
  });

  it('un video de 720p (nunca se agranda) no lleva `media`: sirve en todas las pantallas', () => {
    const video = videoAsset('small', { width: 1280, height: 720 });
    video.sources = video.sources.filter((source) => source.height === 720);
    const html = toHeroSlide(heroVideo(1, { video })).video ?? '';
    assert.doesNotMatch(html, /media=/);
    assert.ok(
      html.includes(
        `<source src="/media/videos/small/720.av1.mp4" type="${AV1_720}">` +
          `<source src="/media/videos/small/720.h264.mp4" type="${H264_720}">`,
      ),
    );
  });

  it('el alt va escapado en aria-label', () => {
    const html = toHeroSlide(heroVideo(1, { alt: 'Luna "llena" <b>&</b>' })).video ?? '';
    assert.match(html, /aria-label="Luna &quot;llena&quot; &lt;b&gt;&amp;&lt;\/b&gt;"/);
  });
});

describe('jsonForScript: JSON seguro dentro de <script>', () => {
  it('no puede cerrar el <script> ni abrir comentarios HTML', () => {
    const json = jsonForScript({ alt: '</script><script>alert(1)</script><!--' });
    assert.doesNotMatch(json, /<|>/);
    assert.deepEqual(JSON.parse(json), { alt: '</script><script>alert(1)</script><!--' });
  });

  it('escapa U+2028/U+2029 y &', () => {
    const json = jsonForScript({ credit: 'a\u2028b\u2029c & d' });
    assert.equal(json, '{"credit":"a\\u2028b\\u2029c \\u0026 d"}');
    assert.equal(JSON.parse(json).credit, 'a\u2028b\u2029c & d');
  });
});

type Pick = (count: number, last: number, random: number) => number;
// El selector es JS plano que viaja tal cual dentro del script en línea: se prueba exactamente ese código.
const pickHeroIndex = new Function(`return ${PICK_HERO_INDEX_JS}`)() as Pick;
const RANDOMS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999999];

describe('selector de índice (función pura)', () => {
  it('con n > 1 nunca repite la última vista y siempre cae en rango', () => {
    for (const n of [2, 3, 5]) {
      for (let last = 0; last < n; last++) {
        for (const r of RANDOMS) {
          const i = pickHeroIndex(n, last, r);
          assert.ok(Number.isInteger(i) && i >= 0 && i < n, `n=${n} last=${last} r=${r} => ${i}`);
          assert.notEqual(i, last, `n=${n} last=${last} r=${r}`);
        }
      }
    }
  });

  it('con n > 1 todas las demás fotos son alcanzables', () => {
    const seen = new Set(RANDOMS.map((r) => pickHeroIndex(4, 1, r)));
    assert.deepEqual([...seen].sort(), [0, 2, 3]);
  });

  it('sin última vista válida (primera visita, almacenamiento vacío o galería más chica) elige entre todas', () => {
    for (const last of [NaN, -1, 7, 4]) {
      assert.deepEqual(
        new Set(RANDOMS.map((r) => pickHeroIndex(4, last, r))),
        new Set([0, 1, 2, 3]),
        `last=${last}`,
      );
    }
  });

  it('con n = 1 siempre 0, sin importar el azar ni la última', () => {
    for (const r of RANDOMS) {
      assert.equal(pickHeroIndex(1, 0, r), 0);
      assert.equal(pickHeroIndex(1, NaN, r), 0);
    }
  });
});

interface FakeElement {
  srcset?: string;
  style: Record<string, string>;
  textContent?: string | null;
  [key: string]: unknown;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

interface Viewer {
  /** El usuario pidió menos movimiento en el sistema. */
  reducedMotion?: boolean;
  /** `navigator.connection`: Chrome lo tiene; Safari y Firefox no. */
  connection?: { saveData: boolean };
}

/** DOM, localStorage, matchMedia y navigator mínimos para ejecutar el script real en un contexto aislado. */
function runRotation(slides: HeroSlide[], storage: object, viewer: Viewer = {}) {
  const avif: FakeElement = { style: {} };
  const webp: FakeElement = { style: {} };
  const img: FakeElement = { style: {} };
  const inserted: string[] = [];
  const picture = {
    style: {} as Record<string, string>,
    children: [avif, webp, img],
    insertAdjacentHTML(position: string, html: string) {
      assert.equal(position, 'afterend', 'el video va encima del <picture>, que queda de fondo');
      inserted.push(html);
    },
  };
  const credit: FakeElement = { style: {}, textContent: 'inicial' };
  const elements: Record<string, unknown> = {
    [HERO_ELEMENT_IDS.slides]: { text: jsonForScript(slides) },
    [HERO_ELEMENT_IDS.picture]: picture,
    [HERO_ELEMENT_IDS.credit]: credit,
  };
  runInNewContext(HERO_ROTATION_SCRIPT, {
    document: { getElementById: (id: string) => elements[id] ?? null },
    localStorage: storage,
    matchMedia: (query: string) => ({ matches: query === REDUCED_MOTION && viewer.reducedMotion === true }),
    navigator: { connection: viewer.connection },
  });
  return { avif, webp, img, picture, credit, inserted };
}

const slides = [1, 2, 3].map((n) => toHeroSlide(heroImage(n)));

describe('script de rotación en línea (S1)', () => {
  it('pesa ≤ 800 bytes (L13)', () => {
    const bytes = Buffer.byteLength(HERO_ROTATION_SCRIPT);
    assert.ok(bytes <= 800, `pesa ${bytes} bytes`);
  });

  it('completa <picture>, <img>, fondo y crédito con la foto elegida', () => {
    const { avif, webp, img, picture, credit } = runRotation(slides, {});
    const chosen = slides.find((s) => s.img.src === img.src);
    assert.ok(chosen, 'eligió una de la galería');
    assert.equal(avif.srcset, chosen.avif);
    assert.equal(webp.srcset, chosen.webp);
    assert.equal(img.alt, chosen.img.alt);
    assert.equal(img.width, chosen.img.width);
    assert.equal(img.height, chosen.img.height);
    assert.deepEqual(picture.style, chosen.background);
    assert.equal(credit.textContent, chosen.credit);
  });

  it('nunca repite la última vista entre visitas consecutivas y las recorre todas', () => {
    const storage: Record<string, unknown> = {};
    const shown: string[] = [];
    for (let visit = 0; visit < 60; visit++) shown.push(String(runRotation(slides, storage).img.src));
    for (let i = 1; i < shown.length; i++) assert.notEqual(shown[i], shown[i - 1], `visita ${i}`);
    assert.equal(new Set(shown).size, slides.length);
  });

  it('si localStorage tira (modo privado, cookies bloqueadas) igual muestra una foto', () => {
    const throwing = Object.defineProperty({}, HERO_STORAGE_KEY, {
      get() {
        throw new Error('SecurityError');
      },
      set() {
        throw new Error('QuotaExceededError');
      },
    });
    const { img } = runRotation(slides, throwing);
    assert.ok(slides.some((s) => s.img.src === img.src));
  });

  it('con una sola foto la muestra siempre', () => {
    const storage: Record<string, unknown> = {};
    for (let visit = 0; visit < 5; visit++) {
      assert.equal(runRotation(slides.slice(0, 1), storage).img.src, slides[0]?.img.src);
    }
  });

  it('una foto sin crédito vacía la línea de crédito', () => {
    const { credit } = runRotation([toHeroSlide(heroImage(1, { credit: null }))], {});
    assert.ok(!credit.textContent);
  });
});

describe('script de rotación con videos (S9, L13)', () => {
  const video = toHeroSlide(heroVideo(1));

  it('sin reduced-motion ni Save-Data inserta el <video> sobre el <picture>, que solo queda de fondo', () => {
    for (const connection of [undefined, { saveData: false }]) {
      const { avif, webp, img, picture, credit, inserted } = runRotation([video], {}, { connection });
      assert.deepEqual(inserted, [video.video]);
      assert.deepEqual(picture.style, video.background);
      assert.equal(credit.textContent, video.credit);
      // El póster lo baja el <video>: el <picture> no pide nada (sin descarga doble).
      assert.equal(avif.srcset, undefined);
      assert.equal(webp.srcset, undefined);
      assert.equal(img.src, undefined);
    }
  });

  for (const [why, viewer] of [
    ['prefers-reduced-motion: reduce', { reducedMotion: true }],
    ['Save-Data', { connection: { saveData: true } }],
  ] as const) {
    it(`con ${why} muestra solo el póster, igual que una foto`, () => {
      const { avif, webp, img, picture, inserted } = runRotation([video], {}, viewer);
      assert.deepEqual(inserted, []);
      assert.equal(avif.srcset, video.avif);
      assert.equal(webp.srcset, video.webp);
      assert.equal(img.src, video.img.src);
      assert.equal(img.alt, video.img.alt);
      assert.deepEqual(picture.style, video.background);
    });
  }

  const mixed = [toHeroSlide(heroImage(1)), video, toHeroSlide(heroImage(3))];
  const shownOn = (run: ReturnType<typeof runRotation>): string => run.inserted[0] ?? String(run.img.src);

  it('fotos y videos comparten la regla: nunca repite el último visto y los recorre todos', () => {
    const storage: Record<string, unknown> = {};
    const shown: string[] = [];
    for (let visit = 0; visit < 60; visit++) shown.push(shownOn(runRotation(mixed, storage)));
    for (let i = 1; i < shown.length; i++) assert.notEqual(shown[i], shown[i - 1], `visita ${i}`);
    assert.equal(new Set(shown).size, mixed.length);
  });

  it('si localStorage tira igual muestra el video', () => {
    const throwing = Object.defineProperty({}, HERO_STORAGE_KEY, {
      get() {
        throw new Error('SecurityError');
      },
      set() {
        throw new Error('QuotaExceededError');
      },
    });
    assert.deepEqual(runRotation([video], throwing).inserted, [video.video]);
  });

  it('con un solo video lo muestra siempre', () => {
    const storage: Record<string, unknown> = {};
    for (let visit = 0; visit < 5; visit++) assert.deepEqual(runRotation([video], storage).inserted, [video.video]);
  });
});
