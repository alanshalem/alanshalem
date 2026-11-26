import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderMarkdown } from '@blog/markdown';
import { availableActions, editorActions, inPalette } from '../src/editor/actions.ts';
import { insertCallout, insertFigure, insertFootnote } from '../src/editor/commands.ts';
import { CALLOUT_KINDS } from '../src/editor/markdownSource.ts';
import { documentStats, outlineEntries, previewOptions, renderPreview } from '../src/editor/preview.ts';
import { applyEditToState, lineOffsets } from '../src/editor/text.ts';
import type { Command, EditorState } from '../src/editor/types.ts';

/* Markdown nuevo en el editor (S4), vista previa fiel al sitio, contador y esquema (S3). Notación: «sel», ¦ cursor. */

function parse(text: string): EditorState {
  const open = text.indexOf('«');
  if (open !== -1) {
    const close = text.indexOf('»');
    return { value: text.slice(0, open) + text.slice(open + 1, close) + text.slice(close + 1), start: open, end: close - 1 };
  }
  const cursor = text.indexOf('¦');
  return { value: text.replace('¦', ''), start: cursor, end: cursor };
}

function run(command: Command, text: string): string {
  const state = parse(text);
  const edit = command(state);
  if (!edit) return 'null';
  const { value, start, end } = applyEditToState(state, edit);
  return start === end ? `${value.slice(0, start)}¦${value.slice(start)}` : `${value.slice(0, start)}«${value.slice(start, end)}»${value.slice(end)}`;
}

describe('nota al pie: referencia en el cursor y definición al final con el próximo número libre', () => {
  it('la primera nota', () => {
    assert.equal(run(insertFootnote.es, 'Hola¦ mundo'), 'Hola[^1] mundo\n\n[^1]: «texto»');
    assert.equal(run(insertFootnote.en, '¦'), '[^1]\n\n[^1]: «text»');
  });

  it('con notas existentes: el número siguiente al mayor, y la definición junto a las otras', () => {
    assert.equal(run(insertFootnote.es, 'a[^1] b¦\n\n[^1]: uno\n'), 'a[^1] b[^2]\n\n[^1]: uno\n[^2]: «texto»');
    assert.equal(run(insertFootnote.es, 'a[^nota] b[^3]¦'), 'a[^nota] b[^3][^4]\n\n[^4]: «texto»');
  });

  it('con texto seleccionado, la referencia va después de la selección (no la borra)', () => {
    assert.equal(run(insertFootnote.es, '«hola» mundo'), 'hola[^1] mundo\n\n[^1]: «texto»');
  });

  it('el resultado se renderiza como nota al pie', () => {
    const { value } = applyEditToState(parse('Hola¦'), insertFootnote.es(parse('Hola¦'))!);
    assert.match(renderMarkdown(value).html, /class="footnote-ref"/);
  });
});

describe('cajas destacadas', () => {
  it('sin texto: la caja con el texto de relleno seleccionado', () => {
    assert.equal(run(insertCallout('note').es, '¦'), '> [!NOTE]\n> «texto»');
    assert.equal(run(insertCallout('tip').en, 'a\n\n¦'), 'a\n\n> [!TIP]\n> «text»');
  });

  it('envuelve las líneas seleccionadas (o la del cursor)', () => {
    assert.equal(run(insertCallout('tip').es, 'a\n\n«b\nc»'), 'a\n\n> [!TIP]\n> «b\n> c»');
    assert.equal(run(insertCallout('warning').es, 'uno ¦dos'), '> [!WARNING]\n> «uno dos»');
  });

  it('cada tipo es uno que el renderer reconoce (los tipos del admin no se desfasan de @blog/markdown)', () => {
    for (const kind of CALLOUT_KINDS) {
      const { value } = applyEditToState(parse('¦'), insertCallout(kind).es(parse('¦'))!);
      assert.match(renderMarkdown(value).html, new RegExp(`class="callout callout-${kind}"`), kind);
    }
  });
});

describe('figura con epígrafe', () => {
  it('como bloque propio, con la url seleccionada para pegarla', () => {
    assert.equal(run(insertFigure.es, '¦'), '![descripción](«url» "epígrafe")');
    assert.equal(run(insertFigure.en, 'a¦'), 'a\n\n![description](«url» "caption")');
  });

  it('con figuras activadas sale como <figure> + <figcaption>', () => {
    const html = renderPreview('![Un gato](/media/gato.webp "Foto: Ana")', 'es').html;
    assert.match(html, /<figure>[\s\S]*<figcaption>Foto: Ana<\/figcaption>/);
  });
});

describe('registro: las acciones nuevas llegan a la barra y a la paleta', () => {
  const actions = editorActions('es');
  const ids = (list: readonly { id: string }[]) => list.map((action) => action.id);

  it('nota al pie, caja, figura en la barra; los tres tipos de caja en la paleta', () => {
    const toolbar = ids(actions.filter((action) => action.toolbar));
    for (const id of ['footnote', 'callout.note', 'figure', 'compare']) assert.ok(toolbar.includes(id), id);
    const palette = ids(actions.filter(inPalette));
    for (const id of ['footnote', 'callout.note', 'callout.tip', 'callout.warning', 'figure']) assert.ok(palette.includes(id), id);
  });

  it('availableActions: sin subida no hay imagen; sin otra versión no hay "ver original"', () => {
    assert.ok(!ids(availableActions(actions, { canUpload: false, canCompare: false })).some((id) => id === 'image' || id === 'compare'));
    const all = ids(availableActions(actions, { canUpload: true, canCompare: true }));
    assert.ok(all.includes('image') && all.includes('compare'));
    assert.equal(availableActions(actions, { canUpload: true, canCompare: true }).length, actions.length);
  });
});

describe('vista previa con las mismas opciones que el sitio', () => {
  it('idioma del post, tipografía inteligente, figuras y títulos estándar (L5)', () => {
    assert.deepEqual(previewOptions('en'), { minHeadingLevel: 2, lang: 'en', smartTypography: true, figures: true });
    const html = renderPreview('# Hola\n\n## Sección\n\n### Sub\n\n"citas" -- y...\n\n> [!NOTE]\n> x', 'en').html;
    // ## = h2, ### = h3 (lo que dicen los botones H2/H3) y un # del cuerpo también es sección: el h1 es el título.
    assert.match(html, /<h2 id="hola">Hola<\/h2>/);
    assert.match(html, /<h2 id="seccion">Sección<\/h2>/);
    assert.match(html, /<h3 id="sub">Sub<\/h3>/);
    assert.match(html, /“citas”/);
    assert.match(html, /Note/); // título de la caja en el idioma del post
  });
});

/*
 * Un solo render por actualización (perfil-skills-produccion L8, P3-14): el contador y el esquema leen el resultado de
 * la vista previa (`text`, `blockStarts`) en vez de volver a parsear el Markdown.
 */
describe('contador', () => {
  const stats = (markdown: string, lang: 'es' | 'en' = 'es') => documentStats(renderPreview(markdown, lang).text);

  it('palabras, caracteres del texto que se lee y minutos con la fórmula del sitio', () => {
    assert.deepEqual(stats('# Título\n\nUna **frase** [con](https://x.com) link.'), { words: 5, characters: 26, readingMinutes: 1 });
    assert.deepEqual(stats(''), { words: 0, characters: 0, readingMinutes: 1 });
    assert.equal(stats(Array(401).fill('palabra').join(' ')).readingMinutes, 3);
  });

  it('cuenta el texto plano que recibe, sin volver a parsear Markdown', () => {
    assert.deepEqual(documentStats('**no** se parsea'), { words: 3, characters: 16, readingMinutes: 1 });
  });

  it('cuenta lo que muestra la vista previa: tipografía del sitio y títulos de cajas en el idioma del post', () => {
    assert.equal(stats('a... b').characters, 4); // "a… b"
    assert.deepEqual(stats('> [!NOTE]\n> hola', 'en'), { words: 2, characters: 9, readingMinutes: 1 }); // "Note hola"
  });
});

describe('esquema de títulos', () => {
  it('cada título con su línea del editor; los del código y los de dentro de una cita (sin ancla) no cuentan', () => {
    const markdown = '# Uno\n\ntexto\n\n```\n# no\n```\n\n## Dos\n> ### Cita\n\n### Tres';
    assert.deepEqual(outlineEntries(markdown, renderPreview(markdown, 'es')), [
      { id: 'uno', text: 'Uno', level: 2, line: 0 },
      { id: 'dos', text: 'Dos', level: 2, line: 8 },
      { id: 'tres', text: 'Tres', level: 3, line: 11 },
    ]);
  });

  it('si las cuentas no coinciden, sin línea (el esquema solo mueve la vista previa)', () => {
    const headings = [{ id: 'x', text: 'x', level: 2 }, { id: 'y', text: 'y', level: 2 }];
    const entries = outlineEntries('    # sangrado', { headings, blockStarts: [0] });
    assert.deepEqual(entries.map((entry) => entry.line), [null, null]);
  });

  it('lineOffsets: dónde empieza cada línea pedida', () => {
    assert.deepEqual(lineOffsets('ab\ncd\n\nef', [0, 1, 3, 9]), [0, 3, 7, 9]);
  });
});
