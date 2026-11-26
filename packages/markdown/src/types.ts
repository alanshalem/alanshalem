/** Un encabezado del documento, útil para armar el índice (TOC) lateral. */
export interface Heading {
  /** Nivel final en el HTML (ya con `headingOffset` y `minHeadingLevel` aplicados). */
  level: number;
  /** Valor del atributo id del <hN>; es el ancla (#id). */
  id: string;
  /** Texto plano, sin marcas de Markdown. */
  text: string;
}

/** Idioma del post: define los textos que agrega el renderer (títulos de cajas, notas al pie). */
export type Lang = 'es' | 'en';

export interface RenderOptions {
  /**
   * Cuánto bajar el nivel de todos los encabezados (`#` → <h2> con 1). Lo usan textos cortos que van debajo de otro
   * título, como la bio de la home. Se limita a 5. Para el cuerpo de un post, ver minHeadingLevel.
   */
  headingOffset?: number;
  /**
   * Nivel mínimo de los encabezados, después de headingOffset. Con 2, `#` y `##` salen como <h2> y `###` como <h3>:
   * "## sección, ### subsección", como GitHub o Docs, y el <h1> queda para el título de la página (plataforma-calidad
   * L5). Se limita a 1..6. Por defecto 1, para que el HTML existente no cambie.
   */
  minHeadingLevel?: number;
  /** Idioma de los textos agregados ("Nota" / "Note"...). Por defecto 'es'. */
  lang?: Lang;
  /**
   * Comillas “ ” ‘ ’, rayas – — y … al renderizar (nunca en código, URLs ni atributos).
   * Por defecto false para que el HTML existente no cambie; el sitio y el admin la activan.
   */
  smartTypography?: boolean;
  /**
   * Una imagen sola en su párrafo y con título (`![alt](url "epígrafe")`) sale como
   * <figure> + <figcaption>. Por defecto false por la misma razón que smartTypography.
   */
  figures?: boolean;
}

export interface RenderResult {
  html: string;
  headings: Heading[];
}
