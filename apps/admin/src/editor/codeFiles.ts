/*
 * Text and code files pasted or dropped into the editor: their content goes into the post as a fenced code block whose
 * language comes from the file name. Nothing is uploaded. Pure (no React, no DOM): the editor hook reads the file and
 * inserts what this module builds.
 */

/** The largest file inserted as code: beyond this it is a dump, not a snippet for a post. */
export const MAX_CODE_FILE_BYTES = 256 * 1024;

/**
 * The one extension map: extension (lowercase, without the dot) → fence language. `''` = plain text, a block without
 * a language. The names are the ones the site's highlighter (`@blog/highlight`, highlight.js) answers to, canonical
 * or alias; a language it does not know renders as a plain block, never as an error.
 */
export const CODE_LANGUAGES: Readonly<Record<string, string>> = Object.freeze({
  py: 'python', pyw: 'python',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  cs: 'csharp', csx: 'csharp',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  ps1: 'powershell', psm1: 'powershell',
  sql: 'sql',
  json: 'json', jsonc: 'json', webmanifest: 'json',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown',
  html: 'html', htm: 'html', xml: 'xml', xsl: 'xml', csproj: 'xml', props: 'xml',
  css: 'css', scss: 'scss', less: 'less',
  go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  rb: 'ruby', php: 'php', kt: 'kotlin', kts: 'kotlin', swift: 'swift', r: 'r', diff: 'diff', patch: 'diff',
  toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini',
  txt: '', text: '', log: '', csv: '', tsv: '',
});

/** Files known by their whole name (no extension, or one that says nothing). */
export const CODE_FILE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  dockerfile: 'dockerfile', containerfile: 'dockerfile',
  makefile: 'makefile', gnumakefile: 'makefile',
  gemfile: 'ruby', rakefile: 'ruby',
  '.gitignore': '', '.gitattributes': '', '.dockerignore': '', '.editorconfig': 'ini',
  license: '', readme: '', changelog: '', procfile: '',
});

/** The fence language of a code file, `''` for plain text, or null if the name says it is not a known text file. */
export function codeLanguageOf(fileName: string): string | null {
  const name = fileName.toLowerCase();
  const byName = CODE_FILE_NAMES[name];
  if (byName !== undefined) return byName;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null; // no extension (or a dot file not listed above)
  return CODE_LANGUAGES[name.slice(dot + 1)] ?? null;
}

/** MIME types of text the browser may give a file whose extension is not in the map (`data.csv`, `feed.atom`). */
export function isTextType(type: string): boolean {
  const mime = type.toLowerCase().split(';')[0]?.trim() ?? '';
  return (
    mime.startsWith('text/') ||
    /^application\/(json|xml|javascript|ecmascript|x-sh|x-httpd-php|sql|toml|yaml|x-yaml)$/.test(mime) ||
    /\+(json|xml)$/.test(mime)
  );
}

/**
 * The file's text, or null if it is binary: a NUL byte or invalid UTF-8 (the decoder fails). A leading BOM is dropped
 * and Windows line ends become `\n`, like typed text.
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
  return text.replace(/\r\n?/g, '\n');
}

/** The longest run of backticks in `text` (0 if none). */
const longestBacktickRun = (text: string): number =>
  Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));

/**
 * A fenced code block. The fence is longer than any backtick run inside the code (at least three), so no line of the
 * file can close the block early and turn the rest into Markdown.
 */
export function fencedBlock(code: string, language: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1));
  const body = code.endsWith('\n') ? code : code === '' ? '' : `${code}\n`;
  return `${fence}${language}\n${body}${fence}`;
}

/** A file name as an inline code span: a name with backticks gets a longer delimiter and spaces (CommonMark). */
function codeSpan(text: string): string {
  if (!text.includes('`')) return `\`${text}\``;
  const ticks = '`'.repeat(longestBacktickRun(text) + 1);
  return `${ticks} ${text} ${ticks}`;
}

export interface CodeFileEntry {
  readonly name: string;
  readonly text: string;
  readonly language: string;
}

/** One block per file; with several, each is preceded by its file name as a caption line so they can be told apart. */
export function codeBlocks(entries: readonly CodeFileEntry[]): string {
  const blocks = entries.map((entry) => fencedBlock(entry.text, entry.language));
  if (entries.length === 1) return blocks[0] ?? '';
  return entries.map((entry, index) => `${codeSpan(entry.name)}\n\n${blocks[index]}`).join('\n\n');
}

/** What `readCodeFile` needs of a File (tests pass plain objects). */
export interface ReadableFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type CodeFileResult =
  | { readonly ok: true; readonly entry: CodeFileEntry }
  | { readonly ok: false; readonly reason: 'tooLarge' | 'binary' };

/** Reads a code file into its block entry. The size is checked before reading anything. */
export async function readCodeFile(file: ReadableFile): Promise<CodeFileResult> {
  if (file.size > MAX_CODE_FILE_BYTES) return { ok: false, reason: 'tooLarge' };
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  if (text === null) return { ok: false, reason: 'binary' };
  return { ok: true, entry: { name: file.name, text, language: codeLanguageOf(file.name) ?? '' } };
}
