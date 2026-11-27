import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

/**
 * The contrast the CSS guarantees in the worst case, computed with the WCAG formula from the tokens: if someone lightens
 * the overlay or changes a text color, this fails before a reader notices. It was also measured in Chrome (white photo,
 * 390 × 844, 1366 × 657 and 1440 × 900).
 */

const read = (specifier: string): string => readFileSync(new URL(import.meta.resolve(specifier)), 'utf8');
const tokens = read('@blog/tokens/tokens.css');
const prose = read('@blog/tokens/prose.css');
const site = readFileSync(new URL('../src/styles/site.css', import.meta.url), 'utf8');

/** The body of the first block whose selector is exactly `selector` (these stylesheets have no nesting). */
function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(String.raw`(?:^|[}\s])${escaped}\s*\{([^}]*)\}`, 'm').exec(css);
  assert.ok(rule, `missing rule ${selector}`);
  return rule[1]!;
}

/** A custom property's value, with each `var(--x)` replaced: looked up first in `scope` and then in :root. */
function token(name: string, scope = ':root'): string {
  for (const body of [block(tokens, scope), block(tokens, ':root')]) {
    const value = new RegExp(String.raw`(?:^|[;\s{])${name}:\s*([^;]+);`).exec(body)?.[1]?.trim();
    if (value !== undefined) return value.replace(/var\((--[\w-]+)\)/g, (_, reference: string) => token(reference, scope));
  }
  assert.fail(`missing token ${name}`);
}

type Rgb = [number, number, number];

function hex(value: string): Rgb {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  assert.ok(match, `not a hexadecimal color: ${value}`);
  const digits = match[1]!.length === 3 ? [...match[1]!].map((d) => d + d).join('') : match[1]!;
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
}

const luminance = ([r, g, b]: Rgb): number => {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

const contrast = (a: Rgb, b: Rgb): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

/* ----------------------- Overlay of the hero photos ----------------------- */

interface Stop {
  color: Rgb;
  alpha: number;
  /** Distance in rem from the edge where the layer starts. */
  at: number;
}
interface Layer {
  /** The edge the stops are measured from. */
  from: 'top' | 'bottom';
  stops: Stop[];
}

/** Layers of an overlay token: vertical linear gradients with rgba stops in rem (or 0). */
function layersOf(name: string): Layer[] {
  const layers = token(name)
    .split(/\)\s*,\s*(?=linear-gradient)/)
    .map((part) => part.trim().replace(/\)?$/, ')'));
  return layers.map((layer) => {
    const inner = /^linear-gradient\(([\s\S]*)\)$/.exec(layer)?.[1];
    assert.ok(inner, `unsupported layer: ${layer}`);
    const from = /^\s*to top\s*,/.test(inner) ? 'bottom' : 'top';
    const stops = [...inner.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)\s+(0|[\d.]+rem)/g)].map((m) => ({
      color: [Number(m[1]), Number(m[2]), Number(m[3])] as Rgb,
      alpha: Number(m[4]),
      at: parseFloat(m[5]!),
    }));
    assert.ok(stops.length >= 2, `${name}: layer without rem stops: ${layer}`);
    return { from, stops };
  });
}

/** The layer's opacity `distance` rem from its edge (linear interpolation; outside the stops, the nearest end's). */
function alphaAt(layer: Layer, distance: number): number {
  const { stops } = layer;
  if (distance <= stops[0]!.at) return stops[0]!.alpha;
  for (let i = 1; i < stops.length; i += 1) {
    const [a, b] = [stops[i - 1]!, stops[i]!];
    if (distance <= b.at) return a.alpha + ((b.alpha - a.alpha) * (distance - a.at)) / (b.at - a.at || 1);
  }
  return stops[stops.length - 1]!.alpha;
}

const WHITE: Rgb = [255, 255, 255];
/** Worst case: a white photo behind the text, with the overlay color composited on top. */
const overWhite = (ink: Rgb, alpha: number): Rgb => ink.map((c, i) => WHITE[i]! * (1 - alpha) + c * alpha) as Rgb;

/** The lowest contrast of `text` in the band [start, end] rem from the layer's edge (every 0.25 rem). */
function worstContrast(layer: Layer, text: Rgb, end: number, start = 0): number {
  let worst = Infinity;
  for (let d = start; d <= end; d += 0.25) worst = Math.min(worst, contrast(text, overWhite(layer.stops[0]!.color, alphaAt(layer, d))));
  return worst;
}

// Where the text that the text block's veil does not cover sits (measured in Chrome): the header ends before 3.5 rem
// from the top edge; below the block, on mobile, the credit and Play/Pause end before 11 rem from the bottom edge.
const HEADER_BAND_REM = 4.5;
const BELOW_TEXT_REM = 12;

describe('hero and cover overlay over a white photo (WCAG 1.4.3)', () => {
  // Read in each test: an overlay that cannot be measured fails there, with its message, and does not crash the suite.
  let photo: Layer[] = [];
  let text: Layer[] = [];
  const primary = hex(token('--text-primary'));
  const secondary = hex(token('--text-secondary'));
  beforeEach(() => {
    photo = layersOf('--overlay-hero');
    text = layersOf('--overlay-hero-text');
  });
  const top = (): Layer => photo.find((layer) => layer.from === 'top')!;
  const bottom = (): Layer => photo.find((layer) => layer.from === 'bottom')!;

  it('over the photo: one band at the top (header) and one at the bottom, starting at 0.62 or more', () => {
    assert.ok(top(), 'missing top layer');
    assert.ok(bottom(), 'missing bottom layer ("to top")');
    // The first stop, behind the text, does not go below 0.62.
    for (const layer of photo) assert.ok(layer.stops[0]!.alpha >= 0.62, `first stop ${layer.stops[0]!.alpha}`);
  });

  it('brand, menu and ES | EN (text-primary) reach 4.5:1 across the whole header band', () => {
    const ratio = worstContrast(top(), primary, HEADER_BAND_REM);
    assert.ok(ratio >= 4.5, `header: ${ratio.toFixed(2)}:1`);
  });

  it('credit and button below the text (down to text-secondary) reach 4.5:1 in the bottom band', () => {
    const ratio = worstContrast(bottom(), secondary, BELOW_TEXT_REM);
    assert.ok(ratio >= 4.5, `bottom band: ${ratio.toFixed(2)}:1`);
  });

  it('behind the text block the veil reaches 4.5:1 with text-primary and text-secondary, whatever its height', () => {
    assert.equal(text.length, 1);
    const [veil] = text as [Layer];
    const fade = veil.stops[veil.stops.length - 1]!.at;
    // The veil rises `fade` rem above the text: the text starts where the fade ends and goes down to the bottom.
    assert.equal(token('--overlay-hero-text-fade'), `${fade}rem`);
    for (const [name, color] of [['text-primary', primary], ['text-secondary', secondary]] as const) {
      const ratio = worstContrast(veil, color, fade + 60, fade);
      assert.ok(ratio >= 4.5, `${name} behind the text: ${ratio.toFixed(2)}:1`);
    }
  });

  it('in the middle the photo still shows: the bands end transparent and the veil starts transparent', () => {
    for (const layer of photo) assert.equal(layer.stops[layer.stops.length - 1]!.alpha, 0);
    assert.equal(text[0]!.stops[0]!.alpha, 0);
  });

  it('the veil sits behind the text of the home hero and the cover, edge to edge and down to the bottom', () => {
    const veil = block(site, '.hero--photo .hero-body::before, .article-hero-body::before');
    assert.match(veil, /background:\s*var\(--overlay-hero-text\)/);
    assert.match(veil, /top:\s*calc\(-1 \* var\(--overlay-hero-text-fade\)\)/);
    // Down to the hero's bottom edge, which clips it: no seam with the bottom margin.
    assert.match(veil, /bottom:\s*-100vh/);
    assert.match(veil, /z-index:\s*-1/);
    assert.match(veil, /left:\s*calc\(-1 \* var\(--gutter\)\);\s*width:\s*100vw/);
    // Its own stacking context: the veil sits above the photo (which comes later in the gallery) and below the text.
    assert.match(block(site, '.hero--photo .hero-body, .article-hero-body'), /position:\s*relative;\s*z-index:\s*0/);
    assert.match(block(site, '.hero--photo, .article-hero'), /overflow:\s*hidden/);
    // On mobile the credit and the button go below the block: positioned, they paint above the veil, not below it.
    assert.match(block(site, '.hero-credit'), /position:\s*relative/);
    assert.match(block(site, '.hero-toggle'), /position:\s*relative/);
  });
});

/* ------------------------- Focus and underline on the sheet ------------------------- */

describe('focus and underline on the white sheet (WCAG 1.4.11)', () => {
  const paper = hex(token('--paper-bg', '.paper'));

  it('the focus ring and the hover underline reach 3:1 on .paper', () => {
    for (const name of ['--link-accent', '--link-underline-hover']) {
      const ratio = contrast(hex(token(name, '.paper')), paper);
      assert.ok(ratio >= 3, `${name} on the sheet: ${ratio.toFixed(2)}:1`);
    }
  });

  it('the dark theme keeps the design system ones', () => {
    assert.equal(token('--link-accent'), '#9db2ff');
    assert.equal(token('--link-underline-hover'), '#c4d0ff');
  });

  it('code blocks and scrolling tables show focus (WCAG 2.4.7)', () => {
    assert.match(block(prose, '.prose pre:focus-visible, .prose .table-wrap:focus-visible'), /outline:\s*2px solid var\(--link-accent\)/);
  });
});
