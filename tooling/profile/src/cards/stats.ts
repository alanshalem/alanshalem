import { count } from '../format.ts';
import type { ProfileData } from '../model.ts';
import { hline, svgDocument } from '../svg.ts';
import { color, layout, text } from '../theme.ts';
import { createTypesetter } from '../type.ts';
import { frame, HALF_HEIGHT, HEADER_BASELINE, sectionHeader } from './frame.ts';

const ROW = 24;

export function renderStats(data: ProfileData): string {
  const t = createTypesetter();
  const { half: width, pad } = layout;
  const rows: Array<[string, number]> = [
    ['Stars earned', data.stars],
    ['Forks', data.forks],
    ['Commits in the last year', data.commitsLastYear],
    ['Pull requests', data.pullRequests],
    ['Issues', data.issues],
    ['Public repositories', data.repos],
    ['Followers', data.followers],
  ];

  const top = HEADER_BASELINE + 12;
  const body = rows
    .map(([label, value], i) => {
      const baseline = top + ROW * (i + 1) - 7;
      const rule = i < rows.length - 1 ? hline(pad, width - pad, top + ROW * (i + 1), color.border) : '';
      return t.text(label, pad, baseline, text.aside) + t.text(count(value), width - pad, baseline, text.strong, 'end') + rule;
    })
    .join('');

  return svgDocument({
    width,
    height: HALF_HEIGHT,
    title: 'GitHub stats',
    desc: `${rows.map(([label, value]) => `${label}: ${count(value)}`).join('. ')}.`,
    glyphs: t,
    body: frame(width, HALF_HEIGHT) + sectionHeader(t, width, 'GitHub stats', `@${data.login}`) + body,
  });
}
