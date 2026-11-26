import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  blockStartLines,
  POST_BODY_RENDER_OPTIONS,
  readingTimeMinutes,
  readingTimeOfText,
  renderMarkdown,
  toPlainText,
  wordCount,
} from '../src/index.ts';

/*
 * blockStartLines (principio 2, L4): la línea donde empieza cada bloque de nivel superior, con las mismas reglas que
 * el render porque sale del mismo recorrido. El admin la usa para el scroll sincronizado y el esquema de títulos;
 * antes copiaba las expresiones de blocks.ts y ya se habían separado.
 */

/** Cuántos elementos hay en el primer nivel del HTML, sin la sección de notas al pie (no sale de un bloque). */
function topLevelElements(html: string): number {
  const VOID = new Set(['hr', 'br', 'img', 'input', 'source']);
  let depth = 0;
  let count = 0;
  for (const [, closing, tag = ''] of html.replace(/\n<section class="footnotes"[\s\S]*$/, '').matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/g)) {
    if (closing) depth -= 1;
    else {
      if (depth === 0) count += 1;
      if (!VOID.has(tag)) depth += 1;
    }
  }
  return count;
}

describe('blockStartLines', () => {
  it('título, párrafo de varias líneas, lista, código con línea en blanco, cita perezosa, tabla y regla', () => {
    const source = [
      '# T', '', 'párrafo', 'sigue', '', '- a', '- b', '', '```', 'x', '', 'y', '```',
      '> cita', 'perezosa', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', '---',
    ].join('\n');
    assert.deepEqual(blockStartLines(source), [0, 2, 5, 8, 13, 16, 20]);
  });

  it('las definiciones de notas al pie no son bloques; CRLF cuenta igual; vacío = ninguno', () => {
    assert.deepEqual(blockStartLines('a[^1]\n\n[^1]: nota\n    sigue\n\nb'), [0, 5]);
    assert.deepEqual(blockStartLines('a\r\n\r\nb'), [0, 2]);
    assert.deepEqual(blockStartLines(''), []);
  });

  it('los bordes del código y de las tablas son los del render', () => {
    assert.deepEqual(blockStartLines('```\n    ```\nx\n```\n\nfin'), [0, 5]);
    assert.deepEqual(blockStartLines('a | b\n---\ntexto'), [0, 1, 2]);
    assert.deepEqual(blockStartLines('``` a`b\n\n# T'), [0, 2]);
  });

  it('un bloque por cada elemento de primer nivel del HTML', () => {
    for (const markdown of [
      '# T\n\n> [!NOTE]\n> caja\n\n![a](/media/a.png "pie")\n\n- a\n\n  b\n\n1. x\n\n| a | b |\n|---|---|\n| 1 | 2 |',
      'texto[^n]\n\n[^n]: nota\n\n````\n```\n````\n\n***\n\n> cita\nperezosa\n\n- a\n* b\n\n2024. no es lista',
    ]) {
      const { html } = renderMarkdown(markdown, POST_BODY_RENDER_OPTIONS);
      assert.equal(blockStartLines(markdown).length, topLevelElements(html), markdown);
    }
  });
});

/*
 * Un solo render por actualización (perfil-skills-produccion L8, P3-14): el resultado trae los bordes de los bloques
 * y el texto plano de ese mismo recorrido, así el admin no vuelve a parsear para el contador, el esquema y el scroll.
 */
describe('renderMarkdown: blockStarts y text del mismo recorrido', () => {
  const SAMPLES = [
    '# T\n\npárrafo\nsigue\n\n- a\n- b\n\n```\nx\n\ny\n```\n> cita\nperezosa\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n---',
    'a[^1]\n\n[^1]: nota\n    sigue\n\nb',
    'a\r\n\r\nb',
    '',
    '# T\n\n> [!NOTE]\n> caja\n\n![a](/media/a.png "pie")\n\n- a\n\n  b\n\n1. x',
  ];

  it('blockStarts es lo mismo que blockStartLines, con las opciones del cuerpo de un post', () => {
    for (const md of SAMPLES) {
      assert.deepEqual(renderMarkdown(md, POST_BODY_RENDER_OPTIONS).blockStarts, blockStartLines(md), md);
      assert.deepEqual(renderMarkdown(md).blockStarts, blockStartLines(md), md);
    }
  });

  it('text es el texto plano de ese render: sin opciones, igual a toPlainText', () => {
    for (const md of SAMPLES) assert.equal(renderMarkdown(md).text, toPlainText(md), md);
    assert.equal(renderMarkdown('a & b < **c**').text, 'a & b < c');
  });

  it('text sigue a las opciones: tipografía, figuras e idioma de las cajas', () => {
    const { text } = renderMarkdown('"hola" -- y...\n\n![a](/a.png "Pie")\n\n> [!NOTE]\n> x', { ...POST_BODY_RENDER_OPTIONS, lang: 'en' });
    assert.equal(text, '“hola” – y… Pie Note x');
  });

  it('html y headings no cambian (los campos nuevos solo se suman)', () => {
    const md = '## Título\n\nUn párrafo con **negrita**.';
    const result = renderMarkdown(md, POST_BODY_RENDER_OPTIONS);
    assert.deepEqual(Object.keys(result), ['html', 'headings', 'blockStarts', 'text']);
    assert.equal(result.html, '<h2 id="titulo">Título</h2>\n<p>Un párrafo con <strong>negrita</strong>.</p>');
    assert.deepEqual(result.headings, [{ level: 2, id: 'titulo', text: 'Título' }]);
  });
});

describe('wordCount y readingTimeOfText: la fórmula de minutos sobre un texto plano ya calculado', () => {
  it('cuenta palabras del texto plano; vacío = 0', () => {
    assert.equal(wordCount('Una frase con link.'), 4);
    assert.equal(wordCount(''), 0);
  });

  it('readingTimeOfText da lo mismo que readingTimeMinutes sobre el texto del render', () => {
    for (const md of ['corto', 'palabra '.repeat(450), '', Array(401).fill('palabra').join(' ')]) {
      assert.equal(readingTimeOfText(renderMarkdown(md).text), readingTimeMinutes(md), md);
    }
    assert.equal(readingTimeOfText('palabra '.repeat(450).trim(), 100), 5);
  });
});
