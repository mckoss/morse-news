import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

test('page template uses package-driven placeholders for deployed version', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(html, /<span id="version">v \{\{APP_DISPLAY_VERSION\}\}<\/span>/);
  assert.match(html, /href="\/styles\.css\?v=\{\{APP_ASSET_VERSION\}\}"/);
  assert.match(html, /src="\/app\.js\?v=\{\{APP_ASSET_VERSION\}\}"/);
  assert.match(html, /by <a href="https:\/\/www\.qrz\.com\/db\/K7MCK">K7MCK<\/a>/);
  assert.match(html, /cast_sender\.js\?loadCastFramework=1/);
  assert.match(html, /data-speed="25"/);
  assert.match(html, /data-speed="30"/);
  assert.match(html, /<span>Cast latest headlines<\/span>/);
  assert.match(html, /Latest headline set only/);
  assert.match(html, /href="\/reference"/);
  assert.match(html, /<select id="cast-speed" disabled>/);
  assert.match(html, /<option value="30">30 WPM<\/option>/);
  assert.match(html, /<input id="frequency"[^>]+value="550"/);
  assert.match(html, /<output id="frequency-label">550 Hz<\/output>/);
  assert.match(html, /id="start-cast"/);
  assert.doesNotMatch(html, /Today’s headlines/);
  assert.match(html, /id="pause-cast"/);
});

test('server renders visible version and asset URLs from package.json', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const port = 36000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(child);
    const res = await fetch(`http://127.0.0.1:${port}/`, { cache: 'no-store' });
    const html = await res.text();
    const displayVersion = displayVersionForPackage(packageJson.version);

    assert.equal(res.status, 200);
    assert.match(html, new RegExp(`<span id="version">v ${escapeRegExp(displayVersion)}</span>`));
    assert.match(html, new RegExp(`href="/styles\\.css\\?v=${escapeRegExp(packageJson.version)}"`));
    assert.match(html, new RegExp(`src="/app\\.js\\?v=${escapeRegExp(packageJson.version)}"`));
    assert.doesNotMatch(html, /\{\{APP_/);
  } finally {
    child.kill();
  }
});

test('server renders reference page with package-driven asset URLs', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const port = 37000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(child);
    const res = await fetch(`http://127.0.0.1:${port}/reference`, { cache: 'no-store' });
    const html = await res.text();
    const displayVersion = displayVersionForPackage(packageJson.version);

    assert.equal(res.status, 200);
    assert.match(html, new RegExp(`<span id="version">v ${escapeRegExp(displayVersion)}</span>`));
    assert.match(html, new RegExp(`href="/styles\\.css\\?v=${escapeRegExp(packageJson.version)}"`));
    assert.match(html, new RegExp(`src="/reference\\.js\\?v=${escapeRegExp(packageJson.version)}"`));
    assert.doesNotMatch(html, /\{\{APP_/);
  } finally {
    child.kill();
  }
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
  assert.match(serverJs, /\/api\/cast-audio\/\$\{mediaVersion\}\/\$\{entry\.speedWpm\}\.mp3/);
  assert.match(serverJs, /max-age=86400, immutable/);
  assert.match(serverJs, /Cache-Control['"],\s*['"]no-cache, must-revalidate/);
});

test('cast sender retries transient loadMedia failures', async () => {
  const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appJs, /loadCastMediaWithRetry/);
  assert.match(appJs, /CAST_NEW_SESSION_READY_DELAY_MS = 2500/);
  assert.match(appJs, /CAST_LOAD_ATTEMPTS = 4/);
  assert.match(appJs, /context\.getCurrentSession\(\) \|\| session/);
  assert.match(appJs, /session\.loadMedia\(request\)/);
  assert.match(appJs, /request\.autoplay = true/);
  assert.match(appJs, /request\.currentTime = 0/);
  assert.match(appJs, /mediaVersion: manifest\.mediaVersion/);
  assert.match(appJs, /stopExistingCastMedia/);
  assert.match(appJs, /mediaSession\.stop\(request, resolve, reject\)/);
  assert.match(appJs, /setCastPendingSpeed\(speedWpm\);/);
  assert.match(appJs, /await loadCastMediaWithRetry\(\(\) => context\.getCurrentSession\(\) \|\| session, request\);\n\s+if \(state\.castLoadRunId !== loadRunId\) return;\n\s+setCastPendingSpeed\(null\);\n\s+setCastingSpeed\(speedWpm\);/);
  assert.match(appJs, /els\.castStatus\.textContent = speedWpm[\s\S]*Casting latest headlines at \$\{speedWpm\} WPM/);
});

test('cast sender can cancel a pending first connection', async () => {
  const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appJs, /castPendingSpeed: null/);
  assert.match(appJs, /function stopCasting\(\) \{[\s\S]*state\.castLoadRunId \+= 1/);
  assert.match(appJs, /function stopCasting\(\) \{[\s\S]*setCastPendingSpeed\(null\);\n\s+setCastingSpeed\(null\);/);
  assert.match(appJs, /function updateCastSessionState\(\) \{[\s\S]*if \(state\.castPendingSpeed\) \{[\s\S]*return;/);
  assert.match(appJs, /els\.stopCast\.classList\.toggle\('hidden', !state\.castingSpeed && !state\.castPendingSpeed\)/);
});

test('cast sender wires remote player pause and resume controls', async () => {
  const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appJs, /new cast\.framework\.RemotePlayer\(\)/);
  assert.match(appJs, /new cast\.framework\.RemotePlayerController\(state\.castRemotePlayer\)/);
  assert.match(appJs, /RemotePlayerEventType\?\.ANY_CHANGE/);
  assert.match(appJs, /controller\.playOrPause\(\)/);
  assert.match(appJs, /player\?\.isPaused \? 'Resume casting' : 'Pause casting'/);
  assert.match(appJs, /player\?\.isMediaLoaded && player\.canPause/);
});

test('reference page renders Morse codes as scaled SVG dots and dashes', async () => {
  const referenceJs = await readFile(new URL('../public/reference.js', import.meta.url), 'utf8');

  assert.match(referenceJs, /const DOT_DIAMETER = 8/);
  assert.match(referenceJs, /const DASH_WIDTH = DOT_DIAMETER \* 3/);
  assert.match(referenceJs, /document\.createElementNS\(SVG_NS, 'circle'\)/);
  assert.match(referenceJs, /document\.createElementNS\(SVG_NS, 'rect'\)/);
  assert.match(referenceJs, /dash\.setAttribute\('rx', String\(DOT_DIAMETER \/ 2\)\)/);
  assert.doesNotMatch(referenceJs, /codeCell\.textContent = code/);
});

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 5000);
    const onData = (chunk) => {
      output += chunk.toString('utf8');
      if (output.includes('Morse News listening')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited ${code}: ${output}`));
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function displayVersionForPackage(version) {
  const minorMatch = /^(\d+\.\d+)\.0$/.exec(version);
  if (minorMatch) return minorMatch[1];

  const match = /^(\d+)\.0\.(\d+)$/.exec(version);
  return match ? `${match[1]}.${match[2]}` : version;
}
