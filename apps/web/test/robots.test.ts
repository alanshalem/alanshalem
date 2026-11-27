import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { robotsTxt } from '../src/lib/robots.ts';

/*
 * robots.txt comes from SITE_URL: the fixed file in public/ pointed the sitemap to example.com on every deployment.
 * Now src/pages/robots.txt.ts builds it with the `site` URL.
 */

describe('robotsTxt: the site robots.txt with its own sitemap', () => {
  it('allows crawling the site, not the admin or the API, and points to the domain sitemap', () => {
    assert.equal(
      robotsTxt('https://blog.mydomain.com'),
      'User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: https://blog.mydomain.com/sitemap.xml\n',
    );
  });

  it('the sitemap uses the URL it receives, with no example domains', () => {
    const txt = robotsTxt('http://localhost:8080');
    assert.match(txt, /^Sitemap: http:\/\/localhost:8080\/sitemap\.xml$/m);
    assert.doesNotMatch(txt, /example\.com/);
  });

  it('there is no fixed robots.txt in public/ (it would win over the generated one) and the route uses the `site` URL', () => {
    assert.equal(existsSync(new URL('../public/robots.txt', import.meta.url)), false);
    const page = readFileSync(new URL('../src/pages/robots.txt.ts', import.meta.url), 'utf8');
    assert.match(page, /robotsTxt\(site\.url\)/);
  });
});
