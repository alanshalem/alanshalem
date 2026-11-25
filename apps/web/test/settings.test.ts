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

describe('toSiteSettings: nameEn en /en/, con respaldo en el nombre en español (S7, L6)', () => {
  it('en usa nameEn para el nombre y el autor del pie', () => {
    const s = toSiteSettings({ name: 'Blog de Ana', nameEn: "Ana's blog" }, env, 'en');
    assert.equal(s.name, "Ana's blog");
    assert.equal(s.author, "Ana's blog");
  });
  it('es ignora nameEn', () => {
    assert.equal(toSiteSettings({ name: 'Blog de Ana', nameEn: "Ana's blog" }, env, 'es').name, 'Blog de Ana');
  });
  it('en sin nameEn (nulo o en blanco) usa name, y después SITE_NAME', () => {
    assert.equal(toSiteSettings({ name: 'Blog de Ana', nameEn: ' ' }, env, 'en').name, 'Blog de Ana');
    assert.equal(toSiteSettings({ nameEn: null }, env, 'en').name, 'Nombre env');
  });
  it('los respaldos visibles sin API ni entorno van en el idioma de la página', () => {
    const s = toSiteSettings({}, {}, 'en');
    assert.equal(s.name, 'My blog');
    assert.equal(s.author, 'The author');
  });
});
