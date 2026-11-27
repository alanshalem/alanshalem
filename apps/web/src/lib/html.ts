import { escapeHtml, unescapeHtml } from '@blog/markdown';

/** Pure helpers to read and write the HTML that @blog/markdown produces. */

/** The (already unescaped) value of a double-quoted attribute of a tag, or null when it is missing. */
export function readAttribute(tag: string, name: string): string | null {
  const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  return value === undefined ? null : unescapeHtml(value);
}

/**
 * Already escaped attributes, each with its leading space: `undefined` is skipped and `true` becomes a boolean
 * attribute without a value (`autoplay`).
 */
export const htmlAttributes = (values: Record<string, string | number | true | undefined>): string =>
  Object.entries(values)
    .filter((entry): entry is [string, string | number | true] => entry[1] !== undefined)
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeHtml(String(value))}"`))
    .join('');

// Inside <script> HTML rules: `</script>` or `<!--` would cut the block short. U+2028/2029 break old JS.
const SCRIPT_UNSAFE: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/** JSON to embed in a <script>: the same value when parsed, with no character that HTML interprets. */
export const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => SCRIPT_UNSAFE[char] ?? char);
