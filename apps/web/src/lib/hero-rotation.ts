/**
 * Hero rotation: on every visit, a random photo or video from the gallery, never the one seen last. It is plain
 * inline JS, with no libraries or network: it runs as soon as the browser parses the hero, before painting, so the
 * photo starts downloading right away and nothing jumps. The static HTML carries the data (JSON) and an empty
 * <picture>; without JS the first photo (or the first video's poster) shows inside <noscript>.
 */

/** Ids shared by the markup of index.astro and the script. */
export const HERO_ELEMENT_IDS = {
  /** <script type="application/json"> with the slides (HeroSlide[]). */
  slides: 'hero-slides',
  /**
   * Empty <picture> with its children in a fixed order: <source> AVIF, <source> WebP, <img>. It carries the background.
   * A video is inserted right after it (on top) and the <picture> stays empty, with only the background.
   */
  picture: 'hero-picture',
  /** The photo's credit line. */
  credit: 'hero-credit',
  /** Play/Pause button (WCAG 2.2.2): `hidden` in the HTML; the script shows it only for a video. */
  toggle: 'hero-toggle',
} as const;

/**
 * State class of the button while the video plays. The CSS shows "❚❚ Pause" with it and "▶ Play" without it: both
 * texts (from the dictionary) are already in the HTML, so the script is the same in every language.
 */
export const HERO_PLAYING_CLASS = 'is-playing';

/** localStorage key holding the index of the last photo shown. */
export const HERO_STORAGE_KEY = 'hero';

/**
 * Pure picker (n photos, l = last seen, r = Math.random()) → index to show.
 * - n < 2: always 0, no randomness.
 * - valid l: draws among the other n - 1 and skips l (r < l stays; r ≥ l moves up by one).
 * - invalid l (first visit, NaN, a gallery that shrank): draws among all n.
 * It travels as is inside the script: the tests run exactly this code.
 */
export const PICK_HERO_INDEX_JS = '(n,l,r)=>n<2?0:l>=0&&l<n?(r=r*--n|0)<l?r:r+1:r*n|0';

/** Whoever turns it on in their system sees the poster instead of the video. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// The script's statements, in order. Minified by hand to stay under 800 bytes: it travels on every home visit.
const STATEMENTS = [
  // g = find by id, s = slides (a <script>'s `.text` is its content), l = last seen,
  // L = localStorage, p = <picture>, a / w / m = <source> AVIF / <source> WebP / <img>,
  // b = Play/Pause button, v = <video>, y = insert and play the video, u = sync the button.
  `let g=i=>document.getElementById(i),s=JSON.parse(g("${HERO_ELEMENT_IDS.slides}").text),l,L,p,a,w,m,b,v,y,u`,
  // localStorage may be missing or throw (private mode, blocked cookies): without it only "no repeats" is lost.
  `try{L=localStorage;l=+L.${HERO_STORAGE_KEY}}catch{}`,
  `s=s[l=(${PICK_HERO_INDEX_JS})(s.length,l,Math.random())]`,
  `try{L.${HERO_STORAGE_KEY}=l}catch{}`,
  `p=g("${HERO_ELEMENT_IDS.picture}")`,
  `Object.assign(p.style,s.background)`,
  // A video always gets the button (WCAG 2.2.2: anything that moves on its own can be paused). The label follows the
  // <video>'s real state (`paused`), not what was requested: if the browser blocks autoplay (iOS in low power mode),
  // `play()` rejects without starting and the button offers Play instead of lying. `play()` sets `paused` to false at
  // once, so `u()` right after already shows Pause without waiting for the event; the events cover the rest (clicks,
  // browser pauses). The video is inserted after the <picture> (on top), wrapped in a <div>: hence `.firstChild`.
  `if(s.video){b=g("${HERO_ELEMENT_IDS.toggle}");b.hidden=0;` +
    `u=()=>b.classList.toggle("${HERO_PLAYING_CLASS}",!v.paused);` +
    `y=()=>{p.insertAdjacentHTML("afterend",s.video);v=p.nextSibling.firstChild;v.onplay=v.onpause=u;v.play().catch(u);u()};` +
    `b.onclick=()=>v?v.paused?v.play():v.pause():y()}`,
  // It starts on its own only if the visitor asked for neither reduced motion nor data saving (`connection` only
  // exists in Chrome). Otherwise (or for a photo), the poster takes the same path as a photo and the video waits for a
  // click on Play. Never both up front: the poster is not downloaded twice.
  `if(y&&!matchMedia("${REDUCED_MOTION_QUERY}").matches&&!navigator.connection?.saveData)y();else{` +
    // The <source>s first, then the <img> (with `src` last): the browser picks a format before requesting anything.
    `[a,w,m]=p.children;a.srcset=s.avif;w.srcset=s.webp;Object.assign(m,s.img)}`,
  `g("${HERO_ELEMENT_IDS.credit}").textContent=s.credit`,
];

/** The exact content of the inline <script> (a constant: its CSP hash does not change between builds). */
export const HERO_ROTATION_SCRIPT = `{${STATEMENTS.join(';')}}`;
