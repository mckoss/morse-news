import fs from 'node:fs/promises';
import path from 'node:path';

const CACHE_DIR = path.resolve('data');
const CACHE_FILE = path.join(CACHE_DIR, 'headlines-cache.json');
const MAX_HEADLINES = 24;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const SOURCES = [
  {
    name: 'NPR News',
    category: 'national',
    url: 'https://feeds.npr.org/1001/rss.xml',
  },
  {
    name: 'AP Top News',
    category: 'general',
    url: 'https://rsshub.app/apnews/topics/apf-topnews',
  },
  {
    name: 'ScienceDaily',
    category: 'science',
    url: 'https://www.sciencedaily.com/rss/top/science.xml',
  },
  {
    name: 'NASA Breaking News',
    category: 'science',
    url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
  },
];

export async function fetchHeadlines({ force = false, now = new Date() } = {}) {
  const cached = await readCache();
  if (!force && cached && now - new Date(cached.fetchedAt) < CACHE_TTL_MS) {
    return cached;
  }

  const settled = await Promise.allSettled(SOURCES.map(fetchSource));
  const items = settled
    .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .filter((item) => item.title.length >= 8);

  const unique = dedupe(items).slice(0, MAX_HEADLINES);
  if (unique.length === 0 && cached) return { ...cached, stale: true };
  if (unique.length === 0) throw new Error('No headlines returned from sources');

  const payload = {
    fetchedAt: now.toISOString(),
    sources: SOURCES.map(({ name, category }) => ({ name, category })),
    headlines: unique,
  };
  await writeCache(payload);
  return payload;
}

async function fetchSource(source) {
  const response = await fetch(source.url, {
    headers: {
      'user-agent': 'MorseNews/0.1 (+https://mckoss.com)',
      accept: 'application/rss+xml, application/xml, text/xml',
    },
  });
  if (!response.ok) throw new Error(`${source.name}: ${response.status}`);
  const xml = await response.text();
  return parseRssTitles(xml).slice(0, 8).map((title) => ({
    title: normalizeHeadline(title),
    source: source.name,
    category: source.category,
  }));
}

export function parseRssTitles(xml) {
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  return itemBlocks
    .map((block) => block.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .map(decodeXml)
    .map((title) => title.replace(/<!\[CDATA\[|\]\]>/g, '').trim())
    .filter(Boolean);
}

export function normalizeHeadline(title) {
  return title
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/—|–/g, '-')
    .trim();
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

async function readCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function writeCache(payload) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2));
}
