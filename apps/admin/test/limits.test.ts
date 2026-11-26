import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { LIMITS } from '../src/limits.ts';

/*
 * El admin avisa antes de enviar con los mismos límites que valida la API (principio 1 de la auditoría, L4). Para que
 * no vuelvan a separarse, este test lee las constantes del dominio en C# (la autoridad) y las compara con
 * src/limits.ts: cambiar un número de cualquiera de los dos lados sin el otro lo rompe.
 */

const DOMAIN = new URL('../../api/src/Blog.Domain/', import.meta.url);

const source = (file: string): string => readFileSync(new URL(file, DOMAIN), 'utf8');

/** `public const int MaxTitleLength = 200;` (también `private`, `double` y `500_000`). */
function constant(file: string, name: string): number {
  const match = new RegExp(`\\bconst\\s+(?:int|double)\\s+${name}\\s*=\\s*([\\d_.]+)\\s*;`).exec(source(file));
  assert.ok(match?.[1], `no encontré la constante ${name} en ${file}: ¿cambió de nombre en la API?`);
  return Number(match[1].replaceAll('_', ''));
}

/** `FadeDurations { get; } = [0.5, 1, 2];` */
function numberList(file: string, name: string): number[] {
  const match = new RegExp(`\\b${name}\\s*\\{\\s*get;\\s*\\}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source(file));
  assert.ok(match?.[1], `no encontré la lista ${name} en ${file}`);
  return match[1].split(',').map((item) => Number(item.trim()));
}

describe('LIMITS: los mismos números que el dominio de la API', () => {
  it('post (PostContent, Slug)', () => {
    assert.deepEqual(LIMITS.post, {
      title: constant('PostContent.cs', 'MaxTitleLength'),
      slug: constant('Slug.cs', 'MaxLength'),
      summary: constant('PostContent.cs', 'MaxSummaryLength'),
      coverAlt: constant('PostContent.cs', 'MaxCoverAltLength'),
    });
  });

  it('ajustes del sitio (SiteSettingsContent) y URLs (WebUrl)', () => {
    assert.deepEqual(LIMITS.settings, {
      name: constant('SiteSettings.cs', 'MaxNameLength'),
      tagline: constant('SiteSettings.cs', 'MaxTaglineLength'),
      bio: constant('SiteSettings.cs', 'MaxBioLength'),
      email: constant('SiteSettings.cs', 'MaxEmailLength'),
    });
    assert.equal(LIMITS.url, constant('WebUrl.cs', 'MaxLength'));
  });

  it('textos de un ítem del hero (HeroImageContent)', () => {
    assert.deepEqual(LIMITS.heroImage, {
      alt: constant('HeroImage.cs', 'MaxAltLength'),
      credit: constant('HeroImage.cs', 'MaxCreditLength'),
    });
  });

  it('tamaño del hero (HeroFrame), con la proporción mínima como fracción entera', () => {
    assert.deepEqual(LIMITS.heroFrame, {
      ideal: { width: constant('HeroFrame.cs', 'IdealWidth'), height: constant('HeroFrame.cs', 'IdealHeight') },
      min: { width: constant('HeroFrame.cs', 'MinWidth'), height: constant('HeroFrame.cs', 'MinHeight') },
      minAspect: {
        numerator: constant('HeroFrame.cs', 'MinAspectNumerator'),
        denominator: constant('HeroFrame.cs', 'MinAspectDenominator'),
      },
    });
  });

  it('recorte y fundido del video (VideoEdit)', () => {
    assert.deepEqual(LIMITS.video, {
      minSeconds: constant('VideoEdit.cs', 'MinSeconds'),
      maxSeconds: constant('VideoEdit.cs', 'MaxSeconds'),
      fadeSeconds: numberList('VideoEdit.cs', 'FadeDurations'),
      defaultFadeSeconds: constant('VideoEdit.cs', 'DefaultFadeSeconds'),
    });
  });

  it('el lector de constantes encuentra lo que busca y falla si no existe', () => {
    assert.equal(constant('PostContent.cs', 'MaxBodyLength'), 500_000);
    assert.throws(() => constant('PostContent.cs', 'NoExiste'), /no encontré la constante NoExiste/);
  });
});

describe('ningún número de límite suelto fuera de src/limits.ts', () => {
  // Los `maxLength` de los inputs eran literales (200, 120, 400, 300): tienen que salir de LIMITS.
  for (const file of ['pages/PostEditorPage.tsx', 'components/ImageField.tsx', 'hero/HeroImageCard.tsx', 'pages/SettingsPage.tsx', 'settings/BioField.tsx']) {
    it(file, () => {
      const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      assert.deepEqual(text.match(/maxLength=\{\d+\}/g) ?? [], []);
    });
  }
});
