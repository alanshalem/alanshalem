import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * tooling/agents/sync.ts through its command line, on a scratch repository in the system temp folder:
 * .agents/skills is the only source; .claude/skills and .github/skills are byte-identical generated copies.
 */

const SYNC = fileURLToPath(new URL('../sync.ts', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const run = (...args: string[]): Run => {
  const result = spawnSync(process.execPath, [SYNC, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

let root: string;
const at = (path: string): string => join(root, path);
const write = (path: string, content: string | Buffer): void => {
  mkdirSync(dirname(at(path)), { recursive: true });
  writeFileSync(at(path), content);
};

/** Every file under the scratch root, with its bytes: proves what changed and what did not. */
const snapshot = (): Map<string, string> => {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(root, path).replaceAll('\\', '/'), readFileSync(path).toString('base64'));
    }
  };
  walk(root);
  return files;
};

const SKILL_A = '---\nname: alpha\ndescription: Does A. Use when A.\n---\n# Alpha\n\nSee [rules](references/rules.md).\n';
// CRLF, a tab and non-ASCII bytes: the copies must keep them exactly.
const RULES_A = Buffer.from('Rule one\r\n\tRegla dos — “ñ”\r\n', 'utf8');
const SKILL_B = '---\nname: beta\ndescription: Does B. Use when B.\n---\n# Beta\n';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agents-sync-'));
  write('.agents/skills/alpha/SKILL.md', SKILL_A);
  write('.agents/skills/alpha/references/rules.md', RULES_A);
  write('.agents/skills/beta/SKILL.md', SKILL_B);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sync (no flags)', () => {
  it('copies every file of .agents/skills to both targets, byte for byte, and reports each write', () => {
    const result = run('--root', root);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(
      result.stdout,
      [
        'wrote .claude/skills/alpha/SKILL.md',
        'wrote .claude/skills/alpha/references/rules.md',
        'wrote .claude/skills/beta/SKILL.md',
        'wrote .github/skills/alpha/SKILL.md',
        'wrote .github/skills/alpha/references/rules.md',
        'wrote .github/skills/beta/SKILL.md',
        'agents:sync: 2 skills; 6 files written, 0 removed',
        '',
      ].join('\n'),
    );
    for (const target of ['.claude/skills', '.github/skills']) {
      assert.deepEqual(readFileSync(at(`${target}/alpha/SKILL.md`)), Buffer.from(SKILL_A));
      assert.deepEqual(readFileSync(at(`${target}/alpha/references/rules.md`)), RULES_A);
      assert.deepEqual(readFileSync(at(`${target}/beta/SKILL.md`)), Buffer.from(SKILL_B));
    }
  });

  it('a second run writes nothing', () => {
    run('--root', root);
    const before = snapshot();

    const result = run('--root', root);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'agents:sync: 2 skills; copies already up to date\n');
    assert.deepEqual(snapshot(), before);
  });

  it('deletes stale copies only inside the two target folders, and their emptied directories', () => {
    run('--root', root);
    write('.claude/skills/gone/SKILL.md', 'old');
    write('.github/skills/alpha/references/old.md', 'old');
    // Siblings of the targets belong to other tools: never touched.
    write('.claude/settings.json', '{}');
    write('.github/workflows/profile.yml', 'on: push');
    write('.github/README.md', '# Project');

    const result = run('--root', root);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      [
        'removed .claude/skills/gone/SKILL.md',
        'removed .github/skills/alpha/references/old.md',
        'agents:sync: 2 skills; 0 files written, 2 removed',
        '',
      ].join('\n'),
    );
    assert.ok(!existsSync(at('.claude/skills/gone')), 'the emptied stale skill directory is removed');
    assert.ok(existsSync(at('.github/skills/alpha/references/rules.md')));
    assert.equal(readFileSync(at('.claude/settings.json'), 'utf8'), '{}');
    assert.equal(readFileSync(at('.github/workflows/profile.yml'), 'utf8'), 'on: push');
    assert.equal(readFileSync(at('.github/README.md'), 'utf8'), '# Project');
  });

  it('overwrites a copy that was edited by hand', () => {
    run('--root', root);
    write('.github/skills/beta/SKILL.md', 'edited by hand');

    const result = run('--root', root);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'wrote .github/skills/beta/SKILL.md\nagents:sync: 2 skills; 1 file written, 0 removed\n');
    assert.deepEqual(readFileSync(at('.github/skills/beta/SKILL.md')), Buffer.from(SKILL_B));
  });
});

describe('--check', () => {
  it('passes when both copies are identical to the source', () => {
    run('--root', root);

    const result = run('--check', '--root', root);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'agents:check: 2 skills valid; copies up to date\n');
  });

  it('fails with exit 1, lists every missing, different and stale file, and changes nothing', () => {
    run('--root', root);
    rmSync(at('.github/skills/beta'), { recursive: true });
    write('.claude/skills/alpha/references/rules.md', 'edited by hand');
    write('.claude/skills/gone/SKILL.md', 'old');
    const before = snapshot();

    const result = run('--check', '--root', root);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      [
        'differs .claude/skills/alpha/references/rules.md',
        'stale .claude/skills/gone/SKILL.md',
        'missing .github/skills/beta/SKILL.md',
        'agents:check: 3 differences; run "node tooling/agents/sync.ts"',
        '',
      ].join('\n'),
    );
    assert.deepEqual(snapshot(), before);
  });

  it('fails when the copies were never generated', () => {
    const result = run('--check', '--root', root);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^missing \.claude\/skills\/alpha\/SKILL\.md$/m);
    assert.match(result.stderr, /agents:check: 6 differences; run "node tooling\/agents\/sync\.ts"\n$/);
  });
});

describe('invalid skills stop both modes before anything is written', () => {
  beforeEach(() => {
    write('.agents/skills/Gamma/SKILL.md', '---\nname: Gamma\ndescription: Does G.\n---\n# Gamma\n');
    write('.agents/skills/delta/notes.md', 'no SKILL.md here');
    write('.agents/skills/README.md', 'a loose file');
  });

  for (const mode of [[], ['--check']]) {
    it(`${mode.length ? '--check' : 'sync'}: exit 1, one line per problem`, () => {
      const before = snapshot();

      const result = run(...mode, '--root', root);

      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(
        result.stderr,
        [
          'invalid .agents/skills/Gamma/SKILL.md: name "Gamma" must be 1-64 lowercase letters, digits and single hyphens, not starting or ending with a hyphen',
          'invalid .agents/skills/README.md: only skill directories belong in .agents/skills',
          'invalid .agents/skills/delta/SKILL.md: missing (every skill directory needs a SKILL.md)',
          'agents: 3 problems in .agents/skills; nothing was written',
          '',
        ].join('\n'),
      );
      assert.deepEqual(snapshot(), before);
    });
  }

  it('a missing source folder', () => {
    rmSync(at('.agents'), { recursive: true });

    const result = run('--root', root);

    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'agents: .agents/skills not found\n');
  });
});

describe('command line', () => {
  it('an unknown option prints the usage and exits 2', () => {
    const result = run('--fix');

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'usage: node tooling/agents/sync.ts [--check] [--root <dir>]\n');
  });

  it('this repository: every skill is valid and the generated copies are up to date', () => {
    const result = run('--check', '--root', REPO);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^agents:check: \d+ skills valid; copies up to date\n$/);
  });
});
