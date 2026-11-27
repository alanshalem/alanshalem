/** The profile's public data: all the network (github.ts) hands to the render, and the shape of the fixture. */
export interface ProfileData {
  login: string;
  /** "Today" for streaks and account age: the render does not read the clock, so the same data gives the same bytes. */
  fetchedAt: string;
  createdAt: string;
  followers: number;
  /** Own public repos that are not forks. */
  repos: number;
  stars: number;
  forks: number;
  commitsLastYear: number;
  pullRequests: number;
  issues: number;
  /** Bytes per language in those same repos. */
  languages: Record<string, number>;
  /** Contributions per day (YYYY-MM-DD) since the account exists; days without contributions are left out. */
  contributions: Record<string, number>;
}

export interface Post {
  title: string;
  url: string;
  /** ISO 8601. */
  date: string;
}
