import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderMarkdown } from '@blog/markdown';
import { indexMedia } from '../src/lib/media.ts';
import { IMAGE_SIZES, imageHtml, responsiveProseHtml } from '../src/lib/responsive-image.ts';
import { mediaAsset } from './fixtures.ts';

const asset = mediaAsset('aaa');
const media = indexMedia([asset]);
const box = { width: 1600, height: 1000 };
const AVIF = '/media/aaa/640.avif 640w, /media/aaa/1024.avif 1024w, /media/aaa/1600.avif 1600w';
const WEBP = '/media/aaa/640.webp 640w, /media/aaa/1024.webp 1024w, /media/aaa/1600.webp 1600w';

describe('IMAGE_SIZES: un `sizes` por contexto de diseño (S6)', () => {
  it('hero a pantalla completa, prosa en la columna de 640px', () => {
    assert.equal(IMAGE_SIZES.hero, '100vw');
    assert.equal(IMAGE_SIZES.prose, '(min-width: 640px) 640px, 100vw');
    assert.match(IMAGE_SIZES.card, /100vw$/);
    assert.match(IMAGE_SIZES.lead, /100vw$/);
  });
});

describe('imageHtml: <picture> AVIF + WebP para assets conocidos', () => {
  it('arma ambas fuentes con srcset completo y el sizes del contexto; <img> = asset.url con sus medidas', () => {
    const html = imageHtml('/media/aaa/1600.webp', media, { alt: 'Un faro', context: 'card', ...box });
    assert.equal(
      html,
      '<picture>' +
        `<source type="image/avif" srcset="${AVIF}" sizes="${IMAGE_SIZES.card}">` +
        `<source type="image/webp" srcset="${WEBP}" sizes="${IMAGE_SIZES.card}">` +
        '<img src="/media/aaa/1600.webp" alt="Un faro" width="2000" height="1125" loading="lazy" decoding="async"' +
        ' style="background-color:#336699">' +
        '</picture>',
    );
  });

  it('reconoce el asset por la URL de cualquier variante', () => {
    const html = imageHtml('/media/aaa/640.avif', media, { alt: '', context: 'lead', ...box });
    assert.match(html, /^<picture>/);
    assert.match(html, /<img src="\/media\/aaa\/1600\.webp"/);
  });

  it('priority => eager + fetchpriority=high (solo hero / primera imagen visible)', () => {
    const html = imageHtml('/media/aaa/1600.webp', media, { alt: '', context: 'hero', priority: true, ...box });
    assert.match(html, /loading="eager" decoding="async" fetchpriority="high"/);
    assert.match(html, /sizes="100vw"/);
    assert.doesNotMatch(html, /loading="lazy"/);
  });

  it('escapa alt y title', () => {
    const html = imageHtml('/media/aaa/1600.webp', media, {
      alt: '"><script>alert(1)</script>',
      title: 'a & "b"',
      context: 'prose',
      ...box,
    });
    assert.match(html, /alt="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;" title="a &amp; &quot;b&quot;"/);
    assert.doesNotMatch(html, /<script/);
  });

  it('un color que no es #rrggbb no se emite como estilo', () => {
    const odd = indexMedia([mediaAsset('bbb', { color: 'red;background:url(x)' })]);
    const html = imageHtml('/media/bbb/1600.webp', odd, { alt: '', context: 'card', ...box });
    assert.doesNotMatch(html, /style=/);
  });

  it('sin variantes AVIF no emite una <source> AVIF vacía', () => {
    const webpOnly = mediaAsset('ccc', { variants: [{ format: 'webp', width: 640, url: '/media/ccc/640.webp' }] });
    const html = imageHtml('/media/ccc/1600.webp', indexMedia([webpOnly]), { alt: '', context: 'card', ...box });
    assert.doesNotMatch(html, /image\/avif/);
    assert.match(html, /<source type="image\/webp" srcset="\/media\/ccc\/640\.webp 640w"/);
  });
});

describe('imageHtml: URL desconocida => el <img> simple de siempre', () => {
  it('conserva src, alt y la caja reservada; lazy por defecto', () => {
    assert.equal(
      imageHtml('https://cdn.example.com/a.jpg?x=1&y=2', media, { alt: 'Foto', context: 'card', ...box }),
      '<img src="https://cdn.example.com/a.jpg?x=1&amp;y=2" alt="Foto" width="1600" height="1000" loading="lazy" decoding="async">',
    );
  });

  it('priority => eager + fetchpriority=high', () => {
    assert.equal(
      imageHtml('/hero.jpg', media, { alt: '', context: 'hero', priority: true, width: 1920, height: 1080 }),
      '<img src="/hero.jpg" alt="" width="1920" height="1080" loading="eager" decoding="async" fetchpriority="high">',
    );
  });
});

describe('responsiveProseHtml: <img> del Markdown que son assets conocidos => <picture> de la columna', () => {
  const md = (source: string): string => renderMarkdown(source, { headingOffset: 1 }).html;

  it('reescribe la imagen conocida, conserva alt y title, con sizes de prosa y lazy', () => {
    const html = responsiveProseHtml(md('Texto\n\n![Mapa & ruta](/media/aaa/1024.webp "Título")'), media);
    assert.match(html, /<picture><source type="image\/avif"/);
    assert.match(html, /alt="Mapa &amp; ruta" title="Título"/);
    assert.match(html, new RegExp(`sizes="${IMAGE_SIZES.prose.replace(/[()]/g, '\\$&')}"`));
    assert.match(html, /loading="lazy"/);
    assert.doesNotMatch(html, /fetchpriority/);
    assert.match(html, /^<p>Texto<\/p>/);
  });

  it('deja intactas las imágenes desconocidas', () => {
    const source = md('![a](/media/otro/1.png) y ![b](https://x.com/b.png?a=1&b=2)');
    assert.equal(responsiveProseHtml(source, media), source);
  });

  it('solo coincide la URL exacta (sin prefijos ni sufijos)', () => {
    const source = md('![a](/media/aaa/1024.webp?v=2) ![b](/media/aaa/1024.webpx)');
    assert.equal(responsiveProseHtml(source, media), source);
  });

  it('escapa el alt al reescribir', () => {
    const html = responsiveProseHtml('<p><img src="/media/aaa/640.webp" alt="&lt;b&gt; &quot;x&quot;"></p>', media);
    assert.match(html, /alt="&lt;b&gt; &quot;x&quot;"/);
  });

  it('sin assets no cambia nada', () => {
    const source = md('![a](/media/aaa/1024.webp)');
    assert.equal(responsiveProseHtml(source, indexMedia([])), source);
  });
});
