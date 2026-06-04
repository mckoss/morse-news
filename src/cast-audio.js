import fs from 'node:fs/promises';
import path from 'node:path';
import { unitsForHeadline } from '../public/morse-timing.js';
import { resolveDataDir } from './data-dir.js';

export const CAST_AUDIO_SPEED_WPM = 5;
export const CAST_AUDIO_FREQUENCY_HZ = 650;
export const CAST_AUDIO_SAMPLE_RATE = 22050;
export const CAST_AUDIO_CONTENT_TYPE = 'audio/wav';

const AUDIO_FILE_NAME = 'morse-news-cast-headline.wav';
const METADATA_FILE_NAME = 'morse-news-cast-headline.json';
const LEAD_IN_MS = 500;
const AMPLITUDE = 0.28;

export function castAudioFilePath({ dataDir = resolveDataDir() } = {}) {
  return path.join(dataDir, AUDIO_FILE_NAME);
}

export function castAudioMetadataPath({ dataDir = resolveDataDir() } = {}) {
  return path.join(dataDir, METADATA_FILE_NAME);
}

export async function readCastAudioMetadata({ dataDir = resolveDataDir() } = {}) {
  try {
    return JSON.parse(await fs.readFile(castAudioMetadataPath({ dataDir }), 'utf8'));
  } catch {
    return null;
  }
}

export async function ensureCastAudioForSnapshot(snapshot, options = {}) {
  const current = await readCastAudioMetadata(options);
  const headline = firstHeadline(snapshot);
  if (!headline) return null;

  if (
    current?.fetchedAt === snapshot.fetchedAt
    && current?.headlineTitle === headline.title
    && current?.speedWpm === CAST_AUDIO_SPEED_WPM
    && current?.frequencyHz === CAST_AUDIO_FREQUENCY_HZ
  ) {
    try {
      await fs.access(castAudioFilePath(options));
      return current;
    } catch {
      // Fall through and rebuild the missing audio file.
    }
  }

  return buildCastAudioForSnapshot(snapshot, options);
}

export async function buildCastAudioForSnapshot(snapshot, { dataDir = resolveDataDir(), now = new Date() } = {}) {
  const headline = firstHeadline(snapshot);
  if (!headline) return null;

  const units = unitsForHeadline(headline.title, CAST_AUDIO_SPEED_WPM);
  const wav = renderWav(units, {
    frequencyHz: CAST_AUDIO_FREQUENCY_HZ,
    sampleRate: CAST_AUDIO_SAMPLE_RATE,
  });
  const metadata = {
    fileName: AUDIO_FILE_NAME,
    contentType: CAST_AUDIO_CONTENT_TYPE,
    fetchedAt: snapshot.fetchedAt ?? '',
    headlineTitle: headline.title,
    source: headline.source ?? '',
    category: headline.category ?? '',
    speedWpm: CAST_AUDIO_SPEED_WPM,
    frequencyHz: CAST_AUDIO_FREQUENCY_HZ,
    sampleRate: CAST_AUDIO_SAMPLE_RATE,
    durationMs: wav.durationMs,
    bytes: wav.buffer.length,
    updatedAt: now.toISOString(),
  };

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(castAudioFilePath({ dataDir }), wav.buffer);
  await fs.writeFile(castAudioMetadataPath({ dataDir }), JSON.stringify(metadata, null, 2));
  return metadata;
}

export function renderWav(units, { frequencyHz = CAST_AUDIO_FREQUENCY_HZ, sampleRate = CAST_AUDIO_SAMPLE_RATE } = {}) {
  const samples = [];
  appendSilence(samples, msToSamples(LEAD_IN_MS, sampleRate));

  for (const unit of units) {
    for (const event of unit.events) {
      const count = msToSamples(event.ms, sampleRate);
      if (event.on) appendTone(samples, count, frequencyHz, sampleRate);
      else appendSilence(samples, count);
    }
  }

  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);

  samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, 44 + index * 2);
  });

  return {
    buffer,
    durationMs: Math.round((samples.length / sampleRate) * 1000),
  };
}

function firstHeadline(snapshot) {
  return Array.isArray(snapshot?.headlines) ? snapshot.headlines[0] : null;
}

function msToSamples(ms, sampleRate) {
  return Math.max(1, Math.round((ms / 1000) * sampleRate));
}

function appendSilence(samples, count) {
  for (let index = 0; index < count; index += 1) samples.push(0);
}

function appendTone(samples, count, frequencyHz, sampleRate) {
  for (let index = 0; index < count; index += 1) {
    const envelope = Math.min(1, index / 80, (count - index) / 80);
    const value = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate) * AMPLITUDE * envelope;
    samples.push(Math.round(value * 32767));
  }
}
