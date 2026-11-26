import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { postsMarkdown, replaceMarked } from '../src/readme.ts';

describe('replaceMarked', () => {
  const readme = 'intro\n<!-- BLOG-POSTS:START -->\nold\nlines\n<!-- BLOG-POSTS:END -->\noutro\n';

  it('reemplaza solo lo que está entre los marcadores y los conserva', () => {
    assert.equal(
      replaceMarked(readme, 'BLOG-POSTS', 'new'),
      'intro\n<!-- BLOG-POSTS:START -->\nnew\n<!-- BLOG-POSTS:END -->\noutro\n',
    );
  });

  it('es idempotente', () => {
    const once = replaceMarked(readme, 'BLOG-POSTS', 'same');
    assert.equal(replaceMarked(once, 'BLOG-POSTS', 'same'), once);
  });

  it('sin marcadores, o en otro orden, falla en vez de no actualizar nada en silencio', () => {
    assert.throws(() => replaceMarked('nothing', 'BLOG-POSTS', 'x'), /BLOG-POSTS:START/);
    assert.throws(
      () => replaceMarked('<!-- BLOG-POSTS:END -->\n<!-- BLOG-POSTS:START -->', 'BLOG-POSTS', 'x'),
      /BLOG-POSTS:START/,
    );
  });

  it('un contenido con "$" se inserta literal (no como patrón de reemplazo)', () => {
    assert.match(replaceMarked(readme, 'BLOG-POSTS', "costs $& and $1"), /costs \$& and \$1/);
  });
});

describe('postsMarkdown', () => {
  it('lista los posts como enlaces con la fecha en inglés (UTC)', () => {
    const markdown = postsMarkdown([
      { title: 'Hello', url: 'https://example.com/en/articles/hello/', date: '2026-11-25T23:30:00.000Z' },
      { title: 'Second', url: 'https://example.com/en/articles/second/', date: '2026-01-02T00:00:00.000Z' },
    ]);
    assert.equal(
      markdown,
      [
        '- [Hello](https://example.com/en/articles/hello/) <sub>Nov 25, 2026</sub>',
        '- [Second](https://example.com/en/articles/second/) <sub>Jan 2, 2026</sub>',
      ].join('\n'),
    );
  });

  it('escapa en el título lo que Markdown o HTML interpretarían, y los paréntesis y espacios del enlace', () => {
    const markdown = postsMarkdown([
      { title: 'A [link] *bold* <b>x</b> `c` _u_ \\ |', url: 'https://example.com/a (b)/', date: '2026-11-25T00:00:00.000Z' },
    ]);
    assert.equal(
      markdown,
      '- [A \\[link\\] \\*bold\\* &lt;b&gt;x&lt;/b&gt; \\`c\\` \\_u\\_ \\\\ \\|](https://example.com/a%20%28b%29/) <sub>Nov 25, 2026</sub>',
    );
  });

  it('a lo sumo 5 posts', () => {
    const posts = Array.from({ length: 7 }, (_, i) => ({
      title: `P${i}`,
      url: `https://example.com/${i}`,
      date: '2026-11-25T00:00:00.000Z',
    }));
    assert.equal(postsMarkdown(posts).split('\n').length, 5);
  });

  it('sin posts, una línea de "próximamente"', () => {
    assert.equal(postsMarkdown([]), '<sub>The blog is on its way — new posts will show up here.</sub>');
  });
});
