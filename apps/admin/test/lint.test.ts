import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { i18nFor } from '../src/i18n/i18n.ts';
import { describeIssue, lintPost, type LintIssue } from '../src/posts/lint.ts';
import { META_DESCRIPTION_MAX, SEO_TITLE_MAX } from '../src/posts/seo.ts';

/* The post reviewer: pure rules; each warning says where it is (body line or field) so one can go there. */

const OK = { title: 'Un título', summary: 'Un resumen.' };
const lintBody = (body: string): LintIssue[] => lintPost({ ...OK, body });
const rules = (issues: readonly LintIssue[]) => issues.map((issue) => issue.rule);

describe('reviewer: body', () => {
  it('a post without problems has no warnings', () => {
    const body = '## Uno\n\n### Dos\n\nTexto[^1] con [link](https://x.com) y ![foto](/a.webp).\n\n> [!TIP]\n> ok\n\n[^1]: nota';
    assert.deepEqual(lintBody(body), []);
  });

  it('heading without a space after # ("#II."): it is not a heading', () => {
    assert.deepEqual(lintBody('texto\n\n#II. La idea\n> ##Otra'), [
      { rule: 'headingSpace', target: { line: 2 }, params: { text: '#II.' } },
      { rule: 'headingSpace', target: { line: 3 }, params: { text: '##Otra' } },
    ]);
  });

  it('level skip between consecutive headings', () => {
    assert.deepEqual(lintBody('## Uno\n\n#### Tres\n\n## Dos\n\n### Ok'), [
      { rule: 'headingSkip', target: { line: 2 }, params: { from: 2, to: 4 } },
    ]);
  });

  // The post title is the h1; sections start at ## (h2). A stray # is published as h2.
  it('levels start at ##: a first ### skips from the post title (level 1)', () => {
    assert.deepEqual(lintBody('### Sub\n\ntexto'), [
      { rule: 'headingSkip', target: { line: 0 }, params: { from: 1, to: 3 } },
    ]);
    assert.deepEqual(lintBody('## Sección\n\n### Sub'), []);
  });

  it('a # in the body: "Usá ## para secciones" (and it counts as ##, no false skips)', () => {
    assert.deepEqual(lintBody('texto\n\n# Sección\n\n### Sub\n\n> # En cita'), [
      { rule: 'headingOne', target: { line: 2 }, params: {} },
      { rule: 'headingOne', target: { line: 6 }, params: {} },
    ]);
  });

  it('images without alt text', () => {
    assert.deepEqual(lintBody('a ![](/x.webp) b\n\n![  ](/y.webp "epígrafe")'), [
      { rule: 'imageAlt', target: { line: 0 }, params: {} },
      { rule: 'imageAlt', target: { line: 2 }, params: {} },
    ]);
  });

  it('empty links (also the Ctrl+K placeholder url) and unsafe ones (sanitizeUrl)', () => {
    assert.deepEqual(lintBody('[a]() [b](url) [c](javascript:void) [d](<mi archivo.pdf>) [e](/ok "t")'), [
      { rule: 'linkEmpty', target: { line: 0 }, params: { text: 'a' } },
      { rule: 'linkEmpty', target: { line: 0 }, params: { text: 'b' } },
      { rule: 'linkUnsafe', target: { line: 0 }, params: { url: 'javascript:void' } },
    ]);
  });

  it('footnotes: reference without a definition and unused definition', () => {
    assert.deepEqual(lintBody('Uno[^1] dos[^2].\n\n[^1]: ok\n[^3]: sobra'), [
      { rule: 'footnoteMissing', target: { line: 0 }, params: { id: '2' } },
      { rule: 'footnoteUnused', target: { line: 3 }, params: { id: '3' } },
    ]);
  });

  it('misspelled callout marker ("[!NOTA]"); lowercase is valid', () => {
    assert.deepEqual(lintBody('> [!NOTA]\n> x\n\n> [!note]\n> y'), [
      { rule: 'calloutUnknown', target: { line: 0 }, params: { marker: '[!NOTA]', kinds: '[!NOTE], [!TIP], [!WARNING]' } },
    ]);
  });

  it('nothing inside code (blocks or inline)', () => {
    assert.deepEqual(lintBody('```\n#II.\n![](x)\n[a]()\n```\n\nUsá `![](x)` y `[^9]`.'), []);
  });
});

describe('reviewer: title and summary (SEO)', () => {
  it('title too long for search engines', () => {
    const title = 'x'.repeat(SEO_TITLE_MAX + 1);
    assert.deepEqual(lintPost({ title, summary: OK.summary, body: '' }), [
      { rule: 'titleTooLong', target: { field: 'title' }, params: { length: SEO_TITLE_MAX + 1, max: SEO_TITLE_MAX } },
    ]);
    assert.deepEqual(lintPost({ title: 'x'.repeat(SEO_TITLE_MAX), summary: OK.summary, body: '' }), []);
  });

  it('empty summary or longer than the meta description', () => {
    assert.deepEqual(rules(lintPost({ title: 'T', summary: '  ', body: '' })), ['summaryEmpty']);
    const summary = 'y'.repeat(META_DESCRIPTION_MAX + 5);
    assert.deepEqual(lintPost({ title: 'T', summary, body: '' }), [
      { rule: 'summaryTooLong', target: { field: 'summary' }, params: { length: META_DESCRIPTION_MAX + 5, max: META_DESCRIPTION_MAX } },
    ]);
  });

  it('fields first, then the body in line order', () => {
    const issues = lintPost({ title: 'T', summary: '', body: '![](x)\n\n#mal' });
    assert.deepEqual(rules(issues), ['summaryEmpty', 'imageAlt', 'headingSpace']);
  });
});

describe('reviewer: messages in both languages', () => {
  it('where (1-based line or field) and what', () => {
    const [issue] = lintBody('#II. x');
    assert.deepEqual(describeIssue(issue!, i18nFor('es')), {
      where: 'Línea 1',
      message: '“#II.” no es un título: falta un espacio después de #.',
    });
    assert.deepEqual(describeIssue(issue!, i18nFor('en')), {
      where: 'Line 1',
      message: '“#II.” isn’t a heading: add a space after #.',
    });
    const [one] = lintBody('# Sección');
    assert.equal(describeIssue(one!, i18nFor('es')).message, 'Usá ## para secciones: el # es el título del post (un # en el texto se publica como ##).');
    assert.equal(describeIssue(one!, i18nFor('en')).message, 'Use ## for sections: # is the post title (a # in the text is published as ##).');
    const [summary] = lintPost({ title: 'T', summary: '', body: '' });
    assert.equal(describeIssue(summary!, i18nFor('en')).where, 'Summary');
  });
});
