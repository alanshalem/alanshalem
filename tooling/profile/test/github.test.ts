import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchProfile } from '../src/github.ts';

interface Call {
  url: string;
  auth: string | null;
  query: string;
  variables: Record<string, unknown>;
}

const user = (after: unknown) => ({
  createdAt: '2025-06-10T12:00:00Z',
  followers: { totalCount: 37 },
  pullRequests: { totalCount: 4 },
  issues: { totalCount: 2 },
  contributionsCollection: { totalCommitContributions: 120 },
  repositories:
    after === null
      ? {
          totalCount: 3,
          pageInfo: { hasNextPage: true, endCursor: 'c1' },
          nodes: [
            { stargazerCount: 5, forkCount: 1, languages: { edges: [{ size: 100, node: { name: 'TypeScript' } }, { size: 10, node: { name: 'CSS' } }] } },
            { stargazerCount: 2, forkCount: 0, languages: { edges: [] } },
          ],
        }
      : {
          totalCount: 3,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{ stargazerCount: 1, forkCount: 2, languages: { edges: [{ size: 50, node: { name: 'TypeScript' } }] } }],
        },
});

const calendar = (days: Array<[string, number]>) => ({
  user: {
    contributionsCollection: {
      contributionCalendar: { weeks: [{ contributionDays: days.map(([date, contributionCount]) => ({ date, contributionCount })) }] },
    },
  },
});

function fakeFetch(calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body));
    calls.push({ url, auth: new Headers(init.headers).get('authorization'), query, variables });
    const data = query.includes('contributionCalendar')
      ? variables.from.startsWith('2025')
        ? calendar([['2025-12-31', 2], ['2025-12-30', 0]])
        : calendar([['2026-01-01', 1], ['2026-01-02', 0]])
      : { user: user(variables.after) };
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
}

describe('fetchProfile', () => {
  it('gathers the profile, paged repos and one calendar per year since the account exists', async () => {
    const calls: Call[] = [];
    const profile = await fetchProfile('alanshalem', { token: 't0k', now: new Date('2026-02-01T08:00:00Z'), fetch: fakeFetch(calls) });

    assert.deepEqual(profile, {
      login: 'alanshalem',
      fetchedAt: '2026-02-01T08:00:00.000Z',
      createdAt: '2025-06-10T12:00:00Z',
      followers: 37,
      repos: 3,
      stars: 8,
      forks: 3,
      commitsLastYear: 120,
      pullRequests: 4,
      issues: 2,
      languages: { TypeScript: 150, CSS: 10 },
      contributions: { '2025-12-31': 2, '2026-01-01': 1 },
    });
    assert.ok(calls.every((c) => c.url === 'https://api.github.com/graphql' && c.auth === 'Bearer t0k'));
    assert.deepEqual(calls.filter((c) => !c.query.includes('contributionCalendar')).map((c) => c.variables.after), [null, 'c1']);
    assert.deepEqual(
      calls.filter((c) => c.query.includes('contributionCalendar')).map((c) => [c.variables.from, c.variables.to]),
      [
        ['2025-06-10T12:00:00.000Z', '2025-12-31T23:59:59.999Z'],
        ['2026-01-01T00:00:00.000Z', '2026-02-01T08:00:00.000Z'],
      ],
    );
  });

  it('without a token it fails with a message that says what to do (GraphQL requires authentication)', async () => {
    await assert.rejects(fetchProfile('alanshalem', { token: undefined }), /GITHUB_TOKEN.*--fixture/);
  });

  it('an HTTP or GraphQL error stops the generation with the details', async () => {
    const failing = (body: unknown, status: number) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    await assert.rejects(fetchProfile('x', { token: 't', fetch: failing({ message: 'Bad credentials' }, 401) }), /401.*Bad credentials/);
    await assert.rejects(fetchProfile('x', { token: 't', fetch: failing({ errors: [{ message: 'Could not resolve' }] }, 200) }), /Could not resolve/);
  });
});
