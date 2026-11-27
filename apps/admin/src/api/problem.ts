/**
 * The text to show for something a call threw: an `Error`'s own message (an `ApiError` carries the API text, already
 * in the UI language) or, for anything else, `fallback` (the context of the action that failed).
 */
export const errorMessage = (caught: unknown, fallback: string): string =>
  caught instanceof Error ? caught.message : fallback;

/**
 * Readable message from an ASP.NET ProblemDetails.
 *
 * - `detail`: the message of domain exceptions ("El nombre es obligatorio."). The most useful one.
 * - `errors`: binding validation ({ field: [messages] }), in case the JSON arrives malformed.
 * - `title`: the generic one ("Datos inválidos", "Conflicto").
 * If the response is not a ProblemDetails, `fallback` is used (usually the statusText).
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
