import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import { chromium } from 'playwright';

import { headlineKey } from '../public/playback-state.js';

const PLAYBACK_STATE_STORAGE_KEY = 'morseNewsPlaybackState';

const currentFetchedAt = '2026-06-05T12:00:00.000Z';
const previousFetchedAt = '2026-06-04T12:00:00.000Z';

const currentHeadlines = Array.from({ length: 12 }, (_, index) => ({
  title: `Current ${String(index + 1).padStart(2, '0')}`,
  source: 'Test Source',
  category: 'test',
  link: `https://example.com/current-${index + 1}`,
}));

const previousHeadlines = Array.from({ length: 12 }, (_, index) => ({
  title: `Previous ${String(index + 1).padStart(2, '0')}`,
  source: 'Test Source',
  category: 'test',
  link: `https://example.com/previous-${index + 1}`,
}));

test('browser resets stale legacy cursor when headline sets change', async () => {
  await withApp({ contextOptions: { serviceWorkers: 'block' } }, async ({ page, url }) => {
    await mockHeadlineApi(page);
    await page.addInitScript(({ storageKey, savedState }) => {
      localStorage.setItem(storageKey, JSON.stringify(savedState));
    }, {
      storageKey: PLAYBACK_STATE_STORAGE_KEY,
      savedState: {
        version: 1,
        fetchedAt: '2026-06-03T12:00:00.000Z',
        lastCompletedHeadlineIndex: 8,
        lastCompletedHeadlineKey: headlineKey(currentHeadlines[8]),
        speed: 5,
        durationMinutes: 15,
        frequencyHz: 650,
        updatedAt: Date.now(),
      },
    });

    await page.goto(url);
    await assertActiveHeadline(page, 'Current 01');

    await page.getByRole('button', { name: 'Previous' }).click();
    await assertActiveHeadline(page, 'Previous 01');
  });
});

test('installed app reloads saved headlines and reference page while offline', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'morse-news-offline-'));
  const offlineHeadlines = [
    'Offline practice headline number one',
    'Offline practice headline number two',
  ].map((title) => ({ title, source: 'Test Source', category: 'test', link: '' }));
  const dayMs = 24 * 60 * 60 * 1000;
  const archiveSet = (daysAgo) => ({
    fetchedAt: new Date(Date.now() - daysAgo * dayMs).toISOString(),
    headlines: [{ title: `Archived headline from ${daysAgo} days ago`, source: 'Test Source', category: 'test', link: '' }],
  });
  await writeFile(path.join(dataDir, 'headlines-cache.json'), JSON.stringify({
    fetchedAt: new Date().toISOString(),
    headlines: offlineHeadlines,
  }));
  await writeFile(path.join(dataDir, 'headlines-archive.json'), JSON.stringify({
    snapshots: [archiveSet(1), archiveSet(2), archiveSet(10)],
  }));

  try {
    await withApp({ env: { DATA_DIR: dataDir } }, async ({ context, page, url }) => {
      await page.route('https://www.gstatic.com/**', (route) => route.fulfill({
        contentType: 'application/javascript',
        body: '',
      }));

      const manifest = await (await page.request.get(`${url}/manifest.webmanifest`)).json();
      assert.equal(manifest.display, 'standalone');
      assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));

      await page.goto(url);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      await page.locator('.headline-title', { hasText: 'number one' }).waitFor();
      await page.waitForFunction(async () => {
        const cache = await caches.open('morse-news-data');
        return Boolean(await cache.match('/api/headlines?index=2'));
      });
      assert.equal(await page.evaluate(async () => {
        const cache = await caches.open('morse-news-data');
        return Boolean(await cache.match('/api/headlines?index=3'));
      }), false, 'sets older than the history window are not saved');

      await context.setOffline(true);
      await page.reload();
      await page.locator('.headline-title', { hasText: 'number two' }).waitFor();
      await page.waitForFunction(() => document.querySelector('#snapshot-time')?.textContent.startsWith('Offline'));
      assert.match(await page.locator('#headline-count').textContent(), /saved for offline practice/);

      await page.getByRole('button', { name: 'Previous' }).click();
      await page.locator('.headline-title', { hasText: 'from 1 days ago' }).waitFor();
      await page.getByRole('button', { name: 'Previous' }).click();
      await page.locator('.headline-title', { hasText: 'from 2 days ago' }).waitFor();
      await page.getByRole('button', { name: 'Previous' }).click();
      await page.waitForFunction(() => document.querySelector('#headline-count')?.textContent.includes('not saved on this device'));

      await page.goto(`${url}/reference`);
      await page.locator('.morse-table .morse-play').first().waitFor();
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('install button uses the browser install prompt and hides afterwards', async () => {
  await withApp({ contextOptions: { serviceWorkers: 'block' } }, async ({ page, url }) => {
    await mockHeadlineApi(page);
    await page.goto(url);
    await page.locator('.headline-title').first().waitFor();
    assert.equal(await page.locator('#install-row').isVisible(), false);

    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = async () => { window.__installPromptShown = true; };
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
    });
    await page.getByRole('button', { name: 'Install app' }).click();
    assert.equal(await page.evaluate(() => window.__installPromptShown), true);
    assert.equal(await page.locator('#install-row').isVisible(), false);
  });
});

test('install button shows Add to Home Screen hint on iOS', async () => {
  const contextOptions = {
    serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  };
  await withApp({ contextOptions }, async ({ page, url }) => {
    await mockHeadlineApi(page);
    await page.goto(url);
    await page.getByRole('button', { name: 'Install app' }).click();
    await page.getByText('Tap Share, then Add to Home Screen.').waitFor();
  });
});

test('install button stays hidden when running as the installed app', async () => {
  const contextOptions = {
    serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  };
  await withApp({ contextOptions }, async ({ page, url }) => {
    await mockHeadlineApi(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true });
    });
    await page.goto(url);
    await page.locator('.headline-title').first().waitFor();
    assert.equal(await page.locator('#install-row').isVisible(), false);
  });
});

async function withApp({ env = {}, contextOptions = {} } = {}, run) {
  const port = await findOpenPort();
  const server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.resume();
  server.stderr.resume();

  let browser;
  try {
    await waitForServer(`http://127.0.0.1:${port}`);
    browser = await chromium.launch();
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await run({ context, page, url: `http://127.0.0.1:${port}` });
  } finally {
    await browser?.close();
    await stopServer(server);
  }
}

async function mockHeadlineApi(page) {
  await page.route('https://www.gstatic.com/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: '',
  }));

  await page.route('**/api/headlines**', (route) => {
    const url = new URL(route.request().url());
    const index = Number(url.searchParams.get('index') ?? '0');
    const payload = index > 0
      ? headlinePayload(previousHeadlines, previousFetchedAt, 1)
      : headlinePayload(currentHeadlines, currentFetchedAt, 0);

    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

function headlinePayload(headlines, fetchedAt, index) {
  return {
    fetchedAt,
    headlines,
    archive: {
      index,
      count: 2,
      hasPrevious: index === 0,
      hasNext: index > 0,
    },
  };
}

async function assertActiveHeadline(page, expectedTitle) {
  const activeTitle = page.locator('.headline-list li.next-headline .headline-title');
  await activeTitle.waitFor({ state: 'visible' });
  await page.waitForFunction((title) => {
    return document.querySelector('.headline-list li.next-headline .headline-title')?.textContent === title;
  }, expectedTitle);
  await assert.equal(await activeTitle.textContent(), expectedTitle);
}

async function findOpenPort() {
  const { createServer } = await import('node:net');
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForServer(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until the child process finishes binding the port.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    once(server, 'exit'),
    delay(2000).then(() => {
      if (server.exitCode === null) server.kill('SIGKILL');
    }),
  ]);
}
