import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as markdown from '../src/index.ts';
import { escapeHtml, toPlainText, unescapeHtml } from '../src/index.ts';

describe('public API', () => {
  it('exports exactly the documented runtime values (createSlugger stays internal)', () => {
    assert.deepEqual(Object.keys(markdown).sort(), [
      'POST_BODY_RENDER_OPTIONS',
      'blockStartLines',
      'escapeHtml',
      'excerpt',
      'readingTimeMinutes',
      'readingTimeOfText',
      'renderMarkdown',
      'sanitizeUrl',
      'slugify',
      'toPlainText',
      'unescapeHtml',
      'wordCount',
    ]);
  });
});

describe('unescapeHtml', () => {
  it('decodes each entity escapeHtml emits', () => {
    assert.equal(unescapeHtml('&amp; &lt; &gt; &quot; &#39;'), `& < > " '`);
  });

  it('is the exact inverse of escapeHtml', () => {
    for (const text of ['', 'plain', `<a href="x">Tom & Jerry's</a>`, '&amp;lt;', '&lt;&gt;', '&&&', '<<>>', '&#39;']) {
      assert.equal(unescapeHtml(escapeHtml(text)), text, text);
    }
  });

  it('decodes in one pass: an escaped entity comes back as that entity, not as its character', () => {
    assert.equal(unescapeHtml('&amp;lt;'), '&lt;');
    assert.equal(unescapeHtml('&amp;amp;'), '&amp;');
    assert.equal(unescapeHtml('&amp;#39;'), '&#39;');
  });

  it('leaves alone every entity escapeHtml never emits', () => {
    const others = '&nbsp; &apos; &#x27; &#039; &copy; &AMP; &lt &amp';
    assert.equal(unescapeHtml(others), others);
  });
});

describe('toPlainText decodes with unescapeHtml', () => {
  it('shows the characters the author typed, including literal entities', () => {
    assert.equal(toPlainText(`5 < 6 & "x" 'y' > z`), `5 < 6 & "x" 'y' > z`);
    assert.equal(toPlainText('write &lt; for <'), 'write &lt; for <');
    assert.equal(toPlainText('`&amp;`'), '&amp;');
  });
});
