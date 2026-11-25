/** Un encabezado del documento, útil para armar el índice (TOC) lateral. */
export interface Heading {
  /** Nivel final en el HTML (ya con `headingOffset` aplicado). */
  level: number;
  /** Valor del atributo id del <hN>; es el ancla (#id). */
  id: string;
  /** Texto plano, sin marcas de Markdown. */
  text: string;
}

export interface RenderOptions {
  /**
   * Cuánto bajar el nivel de los encabezados. El título del post ya es el <h1>
   * de la página, así que normalmente el `#` del cuerpo debería salir como <h2>
   * (headingOffset: 1). Se limita a 5.
   */
  headingOffset?: number;
}

export interface RenderResult {
  html: string;
  headings: Heading[];
}
