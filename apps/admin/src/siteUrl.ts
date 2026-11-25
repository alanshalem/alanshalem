/**
 * Raíz del sitio público, para los enlaces "Ver sitio" y "Volver al sitio".
 * En producción Caddy sirve el sitio y el admin en el mismo dominio, así que es "/". En desarrollo el sitio corre
 * en otro servidor (Astro): vite.config.ts inyecta su URL solo en `vite dev`. Sin Vite (tests) también vale "/".
 */
export const SITE_URL: string = import.meta.env?.VITE_SITE_URL ?? '/';
