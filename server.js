import express from 'express';
import { fetchHeadlines, getHeadlineSnapshot } from './src/headlines.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public', {
  etag: true,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
}));

app.get('/api/headlines', async (req, res) => {
  try {
    const index = Math.max(0, Number.parseInt(req.query.index ?? '0', 10) || 0);
    const force = req.query.force === '1' || req.query.force === 'true';
    const payload = index > 0
      ? await getHeadlineSnapshot({ index })
      : await fetchHeadlines({ force });
    res.set('Cache-Control', force ? 'no-store' : 'public, max-age=900');
    res.json(payload);
  } catch (error) {
    console.error('headline fetch failed', error);
    res.status(500).json({ error: 'Could not load headlines today.' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Morse News listening on http://localhost:${port}`);
});
