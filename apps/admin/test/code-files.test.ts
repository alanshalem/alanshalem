import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { codeBlocks, codeLanguageOf, decodeText, fencedBlock, MAX_CODE_FILE_BYTES, readCodeFile } from '../src/editor/codeFiles.ts';
import { renderPreview } from '../src/editor/preview.ts';

/* A text or code file pasted or dropped into the editor becomes a fenced block; nothing is uploaded. */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('language of a code file (one extension map)', () => {
  it('maps the usual extensions to the fence language', () => {
    const cases: Array<[string, string]> = [
      ['main.py', 'python'], ['app.js', 'javascript'], ['app.mjs', 'javascript'], ['types.ts', 'typescript'],
      ['View.tsx', 'tsx'], ['View.jsx', 'jsx'], ['Program.cs', 'csharp'], ['deploy.sh', 'bash'], ['schema.sql', 'sql'],
      ['data.json', 'json'], ['ci.yml', 'yaml'], ['ci.yaml', 'yaml'], ['README.md', 'markdown'], ['index.html', 'html'],
      ['site.css', 'css'], ['main.go', 'go'], ['lib.rs', 'rust'], ['App.java', 'java'], ['main.c', 'c'],
      ['main.cpp', 'cpp'], ['util.h', 'c'], ['app.rb', 'ruby'], ['index.php', 'php'], ['Main.kt', 'kotlin'],
      ['App.swift', 'swift'], ['Cargo.toml', 'toml'], ['setup.ini', 'ini'], ['build.ps1', 'powershell'],
    ];
    for (const [name, language] of cases) assert.equal(codeLanguageOf(name), language, name);
  });

  it('is case-insensitive for extensions and knows files by their whole name', () => {
    assert.equal(codeLanguageOf('MAIN.PY'), 'python');
    assert.equal(codeLanguageOf('Dockerfile'), 'dockerfile');
    assert.equal(codeLanguageOf('Makefile'), 'makefile');
  });

  it('plain text files get a block without a language', () => {
    assert.equal(codeLanguageOf('notes.txt'), '');
    assert.equal(codeLanguageOf('server.log'), '');
    assert.equal(codeLanguageOf('LICENSE'), '');
  });

  it('anything else is not a known code file', () => {
    for (const name of ['photo.png', 'archive.zip', 'report.pdf', 'noextension', 'main.py.exe']) {
      assert.equal(codeLanguageOf(name), null, name);
    }
  });
});

describe('binary sniff', () => {
  it('UTF-8 text decodes (a BOM is dropped and CRLF becomes LF)', () => {
    assert.equal(decodeText(utf8('﻿print("hola")\r\nprint("ñ")\r\n')), 'print("hola")\nprint("ñ")\n');
  });

  it('a NUL byte or invalid UTF-8 means binary', () => {
    assert.equal(decodeText(new Uint8Array([0x61, 0x00, 0x62])), null);
    assert.equal(decodeText(new Uint8Array([0x61, 0xff, 0xfe, 0x62])), null);
    assert.equal(decodeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), null);
  });
});

describe('fenced block', () => {
  it('fences the code with its language and ends the code with one newline', () => {
    assert.equal(fencedBlock('print(1)\n', 'python'), '```python\nprint(1)\n```');
    assert.equal(fencedBlock('x', ''), '```\nx\n```');
  });

  it('the fence is longer than any backtick run inside the code, so the block cannot be closed early', () => {
    assert.equal(fencedBlock('a ``` b\n````\n', 'markdown'), '`````markdown\na ``` b\n````\n`````');
    const rendered = renderPreview(fencedBlock('```\n<script>alert(1)</script>\n```', 'markdown'), 'en').html;
    assert.equal((rendered.match(/<pre/g) ?? []).length, 1);
    assert.ok(!rendered.includes('<script>'), rendered);
  });

  it('an empty file is an empty block', () => {
    assert.equal(fencedBlock('', 'python'), '```python\n```');
  });
});

describe('several files', () => {
  it('one file is just its block', () => {
    assert.equal(codeBlocks([{ name: 'main.py', text: 'print(1)\n', language: 'python' }]), '```python\nprint(1)\n```');
  });

  it('several files: one block each, the file name as a caption line before it', () => {
    assert.equal(
      codeBlocks([
        { name: 'main.py', text: 'print(1)\n', language: 'python' },
        { name: 'a`b.sh', text: 'ls\n', language: 'bash' },
      ]),
      '`main.py`\n\n```python\nprint(1)\n```\n\n`` a`b.sh ``\n\n```bash\nls\n```',
    );
  });
});

describe('reading a dropped file', () => {
  it('reads a code file into its block entry', async () => {
    const result = await readCodeFile(new File(['def f():\n    return 1\n'], 'f.py', { type: 'text/x-python' }));
    assert.deepEqual(result, { ok: true, entry: { name: 'f.py', text: 'def f():\n    return 1\n', language: 'python' } });
  });

  it('a text/* file of an unknown extension is plain text', async () => {
    const result = await readCodeFile(new File(['a,b\n1,2\n'], 'data.csv', { type: 'text/csv' }));
    assert.deepEqual(result, { ok: true, entry: { name: 'data.csv', text: 'a,b\n1,2\n', language: '' } });
  });

  it('refuses a file over 256 KB without reading it', async () => {
    assert.equal(MAX_CODE_FILE_BYTES, 256 * 1024);
    let read = false;
    const big = { name: 'big.json', type: 'application/json', size: MAX_CODE_FILE_BYTES + 1, arrayBuffer: async () => ((read = true), new ArrayBuffer(0)) };
    assert.deepEqual(await readCodeFile(big), { ok: false, reason: 'tooLarge' });
    assert.equal(read, false);
  });

  it('exactly 256 KB is accepted', async () => {
    const result = await readCodeFile(new File(['a'.repeat(MAX_CODE_FILE_BYTES)], 'max.txt', { type: 'text/plain' }));
    assert.equal(result.ok, true);
  });

  it('refuses a binary file with a code extension', async () => {
    const result = await readCodeFile(new File([new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01])], 'tool.sh'));
    assert.deepEqual(result, { ok: false, reason: 'binary' });
  });
});
