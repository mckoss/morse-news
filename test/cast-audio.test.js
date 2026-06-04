import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCastAudioForSnapshot,
  castAudioFilePath,
  CAST_AUDIO_CONTENT_TYPE,
  CAST_AUDIO_FREQUENCY_HZ,
  CAST_AUDIO_SPEEDS_WPM,
  ensureCastAudioForSnapshot,
  getCastAudioEntry,
  readCastAudioManifest,
} from '../src/cast-audio.js';

test('buildCastAudioForSnapshot writes cached MP3s for all headlines at each speed', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'morse-news-cast-'));
  const snapshot = {
    fetchedAt: '2026-06-04T13:05:00.000Z',
    headlines: [
      { title: 'First headline', source: 'Test Source', category: 'test' },
      { title: 'Second headline', source: 'Test Source', category: 'test' },
    ],
  };

  const metadata = await buildCastAudioForSnapshot(snapshot, {
    dataDir,
    now: new Date('2026-06-04T14:00:00.000Z'),
  });
  const savedMetadata = await readCastAudioManifest({ dataDir });

  assert.equal(metadata.headlineCount, 2);
  assert.equal(metadata.firstHeadlineTitle, 'First headline');
  assert.equal(metadata.frequencyHz, CAST_AUDIO_FREQUENCY_HZ);
  assert.deepEqual(CAST_AUDIO_SPEEDS_WPM, [5, 10, 15, 20, 25, 30]);
  assert.deepEqual(metadata.speeds.map((entry) => entry.speedWpm), CAST_AUDIO_SPEEDS_WPM);
  assert.equal(savedMetadata.firstHeadlineTitle, 'First headline');

  for (const speedWpm of CAST_AUDIO_SPEEDS_WPM) {
    const entry = getCastAudioEntry(metadata, speedWpm);
    const mp3 = await fs.readFile(castAudioFilePath(speedWpm, { dataDir }));

    assert.equal(entry.contentType, CAST_AUDIO_CONTENT_TYPE);
    assert.equal(entry.bytes, mp3.length);
    assert.ok(entry.durationMs > 1000);
    assert.equal(mp3.subarray(0, 3).toString('ascii'), 'ID3');
  }
});

test('ensureCastAudioForSnapshot reuses a current cached media file', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'morse-news-cast-'));
  const snapshot = {
    fetchedAt: '2026-06-04T13:05:00.000Z',
    headlines: [{ title: 'Cached headline', source: 'Test Source', category: 'test' }],
  };

  const first = await ensureCastAudioForSnapshot(snapshot, {
    dataDir,
    now: new Date('2026-06-04T14:00:00.000Z'),
  });
  const second = await ensureCastAudioForSnapshot(snapshot, {
    dataDir,
    now: new Date('2026-06-04T15:00:00.000Z'),
  });

  assert.equal(second.updatedAt, first.updatedAt);
});
