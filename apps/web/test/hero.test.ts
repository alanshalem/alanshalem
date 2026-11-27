import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as heroModule from '../src/lib/hero.ts';
import { localizeHeroImage, orderHeroImages, resolveHero, toHeroSlide, type ApiHeroImage, type HeroSlide } from '../src/lib/hero.ts';
import {
  HERO_ELEMENT_IDS,
  HERO_PLAYING_CLASS,
  HERO_ROTATION_SCRIPT,
  HERO_STORAGE_KEY,
  PICK_HERO_INDEX_JS,
} from '../src/lib/hero-rotation.ts';
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

/** A gallery video item: `media` is its poster. */
const heroVideo = (n: number, overrides: Partial<ApiHeroImage> = {}): ApiHeroImage => {
  const video = videoAsset(`v${n}`);
  return heroImage(n, { alt: `Video ${n}`, media: video.poster ?? mediaAsset(`poster-v${n}`), video, ...overrides });
};

describe('orderHeroImages: the gallery goes by ascending createdAt', () => {
  it('oldest first, without mutating the input', () => {
    const input = [heroImage(3), heroImage(1), heroImage(2)];
    assert.deepEqual(orderHeroImages(input).map((h) => h.id), ['h1', 'h2', 'h3']);
    assert.deepEqual(input.map((h) => h.id), ['h3', 'h1', 'h2']);
  });
});

describe('resolveHero: gallery → public/hero.jpg → typographic hero', () => {
  it('with a gallery: the first one is the <noscript> one; one slide per photo', () => {
    const hero = resolveHero([heroImage(1), heroImage(2)], true);
    assert.equal(hero?.kind, 'gallery');
    assert.ok(hero?.kind === 'gallery');
    assert.equal(hero.first.id, 'h1');
    assert.equal(hero.slides.length, 2);
  });
  it('without a gallery it uses /hero.jpg when it exists', () => {
    assert.deepEqual(resolveHero([], true), { kind: 'static', src: '/hero.jpg' });
  });
  it('without a gallery or hero.jpg => null (typographic hero)', () => {
    assert.equal(resolveHero([], false), null);
  });
});

describe('localizeHeroImage: altEn on /en/, with a Spanish fallback; there is a single credit', () => {
  it('en uses the English alternative text and the same credit', () => {
    const image = localizeHeroImage(heroImage(1, { altEn: 'Photo 1' }), 'en');
    assert.equal(image.alt, 'Photo 1');
    assert.equal(image.credit, 'Crédito 1');
    assert.equal(toHeroSlide(image).img.alt, 'Photo 1');
    assert.equal(toHeroSlide(image).credit, 'Crédito 1');
  });
  it('en without English alternative text (missing, null or blank) uses the Spanish one', () => {
    assert.equal(localizeHeroImage(heroImage(1), 'en').alt, 'Foto 1');
    assert.equal(localizeHeroImage(heroImage(1, { altEn: null }), 'en').alt, 'Foto 1');
    assert.equal(localizeHeroImage(heroImage(1, { altEn: ' ' }), 'en').alt, 'Foto 1');
  });
  it('a creditEn still sent by an old API does not change the credit', () => {
    const legacy = { ...heroImage(1), creditEn: 'Credit 1' };
    assert.equal(localizeHeroImage(legacy, 'en').credit, 'Crédito 1');
  });
  it('es ignores the English text', () => {
    const image = localizeHeroImage(heroImage(1, { altEn: 'Photo 1' }), 'es');
    assert.equal(image.alt, 'Foto 1');
    assert.equal(image.credit, 'Crédito 1');
  });
});

describe('toHeroSlide: the minimum the script needs', () => {
  it('AVIF and WebP srcset, fallback <img> with size and alt, background and credit', () => {
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

  it('src goes last: the script assigns in order and the image is requested with alt and size already set', () => {
    assert.equal(Object.keys(toHeroSlide(heroImage(1)).img).at(-1), 'src');
  });

  it('an invalid color or placeholder does not reach the style; an empty credit => null', () => {
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

describe('toHeroSlide with a video', () => {
  it('the poster takes the photo place: same AVIF/WebP sources, <img>, background and credit', () => {
    const slide = toHeroSlide(heroVideo(1));
    const photo = toHeroSlide(heroImage(1, { alt: 'Video 1', media: mediaAsset('poster-v1') }));
    assert.deepEqual({ ...slide, video: null }, photo);
    assert.equal(slide.img.src, '/media/poster-v1/1600.webp');
  });

  it('background <video>: AV1 before H.264, 1080p only on wide screens, exact encoder types', () => {
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

  it('a 720p video (never upscaled) has no `media`: it works on every screen', () => {
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

  it('the alt is escaped in aria-label', () => {
    const html = toHeroSlide(heroVideo(1, { alt: 'Luna "llena" <b>&</b>' })).video ?? '';
    assert.match(html, /aria-label="Luna &quot;llena&quot; &lt;b&gt;&amp;&lt;\/b&gt;"/);
  });
});

describe('jsonForScript: safe JSON inside <script>', () => {
  it('cannot close the <script> or open HTML comments', () => {
    const json = jsonForScript({ alt: '</script><script>alert(1)</script><!--' });
    assert.doesNotMatch(json, /<|>/);
    assert.deepEqual(JSON.parse(json), { alt: '</script><script>alert(1)</script><!--' });
  });

  it('escapes U+2028/U+2029 and &', () => {
    const json = jsonForScript({ credit: 'a\u2028b\u2029c & d' });
    assert.equal(json, '{"credit":"a\\u2028b\\u2029c \\u0026 d"}');
    assert.equal(JSON.parse(json).credit, 'a\u2028b\u2029c & d');
  });
});

type Pick = (count: number, last: number, random: number) => number;
// The picker is plain JS that travels as is inside the inline script: exactly that code is tested.
const pickHeroIndex = new Function(`return ${PICK_HERO_INDEX_JS}`)() as Pick;
const RANDOMS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999999];

describe('index picker (pure function)', () => {
  it('with n > 1 it never repeats the last seen one and always lands in range', () => {
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

  it('with n > 1 every other photo is reachable', () => {
    const seen = new Set(RANDOMS.map((r) => pickHeroIndex(4, 1, r)));
    assert.deepEqual([...seen].sort(), [0, 2, 3]);
  });

  it('without a valid last seen one (first visit, empty storage or a smaller gallery) it picks among all', () => {
    for (const last of [NaN, -1, 7, 4]) {
      assert.deepEqual(
        new Set(RANDOMS.map((r) => pickHeroIndex(4, last, r))),
        new Set([0, 1, 2, 3]),
        `last=${last}`,
      );
    }
  });

  it('with n = 1 always 0, whatever the randomness or the last one', () => {
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
  /** The user asked for reduced motion in the system. */
  reducedMotion?: boolean;
  /** `navigator.connection`: Chrome has it; Safari and Firefox do not. */
  connection?: { saveData: boolean };
  /** The browser does not allow playing without a gesture (iOS in low power mode, autoplay policies). */
  autoplayBlocked?: boolean;
}

/**
 * Minimal <video> with the HTMLMediaElement semantics the script uses: `play()` sets `paused` to false at once (or
 * returns a rejected promise without touching it when not allowed) and signals `play`; `pause()` signals `pause`.
 */
class FakeVideo {
  paused = true;
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  /** Public: the test turns it off to simulate the user gesture, which does enable `play()`. */
  blocked: boolean;
  constructor(blocked: boolean) {
    this.blocked = blocked;
  }
  play(): Promise<void> {
    if (this.blocked) return Promise.reject(new Error('NotAllowedError'));
    if (this.paused) {
      this.paused = false;
      this.onplay?.();
    }
    return Promise.resolve();
  }
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.onpause?.();
  }
}

/** Play/Pause button: the script only shows it, toggles the state class and sets its `onclick`. */
interface FakeToggle {
  hidden: boolean;
  classes: Set<string>;
  classList: { toggle(name: string, force: boolean): void };
  onclick: (() => void) | null;
}

function fakeToggle(): FakeToggle {
  const classes = new Set<string>();
  let hidden = true;
  return {
    // As in the DOM, `hidden` turns whatever is assigned into a boolean.
    get hidden() {
      return hidden;
    },
    set hidden(value) {
      hidden = Boolean(value);
    },
    classes,
    classList: { toggle: (name, force) => void (force ? classes.add(name) : classes.delete(name)) },
    onclick: null,
  };
}

/** Minimal DOM, localStorage, matchMedia and navigator to run the real script in an isolated context. */
function runRotation(slides: HeroSlide[], storage: object, viewer: Viewer = {}) {
  const avif: FakeElement = { style: {} };
  const webp: FakeElement = { style: {} };
  const img: FakeElement = { style: {} };
  const inserted: string[] = [];
  const videos: FakeVideo[] = [];
  const picture = {
    style: {} as Record<string, string>,
    children: [avif, webp, img],
    nextSibling: null as { firstChild: FakeVideo } | null,
    insertAdjacentHTML(position: string, html: string) {
      assert.equal(position, 'afterend', 'the video goes on top of the <picture>, which stays as the background');
      inserted.push(html);
      // The inserted markup is <div class="hero-video"><video>…: it becomes the <picture>'s next sibling.
      const video = new FakeVideo(viewer.autoplayBlocked === true);
      videos.push(video);
      picture.nextSibling = { firstChild: video };
    },
  };
  const credit: FakeElement = { style: {}, textContent: 'initial' };
  const toggle = fakeToggle();
  const elements: Record<string, unknown> = {
    [HERO_ELEMENT_IDS.slides]: { text: jsonForScript(slides) },
    [HERO_ELEMENT_IDS.picture]: picture,
    [HERO_ELEMENT_IDS.credit]: credit,
    [HERO_ELEMENT_IDS.toggle]: toggle,
  };
  runInNewContext(HERO_ROTATION_SCRIPT, {
    document: { getElementById: (id: string) => elements[id] ?? null },
    localStorage: storage,
    matchMedia: (query: string) => ({ matches: query === REDUCED_MOTION && viewer.reducedMotion === true }),
    navigator: { connection: viewer.connection },
  });
  return { avif, webp, img, picture, credit, inserted, videos, toggle };
}

/** What the button shows: the CSS shows "❚❚ Pause" with the state class and "▶ Play" without it. */
const toggleLabel = (toggle: FakeToggle): 'pause' | 'play' => (toggle.classes.has(HERO_PLAYING_CLASS) ? 'pause' : 'play');

const slides = [1, 2, 3].map((n) => toHeroSlide(heroImage(n)));

describe('inline rotation script', () => {
  it('weighs ≤ 800 bytes', () => {
    const bytes = Buffer.byteLength(HERO_ROTATION_SCRIPT);
    assert.ok(bytes <= 800, `weighs ${bytes} bytes`);
  });

  it('fills <picture>, <img>, background and credit with the chosen photo', () => {
    const { avif, webp, img, picture, credit } = runRotation(slides, {});
    const chosen = slides.find((s) => s.img.src === img.src);
    assert.ok(chosen, 'it picked one from the gallery');
    assert.equal(avif.srcset, chosen.avif);
    assert.equal(webp.srcset, chosen.webp);
    assert.equal(img.alt, chosen.img.alt);
    assert.equal(img.width, chosen.img.width);
    assert.equal(img.height, chosen.img.height);
    assert.deepEqual(picture.style, chosen.background);
    assert.equal(credit.textContent, chosen.credit);
  });

  it('never repeats the last seen one between consecutive visits and goes through them all', () => {
    const storage: Record<string, unknown> = {};
    const shown: string[] = [];
    for (let visit = 0; visit < 60; visit++) shown.push(String(runRotation(slides, storage).img.src));
    for (let i = 1; i < shown.length; i++) assert.notEqual(shown[i], shown[i - 1], `visit ${i}`);
    assert.equal(new Set(shown).size, slides.length);
  });

  it('if localStorage throws (private mode, blocked cookies) it still shows a photo', () => {
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

  it('with a single photo it always shows it', () => {
    const storage: Record<string, unknown> = {};
    for (let visit = 0; visit < 5; visit++) {
      assert.equal(runRotation(slides.slice(0, 1), storage).img.src, slides[0]?.img.src);
    }
  });

  it('a photo without a credit empties the credit line', () => {
    const { credit } = runRotation([toHeroSlide(heroImage(1, { credit: null }))], {});
    assert.ok(!credit.textContent);
  });
});

describe('rotation script with videos', () => {
  const video = toHeroSlide(heroVideo(1));

  it('without reduced-motion or Save-Data it inserts the <video> over the <picture>, which stays as the background only', () => {
    for (const connection of [undefined, { saveData: false }]) {
      const { avif, webp, img, picture, credit, inserted } = runRotation([video], {}, { connection });
      assert.deepEqual(inserted, [video.video]);
      assert.deepEqual(picture.style, video.background);
      assert.equal(credit.textContent, video.credit);
      // The <video> downloads the poster: the <picture> requests nothing (no double download).
      assert.equal(avif.srcset, undefined);
      assert.equal(webp.srcset, undefined);
      assert.equal(img.src, undefined);
    }
  });

  for (const [why, viewer] of [
    ['prefers-reduced-motion: reduce', { reducedMotion: true }],
    ['Save-Data', { connection: { saveData: true } }],
  ] as const) {
    it(`with ${why} it shows only the poster, just like a photo`, () => {
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

  it('photos and videos share the rule: never repeat the last seen one and go through them all', () => {
    const storage: Record<string, unknown> = {};
    const shown: string[] = [];
    for (let visit = 0; visit < 60; visit++) shown.push(shownOn(runRotation(mixed, storage)));
    for (let i = 1; i < shown.length; i++) assert.notEqual(shown[i], shown[i - 1], `visit ${i}`);
    assert.equal(new Set(shown).size, mixed.length);
  });

  it('if localStorage throws it still shows the video', () => {
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

  it('with a single video it always shows it', () => {
    const storage: Record<string, unknown> = {};
    for (let visit = 0; visit < 5; visit++) assert.deepEqual(runRotation([video], storage).inserted, [video.video]);
  });
});

describe('video Play/Pause button (WCAG 2.2.2)', () => {
  const video = toHeroSlide(heroVideo(1));

  it('without reduced-motion or Save-Data: the video starts on its own and the visible button offers ❚❚ Pause', () => {
    const { toggle, videos, inserted } = runRotation([video], {});
    assert.deepEqual(inserted, [video.video]);
    assert.equal(toggle.hidden, false);
    assert.equal(videos[0]?.paused, false);
    assert.equal(toggleLabel(toggle), 'pause');
  });

  it('each click toggles pause and play, and the button text follows the real state', () => {
    const { toggle, videos, inserted } = runRotation([video], {});
    toggle.onclick?.();
    assert.equal(videos[0]?.paused, true);
    assert.equal(toggleLabel(toggle), 'play');
    toggle.onclick?.();
    assert.equal(videos[0]?.paused, false);
    assert.equal(toggleLabel(toggle), 'pause');
    assert.equal(inserted.length, 1, 'toggling does not insert the video again');
  });

  for (const [why, viewer] of [
    ['prefers-reduced-motion: reduce', { reducedMotion: true }],
    ['Save-Data', { connection: { saveData: true } }],
  ] as const) {
    it(`with ${why}: poster and ▶ Play; the click inserts the video, starts it and switches to ❚❚ Pause`, () => {
      const { toggle, videos, inserted, img } = runRotation([video], {}, viewer);
      assert.deepEqual(inserted, []);
      assert.equal(img.src, video.img.src, 'meanwhile the poster shows');
      assert.equal(toggle.hidden, false);
      assert.equal(toggleLabel(toggle), 'play');

      toggle.onclick?.();
      assert.deepEqual(inserted, [video.video]);
      assert.equal(videos[0]?.paused, false);
      assert.equal(toggleLabel(toggle), 'pause');

      toggle.onclick?.();
      assert.equal(videos[0]?.paused, true);
      assert.equal(toggleLabel(toggle), 'play');
      assert.equal(inserted.length, 1);
    });
  }

  it('a photo has no button', () => {
    const { toggle } = runRotation([toHeroSlide(heroImage(1))], {});
    assert.equal(toggle.hidden, true);
    assert.equal(toggle.onclick, null);
  });

  it('if the browser blocks autoplay, the button does not lie: it offers ▶ Play and the click starts it', async () => {
    const run = runRotation([video], {}, { autoplayBlocked: true });
    await new Promise((resolve) => setImmediate(resolve)); // lets the play() rejection run
    const [video0] = run.videos;
    assert.ok(video0, 'the video was inserted anyway');
    assert.equal(video0.paused, true);
    assert.equal(run.toggle.hidden, false);
    assert.equal(toggleLabel(run.toggle), 'play');

    video0.blocked = false; // a click is a user gesture: now play() is allowed
    run.toggle.onclick?.();
    assert.equal(video0.paused, false);
    assert.equal(toggleLabel(run.toggle), 'pause');
    assert.equal(run.inserted.length, 1);
  });
});

describe('heroShareImage: the og:image of the home comes from the hero', () => {
  it('gallery: the first item (a video shares its poster) with its alt', () => {
    const hero = resolveHero([heroVideo(1), heroImage(2)], false);
    assert.deepEqual(heroModule.heroShareImage(hero), { src: heroVideo(1).media.url, alt: 'Video 1' });
  });
  it('static /hero.jpg: the photo without alt (it is decorative)', () => {
    assert.deepEqual(heroModule.heroShareImage(resolveHero([], true)), { src: '/hero.jpg', alt: undefined });
  });
  it('typographic hero: no image to share', () => {
    assert.equal(heroModule.heroShareImage(resolveHero([], false)), null);
  });
});
