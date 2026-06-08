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
  CAST_AUDIO_SAMPLE_RATE,
  CAST_AUDIO_SPEEDS_WPM,
  CAST_AUDIO_TIMING_VERSION,
  ensureCastAudioForSnapshot,
  getCastAudioEntry,
  readCastAudioManifest,
  renderPcmSamples,
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
  assert.equal(metadata.sampleRate, CAST_AUDIO_SAMPLE_RATE);
  assert.equal(metadata.sampleRate, 44100);
  assert.equal(metadata.timingVersion, CAST_AUDIO_TIMING_VERSION);
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

test('ensureCastAudioForSnapshot rebuilds old timing-version media', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'morse-news-cast-'));
  const snapshot = {
    fetchedAt: '2026-06-04T13:05:00.000Z',
    headlines: [{ title: 'Timing version headline', source: 'Test Source', category: 'test' }],
  };

  await buildCastAudioForSnapshot(snapshot, {
    dataDir,
    now: new Date('2026-06-04T14:00:00.000Z'),
  });

  const manifestPath = path.join(dataDir, 'morse-news-cast-audio.json');
  const oldManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  delete oldManifest.timingVersion;
  await fs.writeFile(manifestPath, JSON.stringify(oldManifest, null, 2));

  const rebuilt = await ensureCastAudioForSnapshot(snapshot, {
    dataDir,
    now: new Date('2026-06-04T15:00:00.000Z'),
  });

  assert.equal(rebuilt.timingVersion, CAST_AUDIO_TIMING_VERSION);
  assert.equal(rebuilt.updatedAt, '2026-06-04T15:00:00.000Z');
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

test('renderPcmSamples shapes tone edges to avoid Cast playback clicks', () => {
  const sampleRate = CAST_AUDIO_SAMPLE_RATE;
  const samples = renderPcmSamples([{ events: [{ on: true, ms: 100 }] }], {
    frequencyHz: CAST_AUDIO_FREQUENCY_HZ,
    sampleRate,
  });
  const toneStart = Math.round(0.5 * sampleRate);
  const toneLength = Math.round(0.1 * sampleRate);
  const edgeLength = Math.round(0.001 * sampleRate);
  const middleStart = toneStart + Math.round(0.04 * sampleRate);

  assert.equal(samples[toneStart], 0, 'tone starts at zero amplitude');
  assert.equal(samples[toneStart + toneLength - 1], 0, 'tone ends at zero amplitude');
  assert.ok(maxAbs(samples, toneStart, edgeLength) < 1500, 'attack is ramped in gently');
  assert.ok(maxAbs(samples, toneStart + toneLength - edgeLength, edgeLength) < 1500, 'release is ramped out gently');
  assert.ok(maxAbs(samples, middleStart, edgeLength) > 7000, 'tone reaches full sidetone amplitude');
});

function maxAbs(samples, start, count) {
  let max = 0;
  for (let index = start; index < start + count; index += 1) {
    max = Math.max(max, Math.abs(samples[index]));
  }
  return max;
}
