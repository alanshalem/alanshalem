import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_LANG,
  LANGS,
  alternatesFor,
  articleCount,
  formatDate,
  hreflangLinks,
  interpolate,
  isLang,
  navCurrent,
  navLinks,
  ogLocale,
  paths,
  switcherLinks,
  ui,
} from '../src/lib/i18n.ts';

describe('fixed languages', () => {
  it('es (default) and en; isLang rejects the rest', () => {
    assert.deepEqual(LANGS, ['es', 'en']);
    assert.equal(DEFAULT_LANG, 'es');
    assert.ok(isLang('en'));
    assert.ok(!isLang('fr'));
    assert.ok(!isLang(undefined));
  });
});

describe('hero video button', () => {
  it('Reproducir/Pausar in Spanish, Play/Pause in English', () => {
    assert.deepEqual([ui('es').heroPlay, ui('es').heroPause], ['Reproducir', 'Pausar']);
    assert.deepEqual([ui('en').heroPlay, ui('en').heroPause], ['Play', 'Pause']);
  });
});

describe('UI dictionary: same keys in es and en, no empty text', () => {
  it('the keys match exactly', () => {
    assert.deepEqual(Object.keys(ui('en')).sort(), Object.keys(ui('es')).sort());
  });
  for (const lang of LANGS) {
    it(`${lang}: no empty value`, () => {
      for (const [key, value] of Object.entries(ui(lang))) {
        assert.ok(typeof value === 'string' && value.trim() !== '', `${lang}.${key} is empty`);
      }
    });
  }
  it('the {x} placeholders of each key are the same in both languages', () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
    for (const [key, value] of Object.entries(ui('es'))) {
      assert.deepEqual(placeholders(ui('en')[key as keyof ReturnType<typeof ui>]), placeholders(value), key);
    }
  });
});

describe('routes per language', () => {
  it('es: /es/, /es/articulos/<slug>/, /es/temas/, /es/temas/<tag>/, /es/rss.xml', () => {
    assert.equal(paths.home('es'), '/es/');
    assert.equal(paths.posts('es'), '/es/articulos/');
    assert.equal(paths.post('es', 'mi-post'), '/es/articulos/mi-post/');
    assert.equal(paths.tags('es'), '/es/temas/');
    assert.equal(paths.tag('es', 'dotnet'), '/es/temas/dotnet/');
    assert.equal(paths.rss('es'), '/es/rss.xml');
    assert.equal(paths.rssStyle('es'), '/es/rss.css');
  });
  it('en: /en/, /en/articles/<slug>/, /en/topics/, /en/topics/<tag>/, /en/rss.xml', () => {
    assert.equal(paths.home('en'), '/en/');
    assert.equal(paths.posts('en'), '/en/articles/');
    assert.equal(paths.post('en', 'my-post'), '/en/articles/my-post/');
    assert.equal(paths.tags('en'), '/en/topics/');
    assert.equal(paths.tag('en', 'dotnet'), '/en/topics/dotnet/');
    assert.equal(paths.rss('en'), '/en/rss.xml');
    assert.equal(paths.rssStyle('en'), '/en/rss.css');
  });
  it('alternatesFor: the same page in each language', () => {
    assert.deepEqual(alternatesFor(paths.posts), { es: '/es/articulos/', en: '/en/articles/' });
  });
  it('navLinks: the language articles, topics and RSS; RSS says what it is (with "RSS" first, WCAG 2.5.3)', () => {
    assert.deepEqual(navLinks('en'), [
      { label: 'Articles', href: '/en/articles/' },
      { label: 'Topics', href: '/en/topics/' },
      { label: 'RSS', href: '/en/rss.xml', ariaLabel: 'RSS: feed of new articles' },
    ]);
    assert.equal(navLinks('es')[2]?.ariaLabel, 'RSS: feed de artículos nuevos');
  });
  it('navCurrent: the link page is "page"; a page inside its section (an article, a topic) is "true"', () => {
    assert.equal(navCurrent('/es/articulos/', '/es/articulos/'), 'page');
    assert.equal(navCurrent('/es/articulos/mi-post/', '/es/articulos/'), 'true');
    assert.equal(navCurrent('/en/topics/dotnet/', '/en/topics/'), 'true');
    assert.equal(navCurrent('/es/', '/es/articulos/'), undefined);
    assert.equal(navCurrent('/es/temas/', '/es/articulos/'), undefined);
  });
});

describe('ES | EN switcher', () => {
  it('leads to the equivalent version when it exists', () => {
    assert.deepEqual(switcherLinks('es', { es: '/es/articulos/hola/', en: '/en/articles/hello/' }), [
      { lang: 'es', href: '/es/articulos/hola/', current: true },
      { lang: 'en', href: '/en/articles/hello/', current: false },
    ]);
  });
  it('without a translation: the other language home', () => {
    assert.deepEqual(switcherLinks('es', { es: '/es/articulos/solo/' }).map((l) => l.href), ['/es/articulos/solo/', '/en/']);
  });
  it('accepts another fallback target (topic → the other language topics index)', () => {
    assert.deepEqual(switcherLinks('en', { en: '/en/topics/net/' }, paths.tags).map((l) => l.href), ['/es/temas/', '/en/topics/net/']);
  });
});

describe('hreflang', () => {
  it('with every version: one per language plus x-default → Spanish', () => {
    assert.deepEqual(hreflangLinks({ es: '/es/', en: '/en/' }), [
      { hreflang: 'es', href: '/es/' },
      { hreflang: 'en', href: '/en/' },
      { hreflang: 'x-default', href: '/es/' },
    ]);
  });
  it('a single version: nothing (there is no alternate to announce)', () => {
    assert.deepEqual(hreflangLinks({ en: '/en/articles/x/' }), []);
    assert.deepEqual(hreflangLinks({}), []);
  });
});

describe('texts with data', () => {
  it('interpolate replaces {key}', () => {
    assert.equal(interpolate('{n} min de lectura', { n: 4 }), '4 min de lectura');
  });
  it('articleCount: singular and plural per language', () => {
    assert.equal(articleCount('es', 1), '1 artículo');
    assert.equal(articleCount('es', 3), '3 artículos');
    assert.equal(articleCount('en', 1), '1 article');
    assert.equal(articleCount('en', 0), '0 articles');
  });
  it('dates and og:locale per language (es-AR / en-US)', () => {
    const date = new Date('2026-03-05T15:00:00Z');
    assert.equal(formatDate('es', date), '5 de marzo de 2026');
    assert.equal(formatDate('en', date), 'March 5, 2026');
    assert.equal(ogLocale('es'), 'es_AR');
    assert.equal(ogLocale('en'), 'en_US');
  });
});
