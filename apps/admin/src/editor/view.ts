/* Vista del editor (S2): solo editor, dividida o solo vista previa, y el modo foco. Se recuerda entre visitas. */

const VIEWS = ['editor', 'split', 'preview'] as const;
export type EditorView = (typeof VIEWS)[number];

export interface ViewPrefs {
  readonly view: EditorView;
  readonly focus: boolean;
}

export const DEFAULT_VIEW_PREFS: ViewPrefs = { view: 'split', focus: false };
export const VIEW_STORAGE_KEY = 'admin.editorView';

/** El atajo de vista rota en este orden. */
export const nextView = (view: EditorView): EditorView => VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length] ?? 'split';

const isView = (value: unknown): value is EditorView => (VIEWS as readonly unknown[]).includes(value);

/** Lo guardado si es válido; si no (o el almacenamiento está bloqueado), lo de por defecto. */
export function loadViewPrefs(storage: Pick<Storage, 'getItem'> | null): ViewPrefs {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(VIEW_STORAGE_KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return DEFAULT_VIEW_PREFS;
    const { view, focus } = stored as Record<string, unknown>;
    return isView(view) && typeof focus === 'boolean' ? { view, focus } : DEFAULT_VIEW_PREFS;
  } catch {
    return DEFAULT_VIEW_PREFS; // JSON roto o almacenamiento bloqueado
  }
}

/** Si no se puede guardar, la elección dura lo que dure la pestaña: no es motivo para un error. */
export function saveViewPrefs(storage: Pick<Storage, 'setItem'> | null, prefs: ViewPrefs): void {
  try {
    storage?.setItem(VIEW_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* cuota llena o almacenamiento bloqueado */
  }
}
