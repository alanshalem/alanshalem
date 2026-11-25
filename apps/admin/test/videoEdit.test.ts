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

/*
 * Editor de recorte y fundido antes de subir un video (L19, S12–S15): tramo de 1 a 15 s dentro del video,
 * fundido loop / negro / ninguno de 0,5, 1 o 2 s (fadeSeconds × 2 ≤ tramo) y la vista previa aproximada.
 */

const edit = (overrides: Partial<VideoEdit> = {}): VideoEdit => ({
  trimStart: 0,
  trimEnd: 10,
  fade: 'loop',
  fadeSeconds: 1,
  ...overrides,
});

describe('límites y opciones (S12, S14, S15): un solo lugar', () => {
  it('el tramo dura de 1 a 15 s', () => {
    assert.deepEqual(VIDEO_DURATION, { minSeconds: 1, maxSeconds: 15 });
  });

  it('tres fundidos con su explicación de una línea, en el orden de L19', () => {
    assert.deepEqual(
      FADES.map(({ value, label }) => [value, label]),
      [
        ['loop', 'Loop perfecto'],
        ['black', 'Desde y hacia negro'],
        ['none', 'Sin fundido'],
      ],
    );
    for (const fade of FADES) assert.match(fade.description, /^\S.+\.$/);
  });

  it('duraciones corto / medio / largo = 0,5 / 1 / 2 s', () => {
    assert.deepEqual(
      FADE_DURATIONS.map(({ seconds, label }) => `${label} ${fadeDurationLabel(seconds)}`),
      ['Corto 0,5 s', 'Medio 1 s', 'Largo 2 s'],
    );
  });
});

describe('checkVideoDuration: lo que el recorte no puede arreglar', () => {
  it('menos de 1 s: rechaza; 1 s o más (aunque pase de 15 s) va al editor', () => {
    assert.equal(checkVideoDuration(0.6), 'Dura 0,6 s: el mínimo es 1 s.');
    assert.equal(checkVideoDuration(1), null);
    assert.equal(checkVideoDuration(16.1), null);
    assert.equal(checkVideoDuration(600), null);
  });
});

describe('defaultEdit: los primeros min(duración, 15) s, loop perfecto de 1 s', () => {
  it('un video largo arranca con los primeros 15 s', () => {
    assert.deepEqual(defaultEdit(16.1), { trimStart: 0, trimEnd: 15, fade: 'loop', fadeSeconds: 1 });
  });

  it('uno corto, entero (redondeado hacia abajo a la décima: nunca después del final)', () => {
    assert.deepEqual(defaultEdit(7.46), { trimStart: 0, trimEnd: 7.4, fade: 'loop', fadeSeconds: 1 });
    assert.equal(defaultEdit(15).trimEnd, 15);
  });
});

describe('trimBounds: hasta dónde llega cada manija', () => {
  it('inicio de 0 a fin − 1 s; fin de 1 s al final del video', () => {
    assert.deepEqual(trimBounds(20), { start: { min: 0, max: 19 }, end: { min: 1, max: 20 } });
    assert.deepEqual(trimBounds(7.46), { start: { min: 0, max: 6.4 }, end: { min: 1, max: 7.4 } });
  });
});

describe('moveTrimStart / moveTrimEnd: la otra manija acompaña para respetar 1 ≤ tramo ≤ 15', () => {
  it('mover dentro de los límites cambia solo esa manija (en décimas)', () => {
    assert.deepEqual(moveTrimStart(edit(), 2.04, 20), edit({ trimStart: 2 }));
    assert.deepEqual(moveTrimEnd(edit(), 12.36, 20), edit({ trimEnd: 12.4 }));
  });

  it('el fin más allá de inicio + 15 s arrastra el inicio', () => {
    assert.deepEqual(moveTrimEnd(edit({ trimStart: 0, trimEnd: 15 }), 20, 20), edit({ trimStart: 5, trimEnd: 20 }));
  });

  it('el inicio pasando fin − 1 s empuja el fin', () => {
    assert.deepEqual(moveTrimStart(edit({ trimStart: 0, trimEnd: 5 }), 6, 20), edit({ trimStart: 6, trimEnd: 7 }));
  });

  it('el inicio antes de fin − 15 s trae el fin', () => {
    assert.deepEqual(moveTrimStart(edit({ trimStart: 10, trimEnd: 20 }), 2, 20), edit({ trimStart: 2, trimEnd: 17 }));
  });

  it('el fin antes de inicio + 1 s empuja el inicio', () => {
    assert.deepEqual(moveTrimEnd(edit({ trimStart: 5, trimEnd: 10 }), 3, 20), edit({ trimStart: 2, trimEnd: 3 }));
  });

  it('topes: el fin nunca pasa del video ni baja de 1 s; el inicio nunca es negativo', () => {
    assert.deepEqual(moveTrimEnd(edit(), 99, 16.1), edit({ trimStart: 1.1, trimEnd: 16.1 }));
    assert.deepEqual(moveTrimEnd(edit(), 0, 20), edit({ trimStart: 0, trimEnd: 1 }));
    assert.deepEqual(moveTrimStart(edit(), -3, 20), edit({ trimStart: 0 }));
    assert.deepEqual(moveTrimStart(edit({ trimEnd: 16.1 }), 99, 16.1), edit({ trimStart: 15.1, trimEnd: 16.1 }));
  });

  it('Home/End (±Infinity) llevan la manija al tope', () => {
    assert.deepEqual(moveTrimStart(edit({ trimStart: 4, trimEnd: 10 }), Number.NEGATIVE_INFINITY, 20), edit({ trimEnd: 10 }));
    assert.deepEqual(moveTrimEnd(edit({ trimStart: 4, trimEnd: 10 }), Number.POSITIVE_INFINITY, 20), edit({ trimStart: 5, trimEnd: 20 }));
  });

  it('sin errores de coma flotante al sumar décimas', () => {
    let current = edit({ trimStart: 0, trimEnd: 10 });
    for (let i = 0; i < 3; i++) current = moveTrimStart(current, current.trimStart + 0.1, 20);
    assert.equal(current.trimStart, 0.3);
    assert.equal(selectionSeconds(current), 9.7);
  });

  it('conserva el fundido elegido', () => {
    assert.deepEqual(moveTrimEnd(edit({ fade: 'black', fadeSeconds: 2 }), 8, 20), edit({ fade: 'black', fadeSeconds: 2, trimEnd: 8 }));
  });
});

describe('sliderKeyValue: teclado de las manijas', () => {
  it('flechas mueven 0,1 s; con Shift, 1 s', () => {
    assert.equal(sliderKeyValue('ArrowRight', false, 2), 2.1);
    assert.equal(sliderKeyValue('ArrowUp', false, 2), 2.1);
    assert.equal(sliderKeyValue('ArrowLeft', false, 2), 1.9);
    assert.equal(sliderKeyValue('ArrowDown', false, 2), 1.9);
    assert.equal(sliderKeyValue('ArrowRight', true, 2), 3);
    assert.equal(sliderKeyValue('ArrowLeft', true, 2), 1);
  });

  it('PageUp/PageDown 1 s; Home/End al tope (lo acota el move)', () => {
    assert.equal(sliderKeyValue('PageUp', false, 2), 3);
    assert.equal(sliderKeyValue('PageDown', false, 2), 1);
    assert.equal(sliderKeyValue('Home', false, 2), Number.NEGATIVE_INFINITY);
    assert.equal(sliderKeyValue('End', false, 2), Number.POSITIVE_INFINITY);
  });

  it('otras teclas no son de la manija (Tab sigue navegando)', () => {
    assert.equal(sliderKeyValue('Tab', false, 2), null);
    assert.equal(sliderKeyValue('a', true, 2), null);
  });
});

describe('validateEdit: espejo de la validación de la API (L19)', () => {
  it('un tramo válido con fundido que entra: sin error', () => {
    assert.equal(validateEdit(edit({ trimStart: 2, trimEnd: 4, fadeSeconds: 1 }), 20), null);
    assert.equal(validateEdit(edit({ trimStart: 0, trimEnd: 1, fadeSeconds: 0.5 }), 20), null);
  });

  it('tramo de menos de 1 s o de más de 15 s', () => {
    assert.equal(validateEdit(edit({ trimStart: 3, trimEnd: 3.5 }), 20), 'El tramo dura 0,5 s: el mínimo es 1 s.');
    assert.equal(validateEdit(edit({ trimStart: 0, trimEnd: 15.5 }), 20), 'El tramo dura 15,5 s: el máximo es 15 s.');
  });

  it('fuera del video', () => {
    assert.equal(validateEdit(edit({ trimStart: 5, trimEnd: 17 }), 16.1), 'El tramo tiene que estar dentro del video (0 a 16,1 s).');
    assert.equal(validateEdit(edit({ trimStart: -1, trimEnd: 5 }), 16.1), 'El tramo tiene que estar dentro del video (0 a 16,1 s).');
  });

  it('fundido más largo que la mitad del tramo: explica por qué, según el tipo', () => {
    assert.equal(
      validateEdit(edit({ trimStart: 0, trimEnd: 3.2, fade: 'black', fadeSeconds: 2 }), 20),
      'Un fundido de 2 s necesita un tramo de al menos 4 s: entra en 2 s desde negro y sale en 2 s a negro. ' +
        'Este dura 3,2 s; alargalo o elegí un fundido más corto.',
    );
    assert.equal(
      validateEdit(edit({ trimStart: 0, trimEnd: 1.5, fade: 'loop', fadeSeconds: 1 }), 20),
      'Un fundido de 1 s necesita un tramo de al menos 2 s: el final se funde con el principio, 1 s de cada lado. ' +
        'Este dura 1,5 s; alargalo o elegí un fundido más corto.',
    );
  });

  it('justo el doble pasa; sin fundido no hay regla de fundido', () => {
    assert.equal(validateEdit(edit({ trimStart: 0, trimEnd: 4, fade: 'black', fadeSeconds: 2 }), 20), null);
    assert.equal(validateEdit(edit({ trimStart: 0, trimEnd: 1.5, fade: 'none', fadeSeconds: 2 }), 20), null);
  });
});

describe('previewFrame: opacidades de la vista previa aproximada en función del tiempo', () => {
  const range = { trimStart: 2, trimEnd: 12, fadeSeconds: 1 } as const;

  it('negro: sale de negro en el primer segundo y vuelve a negro en el último', () => {
    const black = edit({ ...range, fade: 'black' });
    const curtain = (t: number): number => previewFrame(t, black).curtainOpacity;
    assert.deepEqual([2, 2.5, 3, 7, 11, 11.5, 12].map(curtain), [1, 0.5, 0, 0, 0, 0.5, 1]);
    assert.equal(previewFrame(7, black).overlay, null);
  });

  it('negro con fundido largo: la rampa dura 2 s', () => {
    assert.equal(previewFrame(3, edit({ ...range, fade: 'black', fadeSeconds: 2 })).curtainOpacity, 0.5);
  });

  it('loop: el segundo video aparece en el último segundo, empezando por el principio del tramo', () => {
    const loop = edit({ ...range, fade: 'loop' });
    assert.deepEqual(previewFrame(10, loop), { curtainOpacity: 0, overlay: null });
    assert.deepEqual(previewFrame(11, loop), { curtainOpacity: 0, overlay: { opacity: 0, time: 2 } });
    assert.deepEqual(previewFrame(11.5, loop), { curtainOpacity: 0, overlay: { opacity: 0.5, time: 2.5 } });
    assert.deepEqual(previewFrame(12, loop), { curtainOpacity: 0, overlay: { opacity: 1, time: 3 } });
  });

  it('sin fundido: nada encima', () => {
    const none = edit({ ...range, fade: 'none' });
    for (const t of [2, 11.5, 12]) assert.deepEqual(previewFrame(t, none), { curtainOpacity: 0, overlay: null });
  });

  it('previewLoopStart: el loop vuelve a donde quedó el segundo video (como la salida del servidor)', () => {
    assert.equal(previewLoopStart(edit({ ...range, fade: 'loop' })), 3);
    assert.equal(previewLoopStart(edit({ ...range, fade: 'black' })), 2);
    assert.equal(previewLoopStart(edit({ ...range, fade: 'none' })), 2);
  });

  it('endingPreviewTime: al mover el fin o el fundido, salta a 1 s antes de la transición', () => {
    assert.equal(endingPreviewTime(edit({ ...range, fade: 'loop', fadeSeconds: 2 })), 9);
    assert.equal(endingPreviewTime(edit({ ...range, fade: 'none' })), 11);
    // Un tramo corto no retrocede antes del inicio del loop.
    assert.equal(endingPreviewTime(edit({ trimStart: 2, trimEnd: 4, fade: 'loop', fadeSeconds: 1 })), 3);
  });
});

describe('formato y lectura de segundos', () => {
  it('formatSeconds: siempre una décima, con coma', () => {
    assert.deepEqual([0, 2, 2.5, 15, 16.1].map(formatSeconds), ['0,0', '2,0', '2,5', '15,0', '16,1']);
  });

  it('formatClock: m:ss y la décima solo si la hay', () => {
    assert.deepEqual([0, 2, 2.5, 15, 75.3].map(formatClock), ['0:00', '0:02', '0:02,5', '0:15', '1:15,3']);
  });

  it('editSummary: el chip de un video guardado', () => {
    assert.equal(editSummary(edit({ trimStart: 2, trimEnd: 15 })), '0:02–0:15 · Loop perfecto 1 s');
    assert.equal(editSummary(edit({ trimStart: 0, trimEnd: 8.5, fade: 'black', fadeSeconds: 0.5 })), '0:00–0:08,5 · Desde y hacia negro 0,5 s');
    assert.equal(editSummary(edit({ fade: 'none', fadeSeconds: 2 })), '0:00–0:10 · Sin fundido');
  });

  it('fadeExplanation: la explicación estática (sin animar) para prefers-reduced-motion', () => {
    assert.equal(
      fadeExplanation(edit({ fade: 'loop', fadeSeconds: 2 })),
      'Loop perfecto (2 s). El final se funde con el principio: vuelve a empezar sin salto.',
    );
    assert.equal(
      fadeExplanation(edit({ fade: 'black', fadeSeconds: 0.5 })),
      'Desde y hacia negro (0,5 s). Aparece desde negro al empezar y se va a negro al terminar.',
    );
    assert.equal(fadeExplanation(edit({ fade: 'none' })), 'Sin fundido. Corte directo: al terminar vuelve a empezar tal cual.');
  });

  it('parseSeconds: acepta coma o punto; lo demás no es un número', () => {
    assert.equal(parseSeconds(' 2,5 '), 2.5);
    assert.equal(parseSeconds('12.3'), 12.3);
    assert.equal(parseSeconds('7'), 7);
    for (const text of ['', ' ', 'abc', '-1', '1,2,3', '2.']) assert.equal(parseSeconds(text), null);
  });
});
