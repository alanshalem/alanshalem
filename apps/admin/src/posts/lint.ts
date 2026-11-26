import { sanitizeUrl } from '@blog/markdown';
import { URL_PLACEHOLDER } from '../editor/commands.ts';
import {
  CALLOUT_KINDS,
  calloutMarker,
  FOOTNOTE_DEFINITION,
  FOOTNOTE_REFERENCE,
  headingLevel,
  proseLines,
  type ProseLine,
} from '../editor/markdownSource.ts';
import type { I18n, Params } from '../i18n/i18n.ts';
import { META_DESCRIPTION_MAX, SEO_TITLE_MAX } from './seo.ts';

/*
 * Revisor del post (S3): reglas puras sobre el título, el resumen y el Markdown. Cada aviso dice dónde está (una
 * línea del cuerpo o un campo) para poder ir ahí; el texto sale del diccionario (`lint.<regla>`).
 */

export type LintRule =
  | 'titleTooLong'
  | 'summaryEmpty'
  | 'summaryTooLong'
  | 'headingSpace'
  | 'headingSkip'
  | 'imageAlt'
  | 'linkEmpty'
  | 'linkUnsafe'
  | 'footnoteMissing'
  | 'footnoteUnused'
  | 'calloutUnknown';

export type LintField = 'title' | 'summary';
/** `line` empieza en 0 (la del textarea); en pantalla se muestra desde 1. */
export type LintTarget = { readonly line: number } | { readonly field: LintField };

export interface LintIssue {
  readonly rule: LintRule;
  readonly target: LintTarget;
  readonly params: Params;
}

// "#II." o "##Otra": almohadillas pegadas a texto al principio de la línea (también dentro de una cita).
const HEADING_WITHOUT_SPACE = /^[ \t]*(?:>[ \t]?)*[ \t]*(#{1,6}[^#\s]\S*)/;
const LINK_OR_IMAGE = /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g;
// Solo el marcador de la primera línea de una cita convierte la cita en caja.
const CALLOUT_LINE = /^ {0,3}>[ \t]?(\[![^\]\s]*\])[ \t]*$/;
const KNOWN_CALLOUTS = new Set(CALLOUT_KINDS.map(calloutMarker));

/** El destino de un link: `<con espacios>` o hasta el primer espacio (lo que sigue es el título). */
const destination = (raw: string): string => {
  const text = raw.trim();
  return text.startsWith('<') ? text.slice(1, text.indexOf('>') === -1 ? undefined : text.indexOf('>')) : (text.split(/\s/)[0] ?? '');
};

function fieldIssues(title: string, summary: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const titleLength = title.trim().length;
  if (titleLength > SEO_TITLE_MAX) {
    issues.push({ rule: 'titleTooLong', target: { field: 'title' }, params: { length: titleLength, max: SEO_TITLE_MAX } });
  }
  const summaryLength = summary.trim().length;
  if (summaryLength === 0) issues.push({ rule: 'summaryEmpty', target: { field: 'summary' }, params: {} });
  else if (summaryLength > META_DESCRIPTION_MAX) {
    issues.push({ rule: 'summaryTooLong', target: { field: 'summary' }, params: { length: summaryLength, max: META_DESCRIPTION_MAX } });
  }
  return issues;
}

function lineIssues({ index, text }: ProseLine): LintIssue[] {
  const at = { line: index };
  const issues: LintIssue[] = [];
  const glued = HEADING_WITHOUT_SPACE.exec(text)?.[1];
  if (glued) issues.push({ rule: 'headingSpace', target: at, params: { text: glued } });

  const callout = CALLOUT_LINE.exec(text)?.[1];
  if (callout && !KNOWN_CALLOUTS.has(callout.toUpperCase())) {
    issues.push({ rule: 'calloutUnknown', target: at, params: { marker: callout, kinds: [...KNOWN_CALLOUTS].join(', ') } });
  }

  for (const [, bang, label = '', rawUrl = ''] of text.matchAll(LINK_OR_IMAGE)) {
    const url = destination(rawUrl);
    if (bang) {
      if (label.trim() === '') issues.push({ rule: 'imageAlt', target: at, params: {} });
    } else if (url === '' || url === URL_PLACEHOLDER) {
      issues.push({ rule: 'linkEmpty', target: at, params: { text: label } });
    } else if (sanitizeUrl(url) === null) {
      issues.push({ rule: 'linkUnsafe', target: at, params: { url } });
    }
  }
  return issues;
}

/** Títulos que saltan niveles respecto del anterior (`##` → `####`). El primero puede ser cualquiera. */
function headingSkips(lines: readonly ProseLine[]): LintIssue[] {
  const issues: LintIssue[] = [];
  let previous: number | null = null;
  for (const { index, text } of lines) {
    const level = headingLevel(text);
    if (level === null) continue;
    if (previous !== null && level > previous + 1) {
      issues.push({ rule: 'headingSkip', target: { line: index }, params: { from: previous, to: level } });
    }
    previous = level;
  }
  return issues;
}

/** Referencias sin definición (en su primera aparición) y definiciones que nadie cita. */
function footnoteIssues(lines: readonly ProseLine[]): LintIssue[] {
  const definitions = new Map<string, number>();
  const references = new Map<string, number>();
  for (const { index, text } of lines) {
    const definition = FOOTNOTE_DEFINITION.exec(text);
    if (definition?.[1] && !definitions.has(definition[1])) definitions.set(definition[1], index);
    // Una nota puede citar a otra: lo que sigue al marcador también cuenta como texto.
    for (const [, id = ''] of text.slice(definition?.[0].length ?? 0).matchAll(FOOTNOTE_REFERENCE)) {
      if (!references.has(id)) references.set(id, index);
    }
  }
  const missing = [...references].filter(([id]) => !definitions.has(id));
  const unused = [...definitions].filter(([id]) => !references.has(id));
  return [
    ...missing.map(([id, line]): LintIssue => ({ rule: 'footnoteMissing', target: { line }, params: { id } })),
    ...unused.map(([id, line]): LintIssue => ({ rule: 'footnoteUnused', target: { line }, params: { id } })),
  ];
}

const lineOf = (issue: LintIssue): number => ('line' in issue.target ? issue.target.line : -1);

/** Todos los avisos: primero los de los campos, después los del cuerpo en orden de línea. */
export function lintPost({ title, summary, body }: { title: string; summary: string; body: string }): LintIssue[] {
  const lines = proseLines(body);
  const bodyIssues = [...lines.flatMap(lineIssues), ...headingSkips(lines), ...footnoteIssues(lines)];
  // sort es estable: en una misma línea queda el orden de las reglas.
  return [...fieldIssues(title, summary), ...bodyIssues.sort((a, b) => lineOf(a) - lineOf(b))];
}

/** "Línea 3" o el nombre del campo, y el mensaje, en el idioma de la interfaz. */
export function describeIssue(issue: LintIssue, { t }: I18n): { where: string; message: string } {
  const { target } = issue;
  return {
    where: 'line' in target ? t('lint.line', { line: target.line + 1 }) : t(`lint.field.${target.field}`),
    message: t(`lint.${issue.rule}`, issue.params),
  };
}
