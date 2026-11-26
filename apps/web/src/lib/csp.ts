import { createHash } from 'node:crypto';
import type { AstroUserConfig } from 'astro';

import { HERO_ROTATION_SCRIPT } from './hero-rotation.ts';
import { MEDIA_GUARD_SCRIPT } from './media-guard.ts';

/**
 * Content Security Policy del sitio (perfil-skills-produccion L8, P2-10). Con `security.csp`, Astro escribe en cada
 * página un <meta http-equiv="content-security-policy"> con estas directivas más `script-src` y `style-src` con los
 * hashes de lo que él procesa (los <script> de Header y del índice, el CSS en línea). Los <script is:inline> no los
 * procesa: sus hashes salen de las constantes de abajo, así un cambio en el script cambia el hash en el mismo build.
 *
 * - Todo es propio ('self'), salvo imágenes: `data:` porque el placeholder de las fotos (fondo del hero) es un data
 *   URI, y `https:` porque la API acepta portadas con URL http(s) y el Markdown, imágenes externas: bloquearlas
 *   escondería contenido que el autor cargó a propósito. Solo https (en un sitio https, http sería contenido mixto).
 * - `style-src-attr 'unsafe-inline'`: el color de espera de cada foto va en su atributo `style` (lib/responsive-image).
 *   Un atributo de estilo no ejecuta código; los <style> siguen con hash. El build avisa que 'self' de style-src no
 *   vale para atributos: es justo lo buscado ('self' queda para una hoja externa si inlineStylesheets deja de ser
 *   'always').
 * - Sin frame-ancestors: un <meta> lo ignora. Lo cubre X-Frame-Options: DENY, que Caddy manda en toda respuesta.
 * - Astro pone el <meta> al final del <head>: rige todo el <body>, donde va el contenido que llega de la API. El
 *   guardián de medios corre antes (es lo primero del <head>) y su hash igual va, por si la política llega como
 *   cabecera HTTP.
 */

/** Fuente CSP (`sha256-…` en base64) del contenido exacto de un script o estilo en línea. */
export const cspHash = (content: string): `sha256-${string}` =>
  `sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`;

/** Los <script is:inline> ejecutables del sitio, por nombre (un test verifica que no haya otros en src/). */
export const INLINE_SCRIPTS = { MEDIA_GUARD_SCRIPT, HERO_ROTATION_SCRIPT } as const;

/** `security.csp` de astro.config.mjs. */
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
