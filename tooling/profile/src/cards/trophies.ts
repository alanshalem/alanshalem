import { count } from '../format.ts';
import { rank, TROPHIES } from '../metrics.ts';
import type { ProfileData } from '../model.ts';
import { rect, svgDocument } from '../svg.ts';
import { color, layout, text } from '../theme.ts';
import { createTypesetter } from '../type.ts';
import { box, CONTENT_TOP, frame, sectionHeader } from './frame.ts';

const GAP = 8;
const TILE = { height: 122, padX: 12, label: 28, tier: 70, meta: 92, bar: 106 } as const;

export function renderTrophies(data: ProfileData): string {
  const t = createTypesetter();
  const { width, pad } = layout;
  const tileWidth = (width - 2 * pad - GAP * (TROPHIES.length - 1)) / TROPHIES.length;
  const trophies = TROPHIES.map((trophy) => ({ ...trophy, value: trophy.value(data) }))
    .map((trophy) => ({ ...trophy, ...rank(trophy.value, trophy.thresholds) }));

  const body = trophies
    .map(({ label, value, tier, next, progress }, i) => {
      const x = pad + i * (tileWidth + GAP);
      const y = CONTENT_TOP;
      const inner = tileWidth - 2 * TILE.padX;
      return [
        box(x, y, tileWidth, TILE.height),
        t.text(label, x + TILE.padX, y + TILE.label, text.label),
        t.text(tier ?? '–', x + TILE.padX, y + TILE.tier, text.figure),
        t.text(next === null ? count(value) : `${count(value)} / ${count(next)}`, x + TILE.padX, y + TILE.meta, text.meta),
        // Progress to the next rank: the track in the rule color, the covered part in the accent.
        rect(x + TILE.padX, y + TILE.bar, inner, 2, `fill="${color.border}"`),
        progress > 0 ? rect(x + TILE.padX, y + TILE.bar, inner * progress, 2, `fill="${color.accent}"`) : '',
      ].join('');
    })
    .join('');
  const height = CONTENT_TOP + TILE.height + pad;

  return svgDocument({
    width,
    height,
    title: 'GitHub trophies',
    desc: trophies
      .map(({ label, value, tier, next }) =>
        `${label}: ${tier ? `rank ${tier}` : 'unranked'} (${count(value)}${next === null ? ', top rank' : `; next rank at ${count(next)}`}).`,
      )
      .join(' '),
    glyphs: t,
    body: frame(width, height) + sectionHeader(t, width, 'Trophies', `ranks C to S, computed from public data`) + body,
  });
}
