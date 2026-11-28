import type { CodeHighlighter, RenderOptions } from '@blog/markdown';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * Syntax highlighting of post code blocks, injected into @blog/markdown's `highlight` option by the site build and the
 * admin preview (`postBodyOptions` of @blog/math), so the preview is the page.
 *
 * highlight.js core with a curated set of languages, not Shiki: its output is class-based (`<span class="hljs-…">`,
 * themed by the tokens in prose.css, so the site CSP needs nothing new) and the whole set adds tens of KB to the
 * admin bundle, where Shiki's TextMate grammars and regex engine add megabytes. Each language brings its own aliases
 * (`py`, `js`, `jsx`, `ts`, `tsx`, `sh`, `cs`, `yml`, `html`, …), resolved in any case.
 *
 * Safety: highlight.js escapes all the code; its HTML is the escaped code with spans around tokens (the tests check
 * that, for every language, removing the spans leaves exactly `escapeHtml(code)`). Plain text and unknown languages
 * answer null, and the renderer escapes the code as always.
 */

const LANGUAGES = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, markdown, plaintext, powershell, python,
  r, rust, shell, sql, typescript, xml, yaml,
} as const;

/** The highlighted languages, by their canonical name (each also answers to its aliases). */
export const HIGHLIGHT_LANGUAGES: readonly string[] = Object.freeze(Object.keys(LANGUAGES));

// An instance of its own: nothing else in the bundle can register or reconfigure languages on it.
const highlighter = hljs.newInstance();
for (const [name, language] of Object.entries(LANGUAGES)) highlighter.registerLanguage(name, language);

/** Languages that are plain text: highlighting would only wrap them in a span. */
const PLAIN = new Set(['plaintext']);

/**
 * Code → class-based HTML, or null when the language is unknown or plain text. highlight.js writes `'` as `&#x27;`;
 * it becomes `&#39;`, the entity of @blog/markdown's `escapeHtml`, so the text inside the spans is that function's.
 */
export const highlightCode: CodeHighlighter = (code, language) => {
  const found = highlighter.getLanguage(language);
  const canonical = found && HIGHLIGHT_LANGUAGES.find((candidate) => highlighter.getLanguage(candidate) === found);
  if (!canonical || PLAIN.has(canonical)) return null;
  try {
    return highlighter.highlight(code, { language: canonical, ignoreIllegals: true }).value.replace(/&#x27;/g, '&#39;');
  } catch {
    return null;
  }
};

/** The highlight part of the post body options. */
export const HIGHLIGHT_RENDER_OPTIONS = Object.freeze({ highlight: highlightCode } as const satisfies RenderOptions);
