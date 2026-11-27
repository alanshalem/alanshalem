import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderMarkdown } from '@blog/markdown';
import { absoluteImageUrl, acceptImageUrl, firstMarkdownImage, resolveCover } from '../src/lib/cover.ts';
import { generativeCover } from '../src/lib/generative.ts';

const html = (md: string): string => renderMarkdown(md, { headingOffset: 1 }).html;

describe('resolveCover: precedence coverUrl → first Markdown image → generative', () => {
  it('coverUrl wins even when the Markdown has images', () => {
    const cover = resolveCover({
      slug: 'a',
      tag: 'ideas',
      coverUrl: '/media/cover.jpg',
      coverAlt: 'A lighthouse at night',
      html: html('![other](/media/body.jpg)'),
    });
    assert.deepEqual(cover, { kind: 'image', src: '/media/cover.jpg', alt: 'A lighthouse at night', source: 'cover' });
  });

  it('an http(s) coverUrl is valid too', () => {
    const cover = resolveCover({ slug: 'a', coverUrl: 'https://cdn.example.com/x.png', coverAlt: null, html: '' });
    assert.deepEqual(cover, { kind: 'image', src: 'https://cdn.example.com/x.png', alt: '', source: 'cover' });
  });

  it('without coverUrl it uses the first Markdown image, with its alt', () => {
    const cover = resolveCover({
      slug: 'a',
      coverUrl: null,
      html: html('Text.\n\n![Map & route](/media/map.png)\n\n![second](/media/2.png)'),
    });
    assert.deepEqual(cover, { kind: 'image', src: '/media/map.png', alt: 'Map & route', source: 'markdown' });
  });

  it('decodes the entities of the rendered src', () => {
    const cover = resolveCover({ slug: 'a', html: html('![x](https://x.com/a.png?a=1&b=2)') });
    assert.equal(cover.kind === 'image' && cover.src, 'https://x.com/a.png?a=1&b=2');
  });

  it('an empty or blank coverUrl falls back to the Markdown image', () => {
    const cover = resolveCover({ slug: 'a', coverUrl: '   ', html: html('![m](/media/m.png)') });
    assert.equal(cover.kind === 'image' && cover.source, 'markdown');
  });

  it('ignores javascript: and data: Markdown images and falls back to the generative one', () => {
    const cover = resolveCover({
      slug: 'unsafe-post',
      tag: 'security',
      html: html('![a](javascript:alert(1))\n\n![b](data:image/png;base64,AAAA)'),
    });
    assert.equal(cover.kind, 'generative');
  });

  it('a javascript: or data: coverUrl is discarded', () => {
    const cover = resolveCover({ slug: 'a', coverUrl: 'javascript:alert(1)', html: html('![m](/media/m.png)') });
    assert.deepEqual(cover, { kind: 'image', src: '/media/m.png', alt: 'm', source: 'markdown' });
    const data = resolveCover({ slug: 'b', coverUrl: 'data:image/png;base64,AAAA', html: '' });
    assert.equal(data.kind, 'generative');
  });

  it('ignores images inside code blocks', () => {
    const cover = resolveCover({ slug: 'a', html: html('```\n![f](/x.png)\n```') });
    assert.equal(cover.kind, 'generative');
  });

  it('without a cover or images it returns the generative one for the slug and topic', () => {
    const cover = resolveCover({ slug: 'no-image', tag: 'ideas', html: html('Only text.') });
    assert.deepEqual(cover, { kind: 'generative', svg: generativeCover('no-image', 'ideas') });
  });
});

describe('acceptImageUrl', () => {
  it('accepts relative paths and http(s); rejects the rest', () => {
    assert.equal(acceptImageUrl('/media/a.png'), '/media/a.png');
    assert.equal(acceptImageUrl(' https://x.com/a.png '), 'https://x.com/a.png');
    assert.equal(acceptImageUrl('img/a.png'), 'img/a.png');
    assert.equal(acceptImageUrl('javascript:alert(1)'), null);
    assert.equal(acceptImageUrl('JaVa\tScript:alert(1)'), null);
    assert.equal(acceptImageUrl('data:image/png;base64,AAAA'), null);
    assert.equal(acceptImageUrl('mailto:a@b.c'), null);
    assert.equal(acceptImageUrl(''), null);
    assert.equal(acceptImageUrl(null), null);
    assert.equal(acceptImageUrl(undefined), null);
  });
});

describe('firstMarkdownImage', () => {
  it('returns null when there is no <img>', () => {
    assert.equal(firstMarkdownImage('<p>hello</p>'), null);
  });

  it('unescapes the attributes exactly once (the inverse of escapeHtml, not a full entity decoder)', () => {
    const tag = '<img src="/a.png?x=1&amp;y=2" alt="&amp;lt;b&amp;gt; &#39;x&#39; &quot;y&quot; &copy;">';
    assert.deepEqual(firstMarkdownImage(tag), { src: '/a.png?x=1&y=2', alt: `&lt;b&gt; 'x' "y" &copy;` });
  });
});

describe('absoluteImageUrl', () => {
  it('resolves paths against the site and leaves absolute ones', () => {
    assert.equal(absoluteImageUrl('/media/a.png', 'https://blog.com/articulos/x/'), 'https://blog.com/media/a.png');
    assert.equal(absoluteImageUrl('img/a.png', 'https://blog.com/articulos/x/'), 'https://blog.com/articulos/x/img/a.png');
    assert.equal(absoluteImageUrl('https://cdn.com/a.png', 'https://blog.com/'), 'https://cdn.com/a.png');
  });
});
