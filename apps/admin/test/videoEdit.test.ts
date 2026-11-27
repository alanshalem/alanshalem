import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VideoEdit } from '../src/api/types.ts';
import {
  checkVideoDuration,
  defaultEdit,
  editSummary,
  endingPreviewTime,
  fadeExplanation,
  FADE_DURATIONS,
  fadeDurationLabel,
  FADES,
  fadeText,
  formatClock,
  formatSeconds,
  moveTrimEnd,
  moveTrimStart,
  parseSeconds,
  previewFrame,
  previewLoopStart,
  selectionSeconds,
  sliderKeyValue,
  trimBounds,
  validateEdit,
  VIDEO_DURATION,
} from '../src/hero/videoEdit.ts';
import { i18nFor } from '../src/i18n/i18n.ts';

const es = i18nFor('es');
const en = i18nFor('en');

/*
 * The trim and fade editor before uploading a video: a 1 to 15 s segment inside the video, a loop / black / none fade
 * of 0.5, 1 or 2 s (fadeSeconds × 2 ≤ segment) and the approximate preview.
 */

const edit = (overrides: Partial<VideoEdit> = {}): VideoEdit => ({
  trimStart: 0,
  trimEnd: 10,
  fade: 'loop',
  fadeSeconds: 1,
  ...overrides,
});

describe('limits and options: one place', () => {
  it('the segment lasts 1 to 15 s', () => {
    assert.deepEqual(VIDEO_DURATION, { minSeconds: 1, maxSeconds: 15 });
  });

  it('three fades with their one-line explanation, in order', () => {
    assert.deepEqual(
      FADES.map((fade) => [fade, fadeText(fade, es).label]),
      [
        ['loop', 'Loop perfecto'],
        ['black', 'Desde y hacia negro'],
        ['none', 'Sin fundido'],
      ],
    );
    for (const i18n of [es, en]) {
      for (const fade of FADES) assert.match(fadeText(fade, i18n).description, /^\S.+\.$/);
    }
  });

  it('short / medium / long durations = 0.5 / 1 / 2 s', () => {
    assert.deepEqual(
      FADE_DURATIONS.map(({ seconds, label }) => `${es.t(label)} ${fadeDurationLabel(seconds, es)}`),
      ['Corto 0,5 s', 'Medio 1 s', 'Largo 2 s'],
    );
    assert.deepEqual(
      FADE_DURATIONS.map(({ seconds, label }) => `${en.t(label)} ${fadeDurationLabel(seconds, en)}`),
      ['Short 0.5 s', 'Medium 1 s', 'Long 2 s'],
    );
  });
});

describe('checkVideoDuration: what trimming cannot fix', () => {
  it('less than 1 s: rejects; 1 s or more (even past 15 s) goes to the editor', () => {
    assert.equal(checkVideoDuration(0.6, es), 'Dura 0,6 s: el mínimo es 1 s.');
    assert.equal(checkVideoDuration(1, es), null);
    assert.equal(checkVideoDuration(16.1, es), null);
    assert.equal(checkVideoDuration(600, es), null);
  });
});

describe('defaultEdit: the first min(duration, 15) s, a 1 s seamless loop', () => {
  it('a long video starts with the first 15 s', () => {
    assert.deepEqual(defaultEdit(16.1), { trimStart: 0, trimEnd: 15, fade: 'loop', fadeSeconds: 1 });
  });

  it('a short one, whole (rounded down to the tenth: never past the end)', () => {
    assert.deepEqual(defaultEdit(7.46), { trimStart: 0, trimEnd: 7.4, fade: 'loop', fadeSeconds: 1 });
    assert.equal(defaultEdit(15).trimEnd, 15);
  });
});

describe('trimBounds: how far each handle goes', () => {
  it('start from 0 to end − 1 s; end from 1 s to the end of the video', () => {
    assert.deepEqual(trimBounds(20), { start: { min: 0, max: 19 }, end: { min: 1, max: 20 } });
    assert.deepEqual(trimBounds(7.46), { start: { min: 0, max: 6.4 }, end: { min: 1, max: 7.4 } });
  });
});

describe('moveTrimStart / moveTrimEnd: the other handle follows to keep 1 ≤ segment ≤ 15', () => {
  it('moving within the limits changes only that handle (in tenths)', () => {
    assert.deepEqual(moveTrimStart(edit(), 2.04, 20), edit({ trimStart: 2 }));
    assert.deepEqual(moveTrimEnd(edit(), 12.36, 20), edit({ trimEnd: 12.4 }));
  });

  it('the end past start + 15 s drags the start', () => {
    assert.deepEqual(moveTrimEnd(edit({ trimStart: 0, trimEnd: 15 }), 20, 20), edit({ trimStart: 5, trimEnd: 20 }));
  });

  it('the start passing end − 1 s pushes the end', () => {
    assert.deepEqual(moveTrimStart(edit({ trimStart: 0, trimEnd: 5 }), 6, 20), edit({ trimStart: 6, trimEnd: 7 }));
  });

  it('the start before end − 15 s pulls the end', () => {
    assert.deepEqual(moveTrimStart(edit({ trimStart: 10, trimEnd: 20 }), 2, 20), edit({ trimStart: 2, trimEnd: 17 }));
  });

  it('the end before start + 1 s pushes the start', () => {
    assert.deepEqual(moveTrimEnd(edit({ trimStart: 5, trimEnd: 10 }), 3, 20), edit({ trimStart: 2, trimEnd: 3 }));
  });

  it('limits: the end never passes the video or drops below 1 s; the start is never negative', () => {
    assert.deepEqual(moveTrimEnd(edit(), 99, 16.1), edit({ trimStart: 1.1, trimEnd: 16.1 }));
    assert.deepEqual(moveTrimEnd(edit(), 0, 20), edit({ trimStart: 0, trimEnd: 1 }));
    assert.deepEqual(moveTrimStart(edit(), -3, 20), edit({ trimStart: 0 }));
    assert.deepEqual(moveTrimStart(edit({ trimEnd: 16.1 }), 99, 16.1), edit({ trimStart: 15.1, trimEnd: 16.1 }));
  });

  it('Home/End (±Infinity) take the handle to its limit', () => {
    assert.deepEqual(moveTrimStart(edit({ trimStart: 4, trimEnd: 10 }), Number.NEGATIVE_INFINITY, 20), edit({ trimEnd: 10 }));
    assert.deepEqual(moveTrimEnd(edit({ trimStart: 4, trimEnd: 10 }), Number.POSITIVE_INFINITY, 20), edit({ trimStart: 5, trimEnd: 20 }));
  });

  it('no floating point errors when adding tenths', () => {
    let current = edit({ trimStart: 0, trimEnd: 10 });
    for (let i = 0; i < 3; i++) current = moveTrimStart(current, current.trimStart + 0.1, 20);
    assert.equal(current.trimStart, 0.3);
    assert.equal(selectionSeconds(current), 9.7);
  });

  it('keeps the chosen fade', () => {
    assert.deepEqual(moveTrimEnd(edit({ fade: 'black', fadeSeconds: 2 }), 8, 20), edit({ fade: 'black', fadeSeconds: 2, trimEnd: 8 }));
  });
});

describe('sliderKeyValue: the handles keyboard', () => {
  it('arrows move 0.1 s; with Shift, 1 s', () => {
    assert.equal(sliderKeyValue('ArrowRight', false, 2), 2.1);
    assert.equal(sliderKeyValue('ArrowUp', false, 2), 2.1);
    assert.equal(sliderKeyValue('ArrowLeft', false, 2), 1.9);
    assert.equal(sliderKeyValue('ArrowDown', false, 2), 1.9);
    assert.equal(sliderKeyValue('ArrowRight', true, 2), 3);
    assert.equal(sliderKeyValue('ArrowLeft', true, 2), 1);
  });

  it('PageUp/PageDown 1 s; Home/End to the limit (the move clamps it)', () => {
    assert.equal(sliderKeyValue('PageUp', false, 2), 3);
    assert.equal(sliderKeyValue('PageDown', false, 2), 1);
    assert.equal(sliderKeyValue('Home', false, 2), Number.NEGATIVE_INFINITY);
    assert.equal(sliderKeyValue('End', false, 2), Number.POSITIVE_INFINITY);
  });

  it('other keys are not handle keys (Tab keeps navigating)', () => {
    assert.equal(sliderKeyValue('Tab', false, 2), null);
    assert.equal(sliderKeyValue('a', true, 2), null);
  });
});

describe('validateEdit: mirror of the API validation', () => {
  it('a valid segment with a fade that fits: no error', () => {
    assert.equal(validateEdit(edit({ trimStart: 2, trimEnd: 4, fadeSeconds: 1 }), 20, es), null);
    assert.equal(validateEdit(edit({ trimStart: 0, trimEnd: 1, fadeSeconds: 0.5 }), 20, es), null);
  });

  it('segment shorter than 1 s or longer than 15 s', () => {
    assert.equal(validateEdit(edit({ trimStart: 3, trimEnd: 3.5 }), 20, es), 'El tramo dura 0,5 s: el mínimo es 1 s.');
    assert.equal(validateEdit(edit({ trimStart: 0, trimEnd: 15.5 }), 20, es), 'El tramo dura 15,5 s: el máximo es 15 s.');
  });

  it('outside the video', () => {
    assert.equal(validateEdit(edit({ trimStart: 5, trimEnd: 17 }), 16.1, es), 'El tramo tiene que estar dentro del video (0 a 16,1 s).');
    assert.equal(validateEdit(edit({ trimStart: -1, trimEnd: 5 }), 16.1, es), 'El tramo tiene que estar dentro del video (0 a 16,1 s).');
  });

  it('fade longer than half the segment: explains why, per kind', () => {
    assert.equal(
      validateEdit(edit({ trimStart: 0, trimEnd: 3.2, fade: 'black', fadeSeconds: 2 }), 20, es),
      'Un fundido de 2 s necesita un tramo de al menos 4 s: entra en 2 s desde negro y sale en 2 s a negro. ' +
        'Este dura 3,2 s; alargalo o elegí un fundido más corto.',
    );
    assert.equal(
      validateEdit(edit({ trimStart: 0, trimEnd: 1.5, fade: 'loop', fadeSeconds: 1 }), 20, es),
      'Un fundido de 1 s necesita un tramo de al menos 2 s: el final se funde con el principio, 1 s de cada lado. ' +
        'Este dura 1,5 s; alargalo o elegí un fundido más corto.',
    );
  });

  it('in English, with a decimal point', () => {
    assert.equal(checkVideoDuration(0.6, en), 'It’s only 0.6 s long: the minimum is 1 s.');
    assert.equal(validateEdit(edit({ trimStart: 0, trimEnd: 15.5 }), 20, en), 'The clip is 15.5 s long: the maximum is 15 s.');
    assert.equal(
      validateEdit(edit({ trimStart: 0, trimEnd: 3.2, fade: 'black', fadeSeconds: 2 }), 20, en),
      'A 2 s fade needs a clip of at least 4 s: it fades in from black over 2 s and out to black over 2 s. ' +
        'This one is 3.2 s; make it longer or pick a shorter fade.',
    );
  });

  it('exactly double passes; without a fade there is no fade rule', () => {
    assert.equal(validateEdit(edit({ trimStart: 0, trimEnd: 4, fade: 'black', fadeSeconds: 2 }), 20, es), null);
    assert.equal(validateEdit(edit({ trimStart: 0, trimEnd: 1.5, fade: 'none', fadeSeconds: 2 }), 20, es), null);
  });
});

describe('previewFrame: approximate preview opacities over time', () => {
  const range = { trimStart: 2, trimEnd: 12, fadeSeconds: 1 } as const;

  it('black: comes out of black in the first second and back to black in the last', () => {
    const black = edit({ ...range, fade: 'black' });
    const curtain = (t: number): number => previewFrame(t, black).curtainOpacity;
    assert.deepEqual([2, 2.5, 3, 7, 11, 11.5, 12].map(curtain), [1, 0.5, 0, 0, 0, 0.5, 1]);
    assert.equal(previewFrame(7, black).overlay, null);
  });

  it('black with a long fade: the ramp lasts 2 s', () => {
    assert.equal(previewFrame(3, edit({ ...range, fade: 'black', fadeSeconds: 2 })).curtainOpacity, 0.5);
  });

  it('loop: the second video appears in the last second, starting at the beginning of the segment', () => {
    const loop = edit({ ...range, fade: 'loop' });
    assert.deepEqual(previewFrame(10, loop), { curtainOpacity: 0, overlay: null });
    assert.deepEqual(previewFrame(11, loop), { curtainOpacity: 0, overlay: { opacity: 0, time: 2 } });
    assert.deepEqual(previewFrame(11.5, loop), { curtainOpacity: 0, overlay: { opacity: 0.5, time: 2.5 } });
    assert.deepEqual(previewFrame(12, loop), { curtainOpacity: 0, overlay: { opacity: 1, time: 3 } });
  });

  it('no fade: nothing on top', () => {
    const none = edit({ ...range, fade: 'none' });
    for (const t of [2, 11.5, 12]) assert.deepEqual(previewFrame(t, none), { curtainOpacity: 0, overlay: null });
  });

  it('previewLoopStart: the loop returns to where the second video got to (like the server output)', () => {
    assert.equal(previewLoopStart(edit({ ...range, fade: 'loop' })), 3);
    assert.equal(previewLoopStart(edit({ ...range, fade: 'black' })), 2);
    assert.equal(previewLoopStart(edit({ ...range, fade: 'none' })), 2);
  });

  it('endingPreviewTime: when the end or the fade moves, it jumps to 1 s before the transition', () => {
    assert.equal(endingPreviewTime(edit({ ...range, fade: 'loop', fadeSeconds: 2 })), 9);
    assert.equal(endingPreviewTime(edit({ ...range, fade: 'none' })), 11);
    // A short segment does not go back before the loop start.
    assert.equal(endingPreviewTime(edit({ trimStart: 2, trimEnd: 4, fade: 'loop', fadeSeconds: 1 })), 3);
  });
});

describe('formatting and parsing seconds', () => {
  it('formatSeconds: always one decimal, with a comma', () => {
    assert.deepEqual(
      [0, 2, 2.5, 15, 16.1].map((seconds) => formatSeconds(seconds, es)),
      ['0,0', '2,0', '2,5', '15,0', '16,1'],
    );
    assert.deepEqual(
      [0, 2.5, 16.1].map((seconds) => formatSeconds(seconds, en)),
      ['0.0', '2.5', '16.1'],
    );
  });

  it('formatClock: m:ss and the tenth only if there is one', () => {
    assert.deepEqual(
      [0, 2, 2.5, 15, 75.3, 59.9].map((seconds) => formatClock(seconds, es)),
      ['0:00', '0:02', '0:02,5', '0:15', '1:15,3', '0:59,9'],
    );
    assert.deepEqual(
      [2.5, 75.3].map((seconds) => formatClock(seconds, en)),
      ['0:02.5', '1:15.3'],
    );
  });

  it('editSummary: the chip of a saved video', () => {
    assert.equal(editSummary(edit({ trimStart: 2, trimEnd: 15 }), es), '0:02–0:15 · Loop perfecto 1 s');
    assert.equal(editSummary(edit({ trimStart: 0, trimEnd: 8.5, fade: 'black', fadeSeconds: 0.5 }), es), '0:00–0:08,5 · Desde y hacia negro 0,5 s');
    assert.equal(editSummary(edit({ fade: 'none', fadeSeconds: 2 }), es), '0:00–0:10 · Sin fundido');
    assert.equal(
      editSummary(edit({ trimStart: 0, trimEnd: 8.5, fade: 'black', fadeSeconds: 0.5 }), en),
      '0:00–0:08.5 · From and to black 0.5 s',
    );
  });

  it('fadeExplanation: the static explanation (no animation) for prefers-reduced-motion', () => {
    assert.equal(
      fadeExplanation(edit({ fade: 'loop', fadeSeconds: 2 }), es),
      'Loop perfecto (2 s). El final se funde con el principio: vuelve a empezar sin salto.',
    );
    assert.equal(
      fadeExplanation(edit({ fade: 'black', fadeSeconds: 0.5 }), es),
      'Desde y hacia negro (0,5 s). Aparece desde negro al empezar y se va a negro al terminar.',
    );
    assert.equal(fadeExplanation(edit({ fade: 'none' }), es), 'Sin fundido. Corte directo: al terminar vuelve a empezar tal cual.');
    assert.equal(
      fadeExplanation(edit({ fade: 'loop', fadeSeconds: 2 }), en),
      'Seamless loop (2 s). The end blends into the start: it loops without a jump.',
    );
  });

  it('parseSeconds: accepts a comma or a point; anything else is not a number', () => {
    assert.equal(parseSeconds(' 2,5 '), 2.5);
    assert.equal(parseSeconds('12.3'), 12.3);
    assert.equal(parseSeconds('7'), 7);
    for (const text of ['', ' ', 'abc', '-1', '1,2,3', '2.']) assert.equal(parseSeconds(text), null);
  });
});
