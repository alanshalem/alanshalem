import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// The Caddyfile rules added for production. The earlier rules (caching, /api/internal, language, 404) are in
// apps/web/test/caddyfile.test.ts. Real validation: `caddy validate` in the image and curl -I against the local copy.
const caddy = readFileSync(new URL('../caddy/Caddyfile', import.meta.url), 'utf8');

/** Text of the `{ … }` block that starts at `start`, with balanced braces. */
function block(start: string): string {
  const begin = caddy.indexOf(start);
  assert.ok(begin >= 0, `missing block ${start}`);
  let depth = 0;
  for (let i = caddy.indexOf('{', begin + start.length - 1); i < caddy.length; i++) {
    if (caddy[i] === '{') depth++;
    if (caddy[i] === '}' && --depth === 0) return caddy.slice(begin, i + 1);
  }
  throw new Error(`unbalanced braces in ${start}`);
}
const directives = (text: string): string[] =>
  text.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));

describe('Caddyfile (production)', () => {
  it('the global options go first: the ACME email (optional) and the forwarding proxies Caddy trusts (none by default)', () => {
    assert.deepEqual(directives(caddy).slice(0, 6), ['{', '{$CADDY_ACME_EMAIL}', 'servers {', '{$CADDY_TRUSTED_PROXIES}', '}', '}']);
    // Strict parsing skips trusted (private) addresses: a visitor Traefik sees as Docker's gateway became Traefik's IP
    // (seen end to end).
    assert.doesNotMatch(caddy, /^\s*trusted_proxies_strict/m);
  });

  it('the API gets one X-Forwarded-For: the visitor as Caddy resolved it, never a chain or Caddy-side address', () => {
    assert.ok(directives(block('reverse_proxy api:8080 {')).includes('header_up X-Forwarded-For {client_ip}'));
  });

  it('staging (SITE_ENV=staging): every response, errors included, says noindex, nofollow', () => {
    // Defined once, in the site block: handle_errors sees it, and a definition inside the snippet (imported twice)
    // makes Caddy reject the file.
    assert.match(caddy, /^\{\$SITE_ADDRESS:localhost\} \{\n\timport security\n(\t#.*\n)*\t@staging expression \{env\.SITE_ENV\} == "staging"$/m);
    assert.equal(caddy.match(/^\s*@staging expression/gm)?.length, 1);
    // Deferred (>) so it replaces the admin's own X-Robots-Tag "noindex" instead of losing to it.
    assert.ok(directives(block('(security) {')).includes('header @staging >X-Robots-Tag "noindex, nofollow"'));
    assert.match(caddy, /^\thandle_errors \{\n\t\timport security$/m);
  });

  it('staging: robots.txt disallows everything; production keeps the site one', () => {
    const matcher = directives(block('@staging_robots {'));
    assert.ok(matcher.includes('path /robots.txt'));
    assert.ok(matcher.includes('expression {env.SITE_ENV} == "staging"'));
    const robots = block('handle @staging_robots {');
    assert.match(robots, /respond <<TXT\n\t\t\tUser-agent: \*\n\t\t\tDisallow: \/\n\t\t\tTXT 200/);
    assert.ok(directives(robots).includes('header Content-Type "text/plain; charset=utf-8"'));
  });

  it('cross-origin isolation on every response (errors too, which import the same snippet)', () => {
    const security = directives(block('(security) {'));
    assert.ok(security.includes('Cross-Origin-Opener-Policy "same-origin"'));
    // As a separate `header` and not inside the block with `-Server`: that block is applied deferred and would override
    // /media's cross-origin (it happened with the first version, seen with curl -I).
    assert.ok(security.includes('header Cross-Origin-Resource-Policy "same-origin"'));
    const snippet = block('(security) {');
    const start = snippet.indexOf('header {');
    assert.doesNotMatch(snippet.slice(start, snippet.indexOf('}', start)), /Cross-Origin-Resource-Policy/);
  });

  it('/media can be embedded from another origin: the RSS feed carries the images and web readers load them', () => {
    assert.ok(directives(block('handle_path /media/* {')).includes('header Cross-Origin-Resource-Policy "cross-origin"'));
  });

  it('the admin panel is not indexed', () => {
    assert.ok(directives(block('handle_path /admin/* {')).includes('header X-Robots-Tag "noindex"'));
  });

  it('access logs in JSON on standard output', () => {
    assert.match(block('log {'), /output stdout\n\t\tformat json/);
  });
});
