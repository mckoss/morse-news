import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHeadline, parseRssTitles } from '../src/headlines.js';

test('parseRssTitles extracts and decodes item titles', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <title>Feed title should be ignored</title>
    <item><title>Science &amp; space</title></item>
    <item><title><![CDATA[Markets — today]]></title></item>
  </channel></rss>`;
  assert.deepEqual(parseRssTitles(xml), ['Science & space', 'Markets — today']);
});

test('normalizeHeadline tidies punctuation and whitespace', () => {
  assert.equal(normalizeHeadline('  “Hello”   —   world  '), '"Hello" - world');
});
