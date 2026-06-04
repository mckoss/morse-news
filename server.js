import express from 'express';
import { createHash } from 'node:crypto';
import {
  castAudioFilePath,
  CAST_AUDIO_SPEEDS_WPM,
  ensureCastAudioForSnapshot,
  getCastAudioEntry,
  readCastAudioManifest,
} from './src/cast-audio.js';
import { getCachedHeadlineSnapshot } from './src/headlines.js';
import { ensureHeadlineRefreshTimer } from './src/headline-refresh-scheduler.js';

const app = express();
const port = process.env.PORT || 3000;

app.set('trust proxy', true);
ensureHeadlineRefreshTimer();

app.use(express.static('public', {
  etag: true,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
}));

app.get('/api/headlines', async (req, res) => {
  ensureHeadlineRefreshTimer();
  try {
    const index = Math.max(0, Number.parseInt(req.query.index ?? '0', 10) || 0);
    const payload = await getCachedHeadlineSnapshot({ index });
    res.set('Cache-Control', 'public, max-age=900');
    res.json(payload);
  } catch (error) {
    console.error('headline cache unavailable', error);
    res.status(503).json({ error: 'Headlines are refreshing. Try again in a minute.' });
  }
});

app.get('/api/cast-audio', async (req, res) => {
  ensureHeadlineRefreshTimer();
  let manifest = null;
  try {
    manifest = await ensureCurrentCastAudioManifest();
  } catch (error) {
    console.error('cast audio unavailable', error);
  }
  if (!manifest) {
    res.status(503).json({ error: 'Cast audio is being prepared. Try again in a minute.' });
    return;
  }

  const origin = `${req.protocol}://${req.get('host')}`;
  const mediaVersion = castMediaVersion(manifest);
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.json({
    ...manifest,
    mediaVersion,
    speeds: manifest.speeds.map((entry) => ({
      ...entry,
      mediaUrl: new URL(`/api/cast-audio/${mediaVersion}/${entry.speedWpm}.mp3`, origin).href,
    })),
  });
});

async function ensureCurrentCastAudioManifest() {
  const snapshot = await getCachedHeadlineSnapshot({ index: 0 });
  return ensureCastAudioForSnapshot(snapshot);
}

app.get('/api/cast-audio/:mediaVersion/:speedWpm.mp3', sendCastAudio);
app.get('/api/cast-audio/:speedWpm.mp3', async (req, res) => {
  req.params.mediaVersion = null;
  await sendCastAudio(req, res);
});

async function sendCastAudio(req, res) {
  ensureHeadlineRefreshTimer();
  const manifest = await readCastAudioManifest();
  const speedWpm = Number(req.params.speedWpm);
  const entry = getCastAudioEntry(manifest, speedWpm);
  if (!entry) {
    const status = CAST_AUDIO_SPEEDS_WPM.includes(speedWpm) ? 503 : 404;
    res.status(status).json({
      error: status === 404 ? 'Unsupported Cast speed.' : 'Cast audio is being prepared. Try again in a minute.',
    });
    return;
  }

  const requestedVersion = req.params.mediaVersion;
  if (requestedVersion && requestedVersion !== castMediaVersion(manifest)) {
    res.status(410).json({ error: 'This Cast audio URL is stale. Fetch a fresh Cast manifest.' });
    return;
  }

  res.set({
    'Cache-Control': requestedVersion ? 'public, max-age=86400, immutable' : 'no-cache, must-revalidate',
    'Content-Type': entry.contentType,
  });
  res.sendFile(castAudioFilePath(speedWpm));
}

function castMediaVersion(manifest) {
  const source = [
    manifest?.updatedAt,
    manifest?.fetchedAt,
    manifest?.timingVersion,
    manifest?.speeds?.map((entry) => `${entry.speedWpm}-${entry.bytes}-${entry.durationMs}`).join('_'),
  ].filter(Boolean).join('_') || String(Date.now());

  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Morse News listening on http://localhost:${port}`);
});
