/**
 * Generative cover: a deterministic SVG for posts without an image.
 * Nodes and thin lines in the dataviz palette over `bg-surface`. No ids, no requests, ~1-2 KB.
 * Same (seed, variant) => the same SVG byte for byte: it depends on neither Math.random, the date nor the environment.
 */

const BG = '#141416';
const PALETTE = ['#a9c98a', '#8fa7d9', '#e08f6a'] as const;
const LINE = '#ededea';

// A 16:10 canvas. With `slice` it covers any crop all the same (16:9, 6:5, a full-screen hero).
const W = 160;
const H = 100;

/** 32-bit FNV-1a: a stable hash of a string. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small pseudorandom generator, good enough for decoration. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number): string => String(Math.round(n * 10) / 10);

interface Node {
  x: number;
  y: number;
  r: number;
  color: number;
}

/**
 * @param seed    usually the post slug (or `tema:<slug>` for the topic tiles).
 * @param variant usually the topic: changes the dominant color and the shape of the cluster.
 */
export function generativeCover(seed: string, variant = ''): string {
  const random = rng(hash(`${seed}\u0000${variant}`));
  const v = hash(variant);
  const dominant = v % PALETTE.length;
  // Two or three "clusters" of nodes; the topic decides how many and where they lean.
  const clusters = 2 + (v % 2);
  const centers = Array.from({ length: clusters }, () => ({
    x: 30 + random() * (W - 60),
    y: 22 + random() * (H - 44),
  }));

  const count = 17 + Math.floor(random() * 5);
  const nodes: Node[] = [];
  for (let i = 0; i < count; i++) {
    const c = centers[i % clusters] ?? { x: W / 2, y: H / 2 };
    const spread = 12 + random() * 22;
    const angle = random() * Math.PI * 2;
    const x = Math.min(W - 4, Math.max(4, c.x + Math.cos(angle) * spread * (0.4 + random())));
    const y = Math.min(H - 4, Math.max(4, c.y + Math.sin(angle) * spread * 0.7 * (0.4 + random())));
    // ~60% in the dominant color; the rest in the other two.
    const color = random() < 0.6 ? dominant : (dominant + 1 + Math.floor(random() * 2)) % PALETTE.length;
    nodes.push({ x, y, r: 0.9 + random() * random() * 2.8, color });
  }

  // Each node joins its 2 nearest neighbors (without repeating edges).
  const edges = new Set<string>();
  nodes.forEach((a, i) => {
    nodes
      .map((b, j) => ({ j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
      .filter(({ j }) => j !== i)
      .sort((p, q) => p.d - q.d || p.j - q.j)
      .slice(0, 2)
      .forEach(({ j }) => edges.add(i < j ? `${i},${j}` : `${j},${i}`));
  });

  const path = [...edges]
    .map((key) => {
      const [i, j] = key.split(',').map(Number) as [number, number];
      const a = nodes[i] as Node;
      const b = nodes[j] as Node;
      return `M${r1(a.x)} ${r1(a.y)}L${r1(b.x)} ${r1(b.y)}`;
    })
    .join('');

  const groups = PALETTE.map((fill, color) => {
    const circles = nodes
      .filter((n) => n.color === color)
      .map((n) => `<circle cx="${r1(n.x)}" cy="${r1(n.y)}" r="${r1(n.r)}"/>`)
      .join('');
    return circles ? `<g fill="${fill}">${circles}</g>` : '';
  }).join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">` +
    `<rect width="${W}" height="${H}" fill="${BG}"/>` +
    `<path d="${path}" fill="none" stroke="${LINE}" stroke-opacity=".3" stroke-width="0.3"/>` +
    groups +
    `</svg>`
  );
}
