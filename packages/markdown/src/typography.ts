/**
 * Smart typography: quotes “ ” ‘ ’, apostrophe ’, dashes – — and ellipsis ….
 *
 * Applied when rendering (the stored Markdown stays in easy-to-type ASCII) and only to plain text runs: the inline
 * renderer never calls it for code, URLs or attributes.
 * Spanish and English use the same double quotes “ ” (Spanish accepts «» or “”): that way a post and its
 * translation share one style, and `lang` does not change this function.
 */

const REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/---/g, '—'], // before '--', otherwise it would become "–-"
  [/--/g, '–'],
  [/\.\.\./g, '…'],
];

// Bare URLs in the text are not links, but changing their "--" or "..." would break them when copied.
const BARE_URL = /(?:https?:\/\/|mailto:|www\.)[^\s"']+/gi;

// Before an opening quote: start, whitespace, an opening sign or an already converted quote/dash.
const OPENING_CONTEXT = /[\s([{¡¿“‘–—]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

const opensQuote = (before: string | undefined): boolean => before === undefined || OPENING_CONTEXT.test(before);

/** A letter or digit of any script: the one definition of "inside a word" (apostrophes here, `_` emphasis in inline.ts). */
export const isWordChar = (char: string | undefined): boolean => char !== undefined && WORD_CHAR.test(char);

/** `before` is the document character right before `text` (it decides whether a quote opens or closes). */
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
    // Looks at the converted output: after “ or ‘ it opens, after ” or ’ it closes (nested quotes).
    const previous = out.length > 0 ? out[out.length - 1] : before;
    if (char === '"') out += opensQuote(previous) ? '“' : '”';
    else if (char === "'") out += isWordChar(previous) && isWordChar(text[i + 1]) ? '’' : opensQuote(previous) ? '‘' : '’';
    else out += char;
  }
  return out;
}
