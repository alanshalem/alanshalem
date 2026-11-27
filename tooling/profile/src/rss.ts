import type { Post } from './model.ts';

/**
 * Minimal reader of the RSS 2.0 the site generates (apps/web/src/lib/feeds.ts): title, link and date of each item.
 * Regular expressions are enough because only three text children of <item> are read; a full XML parser would be a
 * dependency for nothing.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(raw: string): string {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1]!.trim();
  return raw
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, name: string) =>
      name.startsWith('#')
        ? String.fromCodePoint(name[1]!.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)))
        : (ENTITIES[name] ?? entity),
    )
    .trim();
}

/** First `<tag>` child of the item. `content:encoded` does not match `title` because the whole name is compared. */
const child = (item: string, tag: string): string =>
  decode(item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '');

/** Feed items, newest first. Whatever could not be shown correctly or safely is dropped. */
export function parseRss(xml: string): Post[] {
  const posts: Post[] = [];
  for (const [, item] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    // The post's HTML content may hold any tag: it is removed before looking for the children.
    const head = item!.replace(/<content:encoded>[\s\S]*?<\/content:encoded>/g, '');
    const title = child(head, 'title');
    const url = child(head, 'link');
    const time = Date.parse(child(head, 'pubDate'));
    if (!title || !/^https?:\/\//.test(url) || Number.isNaN(time)) continue;
    posts.push({ title, url, date: new Date(time).toISOString() });
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}
