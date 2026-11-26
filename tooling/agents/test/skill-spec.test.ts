import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_BODY_LINES, validateSkill } from '../skills.ts';

/*
 * The Agent Skills rules (https://agentskills.io/specification) that every .agents/skills/<name>/SKILL.md must meet.
 * validateSkill is pure: the directory name, the SKILL.md text and the other files of the skill directory.
 */

const skill = (frontmatter: string, body = '# Title\n\nDo the thing.\n'): string => `---\n${frontmatter}\n---\n${body}`;
const valid = skill('name: my-skill\ndescription: Does X. Use when Y.');
const check = (text: string, dirName = 'my-skill', files: string[] = []): string[] =>
  validateSkill({ dirName, skillMd: text, files: new Set(files) });

describe('validateSkill: a valid skill has no problems', () => {
  it('minimal frontmatter', () => {
    assert.deepEqual(check(valid), []);
  });

  it('every optional field of the spec, quoted values and CRLF line endings', () => {
    const text = skill(
      [
        'name: my-skill',
        'description: "Does X: Y and Z. Use when W."',
        'license: MIT',
        "compatibility: 'Needs Node 22.18+ and pnpm'",
        'allowed-tools: Bash(git:*) Read',
        'metadata:',
        '  author: alanshalem',
        '  version: "1.0"',
      ].join('\n'),
    ).replaceAll('\n', '\r\n');
    assert.deepEqual(check(text), []);
  });
});

describe('validateSkill: frontmatter shape', () => {
  it('missing frontmatter', () => {
    assert.deepEqual(check('# Title\n'), ['SKILL.md must start with YAML frontmatter (---)']);
  });

  it('frontmatter never closed', () => {
    assert.deepEqual(check('---\nname: my-skill\n'), ['SKILL.md frontmatter is not closed with ---']);
  });

  it('a field the spec does not define', () => {
    assert.deepEqual(check(skill('name: my-skill\ndescription: Does X.\nversion: 2')), [
      'unexpected frontmatter field "version" (allowed: name, description, license, compatibility, metadata, allowed-tools)',
    ]);
  });

  it('a repeated field', () => {
    assert.deepEqual(check(skill('name: my-skill\nname: my-skill\ndescription: Does X.')), [
      'frontmatter line 2: "name" is repeated',
    ]);
  });

  it('YAML this validator does not accept (multi-line values) is reported with its line', () => {
    assert.deepEqual(check(skill('name: my-skill\ndescription: >\n  Does X.')), [
      'frontmatter line 2: quote this value or keep it on one line',
      'frontmatter line 3: expected "key: value" (one line per field; only metadata has indented entries)',
    ]);
  });

  it('a plain value that YAML would misread must be quoted', () => {
    assert.deepEqual(check(skill('name: my-skill\ndescription: Rules: do X')), [
      'frontmatter line 2: quote this value or keep it on one line',
    ]);
  });

  it('metadata must be a mapping of strings', () => {
    assert.deepEqual(check(skill('name: my-skill\ndescription: Does X.\nmetadata: v1')), [
      'metadata must be a mapping of string keys to string values',
    ]);
  });
});

describe('validateSkill: name (1-64 chars, a-z 0-9 and single hyphens, equal to the directory)', () => {
  const nameProblem = (name: string): string =>
    `name "${name}" must be 1-64 lowercase letters, digits and single hyphens, not starting or ending with a hyphen`;

  for (const name of ['My-skill', '-skill', 'skill-', 'my--skill', 'my_skill', 'a'.repeat(65)]) {
    it(`rejects "${name.length > 20 ? `${name.slice(0, 8)}… (${name.length})` : name}"`, () => {
      assert.deepEqual(check(skill(`name: ${name}\ndescription: Does X.`), name), [nameProblem(name)]);
    });
  }

  it('accepts 64 characters', () => {
    const name = 'a'.repeat(64);
    assert.deepEqual(check(skill(`name: ${name}\ndescription: Does X.`), name), []);
  });

  it('must match the directory name', () => {
    assert.deepEqual(check(valid, 'other-skill'), ['name "my-skill" must match its directory "other-skill"']);
  });

  it('is required', () => {
    assert.deepEqual(check(skill('description: Does X.')), ['missing required field "name"']);
  });
});

describe('validateSkill: description (1-1024 characters) and compatibility (1-500)', () => {
  it('is required and not empty', () => {
    assert.deepEqual(check(skill('name: my-skill')), ['missing required field "description"']);
    assert.deepEqual(check(skill('name: my-skill\ndescription: ""')), ['description must not be empty']);
  });

  it('1024 characters pass, 1025 fail (counted as characters, not bytes)', () => {
    const at = (length: number): string => skill(`name: my-skill\ndescription: ${'é'.repeat(length)}`);
    assert.deepEqual(check(at(1024)), []);
    assert.deepEqual(check(at(1025)), ['description has 1025 characters (max 1024)']);
  });

  it('compatibility over 500 characters', () => {
    assert.deepEqual(check(skill(`name: my-skill\ndescription: Does X.\ncompatibility: ${'x'.repeat(501)}`)), [
      'compatibility has 501 characters (max 500)',
    ]);
  });
});

describe(`validateSkill: body (not empty, at most ${MAX_BODY_LINES} lines)`, () => {
  const withBodyLines = (count: number): string => skill('name: my-skill\ndescription: Does X.', 'line\n'.repeat(count));

  it(`${MAX_BODY_LINES} lines pass, ${MAX_BODY_LINES + 1} fail`, () => {
    assert.deepEqual(check(withBodyLines(MAX_BODY_LINES)), []);
    assert.deepEqual(check(withBodyLines(MAX_BODY_LINES + 1)), [
      `body has ${MAX_BODY_LINES + 1} lines (max ${MAX_BODY_LINES}); move detail to references/`,
    ]);
  });

  it('an empty body', () => {
    assert.deepEqual(check(skill('name: my-skill\ndescription: Does X.', '\n\n')), ['body is empty']);
  });
});

describe('validateSkill: relative links stay inside the skill directory and exist', () => {
  const linking = (target: string): string => skill('name: my-skill\ndescription: Does X.', `See [it](${target}).\n`);

  it('an existing reference file, a heading anchor, a web link and an e-mail pass', () => {
    for (const target of ['references/rules.md', 'references/rules.md#part', '#title', 'https://agentskills.io', 'mailto:a@b.c']) {
      assert.deepEqual(check(linking(target), 'my-skill', ['references/rules.md']), [], target);
    }
  });

  it('a missing file', () => {
    assert.deepEqual(check(linking('references/missing.md')), ['link "references/missing.md" points to a file that does not exist']);
  });

  it('a link that leaves the skill directory (copies live in other folders)', () => {
    assert.deepEqual(check(linking('../../README.md')), ['link "../../README.md" leaves the skill directory']);
  });
});
