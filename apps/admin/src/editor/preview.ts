import {
  POST_BODY_RENDER_OPTIONS,
  readingTimeMinutes,
  renderMarkdown,
  toPlainText,
  type Heading,
  type RenderOptions,
  type RenderResult,
} from '@blog/markdown';
import type { Lang } from '../languages.ts';
import { isTopLevelHeading } from './markdownSource.ts';
import { blockStartLines } from './scrollSync.ts';

/**
 * Las opciones con las que el sitio renderiza el cuerpo de un post (POST_BODY_RENDER_OPTIONS de @blog/markdown, las
 * mismas que usa el build + el idioma del post): la vista previa es lo que se publica (## = h2, ### = h3, comillas,
 * figuras, títulos de cajas).
 */
export const previewOptions = (lang: Lang): RenderOptions => ({ ...POST_BODY_RENDER_OPTIONS, lang });

export const renderPreview = (markdown: string, lang: Lang): RenderResult => renderMarkdown(markdown, previewOptions(lang));

export interface DocumentStats {
  readonly words: number;
  readonly characters: number;
  readonly readingMinutes: number;
}

/** Lo que se lee (sin marcas de Markdown), con la fórmula de minutos del sitio. */
export function documentStats(markdown: string): DocumentStats {
  const text = toPlainText(markdown);
  return {
    words: text === '' ? 0 : text.split(' ').length,
    characters: [...text].length, // por código Unicode: un emoji o una letra con tilde cuentan uno
    readingMinutes: readingTimeMinutes(markdown),
  };
}

/** Un título del esquema: el del renderer y la línea del editor donde está (null si no se pudo ubicar). */
export interface OutlineEntry extends Heading {
  readonly line: number | null;
}

/**
 * El renderer no dice de qué línea sale cada título, así que se los empareja por orden con los bloques de título de
 * primer nivel (solo esos tienen ancla), partidos con las mismas reglas que el scroll sincronizado. Si las cuentas no
 * coinciden (un caso raro), mejor sin línea que mandar al editor a otro título.
 */
export function outlineEntries(markdown: string, headings: readonly Heading[]): OutlineEntry[] {
  const source = markdown.replace(/\r\n?/g, '\n').split('\n');
  const lines = blockStartLines(markdown).filter((line) => isTopLevelHeading(source[line] ?? ''));
  const paired = lines.length === headings.length;
  return headings.map((heading, i) => ({ ...heading, line: paired ? (lines[i] ?? null) : null }));
}
