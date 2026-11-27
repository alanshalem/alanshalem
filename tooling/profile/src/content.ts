/**
 * What the images say that does not come from the API: who this is, the stack and the featured project. Kept apart
 * from the drawing so a text changes without touching the layout (and the other way around).
 */

export const person = {
  greeting: "Hey there, I'm",
  name: 'Alan Shalem',
  role: 'Engineer from Argentina',
  bio: 'Developer / Electronic Engineering',
} as const;

export interface Tech {
  name: string;
  /** Part of this blog's stack: the card marks it with the accent. */
  blog?: true;
}

/** The usual stack plus this project's, each technology once in its category. */
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
