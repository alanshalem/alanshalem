import type { Route } from '../useRoute.ts';

/*
 * Cambios sin guardar (P1-5): cada formulario abierto (editor de posts, ajustes) registra un guardia con
 * useUnsavedGuard; antes de cambiar de vista (un enlace, "← Posts", atrás del navegador, Salir, "Crear versión") se
 * consulta esta regla. El guardado automático deja el formulario limpio, así que un borrador ya guardado no pregunta.
 */

/** Un formulario abierto: si tiene cambios y qué preguntar (en el idioma de la interfaz). */
export interface LeaveGuard {
  readonly dirty: boolean;
  readonly message: string;
}

const sameRoute = (a: Route, b: Route): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Lo que hay que confirmar para ir de `from` a `to`, o null para ir sin preguntar. `to` null = salir hacia algo que
 * todavía no tiene ruta (cerrar sesión, la versión que se va a crear).
 */
export function leaveConfirmation(guards: Iterable<LeaveGuard>, from: Route, to: Route | null): string | null {
  if (to !== null && sameRoute(from, to)) return null;
  for (const guard of guards) if (guard.dirty) return guard.message;
  return null;
}

// Un ref por formulario montado: se lee al decidir, así vale lo último que se escribió sin re-registrar en cada tecla.
const guards = new Set<{ readonly current: LeaveGuard }>();

/** Registra el guardia de un formulario mientras está montado; devuelve la baja. */
export function registerLeaveGuard(guard: { readonly current: LeaveGuard }): () => void {
  guards.add(guard);
  return () => void guards.delete(guard);
}

/** Pregunta (window.confirm) solo si se pierde algo; true = seguir. */
export function confirmLeave(from: Route, to: Route | null): boolean {
  const message = leaveConfirmation([...guards].map((guard) => guard.current), from, to);
  return message === null || window.confirm(message);
}
