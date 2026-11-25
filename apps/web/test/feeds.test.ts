import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rssXml, sitemapXml } from '../src/lib/feeds.ts';
import { toBlogPost } from '../src/lib/posts.ts';

const BASE = 'https://blog.test';

const post = toBlogPost({
  id: 'p1',
  slug: 'hello',
  title: 'Hello & <welcome>',
  summary: 'A "short" summary',
  body: '![x](/media/a.webp)\n\nText with [a link](/en/topics/net/).',
  tags: [],
  lang: 'en',
  translationGroupId: 'g1',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-02T10:00:00Z',
  publishedAt: '2026-11-01T12:00:00Z',
});

describe('rssXml: un feed por idioma (L3)', () => {
  const xml = rssXml({ lang: 'en', title: 'Ana · Articles', description: 'I write.', posts: [post], baseUrl: BASE });

  it('canal con título, descripción, idioma y self del idioma', () => {
    assert.match(xml, /<title>Ana · Articles<\/title>/);
    assert.match(xml, /<description>I write\.<\/description>/);
    assert.match(xml, /<language>en<\/language>/);
    assert.match(xml, /<link>https:\/\/blog\.test\/en\/<\/link>/);
    assert.match(xml, /<atom:link href="https:\/\/blog\.test\/en\/rss\.xml" rel="self"/);
  });
  it('ítems con URL absoluta del idioma, texto escapado y URLs del cuerpo absolutas', () => {
    assert.match(xml, /<link>https:\/\/blog\.test\/en\/articles\/hello\/<\/link>/);
    assert.match(xml, /<title>Hello &amp; &lt;welcome&gt;<\/title>/);
    assert.match(xml, /<description>A &quot;short&quot; summary<\/description>/);
    assert.match(xml, /src="https:\/\/blog\.test\/media\/a\.webp"/);
    assert.match(xml, /href="https:\/\/blog\.test\/en\/topics\/net\/"/);
  });
});

describe('sitemapXml: todas las páginas, con alternates hreflang donde hay versiones (L3)', () => {
  const xml = sitemapXml(
    [
      { path: '/es/', alternates: { es: '/es/', en: '/en/' }, lastmod: new Date('2026-11-02T10:00:00Z') },
      { path: '/es/temas/net/' },
    ],
    BASE,
  );

  it('declara el espacio xhtml y una <url> por página', () => {
    assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
    assert.equal(xml.match(/<url>/g)?.length, 2);
    assert.match(xml, /<loc>https:\/\/blog\.test\/es\/<\/loc><lastmod>2026-11-02T10:00:00\.000Z<\/lastmod>/);
  });
  it('alternates absolutos con x-default solo en las páginas que los tienen', () => {
    assert.match(xml, /<xhtml:link rel="alternate" hreflang="en" href="https:\/\/blog\.test\/en\/"\/>/);
    assert.match(xml, /<xhtml:link rel="alternate" hreflang="x-default" href="https:\/\/blog\.test\/es\/"\/>/);
    assert.match(xml, /<url><loc>https:\/\/blog\.test\/es\/temas\/net\/<\/loc><\/url>/);
  });
});
