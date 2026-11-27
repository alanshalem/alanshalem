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

describe('IMAGE_SIZES: one `sizes` per design context', () => {
  it('full-screen hero, prose in the 640px column', () => {
    assert.equal(IMAGE_SIZES.hero, '100vw');
    assert.equal(IMAGE_SIZES.prose, '(min-width: 640px) 640px, 100vw');
    assert.match(IMAGE_SIZES.card, /100vw$/);
    assert.match(IMAGE_SIZES.lead, /100vw$/);
  });
});

describe('imageHtml: AVIF + WebP <picture> for known assets', () => {
  it('builds both sources with a full srcset and the context sizes; <img> = asset.url with its size', () => {
    const html = imageHtml('/media/aaa/1600.webp', media, { alt: 'A lighthouse', context: 'card', ...box });
    assert.equal(
      html,
      '<picture>' +
        `<source type="image/avif" srcset="${AVIF}" sizes="${IMAGE_SIZES.card}">` +
        `<source type="image/webp" srcset="${WEBP}" sizes="${IMAGE_SIZES.card}">` +
        '<img src="/media/aaa/1600.webp" alt="A lighthouse" width="2000" height="1125" loading="lazy" decoding="async"' +
        ' style="background-color:#336699">' +
        '</picture>',
    );
  });

  it('recognizes the asset by the URL of any variant', () => {
    const html = imageHtml('/media/aaa/640.avif', media, { alt: '', context: 'lead', ...box });
    assert.match(html, /^<picture>/);
    assert.match(html, /<img src="\/media\/aaa\/1600\.webp"/);
  });

  it('priority => eager + fetchpriority=high (hero / first visible image only)', () => {
    const html = imageHtml('/media/aaa/1600.webp', media, { alt: '', context: 'hero', priority: true, ...box });
    assert.match(html, /loading="eager" decoding="async" fetchpriority="high"/);
    assert.match(html, /sizes="100vw"/);
    assert.doesNotMatch(html, /loading="lazy"/);
  });

  it('escapes alt and title', () => {
    const html = imageHtml('/media/aaa/1600.webp', media, {
      alt: '"><script>alert(1)</script>',
      title: 'a & "b"',
      context: 'prose',
      ...box,
    });
    assert.match(html, /alt="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;" title="a &amp; &quot;b&quot;"/);
    assert.doesNotMatch(html, /<script/);
  });

  it('a color that is not #rrggbb is not emitted as a style', () => {
    const odd = indexMedia([mediaAsset('bbb', { color: 'red;background:url(x)' })]);
    const html = imageHtml('/media/bbb/1600.webp', odd, { alt: '', context: 'card', ...box });
    assert.doesNotMatch(html, /style=/);
  });

  it('without AVIF variants it emits no empty AVIF <source>', () => {
    const webpOnly = mediaAsset('ccc', { variants: [{ format: 'webp', width: 640, url: '/media/ccc/640.webp' }] });
    const html = imageHtml('/media/ccc/1600.webp', indexMedia([webpOnly]), { alt: '', context: 'card', ...box });
    assert.doesNotMatch(html, /image\/avif/);
    assert.match(html, /<source type="image\/webp" srcset="\/media\/ccc\/640\.webp 640w"/);
  });
});

describe('imageHtml: unknown URL => the usual plain <img>', () => {
  it('keeps src, alt and the reserved box; lazy by default', () => {
    assert.equal(
      imageHtml('https://cdn.example.com/a.jpg?x=1&y=2', media, { alt: 'Photo', context: 'card', ...box }),
      '<img src="https://cdn.example.com/a.jpg?x=1&amp;y=2" alt="Photo" width="1600" height="1000" loading="lazy" decoding="async">',
    );
  });

  it('priority => eager + fetchpriority=high', () => {
    assert.equal(
      imageHtml('/hero.jpg', media, { alt: '', context: 'hero', priority: true, width: 1920, height: 1080 }),
      '<img src="/hero.jpg" alt="" width="1920" height="1080" loading="eager" decoding="async" fetchpriority="high">',
    );
  });
});

describe('responsiveProseHtml: Markdown <img>s that are known assets => a <picture> for the column', () => {
  const md = (source: string): string => renderMarkdown(source, { headingOffset: 1 }).html;

  it('rewrites the known image, keeps alt and title, with prose sizes and lazy', () => {
    const html = responsiveProseHtml(md('Text\n\n![Map & route](/media/aaa/1024.webp "Title")'), media);
    assert.match(html, /<picture><source type="image\/avif"/);
    assert.match(html, /alt="Map &amp; route" title="Title"/);
    assert.match(html, new RegExp(`sizes="${IMAGE_SIZES.prose.replace(/[()]/g, '\\$&')}"`));
    assert.match(html, /loading="lazy"/);
    assert.doesNotMatch(html, /fetchpriority/);
    assert.match(html, /^<p>Text<\/p>/);
  });

  it('leaves unknown images untouched', () => {
    const source = md('![a](/media/other/1.png) and ![b](https://x.com/b.png?a=1&b=2)');
    assert.equal(responsiveProseHtml(source, media), source);
  });

  it('only the exact URL matches (no prefixes or suffixes)', () => {
    const source = md('![a](/media/aaa/1024.webp?v=2) ![b](/media/aaa/1024.webpx)');
    assert.equal(responsiveProseHtml(source, media), source);
  });

  it('escapes the alt when rewriting', () => {
    const html = responsiveProseHtml('<p><img src="/media/aaa/640.webp" alt="&lt;b&gt; &quot;x&quot;"></p>', media);
    assert.match(html, /alt="&lt;b&gt; &quot;x&quot;"/);
  });

  it('without assets nothing changes', () => {
    const source = md('![a](/media/aaa/1024.webp)');
    assert.equal(responsiveProseHtml(source, indexMedia([])), source);
  });
});
