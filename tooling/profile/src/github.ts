import type { ProfileData } from './model.ts';

/**
 * Único módulo que habla con la red: datos públicos del usuario vía la API GraphQL de GitHub. El calendario de
 * contribuciones solo existe en GraphQL, y GraphQL exige token (en la Action, el GITHUB_TOKEN del workflow).
 */

const ENDPOINT = 'https://api.github.com/graphql';

const PROFILE_QUERY = `query($login: String!, $after: String) {
  user(login: $login) {
    createdAt
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    contributionsCollection { totalCommitContributions }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { stargazerCount forkCount languages(first: 20, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } } }
    }
  }
}`;

// Un rango de contributionsCollection puede abarcar como mucho un año: se pide un calendario por año calendario.
const CALENDAR_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

interface ProfilePage {
  user: {
    createdAt: string;
    followers: { totalCount: number };
    pullRequests: { totalCount: number };
    issues: { totalCount: number };
    contributionsCollection: { totalCommitContributions: number };
    repositories: {
      totalCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{ stargazerCount: number; forkCount: number; languages: { edges: Array<{ size: number; node: { name: string } }> } }>;
    };
  };
}

interface CalendarPage {
  user: { contributionsCollection: { contributionCalendar: { weeks: Array<{ contributionDays: Array<{ date: string; contributionCount: number }> }> } } };
}

export interface FetchOptions {
  token: string | undefined;
  /** Inyectables para los tests: la red y el reloj. */
  fetch?: typeof fetch;
  now?: Date;
}

export async function fetchProfile(login: string, { token, fetch: request = fetch, now = new Date() }: FetchOptions): Promise<ProfileData> {
  if (!token) throw new Error('GITHUB_TOKEN is required to read the GitHub GraphQL API (or pass --fixture <file>).');

  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await request(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'alanshalem-profile' },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message: string }>; message?: string };
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.message ?? response.statusText}`);
    if (body.errors?.length || !body.data) throw new Error(`GitHub API: ${body.errors?.map((e) => e.message).join('; ') ?? 'empty response'}`);
    return body.data;
  }

  const pages: ProfilePage['user'][] = [];
  let after: string | null = null;
  do {
    const { user }: ProfilePage = await graphql<ProfilePage>(PROFILE_QUERY, { login, after });
    pages.push(user);
    after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
  } while (after);

  const user = pages[0]!;
  const repos = pages.flatMap((page) => page.repositories.nodes);
  const languages: Record<string, number> = {};
  for (const { size, node } of repos.flatMap((repo) => repo.languages.edges)) {
    languages[node.name] = (languages[node.name] ?? 0) + size;
  }

  const contributions: Record<string, number> = {};
  const created = new Date(user.createdAt);
  for (let year = created.getUTCFullYear(); year <= now.getUTCFullYear(); year++) {
    const from = new Date(Math.max(created.getTime(), Date.UTC(year, 0, 1)));
    const to = new Date(Math.min(now.getTime(), Date.UTC(year + 1, 0, 1) - 1));
    const calendar = await graphql<CalendarPage>(CALENDAR_QUERY, { login, from: from.toISOString(), to: to.toISOString() });
    for (const week of calendar.user.contributionsCollection.contributionCalendar.weeks) {
      for (const { date, contributionCount } of week.contributionDays) {
        if (contributionCount > 0) contributions[date] = contributionCount;
      }
    }
  }

  return {
    login,
    fetchedAt: now.toISOString(),
    createdAt: user.createdAt,
    followers: user.followers.totalCount,
    repos: user.repositories.totalCount,
    stars: repos.reduce((sum, repo) => sum + repo.stargazerCount, 0),
    forks: repos.reduce((sum, repo) => sum + repo.forkCount, 0),
    commitsLastYear: user.contributionsCollection.totalCommitContributions,
    pullRequests: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    languages,
    contributions,
  };
}

/** El feed del blog, como texto. */
export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': 'alanshalem-profile' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}
