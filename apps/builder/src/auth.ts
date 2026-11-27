import { timingSafeEqual } from 'node:crypto';

const SCHEME = 'bearer ';

/** Does the Authorization header carry "Bearer <token>" with the right token? Constant-time comparison. */
export function isAuthorized(authorizationHeader: string | undefined, token: string): boolean {
  if (!authorizationHeader || authorizationHeader.length <= SCHEME.length) return false;
  if (authorizationHeader.slice(0, SCHEME.length).toLowerCase() !== SCHEME) return false;

  const provided = Buffer.from(authorizationHeader.slice(SCHEME.length));
  const expected = Buffer.from(token);
  // timingSafeEqual requires the same length; the token length is not secret.
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
