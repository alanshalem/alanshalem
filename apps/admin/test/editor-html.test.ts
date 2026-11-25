import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { htmlToMarkdown } from '../src/editor/htmlToMarkdown.ts';

/* Pegar HTML (Google Docs, una web) convierte a Markdown limpio (S2); sin formato real, se pega el texto plano. */

const md = (html: string): string => htmlToMarkdown(html).markdown;
const B = '\\';

describe('htmlToMarkdown: bloques', () => {
  it('párrafos, títulos y separador', () => {
    assert.equal(md('<h1>T</h1><p>Uno</p><hr><h3>S</h3><p>Dos</p>'), '# T\n\nUno\n\n---\n\n### S\n\nDos');
  });

  it('<br> es un salto de línea forzado dentro del párrafo', () => {
    assert.equal(md('<p>a<br>b</p>'), `a${B}\nb`);
    assert.equal(md('<p>a<br></p>'), 'a', 'un <br> al final no deja una barra suelta');
  });

  it('listas anidadas, numeradas y con start', () => {
    assert.equal(md('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>'), '- a\n  - b\n- c');
    assert.equal(md('<ol><li>uno</li><li>dos<ol><li>x</li></ol></li></ol>'), '1. uno\n2. dos\n   1. x');
    assert.equal(md('<ol start="3"><li>c</li><li>d</li></ol>'), '3. c\n4. d');
  });

  it('una lista dentro de otra sin <li> (Google Docs) se anida bajo el ítem anterior', () => {
    assert.equal(md('<ul><li><p>a</p></li><ul><li><p>b</p></li></ul></ul>'), '- a\n  - b');
  });

  it('cita con varios párrafos', () => {
    assert.equal(md('<blockquote><p>a</p><p>b</p></blockquote>'), '> a\n>\n> b');
  });

  it('bloque de código: el texto sin tocar, con el lenguaje de la clase', () => {
    assert.equal(
      md('<pre><code class="language-js">const a = 1;\nif (a &lt; 2) {}\n</code></pre>'),
      '```js\nconst a = 1;\nif (a < 2) {}\n```',
    );
    assert.equal(md('<pre>```\nx</pre>'), '````\n```\nx\n````', 'un fence adentro alarga el de afuera');
  });

  it('tabla simple: la primera fila es el encabezado; los | de las celdas se escapan', () => {
    assert.equal(
      md('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>x|y</td></tr></tbody></table>'),
      `| A | B |\n| --- | --- |\n| 1 | x${B}|y |`,
    );
    assert.equal(md('<table><tr><td>a<br>b</td></tr></table>'), '| a b |\n| --- |');
  });
});

describe('htmlToMarkdown: en línea', () => {
  it('negrita, cursiva, tachado y código', () => {
    assert.equal(md('<p>Hola <strong>mundo</strong> y <em>todos</em></p>'), 'Hola **mundo** y *todos*');
    assert.equal(md('<b>a</b> <i>b</i> <s>c</s> <del>d</del> <code>e*f</code>'), '**a** *b* ~~c~~ ~~d~~ `e*f`');
    assert.equal(md('<code>a`b</code>'), '``a`b``', 'un acento grave adentro alarga el delimitador');
    assert.equal(md('<code>`x</code>'), '`` `x ``', 'en el borde, además, un espacio');
  });

  it('los espacios de los bordes quedan fuera de los marcadores; un formato repetido no se duplica', () => {
    assert.equal(md('a<b> x </b>b'), 'a **x** b');
    assert.equal(md('<b>a <strong>b</strong></b>'), '**a b**');
    assert.equal(md('<b> </b>x'), 'x');
  });

  it('links e imágenes con URLs seguras', () => {
    assert.equal(md('<a href="https://x.com/a">sitio</a>'), '[sitio](https://x.com/a)');
    assert.equal(md('<a href="/a b">x</a>'), '[x](/a%20b)');
    assert.equal(md('<img src="https://x.com/a.png" alt="Un gato">'), '![Un gato](https://x.com/a.png)');
  });

  it('links javascript:/data: se descartan (queda el texto); imágenes inseguras desaparecen', () => {
    assert.equal(md('<a href="javascript:alert(1)">mal</a>'), 'mal');
    assert.equal(md('<a href=" JaVa&#83;cript:alert(1)">mal</a>'), 'mal');
    assert.equal(md('<a href="data:text/html,x">mal</a>'), 'mal');
    assert.equal(md('<p>a<img src="data:image/png;base64,AAAA" alt="x">b</p>'), 'ab');
  });

  it('entidades y espacios colapsados', () => {
    assert.equal(md('<p>&lt;tag&gt; &amp; &quot;x&quot;&nbsp;&#8212; &#x2014;</p>'), '<tag> & "x" — —');
    assert.equal(md('<p>  a\n   b  </p>'), 'a b');
  });

  it('el texto que parece Markdown se escapa', () => {
    assert.equal(
      md('<p>#II. no es título</p><p>1. tampoco</p><p>- ni esto</p><p>a*b snake_case _x_ [y] ~~z~~</p>'),
      `${B}#II. no es título\n\n1${B}. tampoco\n\n${B}- ni esto\n\na${B}*b snake_case ${B}_x${B}_ ${B}[y${B}] ${B}~${B}~z${B}~${B}~`,
    );
  });
});

describe('htmlToMarkdown: limpieza', () => {
  it('script, style, head y comentarios se quitan con su contenido', () => {
    assert.equal(
      md('<!--StartFragment--><style>p{color:red}</style><p>ok<script>alert("<p>x</p>")</script></p><!--EndFragment-->'),
      'ok',
    );
    assert.equal(md('<html><head><title>T</title></head><body><p>x</p></body></html>'), 'x');
  });

  it('los envoltorios y atributos desconocidos se descartan', () => {
    assert.equal(md('<div class="x"><section><font color="red">texto</font> <o:p></o:p></section></div>'), 'texto');
  });

  it('Google Docs: el <b> envoltorio con font-weight normal no es negrita; los span con estilo sí', () => {
    const docs =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr">' +
      '<span style="font-weight:700;">Negrita</span><span style="font-weight:400;"> y </span>' +
      '<span style="font-style:italic;">cursiva</span> <span style="text-decoration:line-through;">no</span>' +
      '</p></b><br class="Apple-interchange-newline">';
    assert.deepEqual(htmlToMarkdown(docs), { markdown: '**Negrita** y *cursiva* ~~no~~', formatted: true });
  });

  it('sin formato real (solo párrafos, saltos, spans sin estilo) no hay nada que convertir: formatted = false', () => {
    assert.equal(htmlToMarkdown('<p>solo texto</p><p>otro</p>').formatted, false);
    assert.equal(htmlToMarkdown('<span>a</span><br><span style="color:red">b</span>').formatted, false);
    assert.equal(htmlToMarkdown('').formatted, false);
    assert.equal(htmlToMarkdown('<p>a <a href="https://x.com">b</a></p>').formatted, true);
  });
});
