import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  headlineKey,
  nextHeadlineIndex,
  resolveCompletedHeadlineIndex,
} from '../public/playback-state.js';

const headlines = [
  { title: 'Alpha Headline', source: 'NPR', category: 'national', link: 'https://example.com/a' },
  { title: 'Bravo Headline', source: 'NPR', category: 'national', link: 'https://example.com/b' },
  { title: 'Charlie Headline', source: 'NPR', category: 'national', link: 'https://example.com/c' },
];

test('nextHeadlineIndex starts with the first headline when no progress exists', () => {
  assert.equal(nextHeadlineIndex(-1, headlines.length), 0);
});

test('resolveCompletedHeadlineIndex matches saved progress by headline identity', () => {
  const saved = {
    fetchedAt: 'old-fetch-time',
    lastCompletedHeadlineIndex: 0,
    lastCompletedHeadlineKey: headlineKey(headlines[1]),
  };

  assert.equal(resolveCompletedHeadlineIndex(saved, headlines, 'new-fetch-time'), 1);
  assert.equal(nextHeadlineIndex(1, headlines.length), 2);
});

test('resolveCompletedHeadlineIndex falls back to index only for the same snapshot', () => {
  const saved = {
    fetchedAt: 'same-fetch-time',
    lastCompletedHeadlineIndex: 2,
    lastCompletedHeadlineKey: 'missing-headline-key',
  };

  assert.equal(resolveCompletedHeadlineIndex(saved, headlines, 'same-fetch-time'), 2);
  assert.equal(resolveCompletedHeadlineIndex(saved, headlines, 'new-fetch-time'), -1);
});

test('app renders and updates the next-headline marker', async () => {
  const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(appJs, /renderHeadlines[\s\S]*updateHeadlineMarker\(\)/);
  assert.match(appJs, /item\.classList\.toggle\('next-headline', isActive\)/);
  assert.match(styles, /\.headline-list li\.next-headline[\s\S]*color:/);
  assert.doesNotMatch(styles, /\.headline-list li\.next-headline\s*\{[^}]*background:/);
});

test('audio setup creates one compatible Web Audio context', async () => {
  const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appJs, /window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.equal((appJs.match(/new AudioCtor\(\)/g) ?? []).length, 1);
  assert.equal((appJs.match(/new AudioContext\(\)/g) ?? []).length, 0);
});
