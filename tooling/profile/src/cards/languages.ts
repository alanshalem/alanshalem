import { percent } from '../format.ts';
import { topLanguages } from '../metrics.ts';
import type { ProfileData } from '../model.ts';
import { rect, svgDocument } from '../svg.ts';
import { layout, SERIES, text } from '../theme.ts';
import { createTypesetter } from '../type.ts';
import { frame, HALF_HEIGHT, sectionHeader } from './frame.ts';

/** Cinco con nombre y "Other": seis tonos de la paleta, y la leyenda entra en 3 filas de 2. */
const NAMED = 5;
const BAR = { top: 78, height: 8, gap: 2 } as const;
const LEGEND = { top: 124, row: 34, swatch: 8 } as const;

export function renderLanguages(data: ProfileData): string {
  const t = createTypesetter();
  const { half: width, pad } = layout;
  const languages = topLanguages(data.languages, NAMED);
  // "Other" va siempre en el último tono (gris): no compite con los lenguajes con nombre.
  const tone = (name: string, i: number): string => (name === 'Other' ? SERIES[SERIES.length - 1] : SERIES[i])!;

  let body = '';
  if (languages.length === 0) {
    body = t.text('No public code yet.', pad, BAR.top + BAR.height, text.aside);
  } else {
    const inner = width - 2 * pad - BAR.gap * (languages.length - 1);
    let x = pad;
    languages.forEach(({ name, share }, i) => {
      body += rect(x, BAR.top, inner * share, BAR.height, `fill="${tone(name, i)}"`);
      x += inner * share + BAR.gap;
    });
    const column = (width - 2 * pad) / 2;
    languages.forEach(({ name, share }, i) => {
      const left = pad + (i % 2) * (column + 12);
      const baseline = LEGEND.top + Math.floor(i / 2) * LEGEND.row;
      body +=
        rect(left, baseline - LEGEND.swatch, LEGEND.swatch, LEGEND.swatch, `fill="${tone(name, i)}"`) +
        t.text(name, left + 16, baseline, text.body) +
        t.text(percent(share), left + column - 12, baseline, text.meta, 'end');
    });
  }

  return svgDocument({
    width,
    height: HALF_HEIGHT,
    title: 'Top languages',
    desc: languages.length
      ? `Top languages by code size: ${languages.map(({ name, share }) => `${name} ${percent(share)}`).join(', ')}.`
      : 'Top languages by code size: no public code yet.',
    glyphs: t,
    body: frame(width, HALF_HEIGHT) + sectionHeader(t, width, 'Top languages', 'by code size') + body,
  });
}
