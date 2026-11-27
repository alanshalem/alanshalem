import { createHash } from 'node:crypto';
import type { AstroUserConfig } from 'astro';

import { HERO_ROTATION_SCRIPT } from './hero-rotation.ts';
import { MEDIA_GUARD_SCRIPT } from './media-guard.ts';

/**
 * The site's Content Security Policy. With `security.csp`, Astro writes on every page a
 * <meta http-equiv="content-security-policy"> with these directives plus `script-src` and `style-src` with the hashes
 * of what it processes (the <script>s of Header and of the table of contents, the inline CSS). It does not process the
 * <script is:inline>s: their hashes come from the constants below, so a change in a script changes its hash in the
 * same build.
 *
 * - Everything is own ('self') except images: `data:` because the photos' placeholder (the hero background) is a data
 *   URI, and `https:` because the API accepts covers with an http(s) URL and Markdown accepts external images:
 *   blocking them would hide content the author added on purpose. Only https (on an https site, http would be mixed
 *   content).
 * - `style-src-attr 'unsafe-inline'`: each photo's waiting color goes in its `style` attribute (lib/responsive-image).
 *   A style attribute runs no code; the <style>s keep their hashes. The build warns that style-src 'self' does not
 *   apply to attributes: that is exactly the point ('self' stays for an external sheet if inlineStylesheets stops
 *   being 'always').
 * - No frame-ancestors: a <meta> ignores it. X-Frame-Options: DENY covers it; Caddy sends it on every response.
 * - Astro puts the <meta> at the end of the <head>: it governs the whole <body>, where the content from the API goes.
 *   The media guard runs before it (it is the first thing in the <head>) and its hash is included anyway, in case the
 *   policy is ever sent as an HTTP header.
 */

/** CSP source (`sha256-…` in base64) of the exact content of an inline script or style. */
export const cspHash = (content: string): `sha256-${string}` =>
  `sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`;

/** The site's executable <script is:inline>s, by name (a test checks that src/ has no others). */
export const INLINE_SCRIPTS = { MEDIA_GUARD_SCRIPT, HERO_ROTATION_SCRIPT } as const;

/** `security.csp` of astro.config.mjs. */
export const SITE_CSP = {
  directives: [
    "default-src 'self'",
    "img-src 'self' data: https:",
    "media-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ],
  scriptDirective: { hashes: Object.values(INLINE_SCRIPTS).map(cspHash) },
  styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }] },
} satisfies Exclude<NonNullable<NonNullable<AstroUserConfig['security']>['csp']>, boolean>;
