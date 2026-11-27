import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkHeroSize, heroGuidance, HERO_SIZE } from '../src/hero/heroSize.ts';
import { i18nFor } from '../src/i18n/i18n.ts';

const es = i18nFor('es');
const en = i18nFor('en');

/*
 * The hero size rule, the same for photos and videos: rejects portrait/square (width < 1.2 × height) or less than
 * 1280×720; warns (but accepts) below 1920×1080. Duration is no longer part of this rule: a long video goes to the
 * trim editor (test/videoEdit.test.ts).
 */

describe('heroGuidance: the guide the user sees', () => {
  it('is the requested text, built from the same numbers as the rules', () => {
    assert.equal(
      heroGuidance(es),
      'Ideal: 1920×1080 o más, horizontal 16:9. Videos: de 1 a 15 segundos (antes de subir elegís el tramo); se les quita el audio.',
    );
    assert.equal(
      heroGuidance(en),
      'Ideal: 1920×1080 or larger, landscape 16:9. Videos: 1 to 15 seconds (you pick the clip before uploading); audio is removed.',
    );
    assert.deepEqual(HERO_SIZE, {
      ideal: { width: 1920, height: 1080 },
      min: { width: 1280, height: 720 },
      minAspect: { numerator: 6, denominator: 5 },
    });
  });
});

describe('checkHeroSize', () => {
  it('1920×1080 or larger: passes without a warning (photo and video)', () => {
    assert.deepEqual(checkHeroSize({ width: 1920, height: 1080 }, es), { ok: true, warning: null });
    assert.deepEqual(checkHeroSize({ width: 3840, height: 2160, durationSeconds: 15 }, es), { ok: true, warning: null });
  });

  it('portrait or square: rejects showing what was received and the ideal', () => {
    const error = 'Formato vertical o cuadrado (1080×1920): el hero necesita uno horizontal. Ideal: 1920×1080 (16:9).';
    assert.deepEqual(checkHeroSize({ width: 1080, height: 1920 }, es), { ok: false, error });
    assert.deepEqual(checkHeroSize({ width: 2000, height: 2000 }, es), {
      ok: false,
      error: 'Formato vertical o cuadrado (2000×2000): el hero necesita uno horizontal. Ideal: 1920×1080 (16:9).',
    });
  });

  it('aspect: exactly 1.2 passes; just below is rejected', () => {
    assert.equal(checkHeroSize({ width: 2400, height: 2000 }, es).ok, true);
    assert.equal(checkHeroSize({ width: 2399, height: 2000 }, es).ok, false);
  });

  it('less than 1280×720 (either dimension): rejects', () => {
    assert.deepEqual(checkHeroSize({ width: 1024, height: 576 }, es), {
      ok: false,
      error: 'Tamaño insuficiente (1024×576): el mínimo es 1280×720. Ideal: 1920×1080 o más.',
    });
    assert.equal(checkHeroSize({ width: 1279, height: 720 }, es).ok, false);
    assert.equal(checkHeroSize({ width: 1600, height: 719 }, es).ok, false);
  });

  it('between the minimum and the ideal: accepts with a warning', () => {
    assert.deepEqual(checkHeroSize({ width: 1280, height: 720 }, es), {
      ok: true,
      warning: 'Mide 1280×720, menos que lo ideal (1920×1080): puede perder nitidez en pantallas grandes.',
    });
    // Panoramic: plenty of width but height below the ideal.
    assert.equal(checkHeroSize({ width: 2560, height: 1000 }, es).ok, true);
    assert.notEqual((checkHeroSize({ width: 2560, height: 1000 }, es) as { warning: string | null }).warning, null);
  });

  it('a video longer than 15 s: no longer rejected (it is trimmed in the editor before uploading)', () => {
    assert.deepEqual(checkHeroSize({ width: 1920, height: 1080, durationSeconds: 16.1 }, es), { ok: true, warning: null });
    assert.deepEqual(checkHeroSize({ width: 1920, height: 1080, durationSeconds: 600 }, es), { ok: true, warning: null });
  });

  it('in English: rejection and warning with the same sizes', () => {
    assert.deepEqual(checkHeroSize({ width: 1080, height: 1920 }, en), {
      ok: false,
      error: 'Portrait or square format (1080×1920): the hero needs a landscape one. Ideal: 1920×1080 (16:9).',
    });
    assert.deepEqual(checkHeroSize({ width: 1024, height: 576 }, en), {
      ok: false,
      error: 'Too small (1024×576): the minimum is 1280×720. Ideal: 1920×1080 or larger.',
    });
    assert.deepEqual(checkHeroSize({ width: 1280, height: 720 }, en), {
      ok: true,
      warning: 'It’s 1280×720, below the ideal (1920×1080): it may look soft on large screens.',
    });
  });

  it('the shape is reported before the size', () => {
    const result = checkHeroSize({ width: 700, height: 1000, durationSeconds: 60 }, es);
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /^Formato vertical o cuadrado \(700×1000\)/);
  });
});
