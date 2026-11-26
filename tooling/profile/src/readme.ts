import { fullDate } from './format.ts';
import type { Post } from './model.ts';

/** Partes del README que escribe el generador; el resto del archivo es a mano y no se toca. */

/** Reemplaza lo que hay entre `<!-- NAME:START -->` y `<!-- NAME:END -->`. Sin marcadores falla: mejor un error en la Action que un README que deja de actualizarse sin aviso. */
export function replaceMarked(text: string, name: string, content: string): string {
  const start = `<!-- ${name}:START -->`;
  const end = `<!-- ${name}:END -->`;
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from === -1 || to === -1) throw new Error(`README.md needs ${start} followed by ${end}`);
  return `${text.slice(0, from + start.length)}\n${content}\n${text.slice(to)}`;
}

export const LATEST_POSTS = 5;
const COMING_SOON = '<sub>The blog is on its way — new posts will show up here.</sub>';

/** Lo que GitHub interpretaría como Markdown o HTML en el texto de un enlace. */
const escapeMarkdown = (text: string): string =>
  text.replace(/[\\`*_[\]|]/g, '\\$&').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Lo que cortaría el destino `(...)` del enlace. El resto de la URL ya viene codificado del feed. */
const escapeUrl = (url: string): string =>
  url.replace(/[ ()<>]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

/** Lista de los últimos posts (ya ordenados, más nuevos primero) o una línea de "próximamente". */
export function postsMarkdown(posts: readonly Post[]): string {
  if (posts.length === 0) return COMING_SOON;
  return posts
    .slice(0, LATEST_POSTS)
    .map((post) => `- [${escapeMarkdown(post.title)}](${escapeUrl(post.url)}) <sub>${fullDate(post.date)}</sub>`)
    .join('\n');
}
