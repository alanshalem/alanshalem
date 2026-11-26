import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contactLinks, toSiteSettings } from '../src/lib/settings.ts';

const env = { SITE_NAME: 'Nombre env', SITE_TAGLINE: 'Tagline env', SITE_AUTHOR: 'Autor env' };

describe('toSiteSettings: la API manda; el entorno solo cubre lo vacío (L4)', () => {
  it('usa los valores de la API cuando vienen', () => {
    const s = toSiteSettings(
      {
        name: 'Ana Pérez',
        tagline: 'Escribo sobre sistemas.',
        bio: 'Hola, soy **Ana**.',
        email: 'ana@example.com',
        githubUrl: 'https://github.com/ana',
        linkedinUrl: null,
        xUrl: '',
      },
      env,
    );
    assert.deepEqual(s, {
      name: 'Ana Pérez',
      tagline: 'Escribo sobre sistemas.',
      author: 'Ana Pérez',
      bio: 'Hola, soy **Ana**.',
      email: 'ana@example.com',
      githubUrl: 'https://github.com/ana',
      linkedinUrl: null,
      xUrl: null,
    });
  });

  it('cae a SITE_NAME / SITE_TAGLINE / SITE_AUTHOR cuando la API trae vacío', () => {
    const s = toSiteSettings({ name: '  ', tagline: null }, env);
    assert.equal(s.name, 'Nombre env');
    assert.equal(s.tagline, 'Tagline env');
    assert.equal(s.author, 'Autor env');
    assert.equal(s.bio, null);
    assert.equal(s.email, null);
  });

  it('sin API ni entorno usa los valores por defecto de siempre', () => {
    const s = toSiteSettings({}, {});
    assert.equal(s.name, 'Mi blog');
    assert.equal(s.tagline, 'Notas sobre software, ideas y cosas que estoy aprendiendo.');
    assert.equal(s.author, 'El autor');
  });

  it('descarta URLs inseguras o que no son http(s)', () => {
    const s = toSiteSettings(
      { name: 'X', githubUrl: 'javascript:alert(1)', xUrl: 'ftp://x' },
      {},
    );
    assert.equal(s.githubUrl, null);
    assert.equal(s.xUrl, null);
  });
});

describe('contactLinks', () => {
  it('solo los presentes, en orden: email, GitHub, LinkedIn, X', () => {
    const s = toSiteSettings({ name: 'X', email: 'a@b.com', xUrl: 'https://x.com/a', linkedinUrl: 'https://linkedin.com/in/a' }, {});
    assert.deepEqual(contactLinks(s), [
      { label: 'a@b.com', href: 'mailto:a@b.com' },
      { label: 'LinkedIn', href: 'https://linkedin.com/in/a' },
      { label: 'X', href: 'https://x.com/a' },
    ]);
    assert.deepEqual(contactLinks(toSiteSettings({ name: 'X' }, {})), []);
  });
});

describe('toSiteSettings por idioma: taglineEn / bioEn en /en/, con respaldo en español (L3, L4)', () => {
  const api = { name: 'Ana', tagline: 'Escribo sobre sistemas.', bio: 'Hola.', taglineEn: 'I write about systems.', bioEn: 'Hi.' };

  it('en usa los campos en inglés', () => {
    const s = toSiteSettings(api, env, 'en');
    assert.equal(s.tagline, 'I write about systems.');
    assert.equal(s.bio, 'Hi.');
    assert.equal(s.name, 'Ana');
  });
  it('es ignora los campos en inglés', () => {
    const s = toSiteSettings(api, env, 'es');
    assert.equal(s.tagline, 'Escribo sobre sistemas.');
    assert.equal(s.bio, 'Hola.');
  });
  it('en sin textos en inglés (nulos o en blanco) usa los de español', () => {
    const s = toSiteSettings({ ...api, taglineEn: null, bioEn: '  ' }, env, 'en');
    assert.equal(s.tagline, 'Escribo sobre sistemas.');
    assert.equal(s.bio, 'Hola.');
  });
  it('sin ninguna bajada, la de respaldo va en el idioma de la página', () => {
    assert.equal(toSiteSettings({}, {}, 'en').tagline, 'Notes on software, ideas and things I am learning.');
    assert.equal(toSiteSettings({}, {}, 'es').tagline, 'Notas sobre software, ideas y cosas que estoy aprendiendo.');
  });
});

describe('toSiteSettings: el nombre es uno solo en los dos idiomas (S7, L12)', () => {
  it('/en/ usa el mismo nombre y autor del pie que /es/ (marca, H1, pie, <title>, og:site_name y RSS)', () => {
    const en = toSiteSettings({ name: ' Blog de Ana ' }, env, 'en');
    const es = toSiteSettings({ name: ' Blog de Ana ' }, env, 'es');
    assert.deepEqual([en.name, en.author], ['Blog de Ana', 'Blog de Ana']);
    assert.deepEqual([es.name, es.author], [en.name, en.author]);
  });
  it('un nameEn que todavía mande una API vieja no cambia nada', () => {
    const legacy = { name: 'Blog de Ana', nameEn: "Ana's blog" };
    assert.equal(toSiteSettings(legacy, env, 'en').name, 'Blog de Ana');
    assert.equal(toSiteSettings(legacy, env, 'en').author, 'Blog de Ana');
  });
  it('en sin name usa SITE_NAME, igual que es', () => {
    assert.equal(toSiteSettings({ name: ' ' }, env, 'en').name, 'Nombre env');
    assert.equal(toSiteSettings({}, env, 'es').name, 'Nombre env');
  });
  it('los respaldos visibles sin API ni entorno van en el idioma de la página', () => {
    const s = toSiteSettings({}, {}, 'en');
    assert.equal(s.name, 'My blog');
    assert.equal(s.author, 'The author');
  });
});
