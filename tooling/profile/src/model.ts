/** Datos públicos del perfil: lo único que la red (github.ts) entrega al render, y la forma del fixture. */
export interface ProfileData {
  login: string;
  /** "Hoy" para rachas y antigüedad: el render no lee el reloj, así los mismos datos dan los mismos bytes. */
  fetchedAt: string;
  createdAt: string;
  followers: number;
  /** Repos públicos propios que no son forks. */
  repos: number;
  stars: number;
  forks: number;
  commitsLastYear: number;
  pullRequests: number;
  issues: number;
  /** Bytes por lenguaje en esos mismos repos. */
  languages: Record<string, number>;
  /** Contribuciones por día (YYYY-MM-DD) desde que existe la cuenta; los días sin contribuciones no aparecen. */
  contributions: Record<string, number>;
}

export interface Post {
  title: string;
  url: string;
  /** ISO 8601. */
  date: string;
}
