import { count, dayRange, month, monthYear, plural } from '../format.ts';
import { DAY, streaks, type Run } from '../metrics.ts';
import type { ProfileData } from '../model.ts';
import { num, svgDocument } from '../svg.ts';
import { color, layout, text } from '../theme.ts';
import { createTypesetter, type Typesetter } from '../type.ts';
import { frame, sectionHeader } from './frame.ts';

const WEEKS = 53;
const CELL = 11;
const STEP = 14;
const GRID_TOP = 196;
const FIGURES = { figure: 108, label: 130, meta: 150 } as const;
// Accent intensity levels, like GitHub's calendar but in the site's palette.
const LEVEL_OPACITY = [0, 0.32, 0.52, 0.76, 1] as const;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const runRange = (run: Run): string => (run.start && run.end ? dayRange(run.start, run.end) : 'No streak right now');

/** Calendar of the last 53 weeks (Sunday-to-Saturday columns), one path per level to keep it light. */
function heatmap(t: Typesetter, contributions: Record<string, number>, today: string, left: number): string {
  const end = Date.parse(`${today}T00:00:00Z`);
  const start = end - (new Date(end).getUTCDay() + (WEEKS - 1) * 7) * DAY;
  const cells: Array<{ x: number; y: number; value: number }> = [];
  let months = '';
  for (let week = 0; week < WEEKS; week++) {
    const x = left + week * STEP;
    const weekStart = start + week * 7 * DAY;
    // Each month is labeled over its first full week, when there is room before the edge.
    const first = isoDay(weekStart);
    if (first.slice(8) <= '07' && week < WEEKS - 2) months += t.text(month(first), x, GRID_TOP - 9, text.meta);
    for (let day = 0; day < 7 && weekStart + day * DAY <= end; day++) {
      cells.push({ x, y: GRID_TOP + day * STEP, value: contributions[isoDay(weekStart + day * DAY)] ?? 0 });
    }
  }
  // Intensity is relative to the busiest day of the visible period, not of the whole history.
  const max = Math.max(1, ...cells.map((cell) => cell.value));
  const levels = LEVEL_OPACITY.map(() => '');
  for (const { x, y, value } of cells) {
    levels[value === 0 ? 0 : Math.min(4, Math.ceil((4 * value) / max))] += `M${x} ${y}h${CELL}v${CELL}h-${CELL}z`;
  }
  const paths = levels
    .map((d, level) =>
      d ? `<path d="${d}" fill="${level === 0 ? color.surfaceAlt : color.accent}"${level ? ` fill-opacity="${num(LEVEL_OPACITY[level]!)}"` : ''}/>` : '',
    )
    .join('');
  return months + paths;
}

export function renderStreak(data: ProfileData): string {
  const t = createTypesetter();
  const { width, pad } = layout;
  const today = data.fetchedAt.slice(0, 10);
  const { total, current, longest } = streaks(data.contributions, today);
  const since = monthYear(data.createdAt);
  const columns: Array<[string, string, string]> = [
    [count(total), 'Total contributions', `Since ${since}`],
    [plural(current.days, 'day'), 'Current streak', runRange(current)],
    [plural(longest.days, 'day'), 'Longest streak', runRange(longest)],
  ];

  const third = (width - 2 * pad) / 3;
  let body = '';
  columns.forEach(([figure, label, meta], i) => {
    const center = pad + third * (i + 0.5);
    body +=
      t.text(figure, center, FIGURES.figure, text.figure, 'middle') +
      t.text(label, center, FIGURES.label, text.label, 'middle') +
      t.text(meta, center, FIGURES.meta, text.meta, 'middle');
    if (i > 0) body += `<path d="M${num(Math.round(pad + third * i) + 0.5)} 76V156" stroke="${color.border}"/>`;
  });
  const gridWidth = WEEKS * STEP - (STEP - CELL);
  body += heatmap(t, data.contributions, today, Math.round((width - gridWidth) / 2));
  const height = GRID_TOP + 7 * STEP - (STEP - CELL) + pad;

  return svgDocument({
    width,
    height,
    title: 'Contribution streak',
    desc:
      `Total contributions: ${count(total)} since ${since}. ` +
      `Current streak: ${plural(current.days, 'day')} (${runRange(current)}). ` +
      `Longest streak: ${plural(longest.days, 'day')} (${runRange(longest)}). ` +
      'Includes a calendar of the last 12 months.',
    glyphs: t,
    body: frame(width, height) + sectionHeader(t, width, 'Contributions') + body,
  });
}
