import express from 'express';
import { getCachedHeadlineSnapshot } from './src/headlines.js';
import { ensureHeadlineRefreshTimer } from './src/headline-refresh-scheduler.js';

const app = express();
const port = process.env.PORT || 3000;

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

app.listen(port, '0.0.0.0', () => {
  console.log(`Morse News listening on http://localhost:${port}`);
});
