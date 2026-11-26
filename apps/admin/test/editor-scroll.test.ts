import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blockStartLines } from '@blog/markdown';
import { pairAnchors, syncedScrollTop } from '../src/editor/scrollSync.ts';
import { renderPreview } from '../src/editor/preview.ts';

/** Cuántos elementos hay en el primer nivel del HTML (los hijos de .prose), sin la sección de notas al pie. */
function topLevelElements(html: string): number {
  const VOID = new Set(['hr', 'br', 'img', 'input', 'source']);
  let depth = 0;
  let count = 0;
  for (const [, closing, tag = ''] of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/g)) {
    if (closing) depth -= 1;
    else {
      if (depth === 0) count += 1;
      if (!VOID.has(tag)) depth += 1;
    }
  }
  return count;
}

/*
 * Scroll sincronizado (S2): el Markdown se parte en bloques de nivel superior con `blockStartLines` de @blog/markdown
 * (el mismo recorrido que el render; cada uno es un elemento hijo de .prose) y la vista previa interpola entre los pares.
 */

describe('blockStartLines: dónde empieza cada bloque de nivel superior', () => {
  it('título, párrafo de varias líneas, lista, código con línea en blanco, cita perezosa, tabla y regla', () => {
    const source = [
      '# T', '', 'párrafo', 'sigue', '', '- a', '- b', '', '```', 'x', '', 'y', '```',
      '> cita', 'perezosa', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', '---',
    ].join('\n');
    assert.deepEqual(blockStartLines(source), [0, 2, 5, 8, 13, 16, 20]);
  });

  it('un título interrumpe el párrafo; "#II." sin espacio no es título; "2024." no abre lista', () => {
    assert.deepEqual(blockStartLines('texto\n## T'), [0, 1]);
    assert.deepEqual(blockStartLines('#II. no\nsigue'), [0]);
    assert.deepEqual(blockStartLines('a\n2024. fue'), [0]);
  });

  it('listas: continuación indentada tras línea en blanco; otro tipo de marcador es otra lista', () => {
    assert.deepEqual(blockStartLines('- a\n\n  b\n- c\n\notro'), [0, 5]);
    assert.deepEqual(blockStartLines('- a\n1. b'), [0, 1]);
  });

  it('las definiciones de notas al pie no son bloques (el renderer las saca); CRLF cuenta igual', () => {
    assert.deepEqual(blockStartLines('a[^1]\n\n[^1]: nota\n    sigue\n\nb'), [0, 5]);
    assert.deepEqual(blockStartLines('a\r\n\r\nb'), [0, 2]);
  });

  it('texto vacío: ningún bloque', () => {
    assert.deepEqual(blockStartLines(''), []);
  });

  // Los casos donde la copia de las expresiones del renderer (principio 2, L4) ya se había separado de blocks.ts.
  it('un cierre de código con 4 espacios de sangría no cierra (sigue siendo código)', () => {
    assert.deepEqual(blockStartLines('```\n    ```\nx\n```\n\nfin'), [0, 5]);
  });

  it('una tabla con distinta cantidad de columnas en el separador es un párrafo y una regla', () => {
    assert.deepEqual(blockStartLines('a | b\n---\ntexto'), [0, 1, 2]);
  });

  it('``` con un acento grave en la info no abre código', () => {
    assert.deepEqual(blockStartLines('``` a`b\n\n# T'), [0, 2]);
  });

  it('cada bloque es un hijo de la vista previa: misma cuenta que el HTML del renderer', () => {
    const markdown = '# T\n\n> [!NOTE]\n> caja\n\n![a](/media/a.png "pie")\n\n- a\n\n  b\n\n1. x\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    assert.equal(blockStartLines(markdown).length, topLevelElements(renderPreview(markdown, 'es').html));
  });
});

describe('pairAnchors + syncedScrollTop', () => {
  it('con la misma cantidad de bloques, cada bloque del editor se alinea con el suyo', () => {
    const anchors = pairAnchors([0, 100, 400], [0, 300, 500], { source: 600, target: 1000 });
    assert.equal(syncedScrollTop(anchors, 100), 300);
    assert.equal(syncedScrollTop(anchors, 250), 400, 'entre dos bloques interpola');
    assert.equal(syncedScrollTop(anchors, 600), 1000, 'al final del editor, el final de la vista previa');
  });

  it('si los bloques no coinciden (el texto cambió y la vista previa no), cae a proporcional', () => {
    const anchors = pairAnchors([0, 100], [0, 300, 500], { source: 200, target: 1000 });
    assert.equal(syncedScrollTop(anchors, 50), 250);
  });

  it('anclas que retroceden se ignoran y el resultado nunca es negativo', () => {
    const anchors = pairAnchors([0, 100, 200], [0, 500, 400], { source: 300, target: 600 });
    assert.equal(syncedScrollTop(anchors, 100), 500);
    assert.equal(syncedScrollTop(anchors, 200), 550, 'el bloque que retrocede no cuenta: interpola hasta el final');
    assert.equal(syncedScrollTop(pairAnchors([], [], { source: 0, target: 0 }), 10), 0);
  });
});
