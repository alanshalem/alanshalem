import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  blockSpan,
  changeIndent,
  continueMarkdownBlock,
  insertCodeBlock,
  insertHorizontalRule,
  imageMarkdown,
  insertBlock,
  insertLink,
  insertTable,
  insertText,
  pasteUrlAsLink,
  setHeading,
  toggleBold,
  toggleBulletList,
  toggleCode,
  toggleItalic,
  toggleNumberedList,
  toggleQuote,
  toggleStrike,
} from '../src/editor/commands.ts';
import { renderPreview } from '../src/editor/preview.ts';
import { commandForKey } from '../src/editor/shortcuts.ts';
import { applyEditToState } from '../src/editor/text.ts';
import type { Command, EditorState } from '../src/editor/types.ts';

/*
 * Notación de los tests: «texto» = selección, ¦ = cursor.
 *   run(toggleBold, 'hola «mundo»')  ->  'hola **«mundo»**'
 */
function parse(text: string): EditorState {
  const open = text.indexOf('«');
  if (open !== -1) {
    const close = text.indexOf('»');
    const value = text.slice(0, open) + text.slice(open + 1, close) + text.slice(close + 1);
    return { value, start: open, end: close - 1 };
  }
  const cursor = text.indexOf('¦');
  assert.notEqual(cursor, -1, 'el texto de prueba necesita « » o ¦');
  return { value: text.replace('¦', ''), start: cursor, end: cursor };
}

function show({ value, start, end }: EditorState): string {
  if (start === end) return `${value.slice(0, start)}¦${value.slice(start)}`;
  return `${value.slice(0, start)}«${value.slice(start, end)}»${value.slice(end)}`;
}

function run(command: Command, text: string): string {
  const state = parse(text);
  const edit = command(state);
  return edit === null ? 'null' : show(applyEditToState(state, edit));
}

describe('formato en línea', () => {
  it('envuelve la selección', () => {
    assert.equal(run(toggleBold, 'hola «mundo»'), 'hola **«mundo»**');
    assert.equal(run(toggleItalic, 'hola «mundo»'), 'hola *«mundo»*');
    assert.equal(run(toggleCode, 'hola «mundo»'), 'hola `«mundo»`');
    assert.equal(run(toggleStrike, 'hola «mundo»'), 'hola ~~«mundo»~~');
  });

  it('sin selección inserta el par y deja el cursor en el medio', () => {
    assert.equal(run(toggleBold, 'a¦b'), 'a**¦**b');
  });

  it('desenvuelve cuando los marcadores están dentro de la selección', () => {
    assert.equal(run(toggleBold, '«**a**»'), '«a»');
  });

  it('desenvuelve cuando los marcadores están justo afuera', () => {
    assert.equal(run(toggleBold, '**«a»**'), '«a»');
    assert.equal(run(toggleItalic, '*«a»*'), '«a»');
  });

  it('cursiva sobre negrita no la desarma: suma una capa', () => {
    assert.equal(run(toggleItalic, '**«a»**'), '***«a»***');
  });

  it('negrita sobre negrita+cursiva solo saca la negrita', () => {
    assert.equal(run(toggleBold, '***«a»***'), '*«a»*');
  });

  it('los espacios de los bordes de la selección quedan afuera de los marcadores', () => {
    assert.equal(run(toggleBold, '«hola »mundo'), '**«hola»** mundo');
  });
});

describe('encabezados', () => {
  it('agrega el prefijo y mantiene la columna del cursor', () => {
    assert.equal(run(setHeading(2), 'tit¦ulo'), '## tit¦ulo');
  });

  it('el mismo nivel lo quita', () => {
    assert.equal(run(setHeading(2), '## ti¦tulo'), 'ti¦tulo');
  });

  it('cambia de nivel', () => {
    assert.equal(run(setHeading(3), '# a¦'), '### a¦');
  });

  it('solo toca la línea del cursor', () => {
    assert.equal(run(setHeading(2), 'uno\ndo¦s\ntres'), 'uno\n## do¦s\ntres');
  });
});

describe('listas y citas', () => {
  it('viñetas sobre varias líneas', () => {
    assert.equal(run(toggleBulletList, '«uno\ndos»'), '«- uno\n- dos»');
  });

  it('segunda vez las quita', () => {
    assert.equal(run(toggleBulletList, '«- uno\n- dos»'), '«uno\ndos»');
  });

  it('lista numerada incrementa y salta líneas en blanco', () => {
    assert.equal(run(toggleNumberedList, '«a\n\nb»'), '«1. a\n\n2. b»');
  });

  it('cambiar de viñetas a números reemplaza el prefijo', () => {
    assert.equal(run(toggleNumberedList, '«- a\n- b»'), '«1. a\n2. b»');
  });

  it('en una línea vacía agrega el prefijo y deja el cursor después', () => {
    assert.equal(run(toggleBulletList, '¦'), '- ¦');
  });

  it('con cursor conserva la posición relativa', () => {
    assert.equal(run(toggleBulletList, 'ho¦la'), '- ho¦la');
  });

  it('cita', () => {
    assert.equal(run(toggleQuote, '«a\nb»'), '«> a\n> b»');
    assert.equal(run(toggleQuote, '«> a\n> b»'), '«a\nb»');
  });

  it('una selección que termina justo tras un salto no incluye la línea siguiente', () => {
    const state: EditorState = { value: 'a\nb', start: 0, end: 2 }; // "a\n"
    const edit = toggleBulletList(state);
    assert.equal(applyEditToState(state, edit!).value, '- a\nb');
  });
});

describe('sangría', () => {
  it('Tab anida un ítem de viñetas con 2 espacios', () => {
    assert.equal(run(changeIndent(1), '- a\n- ¦b'), '- a\n  - ¦b');
  });

  it('Tab anida un ítem numerado bajo el ancho del marcador', () => {
    assert.equal(run(changeIndent(1), '1. a\n2. ¦b'), '1. a\n   2. ¦b');
  });

  it('Shift+Tab des-anida', () => {
    assert.equal(run(changeIndent(-1), '  - ¦b'), '- ¦b');
  });

  it('Shift+Tab sin sangría no hace nada', () => {
    assert.equal(run(changeIndent(-1), '- ¦b'), 'null');
  });

  it('fuera de listas, con cursor, devuelve null (el Tab sigue moviendo el foco)', () => {
    assert.equal(run(changeIndent(1), 'tex¦to'), 'null');
  });

  it('con varias líneas seleccionadas sangra todas', () => {
    assert.equal(run(changeIndent(1), '«a\nb»'), '«  a\n  b»');
  });
});

describe('Enter en listas y citas', () => {
  it('continúa una viñeta', () => {
    assert.equal(run(continueMarkdownBlock, '- a¦'), '- a\n- ¦');
  });

  it('continúa una lista numerada incrementando', () => {
    assert.equal(run(continueMarkdownBlock, '1. a¦'), '1. a\n2. ¦');
    assert.equal(run(continueMarkdownBlock, '9) a¦'), '9) a\n10) ¦');
  });

  it('conserva la sangría', () => {
    assert.equal(run(continueMarkdownBlock, '  - a¦'), '  - a\n  - ¦');
  });

  it('parte la línea si el cursor está en el medio', () => {
    assert.equal(run(continueMarkdownBlock, '- ab¦cd'), '- ab\n- ¦cd');
  });

  it('un ítem vacío termina la lista', () => {
    assert.equal(run(continueMarkdownBlock, 'x\n- a\n- ¦'), 'x\n- a\n¦');
  });

  it('continúa citas y las termina si están vacías', () => {
    assert.equal(run(continueMarkdownBlock, '> q¦'), '> q\n> ¦');
    assert.equal(run(continueMarkdownBlock, '> ¦'), '¦');
  });

  it('fuera de listas, con selección o con el cursor dentro del marcador: Enter normal', () => {
    assert.equal(run(continueMarkdownBlock, 'plano¦'), 'null');
    assert.equal(run(continueMarkdownBlock, '- «a»'), 'null');
    assert.equal(run(continueMarkdownBlock, '-¦ a'), 'null');
  });

  it('una línea que arranca con ** no se confunde con una viñeta', () => {
    assert.equal(run(continueMarkdownBlock, '**negrita**¦'), 'null');
  });
});

describe('links e imágenes', () => {
  it('link sobre texto seleccionado deja la url seleccionada', () => {
    assert.equal(run(insertLink.es, '«texto»'), '[texto](«url»)');
  });

  it('link sobre una URL seleccionada deja el texto seleccionado', () => {
    assert.equal(run(insertLink.es, '«https://x.com»'), '[«texto»](https://x.com)');
  });

  it('link sin selección', () => {
    assert.equal(run(insertLink.es, '¦'), '[«texto»](url)');
  });

  it('Ctrl+K con el cursor dentro de un link existente selecciona su url para editarla', () => {
    assert.equal(run(insertLink.es, 'ver [sit¦io](https://x.com) y más'), 'ver [sitio](«https://x.com») y más');
    assert.equal(run(insertLink.es, '[a](ht¦tp://x) [b](y)'), '[a](«http://x») [b](y)');
    assert.equal(run(insertLink.es, '[a](x) ¦fuera'), '[a](x) [«texto»](url)fuera');
  });

  it('pegar una URL sobre texto seleccionado crea el link', () => {
    assert.equal(run(pasteUrlAsLink('https://x.com'), '«hola»'), '[hola](https://x.com)¦');
  });

  it('pegar una URL sin selección, o texto común, es un pegado normal', () => {
    assert.equal(run(pasteUrlAsLink('https://x.com'), 'a¦'), 'null');
    assert.equal(run(pasteUrlAsLink('hola'), '«a»'), 'null');
  });

  it('imagen: alt vacío, alt con corchetes y URL con espacios', () => {
    assert.equal(imageMarkdown('/img/a.png', ''), '![](/img/a.png)');
    assert.equal(imageMarkdown('/img/a.png', ' un [gato] '), '![un  gato](/img/a.png)');
    assert.equal(imageMarkdown('/mi foto.png', 'x'), '![x](</mi foto.png>)');
  });

  it('insertText reemplaza la selección y deja el cursor al final', () => {
    assert.equal(run(insertText('**x**'), 'a «b» c'), 'a **x**¦ c');
  });
});

describe('bloques', () => {
  it('bloque de código vacío al inicio del documento', () => {
    assert.equal(run(insertCodeBlock, '¦'), '```\n¦\n```');
  });

  it('bloque de código tras un párrafo se separa con una línea en blanco', () => {
    assert.equal(run(insertCodeBlock, 'texto¦'), 'texto\n\n```\n¦\n```');
  });

  it('el bloque de código envuelve la selección y la deja seleccionada', () => {
    assert.equal(run(insertCodeBlock, '«x = 1»'), '```\n«x = 1»\n```');
  });

  it('tabla y regla horizontal', () => {
    assert.equal(run(insertTable.es, '¦'), '| «Columna» | Columna |\n| --- | --- |\n| Dato | Dato |');
    assert.equal(run(insertHorizontalRule, 'a¦'), 'a\n\n---¦');
  });

  it('no suma saltos de más si ya hay líneas en blanco', () => {
    assert.equal(run(insertHorizontalRule, 'a\n\n¦'), 'a\n\n---¦');
  });
});

/*
 * Imágenes pegadas o soltadas como bloque propio (perfil-skills-produccion L8, P3-15): antes se insertaban en línea
 * en el cursor, se pegaban a la palabra siguiente y nunca podían ser una figura.
 */
describe('insertBlock: imagen pegada o soltada en un párrafo propio', () => {
  const image = insertBlock('![x](/m.webp)');

  it('en medio de una frase: línea en blanco antes y después, sin el espacio del borde', () => {
    const state = { value: 'antes después', start: 6, end: 6 };
    const edit = image(state);
    assert.ok(edit);
    assert.equal(applyEditToState(state, edit).value, 'antes\n\n![x](/m.webp)\n\ndespués');
    assert.equal(run(image, 'antes ¦después'), 'antes\n\n![x](/m.webp)\n\n¦después');
  });

  it('sin líneas en blanco de más al principio ni al final del documento', () => {
    assert.equal(run(image, '¦'), '![x](/m.webp)¦');
    assert.equal(run(image, '¦texto'), '![x](/m.webp)\n\n¦texto');
    assert.equal(run(image, 'texto¦'), 'texto\n\n![x](/m.webp)¦');
  });

  it('reusa las líneas en blanco que ya están y completa las que faltan', () => {
    assert.equal(run(image, 'a\n\n¦\n\nb'), 'a\n\n![x](/m.webp)¦\n\nb');
    assert.equal(run(image, 'a\n¦b'), 'a\n\n![x](/m.webp)\n\n¦b');
    assert.equal(run(image, 'a\n\n![1](/1.webp)\n\n¦b'), 'a\n\n![1](/1.webp)\n\n![x](/m.webp)\n\n¦b');
  });

  it('reemplaza la selección', () => {
    assert.equal(run(image, 'a «sel» b'), 'a\n\n![x](/m.webp)\n\n¦b');
  });

  it('sola en su párrafo, con un título pasa a ser una figura', () => {
    const titled = run(insertBlock('![x](/m.webp "Pie")'), 'antes ¦después').replace('¦', '');
    assert.match(renderPreview(titled, 'es').html, /<figure>/);
  });
});

describe('blockSpan: sacar un bloque sin dejar líneas en blanco de más (la subida que falla)', () => {
  const remove = (value: string, block: string): string => {
    const from = value.indexOf(block);
    const span = blockSpan(value, from, from + block.length);
    return value.slice(0, span.from) + value.slice(span.to);
  };

  it('deshace lo que agregó insertBlock', () => {
    assert.equal(remove('antes\n\nPH\n\ndespués', 'PH'), 'antes\n\ndespués');
    assert.equal(remove('PH\n\ndespués', 'PH'), 'después');
    assert.equal(remove('antes\n\nPH', 'PH'), 'antes');
    assert.equal(remove('PH', 'PH'), '');
  });

  it('si mientras tanto se escribió en su línea, saca solo el bloque', () => {
    assert.equal(remove('antes\nabcPH\n\ndespués', 'PH'), 'antes\nabc\n\ndespués');
    assert.equal(remove('antes\n\nPHx', 'PH'), 'antes\n\nx');
  });
});

describe('atajos de teclado', () => {
  const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    commandForKey({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra });

  it('Ctrl/Cmd + B, I, E, K', () => {
    assert.equal(key('b', { ctrlKey: true }), toggleBold);
    assert.equal(key('B', { metaKey: true }), toggleBold);
    assert.equal(key('i', { ctrlKey: true }), toggleItalic);
    assert.equal(key('e', { ctrlKey: true }), toggleCode);
    assert.equal(key('k', { ctrlKey: true }), insertLink.es);
  });

  it('Mod+Shift+X tachado; otras combinaciones con Shift no hacen nada', () => {
    assert.equal(key('x', { ctrlKey: true, shiftKey: true }), toggleStrike);
    assert.equal(key('b', { ctrlKey: true, shiftKey: true }), null);
  });

  it('Enter y Tab; Shift+Enter y Alt no se tocan', () => {
    assert.equal(key('Enter'), continueMarkdownBlock);
    assert.equal(key('Enter', { shiftKey: true }), null);
    assert.equal(key('Tab') !== null, true);
    assert.equal(key('b', { ctrlKey: true, altKey: true }), null);
  });

  it('una tecla común no dispara nada', () => {
    assert.equal(key('a'), null);
  });
});
