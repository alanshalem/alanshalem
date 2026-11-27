/** Snapshot of the textarea at a given moment. `start`/`end` are selection offsets (start === end = caret). */
export interface EditorState {
  value: string;
  start: number;
  end: number;
}

/**
 * A declarative text change: replace [from, to) with `insert` and leave the selection at [selectStart, selectEnd]
 * (coordinates of the ALREADY edited text).
 *
 * Commands are pure functions (state -> edit) so they can be tested without a browser.
 * Applying the edit to the textarea is a separate step (see applyEdit.ts).
 */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  selectStart: number;
  selectEnd: number;
}

/** Returns `null` when the command does not apply; the component then keeps the native behavior. */
export type Command = (state: EditorState) => TextEdit | null;
