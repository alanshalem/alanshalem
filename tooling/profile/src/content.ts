/**
 * Lo que dicen las imágenes que no sale de la API: quién es, el stack y el proyecto destacado. Separado del dibujo
 * para cambiar un texto sin tocar el layout (y al revés).
 */

export const person = {
  greeting: "Hey there, I'm",
  name: 'Alan Shalem',
  role: 'Engineer from Argentina',
  bio: 'Developer / Electronic Engineering',
} as const;

export interface Tech {
  name: string;
  /** Parte del stack de este blog: la tarjeta lo marca con el acento. */
  blog?: true;
}

/** El stack de siempre más el de este proyecto, cada tecnología una sola vez en su categoría. */
export const stack: ReadonlyArray<{ category: string; items: readonly Tech[] }> = [
  {
    category: 'Frontend',
    items: [
      { name: 'JavaScript' },
      { name: 'TypeScript', blog: true },
      { name: 'React', blog: true },
      { name: 'Redux' },
      { name: 'Next.js' },
      { name: 'Astro', blog: true },
      { name: 'HTML5', blog: true },
      { name: 'CSS3', blog: true },
      { name: 'Tailwind CSS' },
      { name: 'Bootstrap' },
    ],
  },
  {
    category: 'Backend',
    items: [
      { name: 'Node.js', blog: true },
      { name: 'NestJS' },
      { name: 'Express' },
      { name: 'GraphQL' },
      { name: 'C# / .NET', blog: true },
      { name: 'ASP.NET Core', blog: true },
      { name: 'EF Core', blog: true },
      { name: 'Python' },
      { name: 'C' },
    ],
  },
  {
    category: 'Databases',
    items: [
      { name: 'PostgreSQL' },
      { name: 'MongoDB' },
      { name: 'MySQL' },
      { name: 'MariaDB' },
      { name: 'SQL Server' },
      { name: 'Supabase' },
      { name: 'SQLite', blog: true },
    ],
  },
  {
    category: 'Tools & Other',
    items: [
      { name: 'Git', blog: true },
      { name: 'Docker', blog: true },
      { name: 'Linux', blog: true },
      { name: 'Postman' },
      { name: 'Webpack' },
      { name: 'Babel' },
      { name: 'Caddy', blog: true },
      { name: 'ffmpeg', blog: true },
      { name: 'libvips', blog: true },
    ],
  },
];

export const project = {
  eyebrow: 'Featured project',
  repo: 'alanshalem/alanshalem',
  title: 'A self-hosted bilingual blog',
  dek: 'Built from scratch: a static Astro site, a .NET API and a native Markdown editor, shipped with Docker to a small VPS.',
  features: [
    'Bilingual: Spanish and English',
    'Markdown editor with history and scheduling',
    'Photo and video hero: AVIF, WebP and AV1',
    'Accessible: WCAG 2.2 AA',
    'Static site + .NET API + Docker',
  ],
  stack: 'Astro · React · ASP.NET Core · EF Core · SQLite · Caddy · ffmpeg · libvips',
} as const;
