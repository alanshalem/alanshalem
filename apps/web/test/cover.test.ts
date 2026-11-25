import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderMarkdown } from '@blog/markdown';
import { absoluteImageUrl, acceptImageUrl, firstMarkdownImage, resolveCover } from '../src/lib/cover.ts';
import { generativeCover } from '../src/lib/generative.ts';

const html = (md: string): string => renderMarkdown(md, { headingOffset: 1 }).html;

describe('resolveCover: precedencia coverUrl → primera imagen del Markdown → generativa (L5)', () => {
  it('coverUrl gana aunque el Markdown tenga imágenes', () => {
    const cover = resolveCover({
      slug: 'a',
      tag: 'ideas',
      coverUrl: '/media/portada.jpg',
      coverAlt: 'Un faro de noche',
      html: html('![otra](/media/cuerpo.jpg)'),
    });
    assert.deepEqual(cover, { kind: 'image', src: '/media/portada.jpg', alt: 'Un faro de noche', source: 'cover' });
  });

  it('coverUrl http(s) también es válida', () => {
    const cover = resolveCover({ slug: 'a', coverUrl: 'https://cdn.example.com/x.png', coverAlt: null, html: '' });
    assert.deepEqual(cover, { kind: 'image', src: 'https://cdn.example.com/x.png', alt: '', source: 'cover' });
  });

  it('sin coverUrl usa la primera imagen del Markdown, con su alt', () => {
    const cover = resolveCover({
      slug: 'a',
      coverUrl: null,
      html: html('Texto.\n\n![Mapa & ruta](/media/mapa.png)\n\n![segunda](/media/2.png)'),
    });
    assert.deepEqual(cover, { kind: 'image', src: '/media/mapa.png', alt: 'Mapa & ruta', source: 'markdown' });
  });

  it('decodifica las entidades del src renderizado', () => {
    const cover = resolveCover({ slug: 'a', html: html('![x](https://x.com/a.png?a=1&b=2)') });
    assert.equal(cover.kind === 'image' && cover.src, 'https://x.com/a.png?a=1&b=2');
  });

  it('coverUrl vacía o en blanco cae a la imagen del Markdown', () => {
    const cover = resolveCover({ slug: 'a', coverUrl: '   ', html: html('![m](/media/m.png)') });
    assert.equal(cover.kind === 'image' && cover.source, 'markdown');
  });

  it('ignora imágenes javascript: y data: del Markdown y cae a la generativa', () => {
    const cover = resolveCover({
      slug: 'post-inseguro',
      tag: 'seguridad',
      html: html('![a](javascript:alert(1))\n\n![b](data:image/png;base64,AAAA)'),
    });
    assert.equal(cover.kind, 'generative');
  });

  it('una coverUrl javascript: o data: se descarta', () => {
    const cover = resolveCover({ slug: 'a', coverUrl: 'javascript:alert(1)', html: html('![m](/media/m.png)') });
    assert.deepEqual(cover, { kind: 'image', src: '/media/m.png', alt: 'm', source: 'markdown' });
    const data = resolveCover({ slug: 'b', coverUrl: 'data:image/png;base64,AAAA', html: '' });
    assert.equal(data.kind, 'generative');
  });

  it('ignora imágenes dentro de bloques de código', () => {
    const cover = resolveCover({ slug: 'a', html: html('```\n![f](/x.png)\n```') });
    assert.equal(cover.kind, 'generative');
  });

  it('sin portada ni imágenes devuelve la generativa del slug y el tema', () => {
    const cover = resolveCover({ slug: 'sin-imagen', tag: 'ideas', html: html('Solo texto.') });
    assert.deepEqual(cover, { kind: 'generative', svg: generativeCover('sin-imagen', 'ideas') });
  });
});

describe('acceptImageUrl', () => {
  it('acepta rutas relativas y http(s); rechaza el resto', () => {
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
  it('devuelve null si no hay <img>', () => {
    assert.equal(firstMarkdownImage('<p>hola</p>'), null);
  });
});

describe('absoluteImageUrl', () => {
  it('resuelve rutas contra el sitio y deja las absolutas', () => {
    assert.equal(absoluteImageUrl('/media/a.png', 'https://blog.com/articulos/x/'), 'https://blog.com/media/a.png');
    assert.equal(absoluteImageUrl('img/a.png', 'https://blog.com/articulos/x/'), 'https://blog.com/articulos/x/img/a.png');
    assert.equal(absoluteImageUrl('https://cdn.com/a.png', 'https://blog.com/'), 'https://cdn.com/a.png');
  });
});
