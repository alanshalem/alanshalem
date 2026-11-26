import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { i18nFor } from '../src/i18n/i18n.ts';
import { describeIssue, lintPost, type LintIssue } from '../src/posts/lint.ts';
import { META_DESCRIPTION_MAX, SEO_TITLE_MAX } from '../src/posts/seo.ts';

/* Revisor del post (S3): reglas puras; cada aviso dice dónde está (línea del cuerpo o campo) para ir ahí. */

const OK = { title: 'Un título', summary: 'Un resumen.' };
const lintBody = (body: string): LintIssue[] => lintPost({ ...OK, body });
const rules = (issues: readonly LintIssue[]) => issues.map((issue) => issue.rule);

describe('revisor: cuerpo', () => {
  it('un post sin problemas no tiene avisos', () => {
    const body = '# Uno\n\n## Dos\n\nTexto[^1] con [link](https://x.com) y ![foto](/a.webp).\n\n> [!TIP]\n> ok\n\n[^1]: nota';
    assert.deepEqual(lintBody(body), []);
  });

  it('título sin espacio después de # ("#II."): no es un título', () => {
    assert.deepEqual(lintBody('texto\n\n#II. La idea\n> ##Otra'), [
      { rule: 'headingSpace', target: { line: 2 }, params: { text: '#II.' } },
      { rule: 'headingSpace', target: { line: 3 }, params: { text: '##Otra' } },
    ]);
  });

  it('salto de nivel entre títulos seguidos (el primero puede ser cualquiera)', () => {
    assert.deepEqual(lintBody('## Uno\n\n#### Tres\n\n## Dos\n\n### Ok'), [
      { rule: 'headingSkip', target: { line: 2 }, params: { from: 2, to: 4 } },
    ]);
  });

  it('imágenes sin texto alternativo', () => {
    assert.deepEqual(lintBody('a ![](/x.webp) b\n\n![  ](/y.webp "epígrafe")'), [
      { rule: 'imageAlt', target: { line: 0 }, params: {} },
      { rule: 'imageAlt', target: { line: 2 }, params: {} },
    ]);
  });

  it('links vacíos (también la url de relleno de Ctrl+K) e inseguros (sanitizeUrl)', () => {
    assert.deepEqual(lintBody('[a]() [b](url) [c](javascript:void) [d](<mi archivo.pdf>) [e](/ok "t")'), [
      { rule: 'linkEmpty', target: { line: 0 }, params: { text: 'a' } },
      { rule: 'linkEmpty', target: { line: 0 }, params: { text: 'b' } },
      { rule: 'linkUnsafe', target: { line: 0 }, params: { url: 'javascript:void' } },
    ]);
  });

  it('notas al pie: referencia sin definición y definición sin usar', () => {
    assert.deepEqual(lintBody('Uno[^1] dos[^2].\n\n[^1]: ok\n[^3]: sobra'), [
      { rule: 'footnoteMissing', target: { line: 0 }, params: { id: '2' } },
      { rule: 'footnoteUnused', target: { line: 3 }, params: { id: '3' } },
    ]);
  });

  it('marcador de caja mal escrito ("[!NOTA]"); en minúsculas vale', () => {
    assert.deepEqual(lintBody('> [!NOTA]\n> x\n\n> [!note]\n> y'), [
      { rule: 'calloutUnknown', target: { line: 0 }, params: { marker: '[!NOTA]', kinds: '[!NOTE], [!TIP], [!WARNING]' } },
    ]);
  });

  it('nada dentro del código (bloques ni en línea)', () => {
    assert.deepEqual(lintBody('```\n#II.\n![](x)\n[a]()\n```\n\nUsá `![](x)` y `[^9]`.'), []);
  });
});

describe('revisor: título y resumen (SEO)', () => {
  it('título demasiado largo para buscadores', () => {
    const title = 'x'.repeat(SEO_TITLE_MAX + 1);
    assert.deepEqual(lintPost({ title, summary: OK.summary, body: '' }), [
      { rule: 'titleTooLong', target: { field: 'title' }, params: { length: SEO_TITLE_MAX + 1, max: SEO_TITLE_MAX } },
    ]);
    assert.deepEqual(lintPost({ title: 'x'.repeat(SEO_TITLE_MAX), summary: OK.summary, body: '' }), []);
  });

  it('resumen vacío o más largo que la meta description', () => {
    assert.deepEqual(rules(lintPost({ title: 'T', summary: '  ', body: '' })), ['summaryEmpty']);
    const summary = 'y'.repeat(META_DESCRIPTION_MAX + 5);
    assert.deepEqual(lintPost({ title: 'T', summary, body: '' }), [
      { rule: 'summaryTooLong', target: { field: 'summary' }, params: { length: META_DESCRIPTION_MAX + 5, max: META_DESCRIPTION_MAX } },
    ]);
  });

  it('primero los campos, después el cuerpo en orden de línea', () => {
    const issues = lintPost({ title: 'T', summary: '', body: '![](x)\n\n#mal' });
    assert.deepEqual(rules(issues), ['summaryEmpty', 'imageAlt', 'headingSpace']);
  });
});

describe('revisor: mensajes en los dos idiomas', () => {
  it('dónde (línea 1-based o campo) y qué', () => {
    const [issue] = lintBody('#II. x');
    assert.deepEqual(describeIssue(issue!, i18nFor('es')), {
      where: 'Línea 1',
      message: '“#II.” no es un título: falta un espacio después de #.',
    });
    assert.deepEqual(describeIssue(issue!, i18nFor('en')), {
      where: 'Line 1',
      message: '“#II.” isn’t a heading: add a space after #.',
    });
    const [summary] = lintPost({ title: 'T', summary: '', body: '' });
    assert.equal(describeIssue(summary!, i18nFor('en')).where, 'Summary');
  });
});
