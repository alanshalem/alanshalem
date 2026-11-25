/** Un encabezado del documento, útil para armar el índice (TOC) lateral. */
export interface Heading {
  /** Nivel final en el HTML (ya con `headingOffset` aplicado). */
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
   * Cuánto bajar el nivel de los encabezados. El título del post ya es el <h1>
   * de la página, así que normalmente el `#` del cuerpo debería salir como <h2>
   * (headingOffset: 1). Se limita a 5.
   */
  headingOffset?: number;
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
