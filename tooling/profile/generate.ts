/**
 * Genera las imágenes del README del perfil (assets/profile/*.svg) y la lista de últimos posts del README.
 *
 *   node tooling/profile/generate.ts                   datos reales (necesita GITHUB_TOKEN)
 *   node tooling/profile/generate.ts --fixture <file>  sin red, desde un JSON guardado (tooling/profile/fixture.json)
 *
 * BLOG_FEED_URL (opcional): RSS del blog. Sin ella, la sección de posts muestra una línea de "próximamente".
 * Lo corre a diario .github/workflows/profile.yml; acá solo se orquesta: el dibujo y los cálculos viven en src/.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fetchProfile, fetchText } from './src/github.ts';
import type { Post, ProfileData } from './src/model.ts';
import { renderProfile } from './src/profile.ts';
import { LATEST_POSTS, postsMarkdown, replaceMarked } from './src/readme.ts';
import { parseRss } from './src/rss.ts';

const LOGIN = 'alanshalem';
const ROOT = new URL('../../', import.meta.url);
const ASSETS = new URL('assets/profile/', ROOT);
const README = new URL('README.md', ROOT);

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

const data: ProfileData = values.fixture
  ? JSON.parse(await readFile(values.fixture, 'utf8'))
  : await fetchProfile(LOGIN, { token: process.env.GITHUB_TOKEN });

await mkdir(ASSETS, { recursive: true });
for (const [name, svg] of Object.entries(renderProfile(data))) {
  await writeFile(new URL(name, ASSETS), svg);
  console.log(`assets/profile/${name} ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`);
}

/** Posts del feed; undefined si el feed falló, para no borrar la lista publicada por una caída pasajera del sitio. */
async function latestPosts(feedUrl: string | undefined): Promise<Post[] | undefined> {
  if (!feedUrl) return [];
  try {
    return parseRss(await fetchText(feedUrl));
  } catch (error) {
    console.warn(`::warning::Blog feed not updated: ${(error as Error).message}`);
    return undefined;
  }
}

const posts = await latestPosts(process.env.BLOG_FEED_URL);
if (posts) {
  await writeFile(README, replaceMarked(await readFile(README, 'utf8'), 'BLOG-POSTS', postsMarkdown(posts)));
  console.log(`README.md: ${posts.length ? `${Math.min(posts.length, LATEST_POSTS)} latest posts` : 'no feed, "coming soon" line'}`);
}
