/**
 * Tipografía inteligente: comillas “ ” ‘ ’, apóstrofo ’, rayas – — y puntos suspensivos ….
 *
 * Se aplica al renderizar (el Markdown guardado sigue en ASCII fácil de tipear) y solo a los
 * tramos de texto común: el renderer en línea nunca la llama para código, URLs ni atributos.
 * Español e inglés usan las mismas comillas dobles “ ” (L4 admite «» o “” para el español):
 * así un post y su traducción tienen el mismo estilo, y `lang` no cambia esta función.
 */

const REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/---/g, '—'], // antes que '--', si no quedaría "–-"
  [/--/g, '–'],
  [/\.\.\./g, '…'],
];

// Las URLs sueltas en el texto no son links, pero cambiarles "--" o "..." las rompería al copiarlas.
const BARE_URL = /(?:https?:\/\/|mailto:|www\.)[^\s"']+/gi;

// Antes de una comilla de apertura: inicio, espacio, signo que abre o una comilla/raya ya convertida.
const OPENING_CONTEXT = /[\s([{¡¿“‘–—]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

const opensQuote = (before: string | undefined): boolean => before === undefined || OPENING_CONTEXT.test(before);
const isWordChar = (char: string | undefined): boolean => char !== undefined && WORD_CHAR.test(char);

/** `before` es el carácter del documento justo antes de `text` (decide si una comilla abre o cierra). */
export function smartenText(text: string, before: string | undefined): string {
  let out = '';
  let last = 0;
  for (const url of text.matchAll(BARE_URL)) {
    out += smartenSegment(text.slice(last, url.index), last === 0 ? before : text[last - 1]);
    out += url[0];
    last = url.index + url[0].length;
  }
  return out + smartenSegment(text.slice(last), last === 0 ? before : text[last - 1]);
}

function smartenSegment(segment: string, before: string | undefined): string {
  const text = REPLACEMENTS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), segment);
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? '';
    // Se mira lo ya convertido: tras “ o ‘ se abre, tras ” o ’ se cierra (comillas anidadas).
    const previous = out.length > 0 ? out[out.length - 1] : before;
    if (char === '"') out += opensQuote(previous) ? '“' : '”';
    else if (char === "'") out += isWordChar(previous) && isWordChar(text[i + 1]) ? '’' : opensQuote(previous) ? '‘' : '’';
    else out += char;
  }
  return out;
}
