import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHeadline, parseRssItems, parseRssTitles, resolveDataDir } from '../src/headlines.js';

test('parseRssTitles extracts and decodes item titles', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <title>Feed title should be ignored</title>
    <item><title>Science &amp; space</title></item>
    <item><title><![CDATA[Markets — today]]></title></item>
  </channel></rss>`;
  assert.deepEqual(parseRssTitles(xml), ['Science & space', 'Markets — today']);
});

test('parseRssItems extracts links and categories', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Markets — today]]></title>
      <link>https://example.com/story?x=1&amp;y=2</link>
      <category>Business</category>
      <category>Markets</category>
    </item>
  </channel></rss>`;
  assert.deepEqual(parseRssItems(xml), [{
    title: 'Markets — today',
    link: 'https://example.com/story?x=1&y=2',
    categories: ['Business', 'Markets'],
  }]);
});

test('normalizeHeadline tidies punctuation and whitespace', () => {
  assert.equal(normalizeHeadline('  “Hello”   —   world  '), '"Hello" - world');
});

test('resolveDataDir prefers persistent Railway volume paths with local fallback', () => {
  assert.equal(resolveDataDir({ DATA_DIR: '/persistent/data' }), '/persistent/data');
  assert.equal(resolveDataDir({ RAILWAY_VOLUME_MOUNT_PATH: '/app/data' }), '/app/data');
  assert.equal(resolveDataDir({ DATA_DIR: 'tmp/news-data' }), process.cwd() + '/tmp/news-data');
  assert.equal(resolveDataDir({}), process.cwd() + '/data');
});
