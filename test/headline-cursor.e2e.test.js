import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
  await withApp(async ({ page, url }) => {
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

async function withApp(run) {
  const port = await findOpenPort();
  const server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.resume();
  server.stderr.resume();

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await waitForServer(`http://127.0.0.1:${port}`);
    await run({ page, url: `http://127.0.0.1:${port}` });
  } finally {
    await browser.close();
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
