# AGENTS.md

This file is the handoff guide for coding agents working on Morse News. Prefer these repo-local instructions over external memory or chat history.

## Project Shape

Morse News is a small no-bundler web app:

- `server.js` is the Express server and owns the HTTP routes.
- `public/` is plain browser HTML/CSS/JS loaded directly by the page.
- `src/` contains server-side helpers for headlines, refresh scheduling, data paths, and Cast audio generation.
- `test/` uses Node's built-in test runner.

Keep the project simple. Do not add a frontend framework, bundler, TypeScript, database, queue, or cron service unless the change clearly needs it.

## Commands

```bash
npm install
npm test
npm start
```

Local app URL: `http://localhost:3000`.

Before committing code changes, run:

```bash
npm test
git diff --check
```

## Runtime And Data

Headline cache, archive files, and generated Cast media are written under the resolved data directory:

1. `DATA_DIR`
2. `RAILWAY_VOLUME_MOUNT_PATH`
3. local `./data`

Local `data/` contents are generated/runtime state. Do not treat them as source unless a task explicitly asks for fixture work.

The app refreshes headlines from inside the Express process. The scheduler checks every 15 minutes and refreshes only when the cached snapshot is stale for the current Pacific 6-hour window: midnight, 6 AM, noon, or 6 PM.

## Deployment

The live app is deployed from GitHub `main` to Railway:

`https://morse-news.mckoss.com`

When a browser-loaded file changes, bump all of these together:

- `package.json` version
- `package-lock.json` version
- visible version in `public/index.html`
- `/styles.css?v=...` in `public/index.html`
- `/app.js?v=...` in `public/index.html`
- version assertions in `test/static-assets.test.js`

The app intentionally serves mutable static assets with `Cache-Control: no-cache, must-revalidate`; still bump query versions so mobile browsers and deployed pages reliably pick up changes.

## Google Cast Notes

Cast playback is controlled by the sender page, but the Google Cast receiver fetches media URLs directly.

Implications:

- `http://localhost:3000` can verify page behavior, JSON, headers, and URL shape.
- Localhost cannot prove real Cast playback, because `localhost` means the receiver device, not the development machine.
- A LAN URL may work if the phone, speaker, and development machine are on the same network and the port is reachable.
- The real Cast test target is the public HTTPS site: `https://morse-news.mckoss.com`.

Cast media is prebuilt as mono MP3 for 5/10/15/20/25/30 WPM. `/api/cast-audio` returns the manifest and versioned public media URLs. `/api/cast-audio/:speedWpm.mp3` serves the cached MP3 files.

Timing is Farnsworth below 20 WPM: characters stay at 20 WPM while spacing stretches. Speeds above 20 WPM are true faster timing, with both characters and spacing sped up.

Receiver startup can be slow. Preserve the sender's warm-up delay and retry behavior unless replacing it with a better proven Cast flow.

## Testing Guidance

Use focused tests for behavior changes:

- `test/headlines.test.js` for RSS parsing, filtering, snapshot freshness, and data path behavior.
- `test/headline-refresh-scheduler.test.js` for refresh timing and singleton scheduler behavior.
- `test/cast-audio.test.js` for generated Cast audio and manifest behavior.
- `test/playback-state.test.js` for browser playback state helpers.
- `test/static-assets.test.js` for cache/version/deploy-sensitive HTML and route assumptions.

For Cast changes, automated tests can cover sender code structure, manifest shape, cache headers, and media generation. Actual receiver playback still needs a public-URL manual test.

## Coding Preferences

- Use ES modules.
- Keep browser code dependency-free unless there is a strong reason.
- Prefer small functions and explicit state over abstractions that hide timing or playback behavior.
- Avoid unrelated refactors while fixing playback, scheduling, or deploy issues.
- Remove dead code rather than leaving disabled branches or comments.
- Preserve ASCII unless editing existing user-facing copy that already uses non-ASCII punctuation.

## Git Hygiene

Do not commit generated runtime files from `data/`.

Before a handoff, summarize:

- what changed,
- what command(s) passed,
- whether the live site was verified,
- any manual Cast testing still needed.
