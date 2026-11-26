import tokens from '../../../packages/tokens/src/tokens.json' with { type: 'json' };
import type { TextStyle } from './type.ts';

/**
 * Tema de las imágenes del perfil. Los colores salen de packages/tokens (la misma fuente que el sitio), así un
 * cambio de paleta llega al README sin copiar valores; acá solo se decide qué rol cumple cada uno en una tarjeta.
 */

type Token = { $value: string };

/** Sigue las referencias DTCG ("{color.primitive.ink-950}") hasta el valor final. */
function resolve(value: string): string {
  if (!value.startsWith('{')) return value;
  const node = value
    .slice(1, -1)
    .split('.')
    .reduce<unknown>((at, key) => (at as Record<string, unknown>)[key], tokens) as Token;
  return resolve(node.$value);
}

// Los nombres semánticos llevan puntos ("bg.page"), así que se indexan directo y no como ruta.
const semantic = (name: string): string => resolve((tokens.color.semantic as Record<string, Token>)[name]!.$value);

export const color = {
  page: semantic('bg.page'),
  surface: semantic('bg.surface'),
  surfaceAlt: semantic('bg.surface-alt'),
  border: semantic('border.subtle'),
  text: semantic('text.primary'),
  textSecondary: semantic('text.secondary'),
  textTertiary: semantic('text.tertiary'),
  accent: semantic('link.accent'),
  dataviz: Object.values(tokens.color.dataviz).map((t) => t.$value),
} as const;

/** Los únicos colores de texto: su contraste sobre las superficies lo mide test/theme.test.ts. */
export const TEXT_COLORS: readonly string[] = [color.text, color.textSecondary, color.textTertiary];

/** Series de los gráficos (lenguajes, trofeos): acento + dataviz del sitio, luego grises de texto. */
export const SERIES = [color.accent, ...color.dataviz, color.textSecondary, color.textTertiary] as const;

/** Roles tipográficos del sistema de diseño (DESIGN-SYSTEM.md §3) a escala de tarjeta (px a 1x). */
export const text = {
  /** Eyebrow / h2 de sección: Hanken 600, mayúsculas, tracking .12em. */
  label: { face: 'uiStrong', size: 11, fill: color.textTertiary, tracking: 0.12, uppercase: true },
  aside: { face: 'ui', size: 13, fill: color.textSecondary },
  name: { face: 'display', size: 60, fill: color.text },
  title: { face: 'display', size: 28, fill: color.text },
  figure: { face: 'display', size: 34, fill: color.text },
  lead: { face: 'reading', size: 21, fill: color.textSecondary },
  dek: { face: 'reading', size: 15.5, fill: color.textSecondary },
  body: { face: 'ui', size: 13, fill: color.text },
  strong: { face: 'uiStrong', size: 13, fill: color.text },
  meta: { face: 'ui', size: 12, fill: color.textTertiary },
} satisfies Record<string, TextStyle>;

/** Medidas compartidas por todas las tarjetas. */
export const layout = {
  width: 840,
  /** Media fila del README (dos tarjetas lado a lado con un espacio entre medio). */
  half: 414,
  pad: 24,
} as const;
