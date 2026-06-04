import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveDataDir } from './data-dir.js';

export { resolveDataDir };

const CACHE_DIR = resolveDataDir();
const CACHE_FILE = path.join(CACHE_DIR, 'headlines-cache.json');
const ARCHIVE_FILE = path.join(CACHE_DIR, 'headlines-archive.json');
const MAX_HEADLINES = 24;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ARCHIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SPORTS_RE = /\b(sports?|football|basketball|baseball|soccer|tennis|golf|hockey|olympics?|nba|nfl|mlb|nhl|fifa|wimbledon|championships?|tournament|playoffs?|athlete|player|coach|serena)\b/i;

const SOURCES = [
  {
    name: 'NPR News',
    category: 'national',
    url: 'https://feeds.npr.org/1001/rss.xml',
    excludeSports: true,
  },
  {
    name: 'New York Times',
    category: 'general',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    excludeSports: true,
  },
  {
    name: 'The Guardian',
    category: 'world',
    url: 'https://www.theguardian.com/world/rss',
    excludeSports: true,
  },
  {
    name: 'ScienceDaily',
    category: 'science',
    url: 'https://www.sciencedaily.com/rss/top/science.xml',
    excludeSports: true,
  },
];
const SOURCE_SIGNATURE = SOURCES.map(({ name, url }) => `${name}:${url}`).join('|');

export async function fetchHeadlines({ force = false, now = new Date() } = {}) {
  const cached = await readCache();
  if (!force && cached && cached.sourceSignature === SOURCE_SIGNATURE && now - new Date(cached.fetchedAt) < CACHE_TTL_MS) {
    const archive = await getArchive(now, cached);
    return withArchive(cached, archive, 0, now);
  }

  const settled = await Promise.allSettled(SOURCES.map(fetchSource));
  const items = settled
    .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .filter((item) => item.title.length >= 8);

  const unique = excludePreviousSnapshotHeadlines(dedupe(items), cached).slice(0, MAX_HEADLINES);
  if (unique.length === 0 && cached) {
    const archive = await getArchive(now, cached);
    return withArchive({ ...cached, stale: true }, archive, 0, now);
  }
  if (unique.length === 0) throw new Error('No headlines returned from sources');

  const payload = {
    fetchedAt: now.toISOString(),
    sourceSignature: SOURCE_SIGNATURE,
    sources: SOURCES.map(({ name, category }) => ({ name, category })),
    headlines: unique,
  };
  await writeCache(payload);
  const archive = await saveArchive(payload, now, cached);
  return withArchive(payload, archive, 0, now);
}

export async function getHeadlineSnapshot({ index = 0, now = new Date() } = {}) {
  const current = await fetchHeadlines({ now });
  if (index <= 0) return current;

  const archive = await getArchive(now, current);
  const safeIndex = Math.min(index, Math.max(0, archive.length - 1));
  const snapshot = archive[safeIndex] ?? current;
  return withArchive(snapshot, archive, safeIndex, now);
}

export async function getCachedHeadlineSnapshot({ index = 0, now = new Date() } = {}) {
  const cached = await readCache();
  const archive = await getArchive(now, cached);
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, archive.length - 1));
  const snapshot = archive[safeIndex] ?? cached;
  if (!snapshot) throw new Error('No cached headlines available yet');
  return withArchive(snapshot, archive, safeIndex, now);
}

export async function readHeadlineCache() {
  return readCache();
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
  return parseRssItems(xml)
    .filter((item) => !source.excludeSports || !isSportsItem(item))
    .slice(0, 8)
    .map((item) => ({
      title: normalizeHeadline(item.title),
      source: source.name,
      category: source.category,
      link: item.link,
    }));
}

export function parseRssTitles(xml) {
  return parseRssItems(xml).map((item) => item.title);
}

export function parseRssItems(xml) {
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  return itemBlocks
    .map(parseRssItem)
    .filter((item) => item.title);
}

export function normalizeHeadline(title) {
  return title
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/—|–/g, '-')
    .trim();
}

function parseRssItem(block) {
  return {
    title: cleanXmlText(firstTagValue(block, 'title')),
    link: cleanUrl(cleanXmlText(firstTagValue(block, 'link'))),
    categories: allTagValues(block, 'category').map(cleanXmlText).filter(Boolean),
  };
}

function firstTagValue(block, tagName) {
  return block.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'))?.[1] ?? '';
}

function allTagValues(block, tagName) {
  return [...block.matchAll(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'gi'))]
    .map((match) => match[1]);
}

function cleanXmlText(value) {
  return decodeXml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
}

function cleanUrl(value) {
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function isSportsItem(item) {
  const haystack = [item.title, item.link, ...item.categories].join(' ');
  return SPORTS_RE.test(haystack) || /\/sport(s)?\//i.test(item.link);
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = headlineDedupeKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function excludePreviousSnapshotHeadlines(items, previousSnapshot) {
  if (!previousSnapshot || !Array.isArray(previousSnapshot.headlines)) return items;

  const previousKeys = new Set(previousSnapshot.headlines.map(headlineDedupeKey));
  return items.filter((item) => !previousKeys.has(headlineDedupeKey(item)));
}

function headlineDedupeKey(item) {
  return String(item?.title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
}

async function getArchive(now, current = null) {
  return pruneArchive(await readArchive(), now, current);
}

async function saveArchive(snapshot, now, previousSnapshot = null) {
  const archive = pruneArchive([previousSnapshot, ...await readArchive()].filter(Boolean), now, snapshot);
  await writeArchive(archive);
  return archive;
}

function pruneArchive(archive, now, extraSnapshot = null) {
  const cutoff = now.getTime() - ARCHIVE_TTL_MS;
  const byFetchedAt = new Map();

  for (const snapshot of [extraSnapshot, ...archive].filter(Boolean)) {
    if (!snapshot.fetchedAt || !Array.isArray(snapshot.headlines)) continue;
    const fetchedAt = new Date(snapshot.fetchedAt);
    if (Number.isNaN(fetchedAt.getTime()) || fetchedAt.getTime() < cutoff) continue;
    byFetchedAt.set(snapshot.fetchedAt, stripArchiveMetadata(snapshot));
  }

  return [...byFetchedAt.values()]
    .sort((a, b) => new Date(b.fetchedAt) - new Date(a.fetchedAt));
}

function stripArchiveMetadata(snapshot) {
  const { archive: _archive, stale: _stale, currentAgeMs: _currentAgeMs, ...clean } = snapshot;
  return clean;
}

function withArchive(snapshot, archive, index, now) {
  const clean = stripArchiveMetadata(snapshot);
  const currentAgeMs = now - new Date(clean.fetchedAt);
  return {
    ...clean,
    currentAgeMs,
    stale: Boolean(snapshot.stale) || currentAgeMs >= CACHE_TTL_MS,
    archive: {
      index,
      count: archive.length,
      hasPrevious: index < archive.length - 1,
      hasNext: index > 0,
    },
  };
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

async function readArchive() {
  try {
    const data = JSON.parse(await fs.readFile(ARCHIVE_FILE, 'utf8'));
    return Array.isArray(data.snapshots) ? data.snapshots : [];
  } catch {
    return [];
  }
}

async function writeArchive(snapshots) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(ARCHIVE_FILE, JSON.stringify({ snapshots }, null, 2));
}
