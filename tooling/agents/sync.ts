import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCopies, compareCopies, SOURCE, validateSource } from './skills.ts';

/**
 * Generates the agent skill copies from the single source (.agents/skills) and checks them.
 *
 *   node tooling/agents/sync.ts            validate every skill, then write .claude/skills and .github/skills
 *   node tooling/agents/sync.ts --check    validate and compare only; exit 1 listing each difference
 *
 * `--root <dir>` points it at another checkout (the tests use a scratch folder). Invalid skills stop both modes before
 * anything is written. Exit codes: 0 ok, 1 invalid skills or (with --check) out-of-date copies, 2 bad usage.
 */

const USAGE = 'usage: node tooling/agents/sync.ts [--check] [--root <dir>]';

const count = (n: number, singular: string, plural = `${singular}s`): string => `${n} ${n === 1 ? singular : plural}`;

function parseArgs(args: string[]): { check: boolean; root: string } | null {
  let check = false;
  let root = fileURLToPath(new URL('../../', import.meta.url));
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') check = true;
    else if (args[i] === '--root' && args[i + 1] !== undefined) root = args[++i]!;
    else return null;
  }
  return { check, root };
}

function main(args: string[]): number {
  const options = parseArgs(args);
  if (options === null) {
    console.error(USAGE);
    return 2;
  }
  const { check, root } = options;

  if (!existsSync(join(root, SOURCE))) {
    console.error(`agents: ${SOURCE} not found`);
    return 1;
  }

  const { skills, problems } = validateSource(root);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`invalid ${problem}`);
    console.error(`agents: ${count(problems.length, 'problem')} in ${SOURCE}; nothing was written`);
    return 1;
  }

  const differences = compareCopies(root);
  if (check) {
    if (differences.length === 0) {
      console.log(`agents:check: ${count(skills, 'skill')} valid; copies up to date`);
      return 0;
    }
    for (const { kind, path } of differences) console.error(`${kind} ${path}`);
    console.error(`agents:check: ${count(differences.length, 'difference')}; run "node tooling/agents/sync.ts"`);
    return 1;
  }

  if (differences.length === 0) {
    console.log(`agents:sync: ${count(skills, 'skill')}; copies already up to date`);
    return 0;
  }
  applyCopies(root, differences);
  const removed = differences.filter(({ kind }) => kind === 'stale');
  const written = differences.filter(({ kind }) => kind !== 'stale');
  for (const { path } of written) console.log(`wrote ${path}`);
  for (const { path } of removed) console.log(`removed ${path}`);
  console.log(`agents:sync: ${count(skills, 'skill')}; ${count(written.length, 'file')} written, ${removed.length} removed`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
