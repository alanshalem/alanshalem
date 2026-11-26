import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contactLinks, toSiteSettings, type ApiSettings } from '../src/lib/settings.ts';

/** Lo mínimo que la API siempre manda: el nombre es obligatorio (SiteSettingsContent.Create lo exige). */
const api = (overrides: Partial<ApiSettings> = {}): ApiSettings => ({
  name: 'Ana Pérez',
  tagline: null,
  bio: null,
  email: null,
  githubUrl: null,
  linkedinUrl: null,
  xUrl: null,
  ...overrides,
});

describe('toSiteSettings: los ajustes salen de la API (L4)', () => {
  it('usa los valores de la API cuando vienen', () => {
    const s = toSiteSettings(
      api({
        tagline: 'Escribo sobre sistemas.',
        bio: 'Hola, soy **Ana**.',
        email: 'ana@example.com',
        githubUrl: 'https://github.com/ana',
        xUrl: '',
      }),
    );
    assert.deepEqual(s, {
      name: 'Ana Pérez',
      tagline: 'Escribo sobre sistemas.',
      bio: 'Hola, soy **Ana**.',
      email: 'ana@example.com',
      githubUrl: 'https://github.com/ana',
      linkedinUrl: null,
      xUrl: null,
    });
  });

  it('el nombre llega recortado; sin bajada usa la del diccionario; bio y email vacíos quedan en null', () => {
    const s = toSiteSettings(api({ name: '  Ana  ', tagline: '  ', bio: '', email: ' ' }));
    assert.equal(s.name, 'Ana');
    assert.equal(s.tagline, 'Notas sobre software, ideas y cosas que estoy aprendiendo.');
    assert.equal(s.bio, null);
    assert.equal(s.email, null);
  });

  it('ya no hay respaldo SITE_NAME / SITE_TAGLINE / SITE_AUTHOR: el entorno del build no cambia nada', () => {
    const saved = { ...process.env };
    Object.assign(process.env, { SITE_NAME: 'Nombre env', SITE_TAGLINE: 'Tagline env', SITE_AUTHOR: 'Autor env' });
    try {
      const s = toSiteSettings(api({ tagline: null }));
      assert.equal(s.name, 'Ana Pérez');
      assert.equal(s.tagline, 'Notas sobre software, ideas y cosas que estoy aprendiendo.');
    } finally {
      for (const key of ['SITE_NAME', 'SITE_TAGLINE', 'SITE_AUTHOR']) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });

  it('una API sin nombre rompe el contrato: el build falla (y el builder conserva el sitio publicado)', () => {
    assert.throws(
      () => toSiteSettings(api({ name: '  ' })),
      { message: 'La API devolvió los ajustes del sitio sin nombre.' },
    );
  });

  it('descarta URLs inseguras o que no son http(s)', () => {
    const s = toSiteSettings(api({ githubUrl: 'javascript:alert(1)', xUrl: 'ftp://x' }));
    assert.equal(s.githubUrl, null);
    assert.equal(s.xUrl, null);
  });
});

describe('contactLinks', () => {
  it('solo los presentes, en orden: email, GitHub, LinkedIn, X', () => {
    const s = toSiteSettings(api({ email: 'a@b.com', xUrl: 'https://x.com/a', linkedinUrl: 'https://linkedin.com/in/a' }));
    assert.deepEqual(contactLinks(s), [
      { label: 'a@b.com', href: 'mailto:a@b.com' },
      { label: 'LinkedIn', href: 'https://linkedin.com/in/a' },
      { label: 'X', href: 'https://x.com/a' },
    ]);
    assert.deepEqual(contactLinks(toSiteSettings(api())), []);
  });
});

describe('toSiteSettings por idioma: taglineEn / bioEn en /en/, con respaldo en español (L3, L4)', () => {
  const bilingual = api({ name: 'Ana', tagline: 'Escribo sobre sistemas.', bio: 'Hola.', taglineEn: 'I write about systems.', bioEn: 'Hi.' });

  it('en usa los campos en inglés', () => {
    const s = toSiteSettings(bilingual, 'en');
    assert.equal(s.tagline, 'I write about systems.');
    assert.equal(s.bio, 'Hi.');
    assert.equal(s.name, 'Ana');
  });
  it('es ignora los campos en inglés', () => {
    const s = toSiteSettings(bilingual, 'es');
    assert.equal(s.tagline, 'Escribo sobre sistemas.');
    assert.equal(s.bio, 'Hola.');
  });
  it('en sin textos en inglés (nulos o en blanco) usa los de español', () => {
    const s = toSiteSettings({ ...bilingual, taglineEn: null, bioEn: '  ' }, 'en');
    assert.equal(s.tagline, 'Escribo sobre sistemas.');
    assert.equal(s.bio, 'Hola.');
  });
  it('sin ninguna bajada, la de respaldo va en el idioma de la página', () => {
    assert.equal(toSiteSettings(api(), 'en').tagline, 'Notes on software, ideas and things I am learning.');
    assert.equal(toSiteSettings(api(), 'es').tagline, 'Notas sobre software, ideas y cosas que estoy aprendiendo.');
  });
});

describe('toSiteSettings: el nombre es uno solo en los dos idiomas (S7, L12)', () => {
  it('/en/ usa el mismo nombre que /es/ (marca, H1, pie "© año …", <title>, og:site_name y RSS)', () => {
    const en = toSiteSettings(api({ name: ' Blog de Ana ' }), 'en');
    const es = toSiteSettings(api({ name: ' Blog de Ana ' }), 'es');
    assert.equal(en.name, 'Blog de Ana');
    assert.equal(es.name, en.name);
  });
  it('un nameEn que todavía mande una API vieja no cambia nada', () => {
    const legacy = { ...api({ name: 'Blog de Ana' }), nameEn: "Ana's blog" };
    assert.equal(toSiteSettings(legacy, 'en').name, 'Blog de Ana');
  });
});
