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
  it('the global options go first: the ACME email (optional), the forwarding proxies Caddy trusts (none by default) and the proxy gate before every route', () => {
    assert.deepEqual(directives(caddy).slice(0, 7), ['{', '{$CADDY_ACME_EMAIL}', 'servers {', '{$CADDY_TRUSTED_PROXIES}', '}', 'order error before handle', '}']);
    // Strict parsing skips trusted (private) addresses: a visitor Traefik sees as Docker's gateway became Traefik's IP
    // (seen end to end).
    assert.doesNotMatch(caddy, /^\s*trusted_proxies_strict/m);
  });

  it('the API gets one X-Forwarded-For: the visitor as Caddy resolved it, never a chain or Caddy-side address', () => {
    assert.ok(directives(block('reverse_proxy api:8080 {')).includes('header_up X-Forwarded-For {client_ip}'));
  });

  it('with PROXY_SECRET set (behind Dokploy), a request without the proxy secret is refused with 403 before any route', () => {
    // The first directives of the site block: the gate runs before /api, /admin, /media and the site (`order error
    // before handle` above), so a container on the shared network that calls Caddy directly reaches nothing, and the
    // forwarded headers Caddy trusts only ever come from the proxy that knows the secret. Without PROXY_SECRET (plain
    // VPS, local copy) it matches nothing.
    const site = directives(block('{$SITE_ADDRESS:localhost} {'));
    const gate = '@unproxied expression {env.PROXY_SECRET} != "" && {header.X-Proxy-Secret} != {env.PROXY_SECRET}';
    assert.ok(site.includes(gate), 'missing the @unproxied matcher');
    assert.ok(site.includes('error @unproxied 403'), 'missing error @unproxied 403');
    assert.equal(caddy.match(/^\s*error /gm)?.length, 1, 'the global order moves every `error` before handle');
  });

  it('the proxy secret goes no further than Caddy: not to the API and not to the access log', () => {
    assert.ok(directives(block('reverse_proxy api:8080 {')).includes('header_up -X-Proxy-Secret'));
    assert.deepEqual(directives(block('log {')), ['log {', 'output stdout', 'format filter {', 'wrap json', 'request>headers>X-Proxy-Secret delete', '}', '}']);
  });

  it('SITE_ENV is production or staging: any other value has no snippet to import and Caddy refuses to start', () => {
    const snippets = [...caddy.matchAll(/^\(site-env-([^)]+)\) \{$/gm)].map((match) => match[1]);
    assert.deepEqual(snippets, ['production', 'staging']);
    // Imported once, from the site block, with the compose default when SITE_ENV is unset.
    assert.ok(directives(block('{$SITE_ADDRESS:localhost} {')).includes('import site-env-{$SITE_ENV:production}'));
    assert.equal(caddy.match(/import site-env-/g)?.length, 1);
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

  it('CI and the README run the Caddyfile for real (infra/test/caddy-runtime.sh), not only these text checks', () => {
    for (const path of ['../../.github/workflows/ci.yml', '../../docs/README.md']) {
      assert.match(readFileSync(new URL(path, import.meta.url), 'utf8'), /^\s*(run: )?sh infra\/test\/caddy-runtime\.sh$/m, path);
    }
  });

  it('access logs in JSON on standard output', () => {
    assert.match(block('log {'), /output stdout\n\t\tformat filter \{\n\t\t\twrap json\n/);
  });
});
