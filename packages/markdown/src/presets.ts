import type { RenderOptions } from './types.ts';

/**
 * Cómo se renderiza el cuerpo de un post. Lo usan el build del sitio y la vista previa del admin, así lo que se ve en
 * el editor es lo que se publica; cada uno agrega el idioma del post (`{ ...POST_BODY_RENDER_OPTIONS, lang }`).
 * - minHeadingLevel 2: "## sección, ### subsección" y un `#` del cuerpo también es sección; el título del post es el
 *   único <h1> de la página (plataforma-calidad L5).
 * - Figuras y tipografía inteligente: opcionales en el renderer solo para no cambiar otros usos (editor-pro L4).
 */
export const POST_BODY_RENDER_OPTIONS = Object.freeze({
  minHeadingLevel: 2,
  smartTypography: true,
  figures: true,
} as const satisfies RenderOptions);
