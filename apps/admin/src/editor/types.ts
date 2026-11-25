/** Foto del textarea en un momento dado. `start`/`end` son offsets de selección (start === end = cursor). */
export interface EditorState {
  value: string;
  start: number;
  end: number;
}

/**
 * Un cambio de texto declarativo: reemplazar [from, to) por `insert` y dejar la selección en
 * [selectStart, selectEnd] (coordenadas del texto YA editado).
 *
 * Los comandos son funciones puras (estado -> edición) para poder testearlos sin navegador.
 * Aplicar la edición al textarea es un paso aparte (ver applyEdit.ts).
 */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  selectStart: number;
  selectEnd: number;
}

/** Devuelve `null` cuando el comando no aplica; el componente entonces deja el comportamiento nativo. */
export type Command = (state: EditorState) => TextEdit | null;
