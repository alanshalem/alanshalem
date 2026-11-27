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
 * The post reviewer: pure rules over the title, the summary and the Markdown. Each warning says where it is (a body
 * line or a field) so one can go there; the text comes from the dictionary (`lint.<rule>`).
 */

export type LintRule =
  | 'titleTooLong'
  | 'summaryEmpty'
  | 'summaryTooLong'
  | 'headingSpace'
  | 'headingOne'
  | 'headingSkip'
  | 'imageAlt'
  | 'linkEmpty'
  | 'linkUnsafe'
  | 'footnoteMissing'
  | 'footnoteUnused'
  | 'calloutUnknown';

export type LintField = 'title' | 'summary';
/** `line` starts at 0 (the textarea's); on screen it shows from 1. */
export type LintTarget = { readonly line: number } | { readonly field: LintField };

export interface LintIssue {
  readonly rule: LintRule;
  readonly target: LintTarget;
  readonly params: Params;
}

// "#II." or "##Otra": hashes glued to text at the start of the line (also inside a quote).
const HEADING_WITHOUT_SPACE = /^[ \t]*(?:>[ \t]?)*[ \t]*(#{1,6}[^#\s]\S*)/;
const LINK_OR_IMAGE = /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g;
// Only the marker on the first line of a quote turns the quote into a callout.
const CALLOUT_LINE = /^ {0,3}>[ \t]?(\[![^\]\s]*\])[ \t]*$/;
const KNOWN_CALLOUTS = new Set(CALLOUT_KINDS.map(calloutMarker));

/** A link's destination: `<with spaces>` or up to the first space (what follows is the title). */
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
  // `#` is the post title (h1); in the body it is published as `##`, but it is better to write it that way.
  if (headingLevel(text) === 1) issues.push({ rule: 'headingOne', target: at, params: {} });

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

/**
 * Headings that skip levels from the previous one (`##` → `####`). It starts from the post title (level 1): sections
 * start at `##`, so a first `###` skips too. A `#` counts as `##` (that is how it is published).
 */
function headingSkips(lines: readonly ProseLine[]): LintIssue[] {
  const issues: LintIssue[] = [];
  let previous = 1;
  for (const { index, text } of lines) {
    const source = headingLevel(text);
    if (source === null) continue;
    const level = Math.max(2, source);
    if (level > previous + 1) {
      issues.push({ rule: 'headingSkip', target: { line: index }, params: { from: previous, to: level } });
    }
    previous = level;
  }
  return issues;
}

/** References without a definition (at their first occurrence) and definitions nobody cites. */
function footnoteIssues(lines: readonly ProseLine[]): LintIssue[] {
  const definitions = new Map<string, number>();
  const references = new Map<string, number>();
  for (const { index, text } of lines) {
    const definition = FOOTNOTE_DEFINITION.exec(text);
    if (definition?.[1] && !definitions.has(definition[1])) definitions.set(definition[1], index);
    // A footnote may cite another: what follows the marker also counts as text.
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

/** All warnings: first the fields', then the body's in line order. */
export function lintPost({ title, summary, body }: { title: string; summary: string; body: string }): LintIssue[] {
  const lines = proseLines(body);
  const bodyIssues = [...lines.flatMap(lineIssues), ...headingSkips(lines), ...footnoteIssues(lines)];
  // sort is stable: on the same line the rule order stays.
  return [...fieldIssues(title, summary), ...bodyIssues.sort((a, b) => lineOf(a) - lineOf(b))];
}

/** "Línea 3" or the field name, and the message, in the UI language. */
export function describeIssue(issue: LintIssue, { t }: I18n): { where: string; message: string } {
  const { target } = issue;
  return {
    where: 'line' in target ? t('lint.line', { line: target.line + 1 }) : t(`lint.field.${target.field}`),
    message: t(`lint.${issue.rule}`, issue.params),
  };
}
