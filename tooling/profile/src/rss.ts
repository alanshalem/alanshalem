import type { Post } from './model.ts';

/**
 * Lector mínimo del RSS 2.0 que genera el sitio (apps/web/src/lib/feeds.ts): título, enlace y fecha de cada item.
 * Con expresiones regulares alcanza porque solo se leen tres hijos de texto de <item>; un parser XML completo
 * sería una dependencia para nada.
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

/** Primer hijo `<tag>` del item. `content:encoded` no coincide con `title` porque el nombre se compara entero. */
const child = (item: string, tag: string): string =>
  decode(item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '');

/** Items del feed, más nuevos primero. Se descarta lo que no se podría mostrar bien o con seguridad. */
export function parseRss(xml: string): Post[] {
  const posts: Post[] = [];
  for (const [, item] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    // El contenido HTML del post puede tener cualquier etiqueta: se saca antes de buscar los hijos.
    const head = item!.replace(/<content:encoded>[\s\S]*?<\/content:encoded>/g, '');
    const title = child(head, 'title');
    const url = child(head, 'link');
    const time = Date.parse(child(head, 'pubDate'));
    if (!title || !/^https?:\/\//.test(url) || Number.isNaN(time)) continue;
    posts.push({ title, url, date: new Date(time).toISOString() });
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}
