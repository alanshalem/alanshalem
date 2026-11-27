import { fullDate } from './format.ts';
import type { Post } from './model.ts';

/** The README parts the generator writes; the rest of the file is hand-written and left alone. */

/**
 * Replaces what sits between `<!-- NAME:START -->` and `<!-- NAME:END -->`. Without the markers it fails: an error in
 * the Action is better than a README that silently stops updating.
 */
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

/** What GitHub would read as Markdown or HTML in a link text. */
const escapeMarkdown = (text: string): string =>
  text.replace(/[\\`*_[\]|]/g, '\\$&').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** What would cut the link destination `(...)` short. The rest of the URL comes already encoded from the feed. */
const escapeUrl = (url: string): string =>
  url.replace(/[ ()<>]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

/** List of the latest posts (already sorted, newest first) or a "coming soon" line. */
export function postsMarkdown(posts: readonly Post[]): string {
  if (posts.length === 0) return COMING_SOON;
  return posts
    .slice(0, LATEST_POSTS)
    .map((post) => `- [${escapeMarkdown(post.title)}](${escapeUrl(post.url)}) <sub>${fullDate(post.date)}</sub>`)
    .join('\n');
}
