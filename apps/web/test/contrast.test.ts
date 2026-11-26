import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

/**
 * Contraste que el CSS garantiza en el peor caso (plataforma-calidad U1, L4 P1-1 y P2-2), calculado con la fórmula de
 * WCAG a partir de los tokens: si alguien aclara el overlay o cambia un color de texto, esto falla antes que un lector.
 * La medición en Chrome (foto blanca, 390 × 844, 1366 × 657 y 1440 × 900) está en el informe de U1.
 */

const read = (specifier: string): string => readFileSync(new URL(import.meta.resolve(specifier)), 'utf8');
const tokens = read('@blog/tokens/tokens.css');
const prose = read('@blog/tokens/prose.css');
const site = readFileSync(new URL('../src/styles/site.css', import.meta.url), 'utf8');

/** El cuerpo del primer bloque cuyo selector es exactamente `selector` (estos CSS no tienen anidamiento). */
function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(String.raw`(?:^|[}\s])${escaped}\s*\{([^}]*)\}`, 'm').exec(css);
  assert.ok(rule, `falta la regla ${selector}`);
  return rule[1]!;
}

/** Valor de una custom property, con cada `var(--x)` reemplazado: primero se busca en `scope` y después en :root. */
function token(name: string, scope = ':root'): string {
  for (const body of [block(tokens, scope), block(tokens, ':root')]) {
    const value = new RegExp(String.raw`(?:^|[;\s{])${name}:\s*([^;]+);`).exec(body)?.[1]?.trim();
    if (value !== undefined) return value.replace(/var\((--[\w-]+)\)/g, (_, reference: string) => token(reference, scope));
  }
  assert.fail(`falta el token ${name}`);
}

type Rgb = [number, number, number];

function hex(value: string): Rgb {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  assert.ok(match, `no es un color hexadecimal: ${value}`);
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

/* ----------------------- Overlay de las fotos del hero ----------------------- */

interface Stop {
  color: Rgb;
  alpha: number;
  /** Distancia en rem desde el borde donde arranca la capa. */
  at: number;
}
interface Layer {
  /** El borde desde el que se miden las paradas. */
  from: 'top' | 'bottom';
  stops: Stop[];
}

/** Capas de un token de overlay: degradés lineales verticales con paradas rgba en rem (o 0). */
function layersOf(name: string): Layer[] {
  const layers = token(name)
    .split(/\)\s*,\s*(?=linear-gradient)/)
    .map((part) => part.trim().replace(/\)?$/, ')'));
  return layers.map((layer) => {
    const inner = /^linear-gradient\(([\s\S]*)\)$/.exec(layer)?.[1];
    assert.ok(inner, `capa no soportada: ${layer}`);
    const from = /^\s*to top\s*,/.test(inner) ? 'bottom' : 'top';
    const stops = [...inner.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)\s+(0|[\d.]+rem)/g)].map((m) => ({
      color: [Number(m[1]), Number(m[2]), Number(m[3])] as Rgb,
      alpha: Number(m[4]),
      at: parseFloat(m[5]!),
    }));
    assert.ok(stops.length >= 2, `${name}: capa sin paradas en rem: ${layer}`);
    return { from, stops };
  });
}

/** Opacidad de la capa a `distance` rem de su borde (interpolación lineal; fuera de las paradas, la del extremo). */
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
/** Peor caso: una foto blanca detrás del texto, con el color del overlay compuesto encima. */
const overWhite = (ink: Rgb, alpha: number): Rgb => ink.map((c, i) => WHITE[i]! * (1 - alpha) + c * alpha) as Rgb;

/** El contraste más bajo de `text` en la franja [start, end] rem desde el borde de la capa (cada 0,25 rem). */
function worstContrast(layer: Layer, text: Rgb, end: number, start = 0): number {
  let worst = Infinity;
  for (let d = start; d <= end; d += 0.25) worst = Math.min(worst, contrast(text, overWhite(layer.stops[0]!.color, alphaAt(layer, d))));
  return worst;
}

// Dónde está el texto que no cubre el velo del bloque de texto (medido en Chrome): la cabecera termina antes de 3,5 rem
// del borde de arriba; debajo del bloque, en mobile, el crédito y Reproducir/Pausar terminan antes de 11 rem del de abajo.
const HEADER_BAND_REM = 4.5;
const BELOW_TEXT_REM = 12;

describe('overlay del hero y de la portada sobre una foto blanca (WCAG 1.4.3, L4 P1-1)', () => {
  // Se lee en cada test: un overlay que no se puede medir falla ahí, con su mensaje, y no tira abajo la suite.
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

  it('sobre la foto: una franja arriba (cabecera) y otra abajo, que arrancan en 0,62 o más', () => {
    assert.ok(top(), 'falta la capa de arriba');
    assert.ok(bottom(), 'falta la capa de abajo ("to top")');
    // Lo que propuso la verificación: la primera parada, detrás del texto, no baja de 0,62.
    for (const layer of photo) assert.ok(layer.stops[0]!.alpha >= 0.62, `primera parada ${layer.stops[0]!.alpha}`);
  });

  it('marca, menú y ES | EN (text-primary) llegan a 4,5:1 en toda la franja de la cabecera', () => {
    const ratio = worstContrast(top(), primary, HEADER_BAND_REM);
    assert.ok(ratio >= 4.5, `cabecera: ${ratio.toFixed(2)}:1`);
  });

  it('crédito y botón debajo del texto (hasta text-secondary) llegan a 4,5:1 en la franja de abajo', () => {
    const ratio = worstContrast(bottom(), secondary, BELOW_TEXT_REM);
    assert.ok(ratio >= 4.5, `franja de abajo: ${ratio.toFixed(2)}:1`);
  });

  it('detrás del bloque de texto el velo llega a 4,5:1 con text-primary y text-secondary, sin importar su alto', () => {
    assert.equal(text.length, 1);
    const [veil] = text as [Layer];
    const fade = veil.stops[veil.stops.length - 1]!.at;
    // El velo sube `fade` rem por encima del texto: el texto arranca donde termina el fundido y sigue hasta abajo.
    assert.equal(token('--overlay-hero-text-fade'), `${fade}rem`);
    for (const [name, color] of [['text-primary', primary], ['text-secondary', secondary]] as const) {
      const ratio = worstContrast(veil, color, fade + 60, fade);
      assert.ok(ratio >= 4.5, `${name} detrás del texto: ${ratio.toFixed(2)}:1`);
    }
  });

  it('en el medio la foto se sigue viendo: las franjas terminan transparentes y el velo arranca transparente', () => {
    for (const layer of photo) assert.equal(layer.stops[layer.stops.length - 1]!.alpha, 0);
    assert.equal(text[0]!.stops[0]!.alpha, 0);
  });

  it('el velo va detrás del texto del hero de la home y de la portada, de borde a borde y hasta abajo', () => {
    const veil = block(site, '.hero--photo .hero-body::before, .article-hero-body::before');
    assert.match(veil, /background:\s*var\(--overlay-hero-text\)/);
    assert.match(veil, /top:\s*calc\(-1 \* var\(--overlay-hero-text-fade\)\)/);
    // Hasta el borde de abajo del hero, que lo recorta: sin costura con el margen inferior.
    assert.match(veil, /bottom:\s*-100vh/);
    assert.match(veil, /z-index:\s*-1/);
    assert.match(veil, /left:\s*calc\(-1 \* var\(--gutter\)\);\s*width:\s*100vw/);
    // Contexto de apilado propio: el velo queda arriba de la foto (que en la galería viene después) y abajo del texto.
    assert.match(block(site, '.hero--photo .hero-body, .article-hero-body'), /position:\s*relative;\s*z-index:\s*0/);
    assert.match(block(site, '.hero--photo, .article-hero'), /overflow:\s*hidden/);
    // En mobile el crédito y el botón van debajo del bloque: posicionados, se pintan encima del velo y no debajo.
    assert.match(block(site, '.hero-credit'), /position:\s*relative/);
    assert.match(block(site, '.hero-toggle'), /position:\s*relative/);
  });
});

/* ------------------------- Foco y subrayado en la hoja ------------------------- */

describe('foco y subrayado sobre la hoja blanca (WCAG 1.4.11, L4 P2-2)', () => {
  const paper = hex(token('--paper-bg', '.paper'));

  it('el anillo de foco y el subrayado de hover llegan a 3:1 sobre .paper', () => {
    for (const name of ['--link-accent', '--link-underline-hover']) {
      const ratio = contrast(hex(token(name, '.paper')), paper);
      assert.ok(ratio >= 3, `${name} sobre la hoja: ${ratio.toFixed(2)}:1`);
    }
  });

  it('en el tema oscuro se conservan los del sistema de diseño', () => {
    assert.equal(token('--link-accent'), '#9db2ff');
    assert.equal(token('--link-underline-hover'), '#c4d0ff');
  });

  it('los bloques de código y las tablas con scroll muestran el foco (WCAG 2.4.7, L4 P1-3)', () => {
    assert.match(block(prose, '.prose pre:focus-visible, .prose .table-wrap:focus-visible'), /outline:\s*2px solid var\(--link-accent\)/);
  });
});
