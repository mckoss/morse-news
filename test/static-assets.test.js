import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('page cache-busts browser assets for each deployed version', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(html, /<span id="version">v 1\.16<\/span>/);
  assert.match(html, /href="\/styles\.css\?v=1\.16"/);
  assert.match(html, /src="\/app\.js\?v=1\.16"/);
  assert.match(html, /cast_sender\.js\?loadCastFramework=1/);
  assert.match(html, /data-cast-speed="20"/);
});

test('static assets revalidate instead of sticking in mobile browser cache', async () => {
  const serverJs = await readFile(new URL('../server.js', import.meta.url), 'utf8');

  assert.match(serverJs, /maxAge:\s*0/);
  assert.match(serverJs, /Cache-Control['"],\s*['"]no-cache, must-revalidate/);
});

test('headline route serves cache while scheduler owns RSS refreshes', async () => {
  const serverJs = await readFile(new URL('../server.js', import.meta.url), 'utf8');

  assert.match(serverJs, /ensureHeadlineRefreshTimer\(\)/);
  assert.match(serverJs, /getCachedHeadlineSnapshot/);
  assert.doesNotMatch(serverJs, /fetchHeadlines/);
});

test('cast media URLs are versioned and manifest revalidates', async () => {
  const serverJs = await readFile(new URL('../server.js', import.meta.url), 'utf8');

  assert.match(serverJs, /mediaVersion/);
  assert.match(serverJs, /\/api\/cast-audio\/\$\{entry\.speedWpm\}\.mp3\?v=\$\{mediaVersion\}/);
  assert.match(serverJs, /Cache-Control['"],\s*['"]no-cache, must-revalidate/);
});

test('cast sender retries transient loadMedia failures', async () => {
  const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appJs, /loadCastMediaWithRetry/);
  assert.match(appJs, /attempts = 2/);
  assert.match(appJs, /session\.loadMedia\(request\)/);
});
