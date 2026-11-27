import { closesFence, FENCE_OPEN } from './blocks.ts';
import { escapeHtml } from './escape.ts';
import { renderInline, type InlineContext } from './inline.ts';
import type { Labels } from './labels.ts';
import { createSlugger } from './slug.ts';

/**
 * Footnotes: `Text[^id]` + `[^id]: note` (the definition may continue on indented lines).
 *
 * Definitions may come after their first reference, so they are taken out in a previous pass; numbering follows the
 * order of first references and the section goes at the end.
 * Without a definition, `[^id]` stays literal; a definition without references is not shown.
 */

const DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const CONTINUATION = /^[ \t]+\S/;
// U+FE0E asks for the text presentation: without it, iOS shows ↩ as an emoji.
const BACK_ARROW = '↩\uFE0E';

/**
 * Takes out the top-level definitions (outside code blocks). Each removed line is left blank so the surrounding
 * paragraphs do not merge. With a repeated id the first one wins.
 */
export function extractFootnoteDefinitions(lines: string[]): { lines: string[]; definitions: Map<string, string> } {
  const out: string[] = [];
  const definitions = new Map<string, string>();
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      out.push(line);
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    const definition = open ? null : DEFINITION.exec(line);
    if (!definition) {
      if (open) fence = open[1] ?? '```';
      out.push(line);
      continue;
    }

    const text = [definition[2] ?? ''];
    while (CONTINUATION.test(lines[i + 1] ?? '')) {
      i += 1;
      text.push((lines[i] ?? '').trim());
      out.push('');
    }
    out.push('');
    const id = definition[1] ?? '';
    if (!definitions.has(id)) definitions.set(id, text.join('\n').trim());
  }

  return { lines: out, definitions };
}

interface Note {
  slug: string;
  number: number;
  references: number;
}

export interface Footnotes {
  /** For InlineContext.footnoteRef: records the reference and returns its HTML. */
  reference: (id: string) => string | null;
  /** The closing section (empty when there were no references). Called after rendering the body. */
  renderSection: (inline: InlineContext) => string;
}

// The first reference is "fnref-<slug>"; later ones get "_n" (slugify never outputs '_').
const referenceId = (slug: string, n: number): string => (n === 1 ? `fnref-${slug}` : `fnref-${slug}_${n}`);

export function createFootnotes(definitions: Map<string, string>, labels: Labels): Footnotes {
  const slugger = createSlugger();
  const notes = new Map<string, Note>(); // in order of first reference = numbering

  function reference(id: string): string | null {
    if (!definitions.has(id)) return null;
    let note = notes.get(id);
    if (!note) {
      note = { slug: slugger(id), number: notes.size + 1, references: 0 };
      notes.set(id, note);
    }
    note.references += 1;
    const link = `<a href="#fn-${note.slug}" id="${referenceId(note.slug, note.references)}">${note.number}</a>`;
    return `<sup class="footnote-ref">${link}</sup>`;
  }

  function renderSection(inline: InlineContext): string {
    if (notes.size === 0) return '';
    const items: string[] = [];
    // A note may cite one not referenced yet: iterating the Map also visits the entries added meanwhile.
    for (const [id, note] of notes) {
      const text = renderInline(definitions.get(id) ?? '', inline);
      items.push(`<li id="fn-${note.slug}"><p>${text} ${backReferences(note, labels)}</p></li>`);
    }
    return `<section class="footnotes" aria-label="${escapeHtml(labels.footnotes)}">\n<ol>\n${items.join('\n')}\n</ol>\n</section>`;
  }

  return { reference, renderSection };
}

/** One back link (↩) per reference of the note, to return to the exact place in the text. */
function backReferences(note: Note, labels: Labels): string {
  const label = escapeHtml(labels.backToText);
  return Array.from({ length: note.references }, (_, index) => {
    const href = referenceId(note.slug, index + 1);
    return `<a href="#${href}" class="footnote-backref" aria-label="${label}">${BACK_ARROW}</a>`;
  }).join(' ');
}
