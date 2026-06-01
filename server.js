import express from 'express';
import { fetchHeadlines } from './src/headlines.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public', {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

app.get('/api/headlines', async (_req, res) => {
  try {
    const payload = await fetchHeadlines();
    res.set('Cache-Control', 'public, max-age=900');
    res.json(payload);
  } catch (error) {
    console.error('headline fetch failed', error);
    res.status(500).json({ error: 'Could not load headlines today.' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Morse News listening on http://localhost:${port}`);
});
