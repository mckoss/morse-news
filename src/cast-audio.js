import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { unitsForHeadline } from '../public/morse-timing.js';
import { resolveDataDir } from './data-dir.js';

export const CAST_AUDIO_SPEEDS_WPM = [5, 10, 15, 20, 25, 30];
export const CAST_AUDIO_FREQUENCY_HZ = 650;
export const CAST_AUDIO_SAMPLE_RATE = 22050;
export const CAST_AUDIO_BIT_RATE_KBPS = 48;
export const CAST_AUDIO_CONTENT_TYPE = 'audio/mpeg';

const MANIFEST_FILE_NAME = 'morse-news-cast-audio.json';
const LEAD_IN_MS = 500;
const AMPLITUDE = 0.28;

export function castAudioFileName(speedWpm) {
  return `morse-news-cast-${speedWpm}wpm.mp3`;
}

export function castAudioFilePath(speedWpm, { dataDir = resolveDataDir() } = {}) {
  return path.join(dataDir, castAudioFileName(speedWpm));
}

export function castAudioManifestPath({ dataDir = resolveDataDir() } = {}) {
  return path.join(dataDir, MANIFEST_FILE_NAME);
}

export async function readCastAudioManifest({ dataDir = resolveDataDir() } = {}) {
  try {
    return JSON.parse(await fs.readFile(castAudioManifestPath({ dataDir }), 'utf8'));
  } catch {
    return null;
  }
}

export async function ensureCastAudioForSnapshot(snapshot, options = {}) {
  const current = await readCastAudioManifest(options);
  if (!hasHeadlines(snapshot)) return null;

  if (
    current?.fetchedAt === snapshot.fetchedAt
    && current?.headlineCount === snapshot.headlines.length
    && current?.frequencyHz === CAST_AUDIO_FREQUENCY_HZ
    && current?.bitRateKbps === CAST_AUDIO_BIT_RATE_KBPS
    && hasAllSpeedEntries(current)
  ) {
    try {
      await Promise.all(CAST_AUDIO_SPEEDS_WPM.map((speed) => fs.access(castAudioFilePath(speed, options))));
      return current;
    } catch {
      // Fall through and rebuild missing media files.
    }
  }

  return buildCastAudioForSnapshot(snapshot, options);
}

export async function buildCastAudioForSnapshot(snapshot, { dataDir = resolveDataDir(), now = new Date() } = {}) {
  if (!hasHeadlines(snapshot)) return null;

  await fs.mkdir(dataDir, { recursive: true });
  const entries = [];
  for (const speedWpm of CAST_AUDIO_SPEEDS_WPM) {
    const units = unitsForHeadlines(snapshot.headlines, speedWpm);
    const mp3 = await renderMp3(units, {
      bitRateKbps: CAST_AUDIO_BIT_RATE_KBPS,
      frequencyHz: CAST_AUDIO_FREQUENCY_HZ,
      sampleRate: CAST_AUDIO_SAMPLE_RATE,
    });
    const fileName = castAudioFileName(speedWpm);
    await fs.writeFile(castAudioFilePath(speedWpm, { dataDir }), mp3.buffer);
    entries.push({
      speedWpm,
      fileName,
      contentType: CAST_AUDIO_CONTENT_TYPE,
      durationMs: mp3.durationMs,
      bytes: mp3.buffer.length,
    });
  }

  const metadata = {
    fetchedAt: snapshot.fetchedAt ?? '',
    headlineCount: snapshot.headlines.length,
    firstHeadlineTitle: snapshot.headlines[0]?.title ?? '',
    frequencyHz: CAST_AUDIO_FREQUENCY_HZ,
    sampleRate: CAST_AUDIO_SAMPLE_RATE,
    bitRateKbps: CAST_AUDIO_BIT_RATE_KBPS,
    contentType: CAST_AUDIO_CONTENT_TYPE,
    speeds: entries,
    updatedAt: now.toISOString(),
  };

  await fs.writeFile(castAudioManifestPath({ dataDir }), JSON.stringify(metadata, null, 2));
  return metadata;
}

export function getCastAudioEntry(manifest, speedWpm) {
  const speed = Number(speedWpm);
  if (!CAST_AUDIO_SPEEDS_WPM.includes(speed)) return null;
  return manifest?.speeds?.find((entry) => entry.speedWpm === speed) ?? null;
}

export function unitsForHeadlines(headlines, effectiveWpm) {
  return headlines.flatMap((headline) => unitsForHeadline(headline.title, effectiveWpm));
}

export async function renderMp3(units, {
  bitRateKbps = CAST_AUDIO_BIT_RATE_KBPS,
  frequencyHz = CAST_AUDIO_FREQUENCY_HZ,
  sampleRate = CAST_AUDIO_SAMPLE_RATE,
} = {}) {
  const samples = renderPcmSamples(units, { frequencyHz, sampleRate });
  const pcm = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const buffer = await encodeMp3(pcm, { bitRateKbps, sampleRate });

  return {
    buffer,
    durationMs: Math.round((samples.length / sampleRate) * 1000),
  };
}

export function renderPcmSamples(units, { frequencyHz = CAST_AUDIO_FREQUENCY_HZ, sampleRate = CAST_AUDIO_SAMPLE_RATE } = {}) {
  const totalSamples = units
    .flatMap((unit) => unit.events)
    .reduce((sum, event) => sum + msToSamples(event.ms, sampleRate), msToSamples(LEAD_IN_MS, sampleRate));
  const samples = new Int16Array(totalSamples);
  let offset = msToSamples(LEAD_IN_MS, sampleRate);

  for (const unit of units) {
    for (const event of unit.events) {
      const count = msToSamples(event.ms, sampleRate);
      if (event.on) appendTone(samples, offset, count, frequencyHz, sampleRate);
      offset += count;
    }
  }

  return samples;
}

function hasHeadlines(snapshot) {
  return Array.isArray(snapshot?.headlines) && snapshot.headlines.length > 0;
}

function hasAllSpeedEntries(manifest) {
  return CAST_AUDIO_SPEEDS_WPM.every((speed) => getCastAudioEntry(manifest, speed));
}

function msToSamples(ms, sampleRate) {
  return Math.max(1, Math.round((ms / 1000) * sampleRate));
}

function appendTone(samples, offset, count, frequencyHz, sampleRate) {
  for (let index = 0; index < count; index += 1) {
    const envelope = Math.min(1, index / 80, (count - index) / 80);
    const value = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate) * AMPLITUDE * envelope;
    samples[offset + index] = Math.round(value * 32767);
  }
}

function encodeMp3(pcm, { bitRateKbps, sampleRate }) {
  if (!ffmpegPath) throw new Error('ffmpeg binary is not available');

  return new Promise((resolve, reject) => {
    const chunks = [];
    const errors = [];
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 's16le',
      '-ar', String(sampleRate),
      '-ac', '1',
      '-i', 'pipe:0',
      '-vn',
      '-acodec', 'libmp3lame',
      '-b:a', `${bitRateKbps}k`,
      '-f', 'mp3',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errors).toString('utf8')}`));
    });

    child.stdin.end(pcm);
  });
}
