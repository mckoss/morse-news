import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  headlineKey,
  headlineSetKey,
  nextHeadlineIndex,
  resolveCompletedHeadlineIndex,
} from '../public/playback-state.js';

const headlines = [
  { title: 'Alpha Headline', source: 'NPR', category: 'national', link: 'https://example.com/a' },
  { title: 'Bravo Headline', source: 'NPR', category: 'national', link: 'https://example.com/b' },
  { title: 'Charlie Headline', source: 'NPR', category: 'national', link: 'https://example.com/c' },
];

test('fresh load without saved progress marks the first headline active', async () => {
  const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.equal(resolveCompletedHeadlineIndex(null, headlines, 'fetch-time'), -1);
  assert.equal(nextHeadlineIndex(-1, headlines.length), 0);
  assert.match(appJs, /renderHeadlines[\s\S]*updateHeadlineMarker\(\)/);
  assert.match(appJs, /class="headline-title"/);
  assert.match(appJs, /item\.classList\.toggle\('next-headline', isActive\)/);
  assert.match(styles, /\.headline-list li\.next-headline \.headline-title\s*\{[\s\S]*color:\s*#fff07a/);
});

test('resolveCompletedHeadlineIndex matches legacy saved progress by headline identity only for the same snapshot', () => {
  const saved = {
    fetchedAt: 'same-fetch-time',
    lastCompletedHeadlineIndex: 0,
    lastCompletedHeadlineKey: headlineKey(headlines[1]),
  };

  assert.equal(resolveCompletedHeadlineIndex(saved, headlines, 'same-fetch-time'), 1);
  assert.equal(resolveCompletedHeadlineIndex(saved, headlines, 'new-fetch-time'), -1);
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

test('resolveCompletedHeadlineIndex keeps independent progress per headline set', () => {
  const newerHeadlines = [
    { title: 'Delta Headline', source: 'NPR', category: 'national', link: 'https://example.com/d' },
    { title: 'Echo Headline', source: 'NPR', category: 'national', link: 'https://example.com/e' },
  ];
  const saved = {
    version: 2,
    setProgress: {
      [headlineSetKey(headlines, 'older-fetch-time')]: {
        fetchedAt: 'older-fetch-time',
        lastCompletedHeadlineIndex: 1,
        updatedAt: 1000,
      },
      [headlineSetKey(newerHeadlines, 'newer-fetch-time')]: {
        fetchedAt: 'newer-fetch-time',
        lastCompletedHeadlineIndex: 0,
        updatedAt: 2000,
      },
    },
  };

  assert.equal(resolveCompletedHeadlineIndex(saved, headlines, 'older-fetch-time'), 1);
  assert.equal(resolveCompletedHeadlineIndex(saved, newerHeadlines, 'newer-fetch-time'), 0);
  assert.equal(resolveCompletedHeadlineIndex(saved, headlines, 'different-fetch-time'), -1);
});

test('audio setup creates one compatible Web Audio context', async () => {
  const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appJs, /window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.equal((appJs.match(/new AudioCtor\(\)/g) ?? []).length, 1);
  assert.equal((appJs.match(/new AudioContext\(\)/g) ?? []).length, 0);
  assert.match(appJs, /await state\.audio\.resume\(\)/);
  assert.match(appJs, /state\.audio\.state !== 'running'/);
  assert.match(appJs, /state\.oscillator\.start\(\)/);
  assert.match(appJs, /state\.oscillatorStarted = true/);
  assert.match(appJs, /Could not start audio in this browser/);
});

test('playback preferences can recover from stale cookie or storage state', async () => {
  const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appJs, /readPlaybackStateCookie\(\)/);
  assert.match(appJs, /readPlaybackStateStorage\(\)/);
  assert.match(appJs, /setFrequency\(Number\(saved\?\.frequencyHz\)/);
  assert.match(appJs, /frequencyHz:\s*Number\(els\.frequency\.value\)/);
  assert.match(appJs, /const now = Date\.now\(\)/);
  assert.match(appJs, /updatedAt:\s*now/);
  assert.match(appJs, /headlineSetKey\(state\.headlines, state\.payload\.fetchedAt\)/);
  assert.match(appJs, /PLAYBACK_STATE_MAX_AGE_SECONDS = 30 \* 24 \* 60 \* 60/);
  assert.match(appJs, /pruneSetProgress\(previous\.setProgress, now\)/);
  assert.match(appJs, /\.\.\.\(older\.setProgress \?\? \{\}\)/);
});

test('paused practice state clears when browsing to a different headline set', async () => {
  const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appJs, /previousSetKey = state\.headlines\.length > 0[\s\S]*headlineSetKey\(state\.headlines, state\.payload\?\.fetchedAt\)/);
  assert.match(appJs, /nextSetKey = nextHeadlines\.length > 0[\s\S]*headlineSetKey\(nextHeadlines, payload\.fetchedAt\)/);
  assert.match(appJs, /changedHeadlineSet && state\.sessionActive && !state\.playing\) stopPracticeForHeadlineSetChange\(\)/);
  assert.match(appJs, /function stopPracticeForHeadlineSetChange\(\) \{[\s\S]*state\.sessionActive = false/);
  assert.match(appJs, /function stopPracticeForHeadlineSetChange\(\) \{[\s\S]*state\.playbackRunId \+= 1/);
  assert.match(appJs, /function stopPracticeForHeadlineSetChange\(\) \{[\s\S]*els\.stop\.disabled = true/);
});
