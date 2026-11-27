import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Guards over the deploy workflow: what triggers a deploy, where it goes and what it may print. Textual, like the
// compose tests; actionlint checks the syntax and GitHub's expression rules (docs/README.md, "How to verify").
const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const path = '.github/workflows/deploy.yml';
const deploy = existsSync(new URL(`../../${path}`, import.meta.url)) ? read(path) : '';
const ci = read('.github/workflows/ci.yml');

/** Lines without comments or blank lines. */
const code = (text: string): string[] => text.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
const indent = (line: string): number => line.length - line.trimStart().length;

/** The block under the `key:` line at that indentation, as text (without the key line). */
function block(text: string, key: string, depth = 0): string {
  const all = code(text);
  const start = all.findIndex((line) => indent(line) === depth && line.trim().startsWith(`${key}:`));
  assert.ok(start >= 0, `missing ${key}`);
  const body: string[] = [];
  for (const line of all.slice(start + 1)) {
    if (indent(line) <= depth) break;
    body.push(line);
  }
  return body.join('\n');
}

/** Every `run: |` script of a workflow, as text. */
function scripts(text: string): string[] {
  const all = text.split('\n');
  const found: string[] = [];
  all.forEach((line, index) => {
    const match = /^(\s*)(?:- )?run: \|$/.exec(line);
    if (!match) return;
    const depth = match[1]!.length;
    const body: string[] = [];
    for (const next of all.slice(index + 1)) {
      if (next.trim() !== '' && indent(next) <= depth) break;
      body.push(next);
    }
    found.push(body.join('\n'));
  });
  return found;
}

describe('deploy.yml triggers', () => {
  const on = block(deploy, 'on');

  it('a green CI run of a push to master deploys staging', () => {
    assert.match(block(on, 'workflow_run', 2), /^ {4}workflows: \[CI\]\n {4}types: \[completed\]\n {4}branches: \[master\]$/);
    // The name it listens to is the CI workflow's name.
    assert.match(ci, /^name: CI$/m);
    const plan = block(block(deploy, 'jobs'), 'plan', 2);
    assert.match(plan, /github\.event\.workflow_run\.conclusion == 'success'/);
    assert.match(plan, /github\.event\.workflow_run\.event == 'push'/);
  });

  it('a pushed v* tag deploys production; no branch push deploys anything', () => {
    assert.equal(block(on, 'push', 2).trim(), "tags: ['v*']");
  });

  it('only a commit whose whole CI run on master passed is deployed (the images job publishes on its own)', () => {
    assert.match(deploy, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$sha&branch=master&event=push&status=success/);
    assert.match(deploy, /gh run list --workflow CI --branch master --status success --limit 1 --json headSha -q '\.\[0\]\.headSha'/);
  });

  it('running it by hand redeploys a tag (or, on staging, a commit): the rollback', () => {
    const inputs = block(block(on, 'workflow_dispatch', 2), 'inputs', 4);
    assert.match(block(inputs, 'environment', 6), /type: choice\n\s+options: \[staging, production\]/);
    assert.match(block(inputs, 'ref', 6), /required: true/);
    // Production only takes a tag: the version a release names, never a bare commit.
    assert.match(deploy, /production deploys a release tag/);
  });
});

describe('deploy.yml jobs', () => {
  const jobs = block(deploy, 'jobs');

  it('nothing by default: permissions: {} at the top, each job asks for its own', () => {
    assert.match(deploy, /^permissions: \{\}$/m);
    assert.deepEqual(
      code(block(block(jobs, 'plan', 2), 'permissions', 4)).map((line) => line.trim()),
      ['contents: read', 'actions: read'],
    );
    assert.match(block(jobs, 'deploy', 2), /^ {4}permissions: \{\}$/m);
  });

  it('the deploy runs in the GitHub environment the plan picked (staging or production), one at a time', () => {
    const job = block(jobs, 'deploy', 2);
    assert.match(job, /^ {4}environment: \$\{\{ needs\.plan\.outputs\.environment \}\}$/m);
    assert.match(job, /^ {6}group: deploy-\$\{\{ needs\.plan\.outputs\.environment \}\}\n {6}cancel-in-progress: false$/m);
    assert.match(job, /^ {4}timeout-minutes: \d+$/m);
    // The plan only ever names these two environments.
    const named = new Set([...deploy.matchAll(/\benvironment=(\w+)/g)].map((m) => m[1]));
    assert.deepEqual([...named].sort(), ['production', 'staging']);
    for (const name of ['DOKPLOY_URL', 'DOKPLOY_COMPOSE_ID', 'DOKPLOY_ENVIRONMENT_ID', 'SITE_URL']) {
      assert.match(job, new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`), name);
    }
  });

  it('the images it checks are the ones CI publishes and the Dokploy override runs', () => {
    assert.match(ci, /image="ghcr\.io\/\$\{GITHUB_REPOSITORY_OWNER,,\}\/blog-\$SERVICE:sha-\$GITHUB_SHA"/);
    assert.match(deploy, /"ghcr\.io\/\$\{GITHUB_REPOSITORY_OWNER,,\}\/blog-\$service:sha-\$SHA"/);
    assert.match(ci, /^ {8}service: \[api, builder, caddy\]$/m);
    assert.match(deploy, /for service in api builder caddy; do/);
    // The environment env Dokploy resolves into IMAGE_TAG holds only that line.
    assert.match(deploy, /--arg env "IMAGE_TAG=sha-\$SHA"/);
  });

  it('autodeploy stays off: only this workflow deploys, with the version it names', () => {
    assert.match(deploy, /autoDeploy: false/);
  });
});

describe('deploy.yml secrets', () => {
  const runs = scripts(deploy);

  it('the API key is expanded once, as curl config on stdin, and never printed', () => {
    assert.ok(runs.length > 0);
    const uses = runs.flatMap((run) => run.split('\n')).filter((line) => /\$\{?DOKPLOY_API_KEY\b/.test(line));
    assert.equal(uses.length, 1, uses.join('\n'));
    assert.match(uses[0]!, /printf 'header = "x-api-key: %s"\\n' "\$DOKPLOY_API_KEY" \| curl --config - /);
    for (const run of runs) assert.doesNotMatch(run, /set -x|set -o xtrace|curl [^\n]*(--verbose|-v )/);
  });

  it('secrets only reach a step through its env, and only the Dokploy key', () => {
    const lines = deploy.split('\n').filter((line) => line.includes('secrets.'));
    assert.deepEqual(lines.map((line) => line.trim()), ['DOKPLOY_API_KEY: ${{ secrets.DOKPLOY_API_KEY }}']);
  });

  it('no expression inside a script: inputs and event data arrive as environment variables (no injection)', () => {
    for (const run of runs) assert.doesNotMatch(run, /\$\{\{/);
  });

  it('compose.one is reduced to the fields it needs (it also returns the Environment tab)', () => {
    for (const match of deploy.matchAll(/dokploy GET compose\.one [^|\n]*(\|[^\n]*)?/g)) {
      assert.match(match[1] ?? '', /\| jq -r '\.(appName|composeStatus)'/, match[0]);
    }
  });

  it('every action is pinned by commit SHA', () => {
    for (const match of deploy.matchAll(/uses: (\S+)/g)) assert.match(match[1]!, /@[0-9a-f]{40}$/, match[1]);
  });
});
