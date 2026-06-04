# Morse News

A small, no-bundler Morse code practice site that sends daily news headlines as CW audio using Farnsworth timing.

## Run

```bash
npm install
npm start
```

Open <http://localhost:3000> on a desktop, or from a phone on the same network using the host machine's LAN IP and port 3000.

## Features

- Cached headline feed at `/api/headlines`, refreshed on Pacific 6-hour windows
- Generic source mix: NPR, New York Times, The Guardian World, and ScienceDaily
- Sports headline filtering and article links when the RSS feed provides a URL
- 30-day archive of headline snapshots with previous/next navigation
- Mobile-friendly practice interface
- 5, 10, 15, and 20 WPM effective copy speeds
- Farnsworth timing: characters at 20 WPM, spacing stretched for slower selected speeds
- 5/10/15 minute sessions
- Adjustable sidetone frequency

## Notes

This intentionally avoids a build step. The frontend is plain HTML/CSS/JS and the server is a small Express app.

Headline cache and archive files are written to `DATA_DIR`, then `RAILWAY_VOLUME_MOUNT_PATH`,
then local `./data` as a fallback. For Railway persistence across deploys, mount a Railway
Volume at `/app/data`; local development will keep using the repo's `data/` directory.

The Express process owns headline refreshes. A server timer checks every 15 minutes and refreshes
only when the cached snapshot is not from the current Pacific 6-hour window: midnight, 6 AM, noon,
or 6 PM. Requests serve the current cache/archive and make sure the timer is running; they do not
fetch RSS feeds inline.
