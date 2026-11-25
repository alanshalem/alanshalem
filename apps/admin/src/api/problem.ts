/**
 * Mensaje legible a partir de un ProblemDetails de ASP.NET.
 *
 * - `detail`: el mensaje de las excepciones de dominio ("El nombre es obligatorio."). Es lo más útil.
 * - `errors`: validación del binding ({ campo: [mensajes] }), por si el JSON llega mal formado.
 * - `title`: lo genérico ("Datos inválidos", "Conflicto").
 * Si la respuesta no es un ProblemDetails, se usa `fallback` (normalmente el statusText).
 */
export function messageFromProblem(problem: unknown, fallback: string): string {
  if (typeof problem !== 'object' || problem === null) return fallback;
  const { detail, title, errors } = problem as { detail?: unknown; title?: unknown; errors?: unknown };

  if (typeof detail === 'string' && detail.trim() !== '') return detail;

  if (typeof errors === 'object' && errors !== null) {
    const messages = Object.values(errors as Record<string, unknown>)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '');
    if (messages.length > 0) return messages.join(' ');
  }

  if (typeof title === 'string' && title.trim() !== '') return title;
  return fallback;
}
