import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

/**
 * Agent skills of this repository: one source (.agents/skills, the open Agent Skills layout read by Codex, Gemini CLI,
 * Cursor, Antigravity, OpenCode…) and byte-identical copies for the agents that look elsewhere (.claude/skills for
 * Claude Code, .github/skills for Copilot in VS Code). See odd/tasks/perfil-skills-produccion.md L2 and L4 (c).
 *
 * validateSkill checks the rules of https://agentskills.io/specification (the same ones as the reference validator,
 * `skills-ref validate`) plus two of this repo: a body of at most MAX_BODY_LINES lines and relative links that exist
 * inside the skill directory (the copies live in other folders, so a link that leaves it would break there).
 */

export const SOURCE = '.agents/skills';
export const TARGETS = ['.claude/skills', '.github/skills'] as const;
export const MAX_BODY_LINES = 500;
export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const MAX_COMPATIBILITY_LENGTH = 500;

const ALLOWED_FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ---------- Validation (pure) ----------

export interface SkillInput {
  /** Name of the skill directory. */
  dirName: string;
  /** Text of its SKILL.md. */
  skillMd: string;
  /** The other files of the skill directory, relative to it with "/" (references/x.md). */
  files: ReadonlySet<string>;
}

type FieldValue = string | Record<string, string>;

/** Characters count as the spec counts them (code points), not UTF-16 units or bytes. */
const length = (text: string): number => [...text].length;

/** Problems of one skill; empty when it follows the spec. */
export function validateSkill({ dirName, skillMd, files }: SkillInput): string[] {
  const text = skillMd.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return ['SKILL.md must start with YAML frontmatter (---)'];
  const close = text.indexOf('\n---\n', 3);
  const closeAtEnd = text.endsWith('\n---') ? text.length - 4 : -1;
  const end = close >= 0 ? close : closeAtEnd;
  if (end < 0) return ['SKILL.md frontmatter is not closed with ---'];

  const parsed = parseFrontmatter(text.slice(4, end));
  if (parsed.problems.length > 0) return parsed.problems;
  const fields = parsed.fields;
  const problems: string[] = [];

  for (const key of Object.keys(fields)) {
    if (!ALLOWED_FIELDS.includes(key)) {
      problems.push(`unexpected frontmatter field "${key}" (allowed: ${ALLOWED_FIELDS.join(', ')})`);
    }
  }

  const name = fields['name'];
  if (name === undefined) problems.push('missing required field "name"');
  else if (typeof name !== 'string' || length(name) > MAX_NAME_LENGTH || !NAME.test(name)) {
    problems.push(
      `name "${String(typeof name === 'string' ? name : '(mapping)')}" must be 1-${MAX_NAME_LENGTH} lowercase letters, ` +
        'digits and single hyphens, not starting or ending with a hyphen',
    );
  } else if (name !== dirName) problems.push(`name "${name}" must match its directory "${dirName}"`);

  const description = fields['description'];
  if (description === undefined) problems.push('missing required field "description"');
  else if (typeof description !== 'string' || description.trim() === '') problems.push('description must not be empty');
  else if (length(description) > MAX_DESCRIPTION_LENGTH) {
    problems.push(`description has ${length(description)} characters (max ${MAX_DESCRIPTION_LENGTH})`);
  }

  for (const key of ['license', 'compatibility', 'allowed-tools']) {
    const value = fields[key];
    if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) problems.push(`${key} must be a non-empty string`);
  }
  const compatibility = fields['compatibility'];
  if (typeof compatibility === 'string' && length(compatibility) > MAX_COMPATIBILITY_LENGTH) {
    problems.push(`compatibility has ${length(compatibility)} characters (max ${MAX_COMPATIBILITY_LENGTH})`);
  }

  const metadata = fields['metadata'];
  if (metadata !== undefined && typeof metadata === 'string') {
    problems.push('metadata must be a mapping of string keys to string values');
  }

  const body = text.slice(end + 4).replace(/^\n/, '');
  const bodyLines = body.replace(/\n$/, '').split('\n').length;
  if (body.trim() === '') problems.push('body is empty');
  else if (bodyLines > MAX_BODY_LINES) {
    problems.push(`body has ${bodyLines} lines (max ${MAX_BODY_LINES}); move detail to references/`);
  }

  problems.push(...linkProblems(body, files));
  return problems;
}

/**
 * The YAML subset a SKILL.md frontmatter needs, read strictly: one `key: value` per line, values plain or quoted, and
 * `metadata:` with indented `key: value` entries. Anything else (folded or multi-line values, lists, anchors) is
 * rejected with its line instead of being guessed, so every agent's YAML parser reads the same thing.
 */
function parseFrontmatter(yaml: string): { fields: Record<string, FieldValue>; problems: string[] } {
  const fields: Record<string, FieldValue> = {};
  const problems: string[] = [];
  let mapping: Record<string, string> | null = null;

  yaml.split('\n').forEach((line, index) => {
    const at = `frontmatter line ${index + 1}`;
    if (line.trim() === '' || /^\s*#/.test(line)) return;

    const entry = /^(\s*)([A-Za-z0-9_-]+):(?:[ \t]+(.*?))?\s*$/.exec(line);
    const indented = entry !== null && entry[1] !== '';
    if (entry === null || (indented && mapping === null)) {
      problems.push(`${at}: expected "key: value" (one line per field; only metadata has indented entries)`);
      return;
    }
    const key = entry[2]!;
    const raw = entry[3];
    if (!indented) mapping = null;

    if (raw === undefined) {
      if (indented) problems.push(`${at}: "${key}" needs a value`);
      else if (key in fields) problems.push(`${at}: "${key}" is repeated`);
      else fields[key] = mapping = {};
      return;
    }

    const value = scalar(raw);
    if (value === null) {
      problems.push(`${at}: quote this value or keep it on one line`);
      return;
    }
    const target: Record<string, FieldValue> = indented ? mapping! : fields;
    if (key in target) problems.push(`${at}: "${key}" is repeated`);
    else target[key] = value;
  });

  return { fields, problems };
}

/** A quoted or plain one-line scalar; null if a YAML parser could read it as something else. */
function scalar(raw: string): string | null {
  if (raw.startsWith('"')) {
    try {
      const value: unknown = JSON.parse(raw);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }
  if (raw.startsWith("'")) {
    return /^'(?:[^']|'')*'$/.test(raw) ? raw.slice(1, -1).replaceAll("''", "'") : null;
  }
  // Indicators that change the meaning of a plain scalar (block scalars, flow collections, anchors, tags, comments).
  if (/^[,[\]{}#&*!|>%@`]/.test(raw) || /^[-?:](\s|$)/.test(raw) || /: |\s#/.test(raw)) return null;
  return raw;
}

/** Relative Markdown links must point to an existing file of the skill (references/…), never outside it. */
function linkProblems(body: string, files: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const withoutCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const match of withoutCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    let path: string;
    try {
      path = posix.normalize(decodeURI(target.split('#')[0]!));
    } catch {
      problems.push(`link "${target}" is not a valid URL`);
      continue;
    }
    if (path.startsWith('../') || path === '..' || posix.isAbsolute(path)) {
      problems.push(`link "${target}" leaves the skill directory`);
    } else if (!files.has(path)) {
      problems.push(`link "${target}" points to a file that does not exist`);
    }
  }
  return problems;
}

// ---------- Files ----------

/** Every file under `dir`, relative to it with "/", sorted. Empty if `dir` does not exist. */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(dir, relative), { withFileTypes: true })) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk('');
  return files.sort(byPath);
}

const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Problems of every skill in the source, as "path: problem" relative to the repository root. */
export function validateSource(root: string): { skills: number; problems: string[] } {
  const source = join(root, SOURCE);
  const problems: string[] = [];
  let skills = 0;
  for (const entry of readdirSync(source, { withFileTypes: true }).sort((a, b) => byPath(a.name, b.name))) {
    const path = `${SOURCE}/${entry.name}`;
    if (!entry.isDirectory()) {
      problems.push(`${path}: only skill directories belong in ${SOURCE}`);
      continue;
    }
    skills++;
    const files = listFiles(join(source, entry.name));
    if (!files.includes('SKILL.md')) {
      problems.push(`${path}/SKILL.md: missing (every skill directory needs a SKILL.md)`);
      continue;
    }
    const skillMd = readFileSync(join(source, entry.name, 'SKILL.md'), 'utf8');
    const others = new Set(files.filter((file) => file !== 'SKILL.md'));
    for (const problem of validateSkill({ dirName: entry.name, skillMd, files: others })) {
      problems.push(`${path}/SKILL.md: ${problem}`);
    }
  }
  return { skills, problems };
}

export type Difference = { kind: 'missing' | 'differs' | 'stale'; path: string };

/** The target a difference path belongs to (every path compareCopies returns starts with one). */
const targetOf = (path: string): string => TARGETS.find((candidate) => path.startsWith(`${candidate}/`))!;

/** What each target needs to equal the source, by repository-relative path. */
export function compareCopies(root: string): Difference[] {
  const sourceFiles = listFiles(join(root, SOURCE));
  const differences: Difference[] = [];
  for (const target of TARGETS) {
    const targetFiles = new Set(listFiles(join(root, target)));
    for (const file of sourceFiles) {
      const path = `${target}/${file}`;
      if (!targetFiles.has(file)) differences.push({ kind: 'missing', path });
      else if (!readFileSync(join(root, SOURCE, file)).equals(readFileSync(join(root, path)))) {
        differences.push({ kind: 'differs', path });
      }
    }
    for (const file of targetFiles) {
      if (!sourceFiles.includes(file)) differences.push({ kind: 'stale', path: `${target}/${file}` });
    }
  }
  return differences.sort((a, b) => byPath(a.path, b.path));
}

/**
 * Makes both targets equal to the source: writes what is missing or different and deletes what is stale, then the
 * directories that became empty. Deletes only inside the targets, never in their parent folders.
 */
export function applyCopies(root: string, differences: readonly Difference[]): void {
  for (const { kind, path } of differences) {
    const destination = join(root, path);
    if (kind === 'stale') {
      rmSync(destination);
      removeEmptyParents(root, path);
    } else {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(join(root, SOURCE, path.slice(targetOf(path).length + 1))));
    }
  }
}

function removeEmptyParents(root: string, path: string): void {
  const target = targetOf(path);
  for (let dir = posix.dirname(path); dir.length > target.length; dir = posix.dirname(dir)) {
    const absolute = join(root, dir);
    if (!statSync(absolute).isDirectory() || readdirSync(absolute).length > 0) return;
    rmdirSync(absolute);
  }
}
