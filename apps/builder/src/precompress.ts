// Precomprime una carpeta ya construida (.br y .gz junto a cada archivo de texto). La imagen de Caddy lo usa con el
// admin, con la misma función con la que el builder precomprime cada release del sitio:
//
//   node apps/builder/src/precompress.ts apps/admin/dist
import { precompressSite } from './compress.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: node precompress.ts <carpeta>');
  process.exit(2);
}
console.log(`${dir}: ${await precompressSite(dir)} archivos precomprimidos`);
