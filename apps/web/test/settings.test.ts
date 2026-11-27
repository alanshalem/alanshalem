import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contactLinks, toSiteSettings, type ApiSettings } from '../src/lib/settings.ts';

/** The minimum the API always sends: the name is required (SiteSettingsContent.Create enforces it). */
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

describe('toSiteSettings: the settings come from the API', () => {
  it('uses the API values when they come', () => {
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

  it('the name arrives trimmed; without a tagline it uses the dictionary one; empty bio and email become null', () => {
    const s = toSiteSettings(api({ name: '  Ana  ', tagline: '  ', bio: '', email: ' ' }));
    assert.equal(s.name, 'Ana');
    assert.equal(s.tagline, 'Notas sobre software, ideas y cosas que estoy aprendiendo.');
    assert.equal(s.bio, null);
    assert.equal(s.email, null);
  });

  it('there is no SITE_NAME / SITE_TAGLINE / SITE_AUTHOR fallback anymore: the build environment changes nothing', () => {
    const saved = { ...process.env };
    Object.assign(process.env, { SITE_NAME: 'Env name', SITE_TAGLINE: 'Env tagline', SITE_AUTHOR: 'Env author' });
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

  it('an API without a name breaks the contract: the build fails (and the builder keeps the published site)', () => {
    assert.throws(
      () => toSiteSettings(api({ name: '  ' })),
      { message: 'The API returned the site settings without a name.' },
    );
  });

  it('discards unsafe or non-http(s) URLs', () => {
    const s = toSiteSettings(api({ githubUrl: 'javascript:alert(1)', xUrl: 'ftp://x' }));
    assert.equal(s.githubUrl, null);
    assert.equal(s.xUrl, null);
  });
});

describe('contactLinks', () => {
  it('only the present ones, in order: email, GitHub, LinkedIn, X', () => {
    const s = toSiteSettings(api({ email: 'a@b.com', xUrl: 'https://x.com/a', linkedinUrl: 'https://linkedin.com/in/a' }));
    assert.deepEqual(contactLinks(s), [
      { label: 'a@b.com', href: 'mailto:a@b.com' },
      { label: 'LinkedIn', href: 'https://linkedin.com/in/a' },
      { label: 'X', href: 'https://x.com/a' },
    ]);
    assert.deepEqual(contactLinks(toSiteSettings(api())), []);
  });
});

describe('toSiteSettings per language: taglineEn / bioEn on /en/, with a Spanish fallback', () => {
  const bilingual = api({ name: 'Ana', tagline: 'Escribo sobre sistemas.', bio: 'Hola.', taglineEn: 'I write about systems.', bioEn: 'Hi.' });

  it('en uses the English fields', () => {
    const s = toSiteSettings(bilingual, 'en');
    assert.equal(s.tagline, 'I write about systems.');
    assert.equal(s.bio, 'Hi.');
    assert.equal(s.name, 'Ana');
  });
  it('es ignores the English fields', () => {
    const s = toSiteSettings(bilingual, 'es');
    assert.equal(s.tagline, 'Escribo sobre sistemas.');
    assert.equal(s.bio, 'Hola.');
  });
  it('en without English texts (null or blank) uses the Spanish ones', () => {
    const s = toSiteSettings({ ...bilingual, taglineEn: null, bioEn: '  ' }, 'en');
    assert.equal(s.tagline, 'Escribo sobre sistemas.');
    assert.equal(s.bio, 'Hola.');
  });
  it('without any tagline, the fallback one is in the page language', () => {
    assert.equal(toSiteSettings(api(), 'en').tagline, 'Notes on software, ideas and things I am learning.');
    assert.equal(toSiteSettings(api(), 'es').tagline, 'Notas sobre software, ideas y cosas que estoy aprendiendo.');
  });
});

describe('toSiteSettings: the name is one for both languages', () => {
  it('/en/ uses the same name as /es/ (brand, H1, footer "© year …", <title>, og:site_name and RSS)', () => {
    const en = toSiteSettings(api({ name: ' Blog de Ana ' }), 'en');
    const es = toSiteSettings(api({ name: ' Blog de Ana ' }), 'es');
    assert.equal(en.name, 'Blog de Ana');
    assert.equal(es.name, en.name);
  });
  it('a nameEn still sent by an old API changes nothing', () => {
    const legacy = { ...api({ name: 'Blog de Ana' }), nameEn: "Ana's blog" };
    assert.equal(toSiteSettings(legacy, 'en').name, 'Blog de Ana');
  });
});
