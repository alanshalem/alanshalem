import type { Route } from '../useRoute.ts';

/*
 * Unsaved changes: every open form (post editor, settings) registers a guard with useUnsavedGuard; before changing
 * the view (a link, "← Posts", the browser's back, Salir, "Crear versión") this rule is consulted. Autosave leaves the
 * form clean, so an already saved draft does not ask.
 */

/** An open form: whether it has changes and what to ask (in the UI language). */
export interface LeaveGuard {
  readonly dirty: boolean;
  readonly message: string;
}

const sameRoute = (a: Route, b: Route): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * What must be confirmed to go from `from` to `to`, or null to go without asking. `to` null = leaving towards
 * something that has no route yet (logging out, the version about to be created).
 */
export function leaveConfirmation(guards: Iterable<LeaveGuard>, from: Route, to: Route | null): string | null {
  if (to !== null && sameRoute(from, to)) return null;
  for (const guard of guards) if (guard.dirty) return guard.message;
  return null;
}

// One ref per mounted form: read when deciding, so the latest typing counts without re-registering on every key.
const guards = new Set<{ readonly current: LeaveGuard }>();

/** Registers a form's guard while it is mounted; returns the unregister function. */
export function registerLeaveGuard(guard: { readonly current: LeaveGuard }): () => void {
  guards.add(guard);
  return () => void guards.delete(guard);
}

/** Asks (window.confirm) only if something would be lost; true = go on. */
export function confirmLeave(from: Route, to: Route | null): boolean {
  const message = leaveConfirmation([...guards].map((guard) => guard.current), from, to);
  return message === null || window.confirm(message);
}
