import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRss } from '../src/rss.ts';

// The same format the site generates (apps/web/src/lib/feeds.ts): RSS 2.0 with <atom:link> in the channel.
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog</title>
    <link>https://example.com/en/</link>
    <atom:link href="https://example.com/en/rss.xml" rel="self" type="application/rss+xml" />
    <item>
      <title>Older &amp; wiser</title>
      <link>https://example.com/en/articles/older/</link>
      <pubDate>Mon, 02 Nov 2026 12:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>Not a <title>title</title></p>]]></content:encoded>
    </item>
    <item>
      <title><![CDATA[Newest <post>]]></title>
      <link>https://example.com/en/articles/newest/</link>
      <pubDate>Wed, 25 Nov 2026 09:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe('parseRss', () => {
  it('returns title, link and date of each item, newest first, decoding entities and CDATA', () => {
    assert.deepEqual(parseRss(feed), [
      { title: 'Newest <post>', url: 'https://example.com/en/articles/newest/', date: '2026-11-25T09:30:00.000Z' },
      { title: 'Older & wiser', url: 'https://example.com/en/articles/older/', date: '2026-11-02T12:00:00.000Z' },
    ]);
  });

  it('decodes numeric entities and drops items without a title, a valid date or an http(s) link', () => {
    const xml = `<rss><channel>
      <item><title>Caf&#233; &#x2014; ok</title><link>https://a.example/x</link><pubDate>Tue, 03 Nov 2026 00:00:00 GMT</pubDate></item>
      <item><title></title><link>https://a.example/y</link><pubDate>Tue, 03 Nov 2026 00:00:00 GMT</pubDate></item>
      <item><title>No date</title><link>https://a.example/z</link><pubDate>someday</pubDate></item>
      <item><title>Script</title><link>javascript:alert(1)</link><pubDate>Tue, 03 Nov 2026 00:00:00 GMT</pubDate></item>
    </channel></rss>`;
    assert.deepEqual(parseRss(xml), [{ title: 'Café — ok', url: 'https://a.example/x', date: '2026-11-03T00:00:00.000Z' }]);
  });

  it('a document without items gives an empty list', () => {
    assert.deepEqual(parseRss('<html><body>502 Bad Gateway</body></html>'), []);
  });
});
