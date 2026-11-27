import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Regression guard over infra/caddy/Caddyfile. Caddy evaluates `handle` before a top-level `respond`, so blocking
// /api/internal only works INSIDE `handle /api/*` and before the reverse_proxy (see commit 48f0158: for months the
// rule existed but was never applied). The checks read directives, never comment text, so rewording a comment cannot
// break them.
// CADDYFILE lets the test point at another version of the file (to check that it catches the bug).
const caddyfilePath = process.env.CADDYFILE ?? new URL('../../../infra/caddy/Caddyfile', import.meta.url);
const caddy = readFileSync(caddyfilePath, 'utf8');

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Text of the `{ … }` block opened by the directive line that starts with `start`, with balanced braces. */
function block(start: string): string {
  const line = new RegExp(String.raw`^[ \t]*${escapeRegExp(start)}`, 'm').exec(caddy);
  assert.ok(line, `missing block ${start}`);
  const begin = line.index + line[0].length - start.length;
  let depth = 0;
  for (let i = caddy.indexOf('{', begin); i < caddy.length; i++) {
    if (caddy[i] === '{') depth++;
    if (caddy[i] === '}' && --depth === 0) return caddy.slice(begin, i + 1);
  }
  throw new Error(`unbalanced braces in ${start}`);
}

/** Lines that are directives (no comments), so an explanation is never mistaken for the rule. */
const directives = (text: string): string[] =>
  text.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));

/** The directives of `text` joined back into text, for multi-line patterns. */
const directiveText = (text: string): string => directives(text).join('\n');

test('/api/internal answers 404 inside handle /api/*, before the reverse_proxy', () => {
  const api = block('handle /api/* {');
  assert.ok(directives(api).includes('@internal path /api/internal /api/internal/*'));
  assert.ok(directives(api).includes('respond @internal 404'), 'respond @internal 404 missing inside handle /api/*');
  // Directives are searched at the start of a line: the block's comments also mention reverse_proxy.
  const directive = (name: string): number => api.search(new RegExp(String.raw`^\s*${name}\b`, 'm'));
  assert.ok(directive('respond @internal 404') >= 0 && directive('respond @internal 404') < directive('reverse_proxy'), 'the 404 must come before the proxy');
  assert.ok(!directives(caddy.slice(0, caddy.indexOf(block('handle /api/* {')))).some((line) => line.includes('respond @internal')));
});

test('the admin allows blob: previews and /media is cached forever and allows video', () => {
  assert.match(directiveText(block('handle_path /admin/* {')), /img-src 'self' data: blob: https:; media-src 'self' blob:/);
  const media = directiveText(block('handle_path /media/* {'));
  assert.match(media, /max-age=31536000, immutable/);
  assert.match(media, /media-src 'self'/);
  assert.doesNotMatch(media, /\bencode\b/, 'AVIF, WebP and MP4 are already compressed and Range needs exact bytes');
});

test('admin: hashed assets are cached forever and the rest (the SPA index.html) is revalidated', () => {
  const admin = directives(block('handle_path /admin/* {'));
  assert.ok(admin.includes('@hashed path /assets/*'));
  assert.ok(admin.includes('header @hashed Cache-Control "public, max-age=31536000, immutable"'));
  // Caddy sorts identical `header`s putting the path-specific one first and the one without a matcher last: a bare
  // `header Cache-Control "no-cache"` overrode the immutable of /assets/*. Both carry a matcher and the matchers do
  // not overlap, so the order no longer matters.
  assert.ok(admin.includes('@html not path /assets/*'));
  assert.ok(admin.includes('header @html Cache-Control "no-cache"'));
  assert.deepEqual(admin.filter((line) => /^header Cache-Control\b/.test(line)), [], 'no Cache-Control without a matcher in the admin');
});

test('admin: served precompressed (br/gzip made when building the image), without compressing on every request', () => {
  const admin = block('handle_path /admin/* {');
  assert.match(directiveText(admin), /file_server \{\s*precompressed br gzip\s*\}/);
  assert.ok(!directives(admin).some((line) => line.startsWith('encode')), 'with the .br/.gz already made, encode is redundant');
  // Without the .br/.gz files, `precompressed` compresses nothing: the image has to generate them with the same
  // function the builder uses for the site.
  const dockerfile = readFileSync(new URL('../../../infra/caddy/Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /^RUN node apps\/builder\/src\/precompress\.ts apps\/admin\/dist$/m);
});

test('error responses (404 of /media, /_astro or pages) are never cached and carry the security headers', () => {
  const errors = block('handle_errors {');
  // At the block level, not only inside @notfound: the API's 502/503 too.
  const topLevel = directives(errors.replace(block('handle @notfound {'), ''));
  assert.ok(topLevel.includes('header Cache-Control "no-store"'), 'a 404 inherited the immutable of /media or /_astro');
  // Error routes do not go through the site directives: the security headers come from a snippet both import.
  assert.ok(topLevel.includes('import security'));
  assert.match(caddy, /^\{\$SITE_ADDRESS:localhost\} \{\n\timport security$/m, 'the site imports the snippet as its first directive');
  const security = directives(block('(security) {'));
  for (const header of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', '-Server']) {
    assert.ok(security.some((line) => line.startsWith(header)), header);
  }
});

test('/api/admin/* is never stored in any cache, even if the API sends its own Cache-Control', () => {
  const api = directives(block('handle /api/* {'));
  assert.ok(api.includes('@admin path /api/admin/*'));
  // `>` = deferred: it replaces what comes from the API instead of adding a second Cache-Control.
  assert.ok(api.includes('header @admin >Cache-Control "no-store"'));
});

test('API health check: usable a few seconds after starting and without flapping on one failed check', () => {
  const proxy = directives(block('reverse_proxy api:8080 {'));
  const value = (name: string): string | undefined => proxy.find((line) => line.startsWith(`${name} `))?.split(/\s+/)[1];
  assert.equal(value('health_uri'), '/api/health');
  // With 30 s, if the first check failed while the API was starting, /api answered 503 for ~30 s.
  assert.equal(value('health_interval'), '2s');
  // It takes 3 failures in a row (~6 s) to take it out: a single slow response does not take it out of service.
  assert.equal(value('health_fails'), '3');
});

test('the root redirects by the browser language: English → /en/, otherwise → /es/', () => {
  const root = directiveText(block('handle @root {'));
  assert.match(caddy, /^\s*@root path \/\s*$/m, 'the @root matcher must be exactly the root');
  assert.match(root, /^header Vary Accept-Language$/m, 'caches must split the response by language');
  assert.match(root, /header_regexp Accept-Language/);
  // The exact expression: only the FIRST preference, and "en" as a whole word (en, en-US). Without \b, "eng" or an
  // "english-fake" would also go to /en/.
  const english = /^@english header_regexp Accept-Language (\S+)\s*$/m.exec(root)?.[1];
  assert.equal(english, String.raw`(?i)^\s*en\b`);
  // The same expression in JS (Go's `(?i)` = the i flag) to pin what goes in and what does not.
  const prefersEnglish = new RegExp((english ?? '').replace(/^\(\?i\)/, ''), 'i');
  for (const header of ['en', 'en-US,en;q=0.9', ' EN-gb', 'en;q=0.8,es']) assert.ok(prefersEnglish.test(header), header);
  for (const header of ['english-fake', 'eng', 'es-AR,en;q=0.9', 'fr,en']) assert.ok(!prefersEnglish.test(header), header);
  assert.match(root, /^redir @english \/en\/ 302$/m);
  // `redir /es/ 302` does NOT work: Caddy takes /es/ as a path matcher, not as the target. It needs the wildcard.
  assert.match(root, /^redir \* \/es\/ 302$/m);
});

test('a missing admin asset gives a 404, not the SPA index.html with an immutable cache', () => {
  // With `try_files {path} /index.html` for everything, an old tab requesting /assets/old-hash.js after a deploy got
  // index.html with `immutable` for a year and that browser was left with a broken admin.
  const admin = directiveText(block('handle_path /admin/* {'));
  // `try_files` does NOT accept a matcher (Caddy takes `@x` as one more file and still falls into index.html): it
  // takes a `rewrite` with a matcher that excludes /assets/* and whatever does exist.
  assert.match(admin, /@spa \{\s*not path \/assets\/\*\s*not file\s*\}/, '@spa matcher: not /assets/* and the file does not exist');
  assert.match(admin, /^rewrite @spa \/index\.html$/m);
  assert.doesNotMatch(admin, /^try_files\b/m, 'no try_files (it does not accept a matcher)');
});

test('the 404 of /api/internal is not cached either (respond does not go through handle_errors)', () => {
  assert.ok(directives(block('handle /api/* {')).includes('header @internal Cache-Control "no-store"'));
});

test('404 by the URL language: /en/… → /en/404.html, /es/… → /es/404.html, the rest → /404.html', async () => {
  const { LANGS, NOT_FOUND_PATH, paths } = await import('../src/lib/i18n.ts');
  const notFound = directives(block('handle @notfound {'));
  // The targets come from the same routes the build writes the files with (lib/i18n.ts): they cannot diverge.
  for (const lang of LANGS) assert.ok(notFound.includes(`rewrite /${lang}/* ${paths.notFound(lang)}`), lang);
  // The rewrites of one block are mutually exclusive and Caddy tries the path ones before `*`: this one is the rest.
  assert.ok(notFound.includes(`rewrite * ${NOT_FOUND_PATH}`));
  assert.equal(notFound.filter((line) => line.startsWith('rewrite ')).length, LANGS.length + 1);
  // Still a 404 served from the published site, precompressed.
  assert.ok(notFound.includes('root * /srv/site/current'));
  assert.match(directiveText(block('handle @notfound {')), /file_server \{\s*precompressed br gzip\s*\}/);
});

test('/media does not serve the restore staging folder', () => {
  // restore.sh stages the files in /media/.restoring before moving them into place: it must never be visible.
  assert.match(directiveText(block('handle_path /media/* {')), /file_server \{\s*hide \.restoring\s*\}/);
});

test('/admin without the trailing slash redirects to the admin instead of a 404', () => {
  assert.match(directiveText(caddy), /^redir \/admin \/admin\/ 308$/m);
});
