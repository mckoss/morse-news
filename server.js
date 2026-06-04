import express from 'express';
import {
  castAudioFilePath,
  CAST_AUDIO_SPEEDS_WPM,
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
  const manifest = await readCastAudioManifest();
  if (!manifest) {
    res.status(503).json({ error: 'Cast audio is being prepared. Try again in a minute.' });
    return;
  }

  const origin = `${req.protocol}://${req.get('host')}`;
  res.set('Cache-Control', 'public, max-age=900');
  res.json({
    ...manifest,
    speeds: manifest.speeds.map((entry) => ({
      ...entry,
      mediaUrl: new URL(`/api/cast-audio/${entry.speedWpm}.mp3`, origin).href,
    })),
  });
});

app.get('/api/cast-audio/:speedWpm.mp3', async (req, res) => {
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

  res.set({
    'Cache-Control': 'public, max-age=900',
    'Content-Type': entry.contentType,
  });
  res.sendFile(castAudioFilePath(speedWpm));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Morse News listening on http://localhost:${port}`);
});
