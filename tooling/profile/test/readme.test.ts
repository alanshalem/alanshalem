import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { postsMarkdown, replaceMarked } from '../src/readme.ts';

describe('replaceMarked', () => {
  const readme = 'intro\n<!-- BLOG-POSTS:START -->\nold\nlines\n<!-- BLOG-POSTS:END -->\noutro\n';

  it('replaces only what sits between the markers and keeps them', () => {
    assert.equal(
      replaceMarked(readme, 'BLOG-POSTS', 'new'),
      'intro\n<!-- BLOG-POSTS:START -->\nnew\n<!-- BLOG-POSTS:END -->\noutro\n',
    );
  });

  it('is idempotent', () => {
    const once = replaceMarked(readme, 'BLOG-POSTS', 'same');
    assert.equal(replaceMarked(once, 'BLOG-POSTS', 'same'), once);
  });

  it('without markers, or in another order, it fails instead of silently updating nothing', () => {
    assert.throws(() => replaceMarked('nothing', 'BLOG-POSTS', 'x'), /BLOG-POSTS:START/);
    assert.throws(
      () => replaceMarked('<!-- BLOG-POSTS:END -->\n<!-- BLOG-POSTS:START -->', 'BLOG-POSTS', 'x'),
      /BLOG-POSTS:START/,
    );
  });

  it('content with "$" is inserted literally (not as a replacement pattern)', () => {
    assert.match(replaceMarked(readme, 'BLOG-POSTS', "costs $& and $1"), /costs \$& and \$1/);
  });
});

describe('postsMarkdown', () => {
  it('lists the posts as links with the date in English (UTC)', () => {
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

  it('escapes what Markdown or HTML would interpret in the title, and the link parentheses and spaces', () => {
    const markdown = postsMarkdown([
      { title: 'A [link] *bold* <b>x</b> `c` _u_ \\ |', url: 'https://example.com/a (b)/', date: '2026-11-25T00:00:00.000Z' },
    ]);
    assert.equal(
      markdown,
      '- [A \\[link\\] \\*bold\\* &lt;b&gt;x&lt;/b&gt; \\`c\\` \\_u\\_ \\\\ \\|](https://example.com/a%20%28b%29/) <sub>Nov 25, 2026</sub>',
    );
  });

  it('at most 5 posts', () => {
    const posts = Array.from({ length: 7 }, (_, i) => ({
      title: `P${i}`,
      url: `https://example.com/${i}`,
      date: '2026-11-25T00:00:00.000Z',
    }));
    assert.equal(postsMarkdown(posts).split('\n').length, 5);
  });

  it('without posts, a "coming soon" line', () => {
    assert.equal(postsMarkdown([]), '<sub>The blog is on its way — new posts will show up here.</sub>');
  });
});

describe('README placement', () => {
  it('only the profile README is in a place GitHub shows (.github/ wins over the root, on the profile too)', () => {
    const root = new URL('../../../', import.meta.url);
    assert.equal(existsSync(new URL('.github/README.md', root)), false, 'move the project README to docs/');
    assert.equal(existsSync(new URL('README.md', root)), true);
    assert.equal(existsSync(new URL('docs/README.md', root)), true);
  });
});
