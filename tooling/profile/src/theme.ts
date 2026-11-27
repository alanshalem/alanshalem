import { readFileSync } from 'node:fs';
import { cssColors } from './tokens.ts';
import type { TextStyle } from './type.ts';

/**
 * Theme of the profile images. The colors come from packages/tokens/src/tokens.css (the same source as the site), so a
 * palette change reaches the README without copying values; this file only decides which role each one plays on a
 * card.
 */

const css = cssColors(readFileSync(new URL('../../../packages/tokens/src/tokens.css', import.meta.url), 'utf8'));

export const color = {
  page: css('bg-page'),
  surface: css('bg-surface'),
  surfaceAlt: css('bg-surface-alt'),
  border: css('border-subtle'),
  text: css('text-primary'),
  textSecondary: css('text-secondary'),
  textTertiary: css('text-tertiary'),
  accent: css('link-accent'),
  dataviz: ['green', 'blue', 'orange'].map((name) => css(`dataviz-${name}`)),
} as const;

/** The only text colors: test/theme.test.ts measures their contrast on the surfaces. */
export const TEXT_COLORS: readonly string[] = [color.text, color.textSecondary, color.textTertiary];

/** Chart series (languages, trophies): the site's accent + dataviz, then the text grays. */
export const SERIES = [color.accent, ...color.dataviz, color.textSecondary, color.textTertiary] as const;

/** Type roles of the design system (DESIGN-SYSTEM.md §3) at card scale (px at 1x). */
export const text = {
  /** Eyebrow / section h2: Hanken 600, uppercase, tracking .12em. */
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

/** Measures shared by every card. */
export const layout = {
  width: 840,
  /** Half a README row (two cards side by side with a gap in between). */
  half: 414,
  pad: 24,
} as const;
