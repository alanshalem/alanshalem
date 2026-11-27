import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rssStylesheet, rssXml, sitemapXml } from '../src/lib/feeds.ts';
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

describe('rssXml: one feed per language', () => {
  const xml = rssXml({ lang: 'en', title: 'Ana · Articles', description: 'I write.', posts: [post], baseUrl: BASE });

  it('channel with title, description, language and the language self link', () => {
    assert.match(xml, /<title>Ana · Articles<\/title>/);
    assert.match(xml, /<description>I write\.<\/description>/);
    assert.match(xml, /<language>en<\/language>/);
    assert.match(xml, /<link>https:\/\/blog\.test\/en\/<\/link>/);
    assert.match(xml, /<atom:link href="https:\/\/blog\.test\/en\/rss\.xml" rel="self"/);
  });
  it('a CSS stylesheet of the language to view it in a browser (feed readers ignore it)', () => {
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/css" href="/en/rss.css"?>\n<rss '));
  });
  it('items with the language absolute URL, escaped text and absolute body URLs', () => {
    assert.match(xml, /<link>https:\/\/blog\.test\/en\/articles\/hello\/<\/link>/);
    assert.match(xml, /<title>Hello &amp; &lt;welcome&gt;<\/title>/);
    assert.match(xml, /<description>A &quot;short&quot; summary<\/description>/);
    assert.match(xml, /src="https:\/\/blog\.test\/media\/a\.webp"/);
    assert.match(xml, /href="https:\/\/blog\.test\/en\/topics\/net\/"/);
  });
});

describe('sitemapXml: every page, with hreflang alternates where there are versions', () => {
  const xml = sitemapXml(
    [
      { path: '/es/', alternates: { es: '/es/', en: '/en/' }, lastmod: new Date('2026-11-02T10:00:00Z') },
      { path: '/es/temas/net/' },
    ],
    BASE,
  );

  it('declares the xhtml namespace and one <url> per page', () => {
    assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
    assert.equal(xml.match(/<url>/g)?.length, 2);
    assert.match(xml, /<loc>https:\/\/blog\.test\/es\/<\/loc><lastmod>2026-11-02T10:00:00\.000Z<\/lastmod>/);
  });
  it('absolute alternates with x-default only on the pages that have them', () => {
    assert.match(xml, /<xhtml:link rel="alternate" hreflang="en" href="https:\/\/blog\.test\/en\/"\/>/);
    assert.match(xml, /<xhtml:link rel="alternate" hreflang="x-default" href="https:\/\/blog\.test\/es\/"\/>/);
    assert.match(xml, /<url><loc>https:\/\/blog\.test\/es\/temas\/net\/<\/loc><\/url>/);
  });
});

describe('rssStylesheet: the feed readable in a browser', () => {
  const TOKENS = ':root { --bg-page: #0a0a0b; }';

  it('starts from the site tokens and explains what it is, in the feed language', () => {
    const es = rssStylesheet('es', TOKENS);
    assert.ok(es.startsWith(TOKENS));
    assert.match(es, /content: "Esto es un feed RSS: copiá la dirección de esta página en tu lector de feeds para recibir los artículos nuevos\.";/);
    assert.match(rssStylesheet('en', TOKENS), /content: "This is an RSS feed: copy this page's address into your feed reader to get new articles\.";/);
  });

  it('shows each article title, date and summary; hides the full HTML and the technical data', () => {
    const css = rssStylesheet('es', TOKENS);
    assert.match(css, /rss \* \{ display: none; \}/);
    assert.match(css, /item > title, item > pubDate, item > description, item > link \{[^}]*display: block;/);
  });
});
