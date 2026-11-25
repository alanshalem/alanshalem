import { closesFence, FENCE_OPEN } from './blocks.ts';
import { escapeHtml } from './escape.ts';
import { renderInline, type InlineContext } from './inline.ts';
import type { Labels } from './labels.ts';
import { createSlugger } from './slug.ts';

/**
 * Notas al pie: `Texto[^id]` + `[^id]: nota` (la definición puede seguir en líneas indentadas).
 *
 * Las definiciones pueden estar después de su primera referencia, así que se sacan en una pasada
 * previa; la numeración sale del orden de la primera referencia y la sección va al final.
 * Sin definición, `[^id]` queda literal; una definición sin referencias no se muestra.
 */

const DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const CONTINUATION = /^[ \t]+\S/;
// U+FE0E pide la versión de texto: sin él, iOS muestra ↩ como emoji.
const BACK_ARROW = '↩\uFE0E';

/**
 * Saca las definiciones del nivel superior (fuera de bloques de código). Cada línea sacada queda
 * en blanco para que los párrafos de alrededor no se unan. Con un id repetido gana la primera.
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
  /** Para InlineContext.footnoteRef: registra la referencia y devuelve su HTML. */
  reference: (id: string) => string | null;
  /** La sección final (vacía si no hubo referencias). Se llama después de renderizar el cuerpo. */
  renderSection: (inline: InlineContext) => string;
}

// La primera referencia es "fnref-<slug>"; las siguientes llevan "_n" ('_' nunca sale de slugify).
const referenceId = (slug: string, n: number): string => (n === 1 ? `fnref-${slug}` : `fnref-${slug}_${n}`);

export function createFootnotes(definitions: Map<string, string>, labels: Labels): Footnotes {
  const slugger = createSlugger();
  const notes = new Map<string, Note>(); // en orden de primera referencia = numeración

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
    // Una nota puede citar a otra todavía no referenciada: el Map también recorre las que se agregan.
    for (const [id, note] of notes) {
      const text = renderInline(definitions.get(id) ?? '', inline);
      items.push(`<li id="fn-${note.slug}"><p>${text} ${backReferences(note, labels)}</p></li>`);
    }
    return `<section class="footnotes" aria-label="${escapeHtml(labels.footnotes)}">\n<ol>\n${items.join('\n')}\n</ol>\n</section>`;
  }

  return { reference, renderSection };
}

/** Una vuelta (↩) por cada referencia de la nota, para volver al lugar exacto del texto. */
function backReferences(note: Note, labels: Labels): string {
  const label = escapeHtml(labels.backToText);
  return Array.from({ length: note.references }, (_, index) => {
    const href = referenceId(note.slug, index + 1);
    return `<a href="#${href}" class="footnote-backref" aria-label="${label}">${BACK_ARROW}</a>`;
  }).join(' ');
}
