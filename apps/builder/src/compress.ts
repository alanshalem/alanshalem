import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.xml', '.svg', '.txt', '.webmanifest']);
const MIN_BYTES = 256; // below this the compression header weighs more than what it saves

/**
 * Leaves the .br and .gz versions next to each text file.
 * Caddy (`file_server { precompressed br gzip }`) serves them as they are: zero CPU per request.
 * It compresses at the highest level because it happens once per build, not per visit.
 * woff2 fonts and images come already compressed: they are left alone.
 *
 * @returns the number of compressed files
 */
export async function precompressSite(dir: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) {
      count += await precompressSite(path);
    } else if (entry.isFile() && COMPRESSIBLE.has(extname(entry.name).toLowerCase())) {
      const content = await readFile(path);
      if (content.length < MIN_BYTES) continue;

      const [br, gz] = await Promise.all([
        brotli(content, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
            [constants.BROTLI_PARAM_SIZE_HINT]: content.length,
          },
        }),
        gzipAsync(content, { level: 9 }),
      ]);
      await Promise.all([writeFile(`${path}.br`, br), writeFile(`${path}.gz`, gz)]);
      count += 1;
    }
  }
  return count;
}
