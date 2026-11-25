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
  navLinks,
  ogLocale,
  paths,
  switcherLinks,
  ui,
} from '../src/lib/i18n.ts';

describe('idiomas fijos (L3)', () => {
  it('es (por defecto) y en; isLang rechaza el resto', () => {
    assert.deepEqual(LANGS, ['es', 'en']);
    assert.equal(DEFAULT_LANG, 'es');
    assert.ok(isLang('en'));
    assert.ok(!isLang('fr'));
    assert.ok(!isLang(undefined));
  });
});

describe('botón del video del hero (S1, L3)', () => {
  it('Reproducir/Pausar en español, Play/Pause en inglés', () => {
    assert.deepEqual([ui('es').heroPlay, ui('es').heroPause], ['Reproducir', 'Pausar']);
    assert.deepEqual([ui('en').heroPlay, ui('en').heroPause], ['Play', 'Pause']);
  });
});

describe('diccionario de UI: mismas claves en es y en, ningún texto vacío (L3)', () => {
  it('las claves coinciden exactamente', () => {
    assert.deepEqual(Object.keys(ui('en')).sort(), Object.keys(ui('es')).sort());
  });
  for (const lang of LANGS) {
    it(`${lang}: ningún valor vacío`, () => {
      for (const [key, value] of Object.entries(ui(lang))) {
        assert.ok(typeof value === 'string' && value.trim() !== '', `${lang}.${key} está vacío`);
      }
    });
  }
  it('los placeholders {x} de cada clave son los mismos en los dos idiomas', () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
    for (const [key, value] of Object.entries(ui('es'))) {
      assert.deepEqual(placeholders(ui('en')[key as keyof ReturnType<typeof ui>]), placeholders(value), key);
    }
  });
});

describe('rutas por idioma (L3)', () => {
  it('es: /es/, /es/articulos/<slug>/, /es/temas/, /es/temas/<tag>/, /es/rss.xml', () => {
    assert.equal(paths.home('es'), '/es/');
    assert.equal(paths.posts('es'), '/es/articulos/');
    assert.equal(paths.post('es', 'mi-post'), '/es/articulos/mi-post/');
    assert.equal(paths.tags('es'), '/es/temas/');
    assert.equal(paths.tag('es', 'dotnet'), '/es/temas/dotnet/');
    assert.equal(paths.rss('es'), '/es/rss.xml');
  });
  it('en: /en/, /en/articles/<slug>/, /en/topics/, /en/topics/<tag>/, /en/rss.xml', () => {
    assert.equal(paths.home('en'), '/en/');
    assert.equal(paths.posts('en'), '/en/articles/');
    assert.equal(paths.post('en', 'my-post'), '/en/articles/my-post/');
    assert.equal(paths.tags('en'), '/en/topics/');
    assert.equal(paths.tag('en', 'dotnet'), '/en/topics/dotnet/');
    assert.equal(paths.rss('en'), '/en/rss.xml');
  });
  it('alternatesFor: la misma página en cada idioma', () => {
    assert.deepEqual(alternatesFor(paths.posts), { es: '/es/articulos/', en: '/en/articles/' });
  });
  it('navLinks: artículos, temas y RSS del idioma', () => {
    assert.deepEqual(navLinks('en'), [
      { label: 'Articles', href: '/en/articles/' },
      { label: 'Topics', href: '/en/topics/' },
      { label: 'RSS', href: '/en/rss.xml' },
    ]);
  });
});

describe('selector ES | EN (L3)', () => {
  it('lleva a la versión equivalente si existe', () => {
    assert.deepEqual(switcherLinks('es', { es: '/es/articulos/hola/', en: '/en/articles/hello/' }), [
      { lang: 'es', href: '/es/articulos/hola/', current: true },
      { lang: 'en', href: '/en/articles/hello/', current: false },
    ]);
  });
  it('sin traducción: la home del otro idioma', () => {
    assert.deepEqual(switcherLinks('es', { es: '/es/articulos/solo/' }).map((l) => l.href), ['/es/articulos/solo/', '/en/']);
  });
  it('acepta otro destino de respaldo (tema → índice de temas del otro idioma)', () => {
    assert.deepEqual(switcherLinks('en', { en: '/en/topics/net/' }, paths.tags).map((l) => l.href), ['/es/temas/', '/en/topics/net/']);
  });
});

describe('hreflang (L3)', () => {
  it('con todas las versiones: una por idioma más x-default → español', () => {
    assert.deepEqual(hreflangLinks({ es: '/es/', en: '/en/' }), [
      { hreflang: 'es', href: '/es/' },
      { hreflang: 'en', href: '/en/' },
      { hreflang: 'x-default', href: '/es/' },
    ]);
  });
  it('una sola versión: nada (no hay alternativa que anunciar)', () => {
    assert.deepEqual(hreflangLinks({ en: '/en/articles/x/' }), []);
    assert.deepEqual(hreflangLinks({}), []);
  });
});

describe('textos con datos', () => {
  it('interpolate reemplaza {clave}', () => {
    assert.equal(interpolate('{n} min de lectura', { n: 4 }), '4 min de lectura');
  });
  it('articleCount: singular y plural por idioma', () => {
    assert.equal(articleCount('es', 1), '1 artículo');
    assert.equal(articleCount('es', 3), '3 artículos');
    assert.equal(articleCount('en', 1), '1 article');
    assert.equal(articleCount('en', 0), '0 articles');
  });
  it('fechas y og:locale por idioma (es-AR / en-US)', () => {
    const date = new Date('2026-03-05T15:00:00Z');
    assert.equal(formatDate('es', date), '5 de marzo de 2026');
    assert.equal(formatDate('en', date), 'March 5, 2026');
    assert.equal(ogLocale('es'), 'es_AR');
    assert.equal(ogLocale('en'), 'en_US');
  });
});
