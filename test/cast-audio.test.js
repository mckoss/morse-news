import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCastAudioForSnapshot,
  castAudioFilePath,
  CAST_AUDIO_FREQUENCY_HZ,
  CAST_AUDIO_SPEED_WPM,
  ensureCastAudioForSnapshot,
  readCastAudioMetadata,
} from '../src/cast-audio.js';

test('buildCastAudioForSnapshot writes a cached WAV for the first headline', async () => {
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
  const wav = await fs.readFile(castAudioFilePath({ dataDir }));
  const savedMetadata = await readCastAudioMetadata({ dataDir });

  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(metadata.headlineTitle, 'First headline');
  assert.equal(metadata.speedWpm, CAST_AUDIO_SPEED_WPM);
  assert.equal(metadata.frequencyHz, CAST_AUDIO_FREQUENCY_HZ);
  assert.equal(savedMetadata.headlineTitle, 'First headline');
  assert.equal(savedMetadata.bytes, wav.length);
  assert.ok(metadata.durationMs > 1000);
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
