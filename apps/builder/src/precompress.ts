// Precompresses an already built folder (.br and .gz next to each text file). The Caddy image uses it for the admin,
// with the same function the builder uses to precompress each site release:
//
//   node apps/builder/src/precompress.ts apps/admin/dist
import { precompressSite } from './compress.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node precompress.ts <dir>');
  process.exit(2);
}
console.log(`${dir}: ${await precompressSite(dir)} files precompressed`);
